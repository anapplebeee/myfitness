/**
 * AI 建议的采纳流程（AC-AI04）。
 *
 * 三条硬要求：
 *  1. **同操作去重**：同一份草稿重复点"采纳"不能写两次
 *  2. **采纳前版本变化提示过期**：生成建议到用户点采纳之间，
 *     本地数据可能变了（例如用户自己改了训练），提示要作废
 *  3. **未采纳不改变事实**：草稿只是草稿，只有明确采纳才落库
 *
 * 实现方式：
 * - 生成建议时记录当时的**状态指纹**（对关键字段做稳定哈希）
 * - 采纳时重新算指纹，不一致就拒绝并提示
 * - 用一次性 nonce 做去重键，同一 nonce 只能成功采纳一次
 */

import { stableHash } from './transfer';
import type { AppState } from './types';
import type { Draft } from './ai-draft';

/**
 * 计算"与建议相关"的状态指纹。
 *
 * 只纳入会影响建议合理性的字段：
 * 训练场次、周目标、目标、体重——这些变了，建议就可能过时。
 * 不纳入 cookies 类易变字段（如 lastBackupKey），避免无谓的"已过期"。
 */
export function stateFingerprint(state: AppState): string {
  const payload = {
    sessionCount: state.sessions.filter((s) => !s.deletedAt).length,
    lastSessionId: [...state.sessions]
      .filter((s) => !s.deletedAt)
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0]?.id ?? null,
    weeklyGoal: state.weeklyGoal,
    goals: state.goals.map((g) => (g.kind === 'strength' ? `${g.kind}:${g.exerciseId}:${g.targetGrams}` : g.kind)),
    weightCount: state.weights.length,
    lastWeightId: [...state.weights].sort((a, b) => (a.date < b.date ? 1 : -1))[0]?.id ?? null,
  };
  return stableHash(JSON.stringify(payload));
}

export interface AdoptionRecord {
  /** 去重键：同一份草稿只有一个 */
  nonce: string;
  fingerprint: string;
  adoptedAt: string;
}

export type AdoptOutcome =
  | { ok: true; record: AdoptionRecord }
  | { ok: false; reason: 'stale'; message: string }
  | { ok: false; reason: 'duplicate'; message: string }
  | { ok: false; reason: 'empty'; message: string };

/**
 * 判断能否采纳。
 *
 * 纯函数：不写任何状态，只做判定。
 * 真正的写入由调用方在拿到 ok 后执行，这样"未采纳不改事实"是结构保证的。
 */
export function canAdopt(args: {
  draft: Draft;
  /** 生成草稿时的指纹 */
  draftFingerprint: string;
  /** 当前状态的指纹 */
  currentFingerprint: string;
  /** 已采纳过的 nonce 集合 */
  adoptedNonces: Set<string>;
  /** 本次采纳请求的 nonce */
  nonce: string;
  /** 经过校验后可用项数量 */
  acceptedCount: number;
  now: string;
}): AdoptOutcome {
  if (args.acceptedCount <= 0) {
    return { ok: false, reason: 'empty', message: '没有可采纳的建议项' };
  }

  if (args.adoptedNonces.has(args.nonce)) {
    return {
      ok: false,
      reason: 'duplicate',
      message: '这份建议已经采纳过了，不会重复写入',
    };
  }

  if (args.draftFingerprint !== args.currentFingerprint) {
    return {
      ok: false,
      reason: 'stale',
      message: '数据已经变化，这份建议可能过时了。请重新生成建议再采纳。',
    };
  }

  return {
    ok: true,
    record: { nonce: args.nonce, fingerprint: args.currentFingerprint, adoptedAt: args.now },
  };
}

/**
 * 建议过期的可读描述，用于界面提示。
 * 说明"哪里变了"，而不是只说过期。
 */
export function describeStaleness(before: string, after: string): string {
  if (before === after) return '数据未变化';
  return '本地记录在生成建议后有更新，建议内容可能已不适用';
}
