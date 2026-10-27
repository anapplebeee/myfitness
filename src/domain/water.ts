/**
 * 饮水统计（纯函数）。
 *
 * 按条记录而不是只存每日总量：这样才能做"撤销"和"什么时候喝的"。
 */

import type { WaterEntry } from './types';

/** 每日饮水目标参考值。运动人群常在 2000–2500ml，这里取 2000 并允许用户改。 */
export const DEFAULT_WATER_GOAL_ML = 2000;

/** 快捷添加的常见杯量。 */
export const WATER_QUICK_ADD = [200, 300, 500] as const;

export function waterTotal(entries: WaterEntry[] | undefined, date: string): number {
  return (entries ?? [])
    .filter((e) => e.date === date)
    .reduce((sum, e) => sum + Math.max(0, e.ml), 0);
}

/** 完成度百分比；未设目标时返回 null（不编一个假进度）。 */
export function waterProgress(total: number, goal: number | null | undefined): number | null {
  if (!goal || goal <= 0) return null;
  return Math.min(100, Math.round((total / goal) * 100));
}

/** 一句人话：还差多少 / 已达标多少。 */
export function waterText(total: number, goal: number | null | undefined): string {
  if (!goal || goal <= 0) return `${total} ml`;
  const left = goal - total;
  return left > 0 ? `还差 ${left} ml` : `已达标，超出 ${Math.abs(left)} ml`;
}
