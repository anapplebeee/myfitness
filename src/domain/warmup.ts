/**
 * 热身组生成。
 *
 * 为什么必须做：
 * 模板里 `full-2` 标着 beginner，第一个动作是杠铃深蹲 3×6–8，**直接上工作组**。
 * 对一个以新手为目标人群的力量 App，"不热身就上大重量"是受伤风险，
 * 不是体验问题。
 *
 * 规则取保守值：
 * - 只对**有负重**的动作生成（自重动作没有可加的重量）
 * - 工作重量不超过空杆时不生成（没得可加）
 * - 逐级递增，四舍五入到 2.5 kg（国内健身房最小杠铃片常见 2.5）
 * - 任何一级如果 >= 工作重量就丢掉，避免"热身比工作组还重"
 *
 * 只生成**计划**，不强制：用户可以在录制页删掉任何一组。
 */

export interface WarmupSet {
  /** 建议重量（克） */
  loadGrams: number;
  reps: number;
  /** 界面上的短标签："空杆" / "50%" / "70%" / "85%" */
  label: string;
}

export interface WarmupInput {
  /** 工作组重量（克）。0 或负数表示自重，不生成。 */
  workingGrams: number;
  /** 空杆重量（克），默认 20 kg。非杠铃动作传 0。 */
  barGrams?: number;
  /**
   * 是否是杠铃动作。
   * 杠铃从空杆起热身更符合实际；哑铃/器械直接按百分比走。
   */
  isBarbell?: boolean;
}

/** 四舍五入到 2.5 kg 的倍数（克为单位）。 */
function roundToPlate(grams: number): number {
  const step = 2500;
  return Math.round(grams / step) * step;
}

/**
 * 生成热身组。
 *
 * 返回空数组的情况：
 * - 工作重量 <= 0（自重）
 * - 工作重量不足以做任何递增（<= 空杆）
 */
export function buildWarmup(input: WarmupInput): WarmupSet[] {
  const { workingGrams } = input;
  if (!Number.isFinite(workingGrams) || workingGrams <= 0) return [];

  const bar = input.isBarbell === false ? 0 : (input.barGrams ?? 20000);

  const out: WarmupSet[] = [];

  // 第一级：空杆。只有在工作重量明显高于空杆时才值得做。
  if (bar > 0 && workingGrams > bar * 1.5) {
    out.push({ loadGrams: bar, reps: 10, label: '空杆' });
  }

  const steps: Array<{ pct: number; reps: number; label: string }> = [
    { pct: 0.5, reps: 5, label: '50%' },
    { pct: 0.7, reps: 3, label: '70%' },
    { pct: 0.85, reps: 2, label: '85%' },
  ];

  for (const s of steps) {
    const load = roundToPlate(workingGrams * s.pct);
    // 低于空杆的重量加不上去
    if (bar > 0 && load < bar) continue;
    // 不比上一级重就没意义
    const prev = out[out.length - 1];
    if (prev && load <= prev.loadGrams) continue;
    // 不能达到或超过工作组
    if (load >= workingGrams) continue;
    out.push({ loadGrams: load, reps: s.reps, label: s.label });
  }

  return out;
}

/** 热身组的总组数，用于界面上"共 N 组热身"的文案。 */
export function warmupCount(sets: WarmupSet[]): number {
  return sets.length;
}
