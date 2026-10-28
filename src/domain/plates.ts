/**
 * 杠铃片计算。
 *
 * 为什么商用 App 都有：每次加重量都要心算"每边加多少片"，
 * 这是健身房里最高频的心算，也是新手最容易算错的地方
 * （把总重量当成单边重量，或者忘了杠铃杆本身 20 kg）。
 *
 * 口径：
 * - 输入是**总重量**（含杠铃杆），输出是**每边**要挂的片
 * - 两边对称，所以只算一边
 * - 贪心从大往小取；取不到精确值时如实报告差多少，不四舍五入糊弄
 */

export interface PlateStock {
  /** 单片重量（克） */
  grams: number;
  /** 每边最多能放几片 */
  count: number;
}

export interface PlateResult {
  /** 每边要挂的片（从重到轻） */
  perSide: number[];
  /** 实际达成总重量（克） */
  achievedGrams: number;
  /** 目标与实际是否一致 */
  exact: boolean;
  /** 差多少克（正数=差一点，0=正好） */
  diffGrams: number;
}

/** 常见商用健身房配置：每边各一对 25/20/15/10/5/2.5/1.25 kg。 */
export const DEFAULT_PLATES: PlateStock[] = [
  { grams: 25000, count: 2 },
  { grams: 20000, count: 2 },
  { grams: 15000, count: 2 },
  { grams: 10000, count: 2 },
  { grams: 5000, count: 2 },
  { grams: 2500, count: 2 },
  { grams: 1250, count: 2 },
];

/** 默认杠铃杆 20 kg。 */
export const DEFAULT_BAR_GRAMS = 20000;

/**
 * 解出每边要挂的片。
 *
 * @param totalGrams 目标总重量（含杆）
 * @param barGrams 杠铃杆重量
 * @param stock 可用片，按需给；不给用默认配置
 */
export function solvePlates(
  totalGrams: number,
  barGrams: number = DEFAULT_BAR_GRAMS,
  stock: PlateStock[] = DEFAULT_PLATES,
): PlateResult {
  if (!Number.isFinite(totalGrams) || totalGrams <= 0) {
    return { perSide: [], achievedGrams: 0, exact: false, diffGrams: 0 };
  }

  const perSideTarget = (totalGrams - barGrams) / 2;
  // 总重量还不如杆重：挂不了片
  if (perSideTarget <= 0) {
    return {
      perSide: [],
      achievedGrams: barGrams,
      exact: totalGrams === barGrams,
      diffGrams: Math.abs(totalGrams - barGrams),
    };
  }

  const sorted = [...stock].sort((a, b) => b.grams - a.grams);
  const perSide: number[] = [];
  let remaining = perSideTarget;

  for (const p of sorted) {
    if (p.count <= 0) continue;
    let used = 0;
    // 允许 1 克的浮点余量，避免 0.1+0.2 式的误差导致少挂一片
    while (used < p.count && remaining >= p.grams - 1) {
      perSide.push(p.grams);
      remaining -= p.grams;
      used += 1;
    }
  }

  const achievedGrams = barGrams + perSide.reduce((s, x) => s + x, 0) * 2;
  return {
    perSide,
    achievedGrams,
    exact: Math.abs(achievedGrams - totalGrams) < 1,
    diffGrams: Math.abs(achievedGrams - totalGrams),
  };
}

/** 把每边的片压成 "25×2 + 10×1" 这样的文本，便于直接显示。 */
export function formatPlates(perSide: number[]): string {
  if (perSide.length === 0) return '空杆';
  const counts = new Map<number, number>();
  for (const g of perSide) counts.set(g, (counts.get(g) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([g, n]) => `${formatKg(g)}${n > 1 ? `×${n}` : ''}`)
    .join(' + ');
}

/** 1250 → "1.25"，25000 → "25"。去掉多余的 .0。 */
export function formatKg(grams: number): string {
  const kg = grams / 1000;
  return Number.isInteger(kg) ? String(kg) : kg.toFixed(2).replace(/0$/, '');
}
