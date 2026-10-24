/**
 * 过敏原确定性过滤。
 *
 * 契约见 docs/11-data-model.md §2.1a：
 * - strict 级：排除 contains 与 mayContain
 * - avoid 级：只排除 contains，对 mayContain 给出提示
 * - 未标注：按 mayContain 处理，宁可少推荐
 *
 * 纯函数：同样输入必然得到同样输出，可被单测完全覆盖。
 */

import type { AllergenCode, AllergenPresence, DietRestriction } from './types';

/** 一条食物-过敏原标注。 */
export interface AllergenMark {
  foodId: string;
  code: AllergenCode;
  presence: AllergenPresence;
  sourceRef: string;
}

export interface FoodLike {
  id: string;
  name: string;
}

export type ExclusionReason = 'contains' | 'mayContain' | 'unknown';

export interface ExcludedFood {
  food: FoodLike;
  code: string;
  label: string;
  reason: ExclusionReason;
}

export interface FilterResult<T extends FoodLike> {
  allowed: T[];
  excluded: ExcludedFood[];
  /** 允许但需提示（avoid 级 + mayContain） */
  warnings: ExcludedFood[];
}

/**
 * 查询某食物对某过敏原的标注状态。
 * 没有记录一律返回 mayContain —— 这是安全默认，不是"未知"。
 */
export function presenceOf(marks: AllergenMark[], foodId: string, code: string): AllergenPresence {
  const hit = marks.find((m) => m.foodId === foodId && m.code === code);
  return hit ? hit.presence : 'mayContain';
}

/** 只取过敏原类的限制；intolerance/religious 等走别的规则。 */
export function allergenRestrictions(restrictions: DietRestriction[]): DietRestriction[] {
  return restrictions.filter((r) => r.kind === 'allergen');
}

/**
 * 过滤食物集合。
 *
 * 顺序固定（先按 code 字典序，再按食物 id），保证输出稳定可断言。
 */
export function filterFoods<T extends FoodLike>(
  foods: T[],
  marks: AllergenMark[],
  restrictions: DietRestriction[],
): FilterResult<T> {
  // 稳定排序：相等时返回 0，避免依赖引擎实现
  const active = allergenRestrictions(restrictions).sort((a, b) =>
    a.code < b.code ? -1 : a.code > b.code ? 1 : 0,
  );
  const allowed: T[] = [];
  const excluded: ExcludedFood[] = [];
  const warnings: ExcludedFood[] = [];

  for (const food of foods) {
    let blocked = false;
    for (const r of active) {
      const presence = presenceOf(marks, food.id, r.code);
      if (presence === 'free') continue;

      if (presence === 'contains') {
        excluded.push({ food, code: r.code, label: r.label, reason: 'contains' });
        blocked = true;
        break;
      }

      // mayContain
      if (r.severity === 'strict') {
        excluded.push({ food, code: r.code, label: r.label, reason: 'mayContain' });
        blocked = true;
        break;
      }
      warnings.push({ food, code: r.code, label: r.label, reason: 'mayContain' });
    }
    if (!blocked) allowed.push(food);
  }

  return { allowed, excluded, warnings };
}

/**
 * 未确认限制时不允许生成自动餐单（AC-F03）。
 * 返回 null 表示可以继续，否则返回阻止原因。
 */
export function mealPlanBlocker(profile: {
  restrictionsConfirmed: boolean;
  allergies: string[];
}): string | null {
  if (!profile.restrictionsConfirmed) {
    return '请先在设置里确认你的过敏原与饮食限制，确认后才能生成餐单。';
  }
  return null;
}

/** 统计某组食物对每个过敏原的标注覆盖，供内容审核核对。 */
export function coverageByCode(
  foods: FoodLike[],
  marks: AllergenMark[],
  codes: string[],
): Record<string, { contains: number; mayContain: number; free: number; missing: number }> {
  const out: Record<string, { contains: number; mayContain: number; free: number; missing: number }> = {};
  for (const code of codes) {
    out[code] = { contains: 0, mayContain: 0, free: 0, missing: 0 };
    for (const food of foods) {
      const hit = marks.find((m) => m.foodId === food.id && m.code === code);
      if (!hit) out[code].missing += 1;
      else out[code][hit.presence] += 1;
    }
  }
  return out;
}

