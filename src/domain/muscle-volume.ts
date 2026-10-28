/**
 * 按肌群统计的周组数。
 *
 * 为什么这个指标比"容量"有用：
 * 容量（sets × reps × kg）把胸背腿混成一个数，还奖励大重量复合动作。
 * 教练真正会问的是"这周胸做了多少组？背呢？后束呢？"——
 * 肌群组数是判断"练够没有 / 练偏没有"最直接的口径。
 *
 * 只数**已完成的工作组**：
 * - 热身组不算（它不产生训练刺激）
 * - 计划组、跳过组不算
 */

import type { AppState, MuscleGroup, Session } from './types';
import { EXERCISE_BY_ID, MUSCLES } from '../content/exercises';
import { isValidCompleted } from './metrics';
import { weekRange } from './week';

export interface MuscleSets {
  group: MuscleGroup;
  label: string;
  short: string;
  /** 本周完成的工作组数 */
  sets: number;
}

/** 单场训练里每个肌群各做了几组。 */
export function sessionMuscleSets(session: Session): Map<MuscleGroup, number> {
  const out = new Map<MuscleGroup, number>();
  for (const ex of session.exercises) {
    const meta = EXERCISE_BY_ID.get(ex.exerciseId);
    if (!meta) continue;
    const done = ex.sets.filter((s) => s.kind === 'work' && s.status === 'completed').length;
    if (done === 0) continue;
    out.set(meta.group, (out.get(meta.group) ?? 0) + done);
  }
  return out;
}

/**
 * 某一周各肌群的组数。
 *
 * @param state 应用状态
 * @param weekStart 周一日期
 * @param options.includeZero 是否返回 0 组的肌群（默认 false，避免列表太长）
 */
export function weeklyMuscleSets(
  state: AppState,
  weekStart: string,
  options: { includeZero?: boolean } = {},
): MuscleSets[] {
  const { from, to } = weekRange(weekStart);
  const totals = new Map<MuscleGroup, number>();

  for (const s of state.sessions) {
    if (!isValidCompleted(s)) continue;
    if (s.businessDate < from || s.businessDate >= to) continue;
    for (const [g, n] of sessionMuscleSets(s)) {
      totals.set(g, (totals.get(g) ?? 0) + n);
    }
  }

  const rows: MuscleSets[] = MUSCLES.map((m) => ({
    group: m.id,
    label: m.label,
    short: m.short,
    sets: totals.get(m.id) ?? 0,
  }));

  const filtered = options.includeZero ? rows : rows.filter((r) => r.sets > 0);
  return filtered.sort((a, b) => b.sets - a.sets);
}

/** 合计组数，用于"本周共 N 组"。 */
export function totalMuscleSets(rows: MuscleSets[]): number {
  return rows.reduce((s, r) => s + r.sets, 0);
}
