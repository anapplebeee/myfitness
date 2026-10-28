import { describe, expect, it } from 'vitest';
import { DEFAULT_BAR_GRAMS, formatKg, formatPlates, solvePlates } from './plates';

/**
 * 杠铃片计算。
 *
 * 重点验三件事：
 * 1. 常见重量能精确解出来
 * 2. 解不出来时如实报告，不假装精确
 * 3. 总重量小于杆重时不出负数
 */

describe('常见重量', () => {
  it('100kg：每边 25+15', () => {
    const r = solvePlates(100000);
    expect(r.exact).toBe(true);
    expect(r.perSide).toEqual([25000, 15000]);
  });

  it('60kg：每边 20', () => {
    const r = solvePlates(60000);
    expect(r.perSide).toEqual([20000]);
    expect(r.achievedGrams).toBe(60000);
  });

  it('空杆 20kg：不用挂片', () => {
    const r = solvePlates(20000);
    expect(r.perSide).toEqual([]);
    expect(r.exact).toBe(true);
  });

  it('142.5kg：每边 25+25+10+2.5+2.5? 实测应为可解', () => {
    const r = solvePlates(142500);
    expect(r.exact).toBe(true);
    expect(r.achievedGrams).toBe(142500);
  });
});

describe('解不出来时如实报告', () => {
  it('差 1kg 不可解的部分会被报告', () => {
    // 每边 40.5kg 需要 0.5kg 的片，默认配置里没有
    const r = solvePlates(101000);
    expect(r.exact).toBe(false);
    expect(r.diffGrams).toBeGreaterThan(0);
    expect(r.achievedGrams).toBeLessThan(101000);
  });

  it('achieved 永远不超过目标', () => {
    for (const kg of [21, 33, 47, 63, 88, 101, 137]) {
      const r = solvePlates(kg * 1000);
      expect(r.achievedGrams).toBeLessThanOrEqual(kg * 1000);
    }
  });
});

describe('边界', () => {
  it('小于杆重：挂不了片，不返回负数', () => {
    const r = solvePlates(15000);
    expect(r.perSide).toEqual([]);
    expect(r.achievedGrams).toBe(DEFAULT_BAR_GRAMS);
    expect(r.exact).toBe(false);
  });

  it('0 或负数', () => {
    expect(solvePlates(0).perSide).toEqual([]);
    expect(solvePlates(-5000).perSide).toEqual([]);
  });

  it('片不够用时只挂现有的', () => {
    const r = solvePlates(100000, DEFAULT_BAR_GRAMS, [{ grams: 25000, count: 1 }]);
    expect(r.perSide).toEqual([25000]);
    expect(r.exact).toBe(false);
  });
});

describe('显示', () => {
  it('按重量从大到小', () => {
    expect(formatPlates([15000, 25000])).toBe('25 + 15');
  });

  it('同重量合并为 ×N', () => {
    expect(formatPlates([25000, 25000])).toBe('25×2');
  });

  it('空数组显示空杆', () => {
    expect(formatPlates([])).toBe('空杆');
  });

  it('小数重量不带多余的 .0', () => {
    expect(formatKg(25000)).toBe('25');
    expect(formatKg(1250)).toBe('1.25');
  });
});
