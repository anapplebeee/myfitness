/**
 * 设备会话。
 *
 * 三条不能省的规则（§5.3）：
 * 1. 访问令牌 15 分钟；刷新令牌 30 天、服务端只存摘要、每次使用即轮换；
 * 2. 刷新令牌被重复使用时判定为泄露 → **撤销整条会话链**，不是只拒这一次；
 * 3. 每个受保护请求都查一次会话状态，不能只等令牌过期——
 *    否则"撤销设备"在 15 分钟内是假的。
 */
import { fail } from '../domain/errors.mjs';
import { newId } from '../domain/ids.mjs';
import { hashRefreshToken, newRefreshToken, signAccessToken, verifyAccessToken } from './tokens.mjs';

/** 会话最近使用时间的内存缓冲：避免每个请求都写盘。 */
export function createSessionTouchBuffer() {
  /** @type {Map<string, string>} */
  const pending = new Map();
  return {
    touch(sessionId, at) {
      pending.set(sessionId, at);
    },
    /**
     * 把缓冲写进状态（只在已有事务里调用，不额外产生一次写盘）。
     * @param {object} state
     */
    apply(state) {
      for (const [sessionId, at] of pending) {
        const session = state.sessions[sessionId];
        if (session && (!session.lastUsedAt || session.lastUsedAt < at)) {
          session.lastUsedAt = at;
        }
      }
      pending.clear();
    },
    peek(sessionId) {
      return pending.get(sessionId) ?? null;
    },
  };
}

/**
 * 建立会话并签发令牌对。
 * @param {object} state
 * @param {{ accountId: string, deviceName: string, config: any, now: Date }} input
 */
export function createSession(state, { accountId, deviceName, config, now }) {
  const sessionId = newId('ses');
  const refreshToken = newRefreshToken();
  const access = signAccessToken({
    accountId,
    sessionId,
    secret: config.tokenSecret,
    ttlSeconds: config.accessTtlSeconds,
    now,
  });
  const refreshExpiresAt = new Date(now.getTime() + config.refreshTtlDays * 86_400_000).toISOString();

  state.sessions[sessionId] = {
    sessionId,
    accountId,
    deviceName,
    createdAt: now.toISOString(),
    lastUsedAt: now.toISOString(),
    revokedAt: null,
    revokedReason: null,
  };
  state.refreshTokens[hashRefreshToken(refreshToken)] = {
    sessionId,
    accountId,
    createdAt: now.toISOString(),
    expiresAt: refreshExpiresAt,
    revokedAt: null,
    replacedBy: null,
  };

  return {
    sessionId,
    accessToken: access.token,
    accessExpiresAt: access.expiresAt,
    refreshToken,
    refreshExpiresAt,
  };
}

/**
 * 轮换刷新令牌。
 * 重放检测：拿一个"已经被替换过"的刷新令牌来换，说明令牌泄露，撤销整条会话。
 *
 * **不抛异常**：重放时要先把"撤销会话"提交掉，抛异常会让撤销随事务回滚，
 * 攻击者拿着泄露的令牌可以一直换新（测试抓出来的缺陷）。
 * @param {object} state
 * @param {{ refreshToken: string, config: any, now: Date }} input
 * @returns {{ ok: true, tokens: object, persist: true } | { ok: false, code: string, persist: boolean }}
 */
export function rotateRefreshToken(state, { refreshToken, config, now }) {
  const digest = hashRefreshToken(refreshToken);
  const record = state.refreshTokens[digest];
  if (!record) return { ok: false, code: 'REFRESH_INVALID', persist: false };

  const session = state.sessions[record.sessionId];
  if (!session || session.revokedAt) {
    return { ok: false, code: 'SESSION_REVOKED', persist: false };
  }

  if (record.revokedAt) {
    // 重放：撤销会话与名下所有刷新令牌，让两边都必须重新登录
    revokeSession(state, record.sessionId, now, 'refresh_replay');
    return { ok: false, code: 'REFRESH_REPLAY', persist: true };
  }
  if (new Date(record.expiresAt) <= now) {
    return { ok: false, code: 'REFRESH_EXPIRED', persist: false };
  }

  const nextToken = newRefreshToken();
  const nextExpiresAt = new Date(now.getTime() + config.refreshTtlDays * 86_400_000).toISOString();
  record.revokedAt = now.toISOString();
  record.replacedBy = hashRefreshToken(nextToken);
  state.refreshTokens[record.replacedBy] = {
    sessionId: record.sessionId,
    accountId: record.accountId,
    createdAt: now.toISOString(),
    expiresAt: nextExpiresAt,
    revokedAt: null,
    replacedBy: null,
  };

  const access = signAccessToken({
    accountId: record.accountId,
    sessionId: record.sessionId,
    secret: config.tokenSecret,
    ttlSeconds: config.accessTtlSeconds,
    now,
  });
  session.lastUsedAt = now.toISOString();

  return {
    ok: true,
    persist: true,
    tokens: {
      accessToken: access.token,
      accessExpiresAt: access.expiresAt,
      refreshToken: nextToken,
      refreshExpiresAt: nextExpiresAt,
    },
  };
}

