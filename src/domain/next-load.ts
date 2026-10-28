/**
 * 下次重量建议。
 *
 * 只给"能解释、可拒绝"的建议，不做黑箱：
 * - 上次每组都到次数上限 → 加一个最小增量；
 * - 有组低于次数下限 → 降两个增量；
 * - 其余情况保持；
 * - 工作组少于 2 个 → 不给建议（样本不足，只展示记录）。
 */

export interface LoadSuggestion {
  grams: number;
  deltaGrams: number;
  reason: string;
}

export function suggestNextLoad(input: {
  sets: Array<{ loadGrams: number | null; reps: number | null }>;
  repMin: number;
  repMax: number;
  incrementGrams: number;
}): LoadSuggestion | null {
  const valid = input.sets.filter((s) => (s.loadGrams ?? 0) > 0 && (s.reps ?? 0) > 0);
  if (valid.length < 2) return null;

  const top = Math.max(...valid.map((s) => s.loadGrams!));
  const atTop = valid.filter((s) => s.loadGrams === top);
  const increment = input.incrementGrams > 0 ? input.incrementGrams : 2500;

  const allHitMax = atTop.every((s) => (s.reps ?? 0) >= input.repMax);
  if (allHitMax) {
    return {
      grams: top + increment,
      deltaGrams: increment,
      reason: `上次每组都到 ${input.repMax} 次上限，可以加重`,
    };
  }

  const anyBelowMin = valid.some((s) => (s.reps ?? 0) < input.repMin);
  if (anyBelowMin) {
    const next = Math.max(0, top - increment * 2);
    return {
      grams: next,
      deltaGrams: next - top,
      reason: `上次有组低于 ${input.repMin} 次，先把重量降下来`,
    };
  }

  return { grams: top, deltaGrams: 0, reason: '上次落在目标次数区间内，先保持重量' };
}
