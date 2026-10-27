/**
 * 完成度：把"练完了"从二态改成有刻度的事实。
 *
 * 问题来源（PM 评审 P0）：16 个计划组只做了 1 组，结束面板写
 * `1 工作组 · 1/16 完成/计划`，确认后今日页照样显示"今天已经练完了"、
 * 周目标 +1。周目标是产品唯一"承诺型"功能，被一次点击廉价化。
 *
 * 口径：
 * - 只有**有效训练**（至少 1 个完成的工作组，或自报）才谈完成度；
 * - 自报训练没有计划组，不判部分完成（用户已明确表示"练过了"）；
 * - 计划组里只算 work 组，热身组不计入分母。
 */

import type { Session } from './types';

/** 低于这个比例视为"部分完成"。 */
export const PARTIAL_RATIO = 0.6;

export interface CompletionSummary {
  completedWorkSets: number;
  plannedWorkSets: number;
  /** 0–1；没有计划组时为 1。 */
  ratio: number;
  /** 有效训练但明显没练完。 */
  partial: boolean;
  /** 人话，例如 "1/16 组"。 */
  text: string;
}

export function completionSummary(session: Session): CompletionSummary {
  const workSets = session.exercises.flatMap((ex) => ex.sets.filter((s) => s.kind === 'work'));
  const plannedWorkSets = workSets.length;
  const completedWorkSets = workSets.filter((s) => s.status === 'completed').length;
  const ratio = plannedWorkSets ? completedWorkSets / plannedWorkSets : 1;

  /*
   * 注意：不能直接复用 isValidCompletedSession——结束面板是在会话还是 active
   * 状态时算的，那个函数要求 status === 'completed'，会永远判成"没练"。
   * 这里只看事实：没删除、没放弃、至少完成一个工作组。
   */
  const countable =
    !session.deletedAt &&
    session.status !== 'discarded' &&
    completedWorkSets > 0 &&
    session.completionBasis !== 'selfReported' &&
    session.completionBasis !== 'legacyReported';

  const partial = countable && plannedWorkSets > 0 && ratio < PARTIAL_RATIO;

  return {
    completedWorkSets,
    plannedWorkSets,
    ratio,
    partial,
    text: plannedWorkSets ? `${completedWorkSets}/${plannedWorkSets} 组` : `${completedWorkSets} 组`,
  };
}

/** 结束面板用：这一场够不够格默认计入周目标。 */
export function shouldDefaultCredit(session: Session): boolean {
  const selfReported =
    session.completionBasis === 'selfReported' || session.completionBasis === 'legacyReported';
  const summary = completionSummary(session);
  // 一个完成的工作组都没有（且不是自报）→ 不算有效训练，更不能默认计入
  if (!selfReported && summary.completedWorkSets === 0) return false;
  return !summary.partial;
}