/** 刷新失败码 → HTTP 错误（在事务外抛，保证撤销等副作用已提交）。 */
export function refreshFailure(code) {
  if (code === 'REFRESH_REPLAY') return fail.unauthorized('刷新令牌已被使用，出于安全考虑该设备需要重新登录');
  if (code === 'REFRESH_EXPIRED') return fail.unauthorized('刷新令牌已过期，请重新登录');
  if (code === 'SESSION_REVOKED') return fail.unauthorized('设备会话已失效，请重新登录');
  return fail.unauthorized('刷新令牌无效，请重新登录');
}

/** 撤销会话及其全部刷新令牌。 */
export function revokeSession(state, sessionId, now, reason = 'logout') {
  const session = state.sessions[sessionId];
  if (session && !session.revokedAt) {
    session.revokedAt = now.toISOString();
    session.revokedReason = reason;
  }
  for (const record of Object.values(state.refreshTokens)) {
    if (record.sessionId === sessionId && !record.revokedAt) {
      record.revokedAt = now.toISOString();
      record.revokedReason = reason;
    }
  }
}

/** 撤销账号名下所有会话（注销、清空后的强制重登）。 */
export function revokeAllSessions(state, accountId, now, reason) {
  for (const session of Object.values(state.sessions)) {
    if (session.accountId === accountId) revokeSession(state, session.sessionId, now, reason);
  }
}

/**
 * 校验访问令牌 + 会话状态 + 账号状态。
 * @param {object} state
 * @param {string} token
 * @param {{ config: any, now: Date }} options
 */
export function authenticate(state, token, { config, now }) {
  const payload = verifyAccessToken(token, { secret: config.tokenSecret, now });
  if (!payload) throw fail.unauthorized();

  const session = state.sessions[payload.sessionId];
  if (!session || session.accountId !== payload.accountId) throw fail.unauthorized();
  if (session.revokedAt) throw fail.unauthorized('该设备授权已被撤销');

  const account = state.accounts[payload.accountId];
  if (!account || account.status !== 'active') throw fail.unauthorized('账号不可用');

  return { accountId: payload.accountId, sessionId: payload.sessionId, account, session };
}

/* ---------- 近期验证令牌 ---------- */

/**
 * 签发近期验证令牌（清空云端 / 注销必须用它，不能复用登录态）。
 * @param {object} state
 * @param {{ accountId: string, purpose: string, ttlSeconds: number, now: Date }} input
 */
export function issueRecentAuth(state, { accountId, purpose, ttlSeconds, now }) {
  const token = newRefreshToken();
  const tokenId = newId('ra');
  state.recentAuth[tokenId] = {
    tokenId,
    accountId,
    purpose,
    digest: hashRefreshToken(token),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    consumedAt: null,
  };
  return { token, expiresAt: state.recentAuth[tokenId].expiresAt };
}

/**
 * 消费近期验证令牌：用途必须匹配、未过期、未使用。
 * @param {object} state
 * @param {{ token: string, accountId: string, purpose: string, now: Date }} input
 */
export function consumeRecentAuth(state, { token, accountId, purpose, now }) {
  if (typeof token !== 'string' || !token) {
    throw fail.forbidden('该操作需要重新验证邮箱');
  }
  const digest = hashRefreshToken(token);
  const record = Object.values(state.recentAuth).find((item) => item.digest === digest);
  if (!record) throw fail.forbidden('验证凭证无效，请重新验证');
  if (record.accountId !== accountId) throw fail.forbidden('验证凭证无效，请重新验证');
  if (record.purpose !== purpose) throw fail.forbidden('验证凭证与操作不匹配，请重新验证');
  if (record.consumedAt) throw fail.forbidden('验证凭证已使用，请重新验证');
  if (new Date(record.expiresAt) <= now) throw fail.forbidden('验证凭证已过期，请重新验证');
  record.consumedAt = now.toISOString();
  return { tokenId: record.tokenId };
}
