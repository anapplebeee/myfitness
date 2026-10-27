import { describe, expect, it } from 'vitest';
import { buildMealPlan, planForSlot, withoutPlanPlaceholder } from './meal-plan';
import type { FoodEntry } from './types';

function food(id: string, date: string, slot: FoodEntry['slot'], source?: FoodEntry['source']): FoodEntry {
  return { id, date, slot, label: id, kcal: 100, protein: 10, source, createdAt: '' };
}

describe('buildMealPlan', () => {
  it('把 2000 kcal / 150g 蛋白拆到四餐', () => {
    const plan = buildMealPlan(2000, 150);
    expect(plan.map((p) => [p.slot, p.kcal, p.protein])).toEqual([
      ['breakfast', 500, 38],
      ['lunch', 700, 53],
      ['dinner', 600, 45],
      ['snack', 200, 15],
    ]);
  });

  it('份额合计为 1，不会凭空多出或少掉热量', () => {
    const total = buildMealPlan(2000, 150).reduce((s, p) => s + p.share, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('没有热量目标 → 空计划（不编假目标）', () => {
    expect(buildMealPlan(null, 150)).toEqual([]);
    expect(buildMealPlan(0, 150)).toEqual([]);
    expect(buildMealPlan(-100, 150)).toEqual([]);
  });

  it('只设了热量没设蛋白 → 蛋白为 0，不猜', () => {
    const plan = buildMealPlan(1800, null);
    expect(plan.every((p) => p.protein === 0)).toBe(true);
    expect(plan.reduce((s, p) => s + p.kcal, 0)).toBe(1800);
  });
});

describe('planForSlot', () => {
  it('取对应餐次，找不到返回 null', () => {
    const plan = buildMealPlan(2000, 150);
    expect(planForSlot(plan, 'lunch')?.kcal).toBe(700);
    expect(planForSlot([], 'lunch')).toBeNull();
  });
});

describe('withoutPlanPlaceholder', () => {
  it('手动记录同一天同一餐 → 移除"按计划"占位，避免热量算两遍', () => {
    const list = [food('plan', '2026-10-27', 'lunch', 'plan'), food('other', '2026-10-27', 'dinner', 'plan')];
    const next = withoutPlanPlaceholder(list, { date: '2026-10-27', slot: 'lunch', source: 'manual' });
    expect(next.map((f) => f.id)).toEqual(['other']);
  });

  it('不同餐次/不同日期的占位保留', () => {
    const list = [food('a', '2026-10-27', 'dinner', 'plan'), food('b', '2026-10-26', 'lunch', 'plan')];
    const next = withoutPlanPlaceholder(list, { date: '2026-10-27', slot: 'lunch', source: 'manual' });
    expect(next).toHaveLength(2);
  });

  it('写入计划占位本身时不动列表', () => {
    const list = [food('a', '2026-10-27', 'lunch', 'plan')];
    expect(withoutPlanPlaceholder(list, { date: '2026-10-27', slot: 'lunch', source: 'plan' })).toBe(list);
  });
});
