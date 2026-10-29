/**
 * 服务端状态形状与初始值。
 *
 * 一个账号一个数据集（§3.1），所有集合以不可猜测标识为键。
 * 这里刻意保存"上一版本与幂等结果同库"：条件写要靠它们在同一事务里完成，
 * 拆到对象存储或缓存会让"提交成功但回执丢了"变成数据分叉。
 */

import { createHash } from 'node:crypto';

/** 账本条目哈希：任何一条被改动都会让后续链条对不上。 */
export function ledgerHash(entry) {
  const payload = JSON.stringify([
    entry.seq,
    entry.at,
    entry.kind,
    entry.accountHash ?? null,
    entry.deletionId ?? null,
    entry.ref ?? null,
    entry.prevHash ?? null,
  ]);
  return `sha256:${createHash('sha256').update(payload, 'utf8').digest('hex')}`;
}

/** 新建空状态。 */
export function createState() {
  return {
    schema: 1,
    /** 账本序号，单调递增，用于连续性校验。 */
    seq: 0,
    accounts: {},
    /** emailNormalized → accountId；仅用于登录查找，不作授权依据。 */
    emailIndex: {},
    sessions: {},
    /** token 摘要 → 刷新令牌记录（支持轮换与重放检测）。 */
    refreshTokens: {},
    /** accountId → 数据集记录（含当前快照）。 */
    datasets: {},
    versions: {},
    /** `${accountId}|${method}|${path}|${key}` → 幂等回执。 */
    idempotency: {},
    otp: {},
    recentAuth: {},
    /** 注销任务：jobId → 状态凭证摘要与删除时间线。 */
    deleteJobs: {},
    audit: [],
    ledger: [],
  };
}

/** 审计条目上限：只保留最近事件，避免无界增长；不保存业务正文。 */
export const AUDIT_LIMIT = 2000;
