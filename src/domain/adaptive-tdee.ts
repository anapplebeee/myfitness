/**
 * 自适应 TDEE：用体重变化反推真实维持热量。
 *
 * 为什么重要：静态公式（Mifflin-St Jeor × 活动系数）的误差常在 ±300–500 kcal，
 * 而减脂失败最常见的原因就是"目标热量和真实消耗脱节"。
 * 我们有体重记录、也有每日摄入记录，完全可以反推：
 *
 *   能量守恒：摄入 − 消耗 = 体重变化 × 7700 kcal/kg
 *   ⇒ 消耗 ≈ 平均摄入 − (体重变化kg × 7700 ÷ 天数)
 *
 * 这是 MacroFactor 一类产品的核心，只是他们的模型更复杂（会做平滑、
 * 处理水分波动、区分lean mass）。这里做一个诚实的最小版本。
 *
 * 三条硬约束（不做就会给出危险数字）：
 * 1. 记录天数不够就不算——半份记录会让"平均摄入"严重偏低
 * 2. 体重变化太小（水分波动量级）就不算——会被噪声放大成巨大误差
 * 3. 结果落在生理不可能区间就不算——宁可不说，也不给一个能误导人的数
 */

import type { AppState } from './types';
import { addDays } from './units';

/** 1 kg 体重约对应 7700 kcal。 */
const KCAL_PER_KG = 7700;

/** 至少要覆盖这么多天才算。 */
const MIN_SPAN_DAYS = 14;
/** 至少要有这么多天记了饮食，否则平均摄入不可信。 */
const MIN_LOGGED_DAYS = 10;

/** 跨度内至少要有这么高比例的饮食记录，否则平均摄入不可信。 */
const MIN_COVERAGE = 0.7;
/** 体重净变化小于这个值视为噪声（水分波动级）。 */
const MIN_WEIGHT_DELTA_KG = 0.3;
/*
 * 每周体重变化超过这个值，基本可以断定数据有问题：
 * 自然状态下每周掉/涨 1.5 kg 以上，多半是水分、称重时间不一致，
 * 或者只记了部分饮食。用它反推 TDEE 会把误差放大好几倍。
 */
const MAX_WEEKLY_CHANGE_KG = 1.5;

/** 合理的维持热量区间（成人）。超出说明数据有问题。 */
const MIN_PLAUSIBLE_KCAL = 1200;
const MAX_PLAUSIBLE_KCAL = 6000;

export interface AdaptiveTdeeInput {
  /** 体重记录（按日期升序） */
  weights: Array<{ date: string; grams: number }>;
  /** 每日摄入 kcal，只放"有记录"的日期 */
  intakeByDate: Array<{ date: string; kcal: number }>;
  /** 统计窗口的最后一天（含） */
  endDate: string;
  /** 窗口长度，默认 28 天 */
  windowDays?: number;
}

export type AdaptiveTdeeBlocked =
  | 'span-too-short'
  | 'too-few-logged-days'
  | 'weight-flat'
  | 'rate-too-fast'
  | 'implausible'
  | 'no-weight-data';

export interface AdaptiveTdeeResult {
  /** 估算的维持热量；不可信时为 null */
  maintenanceKcal: number | null;
  /** 期间体重变化（kg，正=涨） */
  weightDeltaKg: number;
  /** 每周变化（kg/周） */
  weeklyChangeKg: number;
  /** 平均每日摄入 */
  avgIntakeKcal: number;
  /** 有摄入记录的天数 */
  loggedDays: number;
  /** 数据覆盖天数 */
  spanDays: number;
  /** 不可信时说明原因 */
  blocked: AdaptiveTdeeBlocked | null;
}

/**
 * 估算维持热量。
 *
 * 窗口取"最近 windowDays 天"：太短会被水分波动带偏，
 * 太长则跟不上体重与活动量的变化。
 */
