import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_FACTORS,
  DEFAULT_POLICY,
  PARAM_NOTES,
  POLICY_EXCLUSIONS,
  checkGoalPace,
  computeTargets,
} from './nutrition-policy';

describe('AC-N06 · 活动系数表', () => {
  it('5 档且递增', () => {
    expect(ACTIVITY_FACTORS).toHaveLength(5);
    for (let i = 1; i < ACTIVITY_FACTORS.length; i += 1) {
      expect(ACTIVITY_FACTORS[i]!.factor).toBeGreaterThan(ACTIVITY_FACTORS[i - 1]!.factor);
    }
  });

  it('系数落在合理区间 1.2–1.9', () => {
    for (const a of ACTIVITY_FACTORS) {
      expect(a.factor).toBeGreaterThanOrEqual(1.2);
      expect(a.factor).toBeLessThanOrEqual(1.9);
    }
  });

  it('每档都有说明', () => {
    expect(ACTIVITY_FACTORS.every((a) => a.description.length > 0)).toBe(true);
  });
});

describe('AC-N06 · 目标计算', () => {
  const base = { bmr: 1700, activityLevel: 3, weightKg: 75 };

  it('维持目标热量 = BMR × 系数', () => {
    const r = computeTargets({ ...base, goal: 'maintain' });
    expect(r.blocked).toBeNull();
    expect(r.kcal).toBe(Math.round((1700 * 1.55) / 50) * 50);
  });

  it('减脂低于维持，增肌高于维持', () => {
    const cut = computeTargets({ ...base, goal: 'cut' });
    const keep = computeTargets({ ...base, goal: 'maintain' });
    const bulk = computeTargets({ ...base, goal: 'bulk' });
    expect(cut.kcal).toBeLessThan(keep.kcal);
    expect(bulk.kcal).toBeGreaterThan(keep.kcal);
  });

  it('蛋白按体重计算并取整到 5g', () => {
    const r = computeTargets({ ...base, goal: 'maintain' });
    expect(r.proteinG).toBe(135); // 75 × 1.8 = 135
    expect(r.proteinG % 5).toBe(0);
  });

  it('热量取整到 50', () => {
    const r = computeTargets({ ...base, goal: 'maintain' });
    expect(r.kcal % 50).toBe(0);
  });

  it('三大营养素热量之和接近总热量', () => {
    const r = computeTargets({ ...base, goal: 'maintain' });
    const sum = r.proteinG * 4 + r.carbG * 4 + r.fatG * 9;
    expect(Math.abs(sum - r.kcal)).toBeLessThan(60);
  });

  it('碳水不为负', () => {
    const r = computeTargets({ bmr: 1400, activityLevel: 1, weightKg: 110, goal: 'cut' });
    expect(r.carbG).toBeGreaterThanOrEqual(0);
  });
});

describe('AC-N06 · 热量下限保护', () => {
  it('低于绝对下限时拒绝生成', () => {
    const r = computeTargets({ bmr: 900, activityLevel: 1, weightKg: 45, goal: 'cut' });
    expect(r.blocked).toContain('低于安全下限');
    expect(r.kcal).toBe(0);
  });

  it('拒绝时给出可操作建议', () => {
    const r = computeTargets({ bmr: 900, activityLevel: 1, weightKg: 45, goal: 'cut' });
    expect(r.blocked).toContain('调高活动系数');
  });

  it('正常范围不触发下限', () => {
    const r = computeTargets({ bmr: 1800, activityLevel: 3, weightKg: 80, goal: 'cut' });
    expect(r.blocked).toBeNull();
  });

  it('无效活动系数被拒绝', () => {
    const r = computeTargets({ bmr: 1700, activityLevel: 99, weightKg: 75, goal: 'maintain' });
    expect(r.blocked).toContain('活动系数无效');
  });
});

