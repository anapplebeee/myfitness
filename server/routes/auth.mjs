/**
 * 账号与设备路由。
 *
 * 响应对齐 §2.1 / §5.3：
 * - 发码对外响应与是否注册无关；
 * - 验证成功才建会话；注销后的邮箱重新注册得到**新账号**，不找回旧数据；
 * - 清空云端/注销需要独立的近期验证令牌，与操作类型绑定、单次使用。
 */
import { recordAudit } from '../audit.mjs';
import { deliverCode } from '../mailer.mjs';
import {
  OTP_PURPOSES,
  consumeChallenge,
  issueChallenge,
  otpFailure,
} from '../auth/otp.mjs';
import {
  createSession,
  issueRecentAuth,
  refreshFailure,
  revokeAllSessions,
  revokeSession,
  rotateRefreshToken,
} from '../auth/sessions.mjs';
import { fail } from '../domain/errors.mjs';
import { emailFingerprint, newId, normalizeEmail, sanitizeDeviceName } from '../domain/ids.mjs';
import { rateKey } from '../rate.mjs';

function accountHash(accountId) {
  return emailFingerprint(accountId);
}

function publicDevice(session, currentSessionId, touchedAt) {
  return {
    sessionId: session.sessionId,
    deviceName: session.deviceName,
    createdAt: session.createdAt,
    lastUsedAt: touchedAt ?? session.lastUsedAt,
    current: session.sessionId === currentSessionId,
  };
}

/**
 * @param {ReturnType<import('../http/router.mjs').createRouter>} router
 */
