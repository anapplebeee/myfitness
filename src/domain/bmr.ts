/**
 * 基础代谢率（BMR）。
 *
 * 用 Mifflin-St Jeor（1990）：目前临床与运动营养里最常用的估算式，
 * 比更老的 Harris-Benedict 在超重人群上偏差更小。
 *
 * 口径与限制必须说清：
 * - 它是**估算**，个体误差常在 ±10%（约 ±150–250 kcal）
 * - 需要的输入是身高、体重、年龄、性别；缺一项就算不出来
 * - 它描述的是"躺着不动"的消耗，乘活动系数后才接近每日总消耗
 *
 * 这里只做计算，不给建议——建议在 nutrition-policy 的 computeTargets 里，
 * 那边有热量下限、蛋白区间、不适用人群等策略。
 */

export type Sex = 'male' | 'female';

export interface BmrInput {
  weightKg: number;
  heightCm: number;
  ageYears: number;
  sex: Sex;
}

export interface BmrResult {
  bmr: number;
  /** 人类可读的公式说明，用于界面上"这个数是怎么来的" */
  basis: string;
}

/**
 * 计算 BMR。
 *
 * Mifflin-St Jeor:
 *   男：10 × 体重(kg) + 6.25 × 身高(cm) − 5 × 年龄 + 5
 *   女：10 × 体重(kg) + 6.25 × 身高(cm) − 5 × 年龄 − 161
 *
 * 输入不合理时返回 null 而不是硬算：体重 0 或身高 0 会得出
 * 一个看起来正常但毫无意义的数字，那种数字比没有更危险。
 */
export function mifflinStJeor(input: BmrInput): BmrResult | null {
  const { weightKg, heightCm, ageYears, sex } = input;
  if (!Number.isFinite(weightKg) || weightKg <= 0) return null;
  if (!Number.isFinite(heightCm) || heightCm <= 0) return null;
  if (!Number.isFinite(ageYears) || ageYears <= 0 || ageYears > 120) return null;

  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  const bmr = sex === 'male' ? base + 5 : base - 161;
  if (!Number.isFinite(bmr) || bmr <= 0) return null;

  return {
    bmr: Math.round(bmr),
    basis: `Mifflin-St Jeor：10×${weightKg.toFixed(1)} + 6.25×${heightCm} − 5×${ageYears} ${sex === 'male' ? '+ 5' : '− 161'}`,
  };
}

/** 由出生年与当前日期算年龄；不精确到月，够用且不会越界。 */
export function ageFromBirthYear(birthYear: number | null, now: Date = new Date()): number | null {
  if (birthYear === null || !Number.isFinite(birthYear)) return null;
  const age = now.getFullYear() - birthYear;
  return age > 0 && age <= 120 ? age : null;
}
