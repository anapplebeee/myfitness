/**
 * 营养策略参数。
 *
 * 口径见 docs/11-data-model.md 与 docs/content/README.md §7。
 * 每条参数注明来源与适用人群；整体声明不适用于特殊人群。
 *
 * 定位：**估算工具**，不是医疗或营养处方。界面必须标注"参考值"。
 */

export interface ActivityFactor {
  level: number;
  label: string;
  description: string;
  factor: number;
}

/**
 * 活动系数表。
 * 来源：FAO/WHO/UNU 能量需求分级的常见简化（PAL 1.4–2.4），
 * 取健身人群常用的 5 档。系数用于 BMR × 系数 = TDEE 估算。
 */
export const ACTIVITY_FACTORS: ActivityFactor[] = [
  { level: 1, label: '久坐', description: '办公室为主，几乎不运动', factor: 1.2 },
  { level: 2, label: '轻度', description: '每周 1–2 次轻活动', factor: 1.375 },
  { level: 3, label: '中度', description: '每周 3–4 次训练', factor: 1.55 },
  { level: 4, label: '较高', description: '每周 5–6 次训练', factor: 1.725 },
  { level: 5, label: '很高', description: '每日训练或体力工作', factor: 1.9 },
];

export interface PolicyParams {
  /** 每公斤体重蛋白推荐区间（g/kg）。 */
  proteinPerKgMin: number;
  proteinPerKgMax: number;
  proteinPerKgDefault: number;
  /** 目标方向对热量的调整比例。 */
  deficitPct: number;
  surplusPct: number;
  /** 热量下限：不低于 BMR 的这个倍数。 */
  kcalFloorOfBmr: number;
  /** 绝对下限（kcal），低于此值一律不生成。 */
  kcalFloorAbsolute: number;
  /** 脂肪供能比下限。 */
  fatPctMin: number;
  /** 脂肪供能比上限。 */
  fatPctMax: number;
  /** 取整规则：热量取整到该步长。 */
  kcalRounding: number;
  /** 蛋白取整步长（g）。 */
  proteinRounding: number;
  /** 每周体重变化上限（% 体重），用于校验目标是否激进。 */
  maxWeeklyChangePct: number;
}

export const DEFAULT_POLICY: PolicyParams = {
  proteinPerKgMin: 1.6,
  proteinPerKgMax: 2.2,
  proteinPerKgDefault: 1.8,
  deficitPct: 0.15,
  surplusPct: 0.1,
  kcalFloorOfBmr: 1.1,
  kcalFloorAbsolute: 1200,
  fatPctMin: 0.2,
  fatPctMax: 0.35,
  kcalRounding: 50,
  proteinRounding: 5,
  maxWeeklyChangePct: 0.01,
};

export interface ParamNote {
  key: keyof PolicyParams;
  label: string;
  value: string;
  basis: string;
  appliesTo: string;
}

/**
 * 参数说明表。每条都必须能回答"凭什么"与"对谁适用"。
 */
export const PARAM_NOTES: ParamNote[] = [
  {
    key: 'proteinPerKgMin',
    label: '蛋白下限',
    value: '1.6 g/kg',
    basis: '阻力训练人群维持与增肌的常用下限（Morton 等 2018 荟萃分析区间 1.6–2.2 g/kg）',
    appliesTo: '有规律阻力训练的成年健康人',
  },
  {
    key: 'proteinPerKgMax',
    label: '蛋白上限',
    value: '2.2 g/kg',
    basis: '同上，超过此值对增肌无额外收益',
    appliesTo: '同上；肾功能异常者不适用',
  },
  {
    key: 'proteinPerKgDefault',
    label: '蛋白默认',
    value: '1.8 g/kg',
    basis: '取区间中位，兼顾饱腹与可执行性',
    appliesTo: '未指定偏好时的默认值',
  },
  {
    key: 'deficitPct',
    label: '减脂热量缺口',
    value: '15%',
    basis: '温和缺口，保留瘦体重与训练表现；激进缺口依从性差且易掉力量',
    appliesTo: '体脂偏高的减脂目标',
  },
  {
    key: 'surplusPct',
    label: '增肌热量盈余',
    value: '10%',
    basis: '新手/中级者的小幅盈余，减少脂肪同步增长',
    appliesTo: '增肌目标；体脂已较高者不建议',
  },
  {
    key: 'kcalFloorOfBmr',
    label: '热量下限（BMR 倍数）',
    value: '1.1 × BMR',
    basis: '长期低于静息消耗难以维持，且微量营养素易不足',
    appliesTo: '所有减脂目标',
  },
  {
    key: 'kcalFloorAbsolute',
    label: '热量绝对下限',
    value: '1200 kcal',
    basis: '低于此值无法可靠满足基础营养需求',
    appliesTo: '所有目标；触发时拒绝生成并提示',
  },
  {
    key: 'fatPctMin',
    label: '脂肪供能下限',
    value: '20%',
    basis: '保障脂溶性维生素吸收与激素合成',
    appliesTo: '所有目标',
  },
  {
    key: 'fatPctMax',
    label: '脂肪供能上限',
    value: '35%',
    basis: '为训练留出足够碳水；脂肪占比过高会挤压糖原储备与训练表现',
    appliesTo: '所有目标',
  },
  {
    key: 'kcalRounding',
    label: '热量取整',
    value: '50 kcal',
    basis: '避免给出 2137 这类虚假精确值',
    appliesTo: '所有输出',
  },
  {
    key: 'proteinRounding',
    label: '蛋白取整',
    value: '5 g',
    basis: '与热量取整同理，避免 137g 这类虚假精确值，便于按份执行',
    appliesTo: '所有输出',
  },
  {
    key: 'maxWeeklyChangePct',
    label: '每周体重变化上限',
    value: '1% 体重',
    basis: '超过此速率多为水分与瘦体重流失',
    appliesTo: '减脂与增肌目标校验',
  },
];

