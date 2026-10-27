import { describe, expect, it } from 'vitest';
import { buildWarmup, warmupCount } from './warmup';

/**
 * 热身组生成。
 *
 * 这是安全相关逻辑，测试要盯住三件事：
 * 1. 该生成的场景确实生成
 * 2. 不该生成的场景不硬造（自重、空杆重）
 * 3. 绝不生成"比工作组还重"的热身组
 */

describe('杠铃动作', () => {
  it('100kg 深蹲：空杆 → 50% → 70% → 85%', () => {
    const w = buildWarmup({ workingGrams: 100000, isBarbell: true });
    expect(w.map((s) => s.label)).toEqual(['空杆', '50%', '70%', '85%']);
    expect(w[0]!.loadGrams).toBe(20000);
    expect(w[1]!.loadGrams).toBe(50000);
    expect(w[2]!.loadGrams).toBe(70000);
    expect(w[3]!.loadGrams).toBe(85000);
  });

  it('每一级都比上一级重', () => {
    const w = buildWarmup({ workingGrams: 100000, isBarbell: true });
    for (let i = 1; i < w.length; i += 1) {
      expect(w[i]!.loadGrams).toBeGreaterThan(w[i - 1]!.loadGrams);
    }
  });

  it('任何一组都不会达到或超过工作组', () => {
    for (const kg of [40, 60, 80, 100, 140, 200]) {
      const w = buildWarmup({ workingGrams: kg * 1000, isBarbell: true });
      for (const s of w) expect(s.loadGrams).toBeLessThan(kg * 1000);
    }
  });

  it('重量都对齐到 2.5kg', () => {
    const w = buildWarmup({ workingGrams: 83500, isBarbell: true });
    for (const s of w) expect(s.loadGrams % 2500).toBe(0);
  });
});

describe('不生成的情况', () => {
  it('自重动作', () => {
    expect(buildWarmup({ workingGrams: 0, isBarbell: true })).toEqual([]);
  });

  it('工作重量等于空杆', () => {
    expect(buildWarmup({ workingGrams: 20000, isBarbell: true })).toEqual([]);
  });

  it('工作重量低于空杆', () => {
    expect(buildWarmup({ workingGrams: 15000, isBarbell: true })).toEqual([]);
  });

  it('非法输入', () => {
    expect(buildWarmup({ workingGrams: -100, isBarbell: true })).toEqual([]);
    expect(buildWarmup({ workingGrams: Number.NaN, isBarbell: true })).toEqual([]);
  });
});

describe('轻重量不会造出比空杆还轻的组', () => {
  it('30kg 深蹲：不出现 15kg（低于空杆）', () => {
    const w = buildWarmup({ workingGrams: 30000, isBarbell: true });
    for (const s of w) expect(s.loadGrams).toBeGreaterThanOrEqual(20000);
  });
});

describe('非杠铃（哑铃/器械）', () => {
  it('不生成空杆组', () => {
    const w = buildWarmup({ workingGrams: 30000, isBarbell: false });
    expect(w.some((s) => s.label === '空杆')).toBe(false);
  });

  it('仍然按百分比生成递增组', () => {
    const w = buildWarmup({ workingGrams: 40000, isBarbell: false });
    expect(w.length).toBeGreaterThan(0);
    for (const s of w) expect(s.loadGrams).toBeLessThan(40000);
  });
});

describe('组数', () => {
  it('100kg 杠铃是 4 组', () => {
    expect(warmupCount(buildWarmup({ workingGrams: 100000, isBarbell: true }))).toBe(4);
  });

  it('自重是 0 组', () => {
    expect(warmupCount(buildWarmup({ workingGrams: 0 }))).toBe(0);
  });
});