export function registerAuthRoutes(router) {
  /* ---------- 发验证码 ---------- */
  router.post('/api/cloud/v1/auth/code', async (ctx) => {
    const body = await ctx.json();
    const email = normalizeEmail(body?.email);
    if (!email) throw fail.invalid('EMAIL_INVALID', '邮箱格式不正确');
    const purpose = body?.purpose ?? 'login';
    if (!OTP_PURPOSES.has(purpose)) throw fail.invalid('PURPOSE_INVALID', '不支持的验证用途');

    // IP 级限流可以明确拒绝：它与"该邮箱是否注册"无关，不泄露账号状态
    const ipLimit = ctx.limiter.hit(rateKey('code:ip', emailIpKey(ctx)), 20, 3_600_000, ctx.nowMs);
    if (!ipLimit.allowed) throw fail.rateLimited(ipLimit.retryAfterSeconds);

    /*
     * 邮箱级限流：超限时**仍然返回 202**，只是不再发信。
     * 若这里返回 429，攻击者就能靠"是否被限"判断该邮箱近期是否被请求过。
     */
    const perMinute = ctx.limiter.hit(rateKey('code:min', email), 1, 60_000, ctx.nowMs);
    const perHour = ctx.limiter.hit(rateKey('code:hour', email), 5, 3_600_000, ctx.nowMs);
    const perDay = ctx.limiter.hit(rateKey('code:day', email), 10, 86_400_000, ctx.nowMs);
    const shouldSend = perMinute.allowed && perHour.allowed && perDay.allowed;

    if (shouldSend) {
      const issued = await ctx.store.transaction([`otp:${email}`], (state) => {
        const challenge = issueChallenge(state, {
          email,
          purpose,
          secret: ctx.config.otpSecret,
          ttlSeconds: ctx.config.otpTtlSeconds,
          now: ctx.now,
          requestId: ctx.requestId,
        });
        recordAudit(state, {
          at: ctx.now.toISOString(),
          action: 'auth.code',
          outcome: 'issued',
          accountHash: emailFingerprint(email),
          requestId: ctx.requestId,
          meta: { purpose },
        });
        return { result: challenge };
      });
      await deliverCode(
        ctx.mailer,
        { to: email, code: issued.code, purpose, expiresInSeconds: ctx.config.otpTtlSeconds },
        ctx.requestId,
      );
    }

    return {
      status: 202,
      body: { status: 'accepted', expiresInSeconds: ctx.config.otpTtlSeconds },
    };
  });

  /* ---------- 校验验证码并建立会话 ---------- */
  router.post('/api/cloud/v1/auth/verify', async (ctx) => {
    const body = await ctx.json();
    const email = normalizeEmail(body?.email);
    if (!email) throw fail.invalid('EMAIL_INVALID', '邮箱格式不正确');
    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    if (!/^\d{6}$/.test(code)) throw fail.codeInvalid();

    const perEmail = ctx.limiter.hit(rateKey('verify:email', email), 10, 3_600_000, ctx.nowMs);
    if (!perEmail.allowed) throw fail.rateLimited(perEmail.retryAfterSeconds);
    const perIp = ctx.limiter.hit(rateKey('verify:ip', emailIpKey(ctx)), 30, 3_600_000, ctx.nowMs);
    if (!perIp.allowed) throw fail.rateLimited(perIp.retryAfterSeconds);

    const outcome = await ctx.store.transaction([`otp:${email}`, `account:${email}`], (state) => {
      const check = consumeChallenge(state, {
        email,
        purpose: body?.purpose ?? 'login',
        code,
        secret: ctx.config.otpSecret,
        now: ctx.now,
        maxAttempts: ctx.config.otpMaxAttempts,
      });
      // 失败也要把 attempts 提交掉，否则 5 次上限形同虚设
      if (!check.ok) return { result: { failure: check.code }, persist: check.persist };
      const purpose = state.otp[check.challengeId].purpose;

      let accountId = state.emailIndex[email];
      let created = false;
      const existing = accountId ? state.accounts[accountId] : null;
      if (!existing || existing.status !== 'active') {
        // 注销后的邮箱重新注册 = 新账号；旧数据不找回（§5.2）
        accountId = newId('acc');
        created = true;
        state.accounts[accountId] = {
          accountId,
          emailVerified: true,
          emailHash: emailFingerprint(email),
          status: 'active',
          createdAt: ctx.now.toISOString(),
          deletedAt: null,
          deletionJobId: null,
        };
        state.datasets[accountId] = {
          accountId,
          datasetId: newId('ds'),
          epoch: 1,
          status: 'never_initialized',
          revision: 0,
          snapshot: null,
          snapshotHash: null,
          schemaVersion: null,
          ruleVersion: null,
          updatedAt: null,
          deletionId: null,
          deletedAt: null,
        };
        state.emailIndex[email] = accountId;
      }

      const account = state.accounts[accountId];
      account.lastVerifiedAt = ctx.now.toISOString();

      const deviceName = sanitizeDeviceName(body?.deviceName);
      const session = createSession(state, {
        accountId,
        deviceName,
        config: ctx.config,
        now: ctx.now,
      });

      const recent =
        purpose === 'login'
          ? null
          : issueRecentAuth(state, {
              accountId,
              purpose,
              ttlSeconds: ctx.config.recentAuthTtlSeconds,
              now: ctx.now,
            });

      recordAudit(state, {
        at: ctx.now.toISOString(),
        action: 'auth.verify',
        outcome: 'ok',
        accountHash: accountHash(accountId),
        requestId: ctx.requestId,
        meta: { purpose, created },
      });

      return { result: { accountId, created, session, recent, purpose, deviceName } };
    });

    if (outcome.failure) throw otpFailure(outcome.failure);

    return {
      status: 200,
      body: {
        accountId: outcome.accountId,
        created: outcome.created,
        deviceName: outcome.deviceName,
        sessionId: outcome.session.sessionId,
        accessToken: outcome.session.accessToken,
        accessExpiresAt: outcome.session.accessExpiresAt,
        refreshToken: outcome.session.refreshToken,
        refreshExpiresAt: outcome.session.refreshExpiresAt,
        ...(outcome.recent
          ? {
              recentAuthToken: outcome.recent.token,
              recentAuthExpiresAt: outcome.recent.expiresAt,
              recentAuthPurpose: outcome.purpose,
            }
          : {}),
      },
    };
  });

  /* ---------- 刷新 ---------- */
  router.post('/api/cloud/v1/auth/refresh', async (ctx) => {
    const body = await ctx.json();
    const token = typeof body?.refreshToken === 'string' ? body.refreshToken : '';
    if (!token) throw fail.unauthorized('缺少刷新令牌');

    const tokens = await ctx.store.transaction(['refresh'], (state) => {
      const rotated = rotateRefreshToken(state, {
        refreshToken: token,
        config: ctx.config,
        now: ctx.now,
      });
      if (!rotated.ok) return { result: { failure: rotated.code }, persist: rotated.persist };
      return { result: rotated.tokens };
    });

    // 重放等失败必须**先提交撤销**再抛错，所以这里才抛
    if (tokens.failure) throw refreshFailure(tokens.failure);

    return { status: 200, body: { ...tokens } };
  });

  /* ---------- 退出当前设备 ---------- */
  router.post('/api/cloud/v1/auth/logout', async (ctx) => {
    const identity = await ctx.authenticate();
    await ctx.store.transaction([`account:${identity.accountId}`], (state) => {
      revokeSession(state, identity.sessionId, ctx.now, 'logout');
      recordAudit(state, {
        at: ctx.now.toISOString(),
        action: 'auth.logout',
        outcome: 'ok',
        accountHash: accountHash(identity.accountId),
        requestId: ctx.requestId,
      });
      return { result: null };
    });
    return { status: 204, body: undefined };
  });

  /* ---------- 设备列表 ---------- */
  router.get('/api/cloud/v1/devices', async (ctx) => {
    const identity = await ctx.authenticate();
    const devices = await ctx.store.read((state) =>
      Object.values(state.sessions)
        .filter((session) => session.accountId === identity.accountId && !session.revokedAt)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map((session) =>
          publicDevice(session, identity.sessionId, ctx.touches.peek(session.sessionId)),
        ),
    );
    return { status: 200, body: { devices } };
  });

  /* ---------- 撤销设备 ---------- */
  router.delete('/api/cloud/v1/devices/{sessionId}', async (ctx) => {
    const identity = await ctx.authenticate();
    const targetId = ctx.params.sessionId;

    const result = await ctx.store.transaction([`account:${identity.accountId}`], (state) => {
      const target = state.sessions[targetId];
      // 他人设备一律 404：不透露"这个 id 存在但不属于你"
      if (!target || target.accountId !== identity.accountId) {
        return { result: { found: false } };
      }
      revokeSession(state, targetId, ctx.now, 'device_revoked');
      recordAudit(state, {
        at: ctx.now.toISOString(),
        action: 'device.revoke',
        outcome: 'ok',
        accountHash: accountHash(identity.accountId),
        requestId: ctx.requestId,
        meta: { self: targetId === identity.sessionId },
      });
      return { result: { found: true } };
    });

    if (!result.found) throw fail.notFound();
    return { status: 204, body: undefined };
  });
}

/** IP 限流键：优先真实来源，但只在显式信任代理时才取转发头。 */
function emailIpKey(ctx) {
  return ctx.ip;
}

/** 供其他路由复用：撤销账号下所有会话（清空云端/注销时）。 */
export { revokeAllSessions };
