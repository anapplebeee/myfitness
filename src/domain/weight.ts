/**
 * 体重变化该怎么评价。
 *
 * 原来的实现是"掉秤=好（绿），涨秤=坏（红）"。
 * 这默认了每个用户都在减脂——增肌的人看到自己涨了 1 kg 被标红，
 * 等于 App 在不知道你想干什么的情况下判你错了。
 *
 * 正确做法是相对**目标方向**判断：
 * - 没设目标体重 → 不表态（neutral），只显示数字
 * - 目标低于当前 → 在减脂，下降为好
 * - 目标高于当前 → 在增肌，上升为好
 */

export type WeightTone = 'good' | 'bad' | 'neutral';

/** 小于这个幅度视为持平，不给评价（日常水分波动比这大）。 */
const FLAT_KG = 0.1;

/**
 * @param deltaKg 这段时间的变化量（正=涨）
 * @param latestKg 当前体重
 * @param goalKg 目标体重；未设置为 null
 */
export function weightTrendTone(deltaKg: number, latestKg: number, goalKg: number | null): WeightTone {
  if (Math.abs(deltaKg) < FLAT_KG) return 'neutral';
  if (goalKg === null || goalKg <= 0) return 'neutral';
  // 目标低于当前 = 想减重
  const wantLoss = goalKg < latestKg;
  if (wantLoss) return deltaKg < 0 ? 'good' : 'bad';
  return deltaKg > 0 ? 'good' : 'bad';
}

/** 给用户看的一句话，解释这次变化算不算朝目标走。 */
export function weightTrendHint(tone: WeightTone, goalKg: number | null): string {
  if (goalKg === null || goalKg <= 0) return '未设目标体重，不做评价';
  if (tone === 'good') return '朝目标方向';
  if (tone === 'bad') return '与目标方向相反';
  return '基本持平';
}
