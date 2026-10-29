/**
 * 数据集路由的共用件：幂等回执、版本留存、过期清理。
 *
 * 幂等键作用域是 `账号 | 方法 | 路径 | 键`（§3.1）：同一把 key 在
 * 另一个账号或另一条路径下必须互不影响，否则跨账号重放会泄漏结果。
 */
import { fingerprint } from '../domain/canonical.mjs';
import { fail } from '../domain/errors.mjs';
import { newId } from '../domain/ids.mjs';

/** 请求哈希：方法 + 路径 + 条件 + 代次 + 快照，任何一项不同都算"异请求"。 */
export function requestFingerprint({ method, path, epoch, ifMatch, ifNoneMatch, hash }) {
  return fingerprint({ method, path, epoch: epoch ?? null, ifMatch, ifNoneMatch, hash });
}

/**
 * 取幂等键。缺失直接拒绝——没有幂等键的条件写，一旦响应丢失就无法安全重试。
 * @param {import('node:http').IncomingMessage} req
 */
export function requireIdempotencyKey(req) {
  const raw = req.headers['idempotency-key'];
  if (typeof raw !== 'string' || !raw.trim()) throw fail.idempotencyRequired();
  const key = raw.trim();
  if (key.length < 8 || key.length > 128) {
    throw fail.invalid('IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key 长度需在 8–128 之间');
  }
  return key;
}

/** 幂等作用域。 */
export function idempotencyScope(accountId, method, path, key) {
  return `${accountId}|${method}|${path}|${key}`;
}

/**
 * 查回执：同键同请求 → 原结果；同键异请求 → 409。
 * @param {object} state
 * @param {{ accountId: string, method: string, path: string, key: string, requestHash: string }} input
 */
export function lookupReceipt(state, input) {
  const scope = idempotencyScope(input.accountId, input.method, input.path, input.key);
  const receipt = state.idempotency[scope];
  if (!receipt) return null;
  if (receipt.requestHash !== input.requestHash) {
    throw fail.conflict('IDEMPOTENCY_KEY_REUSED', '同一幂等键被用于不同请求');
  }
  return receipt;
}

/** 保存回执（与业务变更同事务）。 */
export function saveReceipt(state, { accountId, method, path, key, requestHash, status, body, headers, operation }, { now, config }) {
  const scope = idempotencyScope(accountId, method, path, key);
  state.idempotency[scope] = {
    scope,
    key,
    requestHash,
    status,
    body,
    headers: headers ?? {},
    operation: operation ?? null,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + config.idempotencyTtlDays * 86_400_000).toISOString(),
  };
}

/**
 * 清理过期数据：幂等回执 7 天、验证码 1 天、近期验证 1 天。
 * 在每次写入事务里顺带执行，避免再引入一个后台任务。
 */
export function purgeExpired(state, now) {
  const nowMs = now.getTime();
  for (const [scope, receipt] of Object.entries(state.idempotency)) {
    if (new Date(receipt.expiresAt).getTime() <= nowMs) delete state.idempotency[scope];
  }
  for (const [id, record] of Object.entries(state.otp)) {
    const expired = new Date(record.expiresAt).getTime() + 86_400_000 <= nowMs;
    if (expired) delete state.otp[id];
  }
  for (const [id, record] of Object.entries(state.recentAuth)) {
    if (new Date(record.expiresAt).getTime() + 86_400_000 <= nowMs) delete state.recentAuth[id];
  }
}

/**
 * 把当前快照存为一个可恢复历史版本。
 * 相同哈希不重复留档——"最多 10 个**不同**的此前版本"（§5.1）。
 * @param {object} state
 * @param {any} dataset
 * @param {Date} now
 * @returns {string | null} 版本 id
 */
export function archiveCurrentVersion(state, dataset, now) {
  if (!dataset.snapshot || dataset.revision < 1) return null;
  const sameHash = Object.values(state.versions).some(
    (version) => version.accountId === dataset.accountId && version.snapshotHash === dataset.snapshotHash,
  );
  if (sameHash) return null;
  const versionId = newId('ver');
  state.versions[versionId] = {
    versionId,
    accountId: dataset.accountId,
    datasetId: dataset.datasetId,
    epoch: dataset.epoch,
    revision: dataset.revision,
    snapshot: dataset.snapshot,
    snapshotHash: dataset.snapshotHash,
    schemaVersion: dataset.schemaVersion,
    ruleVersion: dataset.ruleVersion,
    createdAt: now.toISOString(),
  };
  return versionId;
}

/** 轮转：只留最近 30 天、最多 10 个。 */
export function pruneVersions(state, accountId, now, config) {
  const cutoff = now.getTime() - config.versionRetentionDays * 86_400_000;
  const candidates = Object.values(state.versions)
    .filter((version) => version.accountId === accountId)
    .filter((version) => new Date(version.createdAt).getTime() > cutoff)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const keep = new Set(candidates.slice(0, config.versionRetentionCount).map((v) => v.versionId));
  for (const [id, version] of Object.entries(state.versions)) {
    if (version.accountId !== accountId) continue;
    const expired = new Date(version.createdAt).getTime() <= cutoff;
    if (expired || !keep.has(id)) delete state.versions[id];
  }
}

/**
 * 列出可恢复版本（未过期、按时间从新到旧）。
 * @param {object} state
 * @param {string} accountId
 * @param {Date} now
 * @param {any} config
 */
export function listVersions(state, accountId, now, config) {
  const cutoff = now.getTime() - config.versionRetentionDays * 86_400_000;
  return Object.values(state.versions)
    .filter((version) => version.accountId === accountId)
    .filter((version) => new Date(version.createdAt).getTime() > cutoff)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, config.versionRetentionCount)
    .map((version) => ({
      versionId: version.versionId,
      datasetId: version.datasetId,
      epoch: version.epoch,
      revision: version.revision,
      snapshotHash: version.snapshotHash,
      schemaVersion: version.schemaVersion,
      ruleVersion: version.ruleVersion,
      createdAt: version.createdAt,
    }));
}