export function estimateAdaptiveTdee(input: AdaptiveTdeeInput): AdaptiveTdeeResult {
  const windowDays = input.windowDays ?? 28;
  const from = addDays(input.endDate, -(windowDays - 1));

  const weights = input.weights
    .filter((w) => w.date >= from && w.date <= input.endDate && w.grams > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const intake = input.intakeByDate.filter((d) => d.date >= from && d.date <= input.endDate);

  const base: Omit<AdaptiveTdeeResult, 'blocked'> = {
    maintenanceKcal: null,
    weightDeltaKg: 0,
    weeklyChangeKg: 0,
    avgIntakeKcal: 0,
    loggedDays: intake.length,
    spanDays: 0,
  };

  if (weights.length < 2) {
    return { ...base, blocked: 'no-weight-data' };
  }

  const first = weights[0]!;
  const last = weights[weights.length - 1]!;
  const spanDays = Math.max(1, daysBetween(first.date, last.date));
  const weightDeltaKg = (last.grams - first.grams) / 1000;

  /*
   * 摄入只能取"两次体重记录之间"的天数。
   *
   * 原实现按窗口取，再除以 intake.length，于是窗口边缘 10 天的记录
   * 会被当成整段 27 天都这么吃 —— 后 17 天完全没记，照样给出一个
   * 精确到 kcal 的结论。先把区间对齐到体重跨度，再要求覆盖率。
   */
  const intakeInSpan = intake.filter((d) => d.date >= first.date && d.date <= last.date);
  const coverage = intakeInSpan.length / spanDays;

  const avgIntakeKcal =
    intakeInSpan.length > 0
      ? Math.round(intakeInSpan.reduce((s, d) => s + d.kcal, 0) / intakeInSpan.length)
      : 0;

  const filled: Omit<AdaptiveTdeeResult, 'blocked'> = {
    ...base,
    weightDeltaKg: round1(weightDeltaKg),
    weeklyChangeKg: round1((weightDeltaKg / spanDays) * 7),
    avgIntakeKcal,
    loggedDays: intakeInSpan.length,
    spanDays,
  };

  if (spanDays < MIN_SPAN_DAYS) {
    return { ...filled, blocked: 'span-too-short' };
  }
  if (intakeInSpan.length < MIN_LOGGED_DAYS || coverage < MIN_COVERAGE) {
    return { ...filled, blocked: 'too-few-logged-days' };
  }
  /*
   * 体重几乎没动时不估算。
   *
   * 理论上"没变"意味着摄入≈消耗，可以直接用平均摄入当 TDEE；
   * 但 0.3 kg 以内的变化本身就在水分波动范围内，
   * 用它做除数会得到巨大误差。宁可让用户继续记录。
   */
  if (Math.abs(weightDeltaKg) < MIN_WEIGHT_DELTA_KG) {
    return { ...filled, blocked: 'weight-flat' };
  }

  const weekly = filled.weeklyChangeKg;
  if (Math.abs(weekly) > MAX_WEEKLY_CHANGE_KG) {
    return { ...filled, blocked: 'rate-too-fast' };
  }

  const dailyBalance = (weightDeltaKg * KCAL_PER_KG) / spanDays;
  const maintenanceKcal = Math.round(avgIntakeKcal - dailyBalance);

  if (maintenanceKcal < MIN_PLAUSIBLE_KCAL || maintenanceKcal > MAX_PLAUSIBLE_KCAL) {
    return { ...filled, blocked: 'implausible' };
  }

  return { ...filled, maintenanceKcal, blocked: null };
}

/** 把结果翻成一句人话，供界面直接显示。 */
export function adaptiveTdeeHint(r: AdaptiveTdeeResult): string {
  switch (r.blocked) {
    case 'no-weight-data':
      return '还需要至少两次体重记录';
    case 'span-too-short':
      return `记录跨度 ${r.spanDays} 天，至少需要 ${MIN_SPAN_DAYS} 天`;
    case 'too-few-logged-days':
      return `只有 ${r.loggedDays} 天记了饮食，至少需要 ${MIN_LOGGED_DAYS} 天`;
    case 'weight-flat':
      return '体重变化太小，暂时无法推算（继续记录即可）';
    case 'rate-too-fast':
      return `体重每周变化 ${Math.abs(r.weeklyChangeKg)} kg，超出可信范围，先检查称重与饮食记录`;
    case 'implausible':
      return '按现有数据推算出的数值不合理，先检查记录是否完整';
    default:
      return `近 ${r.spanDays} 天实测维持热量约 ${r.maintenanceKcal} kcal`;
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`).getTime();
  const b = new Date(`${to}T12:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** 从应用状态里抽出输入：只取窗口内的体重与每日摄入。 */
export function adaptiveTdeeFromState(
  state: AppState,
  endDate: string,
  windowDays = 28,
): AdaptiveTdeeResult {
  const from = addDays(endDate, -(windowDays - 1));

  const weights = state.weights
    .filter((w) => w.date >= from && w.date <= endDate)
    .map((w) => ({ date: w.date, grams: w.grams }));

  // 同一天多条记录会重复计数，先按日期汇总
  const perDate = new Map<string, number>();
  for (const f of state.foods) {
    if (f.date < from || f.date > endDate) continue;
    perDate.set(f.date, (perDate.get(f.date) ?? 0) + f.kcal);
  }
  const intakeByDate = [...perDate.entries()].map(([date, kcal]) => ({ date, kcal }));

  return estimateAdaptiveTdee({ weights, intakeByDate, endDate, windowDays });
}

