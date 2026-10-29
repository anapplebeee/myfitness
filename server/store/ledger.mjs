/**
 * 删除台账：账号注销 / 清空云端的"不可复活"证据链。
 *
 * §5.2 要求台账与账号停用/代次变化在同一事务提交。这里台账和业务数据存在
 * 同一个状态文件里，一次原子写即同时落地——这是本实现能给出的最强保证。
 *
 * 诚实说明两点（另见 docs/29 的"未实现"清单）：
 * 1. 跨故障域同步复制需要托管数据库，本实现只有单机 fsync；
 * 2. 台账只有哈希链（篡改可发现），没有外部只读归档，全库恢复时无法证明
 *    "台账覆盖到了对外服务的时间点"。因此这条只能作为内测实现，不满足
 *    CB-A17 / CB-A23 的对外发布要求。
 */
import { ledgerHash } from './state.mjs';

/**
 * 追加一条台账记录（必须与业务变更在同一个 transaction 内调用）。
 * @param {ReturnType<import('./state.mjs').createState>} state
 * @param {{ at: string, kind: string, accountHash?: string | null, deletionId?: string | null, ref?: string | null }} input
 */
export function appendLedger(state, input) {
  const prev = state.ledger.at(-1) ?? null;
  /** @type {Record<string, unknown>} */
  const entry = {
    seq: (prev?.seq ?? 0) + 1,
    at: input.at,
    kind: input.kind,
    accountHash: input.accountHash ?? null,
    deletionId: input.deletionId ?? null,
    ref: input.ref ?? null,
    prevHash: prev?.hash ?? null,
  };
  entry.hash = ledgerHash(entry);
  state.ledger.push(entry);
  state.seq = entry.seq;
  return entry;
}

/**
 * 校验连续性：序号必须从 1 连续递增，prevHash 必须等于上一条的 hash，
 * 每条自身 hash 必须可复算。任何一处不符都视为账本不可信。
 * @param {ReturnType<import('./state.mjs').createState>} state
 * @returns {{ ok: boolean, brokenAt?: number, reason?: string }}
 */
export function verifyLedger(state) {
  let prevHash = null;
  for (let i = 0; i < state.ledger.length; i += 1) {
    const entry = state.ledger[i];
    if (entry.seq !== i + 1) {
      return { ok: false, brokenAt: i + 1, reason: `序号不连续：期望 ${i + 1}，实际 ${entry.seq}` };
    }
    if ((entry.prevHash ?? null) !== prevHash) {
      return { ok: false, brokenAt: i + 1, reason: 'prevHash 与上一条不匹配' };
    }
    if (ledgerHash(entry) !== entry.hash) {
      return { ok: false, brokenAt: i + 1, reason: '台账条目自身哈希不匹配' };
    }
    prevHash = entry.hash;
  }
  return { ok: true };
}