describe('AC-N06 · 参数表完整性', () => {
  it('每个参数都有来源与适用人群', () => {
    expect(PARAM_NOTES.length).toBeGreaterThanOrEqual(10);
    for (const n of PARAM_NOTES) {
      expect(n.basis.length, `${n.label} 缺来源`).toBeGreaterThan(10);
      expect(n.appliesTo.length, `${n.label} 缺适用人群`).toBeGreaterThan(0);
    }
  });

  it('参数值覆盖默认策略的每个字段', () => {
    const keys = new Set(PARAM_NOTES.map((n) => n.key));
    for (const k of Object.keys(DEFAULT_POLICY)) {
      expect(keys.has(k as keyof typeof DEFAULT_POLICY), `${k} 未在说明表中`).toBe(true);
    }
  });

  it('不适用人群声明非空且含关键人群', () => {
    expect(POLICY_EXCLUSIONS.length).toBeGreaterThanOrEqual(5);
    const all = POLICY_EXCLUSIONS.join(' ');
    expect(all).toContain('孕');
    expect(all).toContain('未成年');
    expect(all).toContain('肾');
  });
});

describe('AC-N06 · 目标节奏校验', () => {
  it('合理周期通过', () => {
    expect(checkGoalPace({ currentKg: 80, targetKg: 76, weeks: 10 })).toBeNull();
  });

  it('过于激进被拒', () => {
    const msg = checkGoalPace({ currentKg: 80, targetKg: 70, weeks: 4 });
    expect(msg).toContain('超过建议上限');
  });

  it('周期为 0 被拒', () => {
    expect(checkGoalPace({ currentKg: 80, targetKg: 75, weeks: 0 })).toContain('大于 0');
  });

  it('增肌方向同样受约束', () => {
    expect(checkGoalPace({ currentKg: 70, targetKg: 80, weeks: 3 })).toContain('超过');
  });
});

describe('参数边界一致性', () => {
  it('蛋白区间单调', () => {
    expect(DEFAULT_POLICY.proteinPerKgMin).toBeLessThanOrEqual(DEFAULT_POLICY.proteinPerKgMax);
    expect(DEFAULT_POLICY.proteinPerKgDefault).toBeGreaterThanOrEqual(DEFAULT_POLICY.proteinPerKgMin);
    expect(DEFAULT_POLICY.proteinPerKgDefault).toBeLessThanOrEqual(DEFAULT_POLICY.proteinPerKgMax);
  });

  it('脂肪区间单调且在 0–1 之间', () => {
    expect(DEFAULT_POLICY.fatPctMin).toBeLessThan(DEFAULT_POLICY.fatPctMax);
    expect(DEFAULT_POLICY.fatPctMax).toBeLessThan(1);
  });

  it('缺口语义正确：减脂为减、增肌为增', () => {
    expect(DEFAULT_POLICY.deficitPct).toBeGreaterThan(0);
    expect(DEFAULT_POLICY.surplusPct).toBeGreaterThan(0);
    expect(DEFAULT_POLICY.deficitPct).toBeLessThan(0.3);
    expect(DEFAULT_POLICY.surplusPct).toBeLessThan(0.2);
  });
});


describe('活动量可以传乘数，不必传等级', () => {
  /*
   * UserProfile 里存的是乘数（1.4 / 1.5），不是 1–5 的等级。
   * 之前 computeTargets 只认等级，调用方把乘数传进去，
   * find 命中不到 → 返回"活动系数无效"，估算功能对所有人都失败。
   * 这条测试锁住"乘数也能用"这个契约。
   */
  it('传 activityFactor 能算出结果', () => {
    const r = computeTargets({ bmr: 1800, activityFactor: 1.55, goal: 'maintain', weightKg: 80 });
    expect(r.blocked).toBeFalsy();
    expect(r.kcal).toBeGreaterThan(1800);
  });

  it('乘数与对应等级结果一致', () => {
    const byFactor = computeTargets({ bmr: 1800, activityFactor: 1.55, goal: 'maintain', weightKg: 80 });
    const byLevel = computeTargets({ bmr: 1800, activityLevel: 3, goal: 'maintain', weightKg: 80 });
    expect(byFactor.kcal).toBe(byLevel.kcal);
  });

  it('非法乘数仍然拦截', () => {
    const r = computeTargets({ bmr: 1800, activityFactor: 0, goal: 'maintain', weightKg: 80 });
    expect(r.blocked).toBe('活动系数无效');
  });

  it('乘数优先于等级', () => {
    const r = computeTargets({ bmr: 1800, activityFactor: 1.2, activityLevel: 5, goal: 'maintain', weightKg: 80 });
    const only = computeTargets({ bmr: 1800, activityFactor: 1.2, goal: 'maintain', weightKg: 80 });
    expect(r.kcal).toBe(only.kcal);
  });
});