/** 不适用人群声明。必须在界面可见。 */
export const POLICY_EXCLUSIONS = [
  '孕妇与哺乳期女性',
  '未成年人',
  '肾功能不全或其他需限蛋白的慢性病患者',
  '糖尿病患者及需医学营养治疗者',
  '进食障碍病史者',
  '体重指数过低（BMI < 18.5）仍需减重者',
];

export interface MacroResult {
  kcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  notes: string[];
  blocked: string | null;
}

/**
 * 计算每日目标。
 *
 * 顺序固定：TDEE → 目标调整 → 下限校验 → 蛋白 → 脂肪 → 碳水补足 → 取整。
 * 任一步触发下限都返回 blocked，不生成"凑出来的数字"。
 */
export function computeTargets(input: {
  bmr: number;
  activityLevel: number;
  goal: 'cut' | 'maintain' | 'bulk';
  weightKg: number;
  policy?: PolicyParams;
}): MacroResult {
  const p = input.policy ?? DEFAULT_POLICY;
  const notes: string[] = [];

  const af = ACTIVITY_FACTORS.find((a) => a.level === input.activityLevel);
  if (!af) {
    return { kcal: 0, proteinG: 0, carbG: 0, fatG: 0, notes, blocked: '活动系数无效' };
  }

  let tdee = input.bmr * af.factor;
  if (input.goal === 'cut') tdee *= 1 - p.deficitPct;
  else if (input.goal === 'bulk') tdee *= 1 + p.surplusPct;

  const floorByBmr = input.bmr * p.kcalFloorOfBmr;
  const floor = Math.max(floorByBmr, p.kcalFloorAbsolute);
  if (tdee < floor) {
    return {
      kcal: 0,
      proteinG: 0,
      carbG: 0,
      fatG: 0,
      notes,
      blocked: `按当前目标算出的热量 ${Math.round(tdee)} kcal 低于安全下限 ${Math.round(floor)} kcal。请调高活动系数或改为维持/增肌目标。`,
    };
  }

  const proteinG = input.weightKg * p.proteinPerKgDefault;
  let fatG = (tdee * ((p.fatPctMin + p.fatPctMax) / 2)) / 9;
  const carbG = Math.max(0, (tdee - proteinG * 4 - fatG * 9) / 4);

  // 碳水过低说明脂肪或蛋白占太多，把脂肪降到下限再算
  if (carbG < input.weightKg * 2) {
    fatG = (tdee * p.fatPctMin) / 9;
    notes.push('碳水偏低，已把脂肪调到下限以保证训练供能。');
  }

  const round = (v: number, step: number) => Math.round(v / step) * step;
  const kcal = round(tdee, p.kcalRounding);
  const protein = round(proteinG, p.proteinRounding);
  const fat = Math.round(fatG);
  const carb = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));

  return { kcal, proteinG: protein, carbG: carb, fatG: fat, notes, blocked: null };
}

/** 校验目标是否过于激进（每周体重变化）。 */
export function checkGoalPace(input: {
  currentKg: number;
  targetKg: number;
  weeks: number;
  policy?: PolicyParams;
}): string | null {
  const p = input.policy ?? DEFAULT_POLICY;
  if (input.weeks <= 0) return '目标周期必须大于 0 周';
  const delta = Math.abs(input.targetKg - input.currentKg);
  const perWeek = delta / input.weeks;
  const limit = input.currentKg * p.maxWeeklyChangePct;
  if (perWeek > limit) {
    return `按 ${input.weeks} 周达成需要每周变化 ${perWeek.toFixed(2)} kg，超过建议上限 ${limit.toFixed(2)} kg。建议延长周期或缩小目标。`;
  }
  return null;
}


