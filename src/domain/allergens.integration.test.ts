import { describe, expect, it } from 'vitest';
import { filterFoods } from './allergens';
import { FOOD_ALLERGENS } from '../content/allergens';
import { FOODS } from '../content/foods';
import type { DietRestriction } from './types';

function restriction(code: string, severity: 'avoid' | 'strict' = 'strict'): DietRestriction {
  return { id: `r_${code}`, kind: 'allergen', code, label: code, severity, source: 'test' };
}

describe('AC-N08 · 食物库按过敏原过滤（集成）', () => {
  it('未设置过敏原时全部食物可见', () => {
    const r = filterFoods(FOODS, FOOD_ALLERGENS, []);
    expect(r.allowed).toHaveLength(FOODS.length);
    expect(r.excluded).toHaveLength(0);
  });

  it('奶过敏时牛奶与奶酪不可见', () => {
    const r = filterFoods(FOODS, FOOD_ALLERGENS, [restriction('milk')]);
    const ids = r.allowed.map((f) => f.id);
    expect(ids).not.toContain('milk');
    expect(ids).not.toContain('cheese');
    expect(ids).not.toContain('yogurt');
  });

  it('蛋过敏时鸡蛋与蛋清不可见', () => {
    const r = filterFoods(FOODS, FOOD_ALLERGENS, [restriction('egg')]);
    const ids = r.allowed.map((f) => f.id);
    expect(ids).not.toContain('egg');
    expect(ids).not.toContain('egg-white');
  });

  it('坚果过敏时混合坚果不可见', () => {
    const r = filterFoods(FOODS, FOOD_ALLERGENS, [restriction('treenut')]);
    expect(r.allowed.map((f) => f.id)).not.toContain('nuts');
  });

  it('花生过敏时花生酱不可见', () => {
    const r = filterFoods(FOODS, FOOD_ALLERGENS, [restriction('peanut')]);
    expect(r.allowed.map((f) => f.id)).not.toContain('peanut-butter');
  });

  it('鱼过敏时三文鱼与鳕鱼不可见，虾仁仍可见', () => {
    const r = filterFoods(FOODS, FOOD_ALLERGENS, [restriction('fish')]);
    const ids = r.allowed.map((f) => f.id);
    expect(ids).not.toContain('salmon');
    expect(ids).not.toContain('cod');
    expect(ids).toContain('shrimp');
  });

  it('甲壳类过敏时虾仁不可见，鱼仍可见', () => {
    const r = filterFoods(FOODS, FOOD_ALLERGENS, [restriction('shellfish')]);
    const ids = r.allowed.map((f) => f.id);
    expect(ids).not.toContain('shrimp');
    expect(ids).toContain('salmon');
  });

  it('大豆过敏时豆腐与豆浆不可见', () => {
    const r = filterFoods(FOODS, FOOD_ALLERGENS, [restriction('soy')]);
    const ids = r.allowed.map((f) => f.id);
    expect(ids).not.toContain('tofu');
    expect(ids).not.toContain('soy-milk');
  });

  it('多种过敏原时可用食物更少', () => {
    const single = filterFoods(FOODS, FOOD_ALLERGENS, [restriction('milk')]);
    const multi = filterFoods(FOODS, FOOD_ALLERGENS, [
      restriction('milk'),
      restriction('egg'),
      restriction('gluten'),
    ]);
    expect(multi.allowed.length).toBeLessThan(single.allowed.length);
  });

  it('排除结果带可解释原因', () => {
    const r = filterFoods(FOODS, FOOD_ALLERGENS, [restriction('milk')]);
    expect(r.excluded.length).toBeGreaterThan(0);
    for (const e of r.excluded) {
      expect(e.label.length).toBeGreaterThan(0);
      expect(['contains', 'mayContain', 'unknown']).toContain(e.reason);
    }
  });
});

