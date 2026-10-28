import { describe, expect, it } from 'vitest';
import { suggestNextLoad } from './next-load';

const set = (loadGrams: number | null, reps: number | null) => ({ loadGrams, reps });

describe('suggestNextLoad', () => {
  it('每组都到上限 → 加一个最小增量', () => {
    const r = suggestNextLoad({
      sets: [set(80000, 8), set(80000, 8), set(80000, 8)],
      repMin: 6,
      repMax: 8,
      incrementGrams: 2500,
    });
    expect(r?.grams).toBe(82500);
    expect(r?.deltaGrams).toBe(2500);
    expect(r?.reason).toContain('上限');
  });

  it('有组低于下限 → 降两个增量', () => {
    const r = suggestNextLoad({
      sets: [set(80000, 8), set(80000, 7), set(80000, 5)],
      repMin: 6,
      repMax: 8,
      incrementGrams: 2500,
    });
    expect(r?.grams).toBe(75000);
    expect(r?.deltaGrams).toBe(-5000);
    expect(r?.reason).toContain('低于');
  });

  it('落在区间内 → 保持', () => {
    const r = suggestNextLoad({
      sets: [set(80000, 8), set(80000, 7), set(80000, 7)],
      repMin: 6,
      repMax: 8,
      incrementGrams: 2500,
    });
    expect(r?.grams).toBe(80000);
    expect(r?.deltaGrams).toBe(0);
  });

  it('只有一组 → 样本不足，不给建议', () => {
    expect(
      suggestNextLoad({ sets: [set(80000, 8)], repMin: 6, repMax: 8, incrementGrams: 2500 }),
    ).toBeNull();
  });

  it('没有有效重量/次数 → 不给建议', () => {
    expect(
      suggestNextLoad({ sets: [set(null, 8), set(0, 0)], repMin: 6, repMax: 8, incrementGrams: 2500 }),
    ).toBeNull();
  });

  it('只看最高重量的那几组判断是否到上限', () => {
    const r = suggestNextLoad({
      sets: [set(80000, 8), set(80000, 8), set(70000, 8)],
      repMin: 6,
      repMax: 8,
      incrementGrams: 2500,
    });
    expect(r?.grams).toBe(82500);
  });
});
