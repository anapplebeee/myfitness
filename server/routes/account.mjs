/**
 * 注销账号与删除状态查询。
 *
 * §5.2 / CB-A24 的关键点：注销会撤销全部会话，旧登录态立刻不可用；
 * 客户端在请求前生成 256 位状态凭证并本机持久化，服务端只存摘要。
 * 这样即使成功响应丢失，原设备仍能查任务状态——但只能查**有限状态**，
 * 拿不回任何业务数据，也不能凭邮箱或任务 id 查询。
 */
import { recordAudit } from '../audit.mjs';
import { consumeRecentAuth, revokeAllSessions } from '../auth/sessions.mjs';
import { fail } from '../domain/errors.mjs';
import { emailFingerprint, newId, newToken } from '../domain/ids.mjs';
import { hashRefreshToken } from '../auth/tokens.mjs';
import { appendLedger } from '../store/ledger.mjs';
import { lookupReceipt, purgeExpired, requireIdempotencyKey, requestFingerprint, saveReceipt } from './helpers.mjs';

const ACCOUNT_PATH = '/api/cloud/v1/account';
const DELETION_STATUS_PATH = '/api/cloud/v1/account/deletion';

/**
 * @param {ReturnType<import('../http/router.mjs').createRouter>} router
 */
export function registerAccountRoutes(router) {
  /* ---------- 注销账号 ---------- */
  router.delete(ACCOUNT_PATH, async (ctx) => {
    const identity = await ctx.authenticate();
    const key = requireIdempotencyKey(ctx.req);
    const body = await ctx.json();
    const statusToken = typeof body?.statusToken === 'string' ? body.statusToken : '';
    if (statusToken.length < 32) {
      throw fail.invalid('STATUS_TOKEN_REQUIRED', '注销需要客户端生成的状态查询凭证（≥32 字符）');
    }
    const recentAuth = ctx.req.headers['x-recent-auth'];
    const requestHash = requestFingerprint({
      method: 'DELETE',
      path: ACCOUNT_PATH,
      epoch: null,
      ifMatch: null,
      ifNoneMatch: null,
      hash: hashRefreshToken(statusToken),
    });

    return ctx.store.transaction([`account:${identity.accountId}`], (state) => {
      purgeExpired(state, ctx.now);
      const replay = lookupReceipt(state, {
        accountId: identity.accountId,
        method: 'DELETE',
        path: ACCOUNT_PATH,
        key,
        requestHash,
      });
      if (replay) return { result: { status: replay.status, body: replay.body, headers: { ...replay.headers, 'Idempotent-Replay': 'true' } } };

      consumeRecentAuth(state, {
        token: typeof recentAuth === 'string' ? recentAuth : '',
        accountId: identity.accountId,
        purpose: 'delete_account',
        now: ctx.now,
      });

      const account = state.accounts[identity.accountId];
      const jobId = newId('job');
      const acceptedAt = ctx.now.toISOString();
      const purgeBy = new Date(ctx.now.getTime() + 86_400_000).toISOString();

      revokeAllSessions(state, identity.accountId, ctx.now, 'account_deleted');

      account.status = 'deleted';
      account.deletedAt = acceptedAt;
      account.deletionJobId = jobId;

      const dataset = state.datasets[identity.accountId];
      if (dataset && dataset.status !== 'deleted') {
        dataset.status = 'deleted';
        dataset.epoch += 1;
        dataset.deletionId = newId('del');
        dataset.deletedAt = acceptedAt;
        dataset.deleteBy = purgeBy;
        dataset.revision = 0;
        dataset.snapshot = null;
        dataset.snapshotHash = null;
        dataset.schemaVersion = null;
        dataset.ruleVersion = null;
        dataset.updatedAt = null;
      }
      for (const [id, version] of Object.entries(state.versions)) {
        if (version.accountId === identity.accountId) delete state.versions[id];
      }

      state.deleteJobs = state.deleteJobs ?? {};
      state.deleteJobs[jobId] = {
        jobId,
        accountHash: emailFingerprint(identity.accountId),
        statusTokenDigest: hashRefreshToken(statusToken),
        acceptedAt,
        // 在线数据在本事务内即删除；备份随轮转最迟 30 天（本实现无运维备份，见 docs/29）
        onlinePurgedAt: acceptedAt,
        purgeBy,
        backupPurgeAt: new Date(ctx.now.getTime() + 30 * 86_400_000).toISOString(),
        status: 'completed',
      };

      appendLedger(state, {
        at: acceptedAt,
        kind: 'account_delete',
        accountHash: emailFingerprint(identity.accountId),
        deletionId: dataset?.deletionId ?? null,
        ref: jobId,
      });
      recordAudit(state, {
        at: acceptedAt,
        action: 'account.delete',
        outcome: 'accepted',
        accountHash: emailFingerprint(identity.accountId),
        requestId: ctx.requestId,
        meta: { jobId },
      });

      const view = {
        status: 'accepted',
        jobId,
        acceptedAt,
        onlinePurgeBy: purgeBy,
        backupPurgeAt: state.deleteJobs[jobId].backupPurgeAt,
      };
      saveReceipt(
        state,
        {
          accountId: identity.accountId,
          method: 'DELETE',
          path: ACCOUNT_PATH,
          key,
          requestHash,
          status: 202,
          body: view,
          headers: {},
          operation: 'account_delete',
        },
        { now: ctx.now, config: ctx.config },
      );

      return { result: { status: 202, body: view, headers: {} } };
    });
  });

  /* ---------- 删除状态查询（无需登录） ---------- */
  router.get(DELETION_STATUS_PATH, async (ctx) => {
    const token = ctx.req.headers['x-status-token'];
    if (typeof token !== 'string' || token.length < 32) throw fail.notFound();

    const digest = hashRefreshToken(token);
    const job = await ctx.store.read((state) =>
      Object.values(state.deleteJobs ?? {}).find((record) => record.statusTokenDigest === digest) ?? null,
    );
    if (!job) throw fail.notFound();

    // 只回有限状态，绝不回业务内容或账号标识
    return {
      status: 200,
      body: {
        status: job.status,
        acceptedAt: job.acceptedAt,
        onlinePurgedAt: job.onlinePurgedAt,
        purgeBy: job.purgeBy,
        backupPurgeAt: job.backupPurgeAt,
      },
    };
  });
}

/** 供测试与运维使用：生成一对状态凭证并返回摘要，避免测试里手搓。 */
export function createStatusTokenPair() {
  const token = newToken(32);
  return { token, digest: hashRefreshToken(token) };
}
