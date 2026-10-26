/**
 * 份量单位解析。
 *
 * 饮食记录的真实用法是"两个鸡蛋"而不是"100g 鸡蛋"，
 * 所以要从份量描述里推导出量词与单件重量，并保证换算不改变营养值。
 */

import { describe, expect, it } from 'vitest';
import { FOOD_BY_ID, FOODS, nutritionFor, portionText, portionUnit, unitOf } from './foods';

describe('portionUnit', () => {
  it('一个 → 1 个', () => {
    expect(portionUnit({ label: '一个', grams: 50 })).toEqual({ label: '个', grams: 50, step: 1 });
  });

  it('两片 → 每片 35g', () => {
    expect(portionUnit({ label: '两片', grams: 70 })).toEqual({ label: '片', grams: 35, step: 1 });
  });

  it('半个 → 每个 200g，步进 0.5', () => {
    expect(portionUnit({ label: '半个', grams: 100 })).toEqual({ label: '个', grams: 200, step: 0.5 });
  });

  it('保留"小"这类修饰，避免两个量词被合并', () => {
    expect(portionUnit({ label: '一小把', grams: 25 })).toEqual({ label: '小把', grams: 25, step: 1 });
  });

  it('无法解析时返回 null，界面退回按克录入', () => {
    expect(portionUnit({ label: '100g', grams: 100 })).toBeNull();
    expect(portionUnit({ label: '', grams: 100 })).toBeNull();
  });
});

describe('食物库单位', () => {
  it('鸡蛋按个记录：2 个 = 100g', () => {
    const egg = FOOD_BY_ID.get('egg')!;
    const unit = unitOf(egg)!;
    expect(unit.label).toBe('个');
    expect(unit.grams).toBe(50);
    expect(nutritionFor(egg, unit.grams * 2)).toEqual(nutritionFor(egg, 100));
  });

  it('全麦面包按片记录：1 片 35g', () => {
    const bread = FOOD_BY_ID.get('whole-bread')!;
    expect(unitOf(bread)!.grams).toBe(35);
  });

  it('所有食物都能给出份量文案', () => {
    for (const food of FOODS) {
      const text = portionText(food);
      expect(text.length).toBeGreaterThan(0);
    }
  });
});
