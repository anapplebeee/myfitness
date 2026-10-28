import { describe, expect, it } from 'vitest';
import { adaptiveTdeeHint, estimateAdaptiveTdee, type AdaptiveTdeeInput } from './adaptive-tdee';

/**
 * 自适应 TDEE。
 *
 * 最需要防的不是"算不准"，而是**算出一个看起来明确、实际没有依据的数字**。
 * 所以一半用例都在验证"什么时候应该拒绝给答案"。
 */

const END = '2026-10-28';

function daysAgo(n: number): string {
  const d = new Date(`${END}T12:00:00`);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/** 造一份"每天记、体重线性变化"的完整数据。 */
function makeInput(opts: {
  days: number;
  startKg: number;
  endKg: number;
  intake: number;
  /** 只记这么多天的饮食，用于测样本不足 */
  loggedDays?: number;
}): AdaptiveTdeeInput {
  const weights = [
    { date: daysAgo(opts.days - 1), grams: opts.startKg * 1000 },
    { date: daysAgo(0), grams: opts.endKg * 1000 },
  ];
  const logged = opts.loggedDays ?? opts.days;
  const intakeByDate = Array.from({ length: logged }, (_, i) => ({
    date: daysAgo(i),
    kcal: opts.intake,
  }));
  return { weights, intakeByDate, endDate: END, windowDays: 28 };
}

describe('能算的情况', () => {
  it('体重下降时，维持热量高于摄入', () => {
    // 28 天掉 2kg，每天吃 2000
    // 赤字 = 2*7700/28 ≈ 550 → 维持 ≈ 2550
    const r = estimateAdaptiveTdee(makeInput({ days: 28, startKg: 80, endKg: 78, intake: 2000 }));
    expect(r.blocked).toBeNull();
    expect(r.maintenanceKcal).toBeGreaterThan(2400);
    expect(r.maintenanceKcal).toBeLessThan(2700);
  });

  it('体重上升时，维持热量低于摄入', () => {
    // 28 天涨 2kg，每天吃 3000 → 盈余 550 → 维持 ≈ 2450
    const r = estimateAdaptiveTdee(makeInput({ days: 28, startKg: 70, endKg: 72, intake: 3000 }));
    expect(r.maintenanceKcal).toBeLessThan(3000);
    expect(r.maintenanceKcal).toBeGreaterThan(2200);
  });

  it('给出每周变化速度', () => {
    const r = estimateAdaptiveTdee(makeInput({ days: 28, startKg: 80, endKg: 78, intake: 2000 }));
    // 2kg / 4 周 = 0.5 kg/周
    expect(r.weeklyChangeKg).toBeCloseTo(-0.5, 1);
  });
});

describe('必须拒绝给答案的情况', () => {
  it('只有一次体重记录', () => {
    const r = estimateAdaptiveTdee({
      weights: [{ date: END, grams: 80000 }],
      intakeByDate: [],
      endDate: END,
    });
    expect(r.maintenanceKcal).toBeNull();
    expect(r.blocked).toBe('no-weight-data');
  });

  it('跨度不足 14 天', () => {
    const r = estimateAdaptiveTdee(makeInput({ days: 10, startKg: 80, endKg: 78.5, intake: 2000 }));
    expect(r.maintenanceKcal).toBeNull();
    expect(r.blocked).toBe('span-too-short');
  });

  it('记录饮食的天数不足 10 天', () => {
    const r = estimateAdaptiveTdee(
      makeInput({ days: 28, startKg: 80, endKg: 78, intake: 2000, loggedDays: 5 }),
    );
    expect(r.maintenanceKcal).toBeNull();
    expect(r.blocked).toBe('too-few-logged-days');
  });

  it('体重几乎没变（水分波动量级）', () => {
    const r = estimateAdaptiveTdee(makeInput({ days: 28, startKg: 80, endKg: 80.1, intake: 2000 }));
    expect(r.maintenanceKcal).toBeNull();
    expect(r.blocked).toBe('weight-flat');
  });

  it('变化速度超出可信范围时不给', () => {
    // 28 天掉 10kg = 每周 2.5kg，远超自然速度，多半是记录有问题
    const r = estimateAdaptiveTdee(makeInput({ days: 28, startKg: 90, endKg: 80, intake: 2000 }));
    expect(r.maintenanceKcal).toBeNull();
    expect(r.blocked).toBe('rate-too-fast');
  });

  it('算出来低于生理下限也不给', () => {
    // 28 天涨 10kg、每天只吃 1200 → 推算维持热量为负
    const r = estimateAdaptiveTdee(makeInput({ days: 28, startKg: 70, endKg: 80, intake: 1200 }));
    expect(r.maintenanceKcal).toBeNull();
    expect(r.blocked).toBe('rate-too-fast');
  });
});

describe('提示语', () => {
  it('每种阻塞都有可读的原因', () => {
    const cases = [
      'no-weight-data',
      'span-too-short',
      'too-few-logged-days',
      'weight-flat',
      'rate-too-fast',
      'implausible',
    ] as const;
    for (const c of cases) {
      const hint = adaptiveTdeeHint({
        maintenanceKcal: null,
        weightDeltaKg: 0,
        weeklyChangeKg: 0,
        avgIntakeKcal: 0,
        loggedDays: 3,
        spanDays: 10,
        blocked: c,
      });
      expect(hint.length).toBeGreaterThan(4);
      expect(hint).not.toContain('undefined');
    }
  });

  it('成功时说明窗口与数值', () => {
    const r = estimateAdaptiveTdee(makeInput({ days: 28, startKg: 80, endKg: 78, intake: 2000 }));
    const hint = adaptiveTdeeHint(r);
    // 窗口按实际首尾体重记录计算，不硬编码天数
    expect(hint).toMatch(/\d+ 天/);
    expect(hint).toContain('维持热量');
  });
});

