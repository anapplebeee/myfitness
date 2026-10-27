/**
 * 饮食计划（按餐次的目标分配）。
 *
 * 不猜"具体吃什么"——没有可靠的配餐数据时，编一份菜谱只会误导。
 * 这里只把每日热量/蛋白拆到四个餐次，用户按计划吃完就勾完成；
 * 实际吃的不一样，走手动录入，手动记录会自动替换掉"按计划"占位。
 */

import type { FoodEntry, Slot } from './types';

export interface MealPlanItem {
  slot: Slot;
  share: number;
  kcal: number;
  protein: number;
}

/** 三餐 + 加餐的热量分配，加餐小一些，避免像四顿正餐。 */
const SHARES: ReadonlyArray<{ slot: Slot; share: number }> = [
  { slot: 'breakfast', share: 0.25 },
  { slot: 'lunch', share: 0.35 },
  { slot: 'dinner', share: 0.3 },
  { slot: 'snack', share: 0.1 },
];

/** 没有热量目标就没有计划：不编一份假目标。 */
export function buildMealPlan(
  targetKcal: number | null | undefined,
  targetProtein: number | null | undefined,
): MealPlanItem[] {
  if (!targetKcal || targetKcal <= 0) return [];
  return SHARES.map(({ slot, share }) => ({
    slot,
    share,
    kcal: Math.round(targetKcal * share),
    protein: targetProtein && targetProtein > 0 ? Math.round(targetProtein * share) : 0,
  }));
}

export function planForSlot(plan: MealPlanItem[], slot: Slot): MealPlanItem | null {
  return plan.find((p) => p.slot === slot) ?? null;
}

/**
 * 手动记录时移除同餐次的"按计划"占位。
 *
 * 用户先勾"按计划完成"、之后又补录实际吃的，如果不清掉占位，
 * 热量会被算两遍。只清同一天同一餐次的占位，不影响其他餐次。
 */
export function withoutPlanPlaceholder(
  foods: FoodEntry[],
  entry: Pick<FoodEntry, 'date' | 'slot' | 'source'>,
): FoodEntry[] {
  if (entry.source === 'plan') return foods;
  return foods.filter(
    (f) => !(f.date === entry.date && f.slot === entry.slot && f.source === 'plan'),
  );
}
