/**
 * 目标设定与进度。
 *
 * 设计原则：
 * - 目标必须是可度量、可判断"达成/未达成"的，不写"变强"这种无法验证的话
 * - 进度用已有事实计算，不引入新存储的派生值（02:派生值不落库）
 * - 目标本身要落库（用户意图，不是派生）
 */

import type { Session } from './types';
import { bestSet, isValidCompleted, sessionVolumeGrams } from './metrics';

export type GoalKind = 'bodyweight' | 'strength' | 'frequency';

export interface BodyweightGoal {
  kind: 'bodyweight';
  targetGrams: number;
  /** 期望达成日期；null 表示无期限 */
  targetDate: string | null;
  /** 起始体重，用于计算进度方向 */
  startGrams: number | null;
  createdAt: string;
}

export interface StrengthGoal {
  kind: 'strength';
  exerciseId: string;
  /** 目标：该动作单组最大重量达到此值 */
  targetGrams: number;
  targetDate: string | null;
  createdAt: string;
}

export interface FrequencyGoal {
  kind: 'frequency';
  /** 每周训练次数 */
  perWeek: number;
  createdAt: string;
}

export type Goal = BodyweightGoal | StrengthGoal | FrequencyGoal;

export interface GoalProgress {
  /** 0–1，可能超过 1（超额完成） */
  ratio: number;
  current: number;
  target: number;
  unit: string;
  /** 面向用户的进度描述 */
  text: string;
  achieved: boolean;
  /** 剩余多少，未达成为正 */
  remaining: number;
}

/**
 * 体重目标进度。
 *
 * 关键：方向可能向上（增重）也可能向下（减重），
 * 不能用"当前/目标"算，否则减重时进度是反的。
 */
export function bodyweightProgress(
  goal: BodyweightGoal,
  currentGrams: number | null,
): GoalProgress {
  const start = goal.startGrams;
  if (currentGrams === null || start === null) {
    return {
      ratio: 0,
      current: currentGrams === null ? 0 : currentGrams / 1000,
      target: goal.targetGrams / 1000,
      unit: 'kg',
      text: currentGrams === null ? '还没有体重记录' : '缺少起始体重，无法计算进度',
      achieved: false,
      remaining: Math.abs(goal.targetGrams - (currentGrams ?? start ?? goal.targetGrams)) / 1000,
    };
  }

  const total = goal.targetGrams - start;
  const done = currentGrams - start;
  const achieved =
    total === 0 ? currentGrams === goal.targetGrams : done / total >= 1;

  // 方向相反时进度为 0，不能出现负数
  const ratio = total === 0 ? (achieved ? 1 : 0) : Math.max(0, Math.min(1, done / total));

  const remaining = Math.abs(goal.targetGrams - currentGrams) / 1000;
  // 起始体重就是当前体重时，进度必为 0。这时说"0%"像坏了，
  // 应该说清楚"从今天开始算"，让用户知道记录会推动进度。
  const notStarted = Math.abs(done) < 1;
  return {
    ratio,
    current: Math.round((currentGrams / 1000) * 10) / 10,
    target: Math.round((goal.targetGrams / 1000) * 10) / 10,
    unit: 'kg',
    text: achieved
      ? `已达成目标 ${Math.round((goal.targetGrams / 1000) * 10) / 10} kg`
      : notStarted
        ? `从今天开始算，还差 ${remaining.toFixed(1)} kg`
        : `还差 ${remaining.toFixed(1)} kg`,
    achieved,
    remaining: Math.round(remaining * 10) / 10,
  };
}

/**
 * 力量目标进度：取该动作的历史最佳单组重量。
 * 只对可比较的负重动作有意义（自重/计时无"重量"）。
 */
export function strengthProgress(
  goal: StrengthGoal,
  sessions: Session[],
): GoalProgress {
  const best = bestSet(sessions.filter(isValidCompleted), goal.exerciseId);
  const current = best?.loadGrams ?? 0;
  const ratio = goal.targetGrams === 0 ? 0 : Math.max(0, Math.min(1, current / goal.targetGrams));
  const achieved = current >= goal.targetGrams;
  return {
    ratio,
    current: Math.round((current / 1000) * 10) / 10,
    target: Math.round((goal.targetGrams / 1000) * 10) / 10,
    unit: 'kg',
    text: achieved
      ? `已达成 ${Math.round((goal.targetGrams / 1000) * 10) / 10} kg`
      : current === 0
        ? '还没有该动作的负重记录'
        : `还差 ${((goal.targetGrams - current) / 1000).toFixed(1)} kg`,
    achieved,
    remaining: Math.round(((goal.targetGrams - current) / 1000) * 10) / 10,
  };
}

/**
 * 训练频率目标：最近 N 周的平均周训练次数。
 * 用"最近 4 周平均"而不是"本周"，避免周初显示 0 次造成挫败。
 */
export function frequencyProgress(
  goal: FrequencyGoal,
  sessions: Session[],
  today: string,
  weeks = 4,
): GoalProgress {
  const valid = sessions.filter(isValidCompleted).filter((s) => s.businessDate <= today);
  const dates = new Set<string>();
  for (const s of valid) {
    const d = new Date(`${s.businessDate}T12:00:00`);
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    dates.add(d.toISOString().slice(0, 10));
  }

  // 统计最近 weeks 周内每周的场次数
  const counts = new Map<string, number>();
  for (const s of valid) {
    const d = new Date(`${s.businessDate}T12:00:00`);
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    const weekStart = d.toISOString().slice(0, 10);
    counts.set(weekStart, (counts.get(weekStart) ?? 0) + 1);
  }

  const recentWeeks: string[] = [];
  const base = new Date(`${today}T12:00:00`);
  const baseDay = (base.getDay() + 6) % 7;
  base.setDate(base.getDate() - baseDay);
  for (let i = 0; i < weeks; i += 1) {
    const d = new Date(base);
    d.setDate(d.getDate() - i * 7);
    recentWeeks.push(d.toISOString().slice(0, 10));
  }

  const total = recentWeeks.reduce((sum, w) => sum + (counts.get(w) ?? 0), 0);
  const avg = total / weeks;
  const ratio = goal.perWeek === 0 ? 0 : Math.max(0, Math.min(1, avg / goal.perWeek));

  return {
    ratio,
    current: Math.round(avg * 10) / 10,
    target: goal.perWeek,
    unit: '次/周',
    text:
      avg >= goal.perWeek
        ? `近 ${weeks} 周平均 ${avg.toFixed(1)} 次，已达标的`
        : `近 ${weeks} 周平均 ${avg.toFixed(1)} 次，目标 ${goal.perWeek} 次`,
    achieved: avg >= goal.perWeek,
    remaining: Math.round((goal.perWeek - avg) * 10) / 10,
  };
}

/** 依目标类型分派进度计算。 */
export function goalProgress(
  goal: Goal,
  ctx: { currentWeightGrams: number | null; sessions: Session[]; today: string },
): GoalProgress {
  if (goal.kind === 'bodyweight') return bodyweightProgress(goal, ctx.currentWeightGrams);
  if (goal.kind === 'strength') return strengthProgress(goal, ctx.sessions);
  return frequencyProgress(goal, ctx.sessions, ctx.today);
}

/** 目标是否应该提示"已过期"（超过目标日期仍未达成）。 */
export function isOverdue(goal: Goal, today: string, progress: GoalProgress): boolean {
  if (goal.kind === 'frequency') return false;
  if (!goal.targetDate) return false;
  return !progress.achieved && today > goal.targetDate;
}

/** 目标描述，用于列表展示。 */
export function goalLabel(goal: Goal, exerciseName?: (id: string) => string): string {
  if (goal.kind === 'bodyweight') {
    return `体重达到 ${(goal.targetGrams / 1000).toFixed(1)} kg`;
  }
  if (goal.kind === 'strength') {
    const name = exerciseName ? exerciseName(goal.exerciseId) : goal.exerciseId;
    return `${name} 单组 ${(goal.targetGrams / 1000).toFixed(1)} kg`;
  }
  return `每周训练 ${goal.perWeek} 次`;
}

/** 校验目标输入是否合理，返回错误信息或 null。 */
export function validateGoal(goal: Goal): string | null {
  if (goal.kind === 'bodyweight') {
    const kg = goal.targetGrams / 1000;
    if (kg < 35 || kg > 250) return '目标体重需在 35–250 kg 之间';
    if (goal.startGrams !== null) {
      const delta = Math.abs(goal.targetGrams - goal.startGrams) / 1000;
      if (delta < 0.5) return '目标与当前体重差距太小，没有意义';
      if (delta > 60) return '目标与当前体重差距过大，建议分阶段';
    }
    return null;
  }
  if (goal.kind === 'strength') {
    const kg = goal.targetGrams / 1000;
    if (kg <= 0) return '目标重量必须大于 0';
    if (kg > 500) return '目标重量超出合理范围';
    return null;
  }
  if (goal.perWeek < 1 || goal.perWeek > 21) return '每周次数需在 1–21 之间';
  return null;
}

/** 训练量摘要，供"本次 vs 上次"使用。 */
export interface SessionSummary {
  sets: number;
  volumeGrams: number;
  durationSeconds: number;
  exercises: number;
  bestSetGrams: number;
}

export function summarizeSession(session: Session): SessionSummary {
  let sets = 0;
  let best = 0;
  for (const ex of session.exercises) {
    for (const st of ex.sets) {
      if (st.kind !== 'work' || st.status !== 'completed') continue;
      sets += 1;
      if (st.loadGrams !== null && st.loadGrams > best) best = st.loadGrams;
    }
  }
  const started = new Date(session.startedAt).getTime();
  const ended = session.endedAt ? new Date(session.endedAt).getTime() : started;
  return {
    sets,
    volumeGrams: sessionVolumeGrams(session),
    durationSeconds: Math.max(0, Math.round((ended - started) / 1000)),
    exercises: session.exercises.length,
    bestSetGrams: best,
  };
}

/** 找同一模板/同一天的上一次训练，用于对比。 */
export function previousComparableSession(
  current: Session,
  all: Session[],
): Session | null {
  const candidates = all.filter(isValidCompleted)
    .filter((s) => s.id !== current.id)
    .filter((s) => s.businessDate < current.businessDate)
    .sort((a, b) => (a.businessDate < b.businessDate ? 1 : -1));

  const sameDay = candidates.find((s) => s.dayId === current.dayId && current.dayId !== null);
  if (sameDay) return sameDay;
  const sameTitle = candidates.find((s) => s.title === current.title);
  return sameTitle ?? null;
}

/** 对比两次训练，给出可读的差异。 */
export interface SessionDiff {
  volumeDeltaPct: number | null;
  setsDelta: number;
  durationDeltaSeconds: number;
  bestSetDeltaGrams: number;
  text: string;
}

export function diffSessions(current: SessionSummary, previous: SessionSummary): SessionDiff {
  const volumeDeltaPct =
    previous.volumeGrams === 0
      ? null
      : Math.round(((current.volumeGrams - previous.volumeGrams) / previous.volumeGrams) * 1000) / 10;
  const setsDelta = current.sets - previous.sets;
  const durationDeltaSeconds = current.durationSeconds - previous.durationSeconds;
  const bestSetDeltaGrams = current.bestSetGrams - previous.bestSetGrams;

  const parts: string[] = [];
  // 变化为 0 时不必提示"容量 +0%"，那是噪音
  if (volumeDeltaPct !== null && volumeDeltaPct !== 0) {
    parts.push(`容量${volumeDeltaPct >= 0 ? '+' : ''}${volumeDeltaPct}%`);
  }
  if (setsDelta !== 0) parts.push(`组数${setsDelta > 0 ? '+' : ''}${setsDelta}`);
  if (bestSetDeltaGrams !== 0) {
    parts.push(`最重一组${bestSetDeltaGrams > 0 ? '+' : ''}${(bestSetDeltaGrams / 1000).toFixed(1)}kg`);
  }

  return {
    volumeDeltaPct,
    setsDelta,
    durationDeltaSeconds,
    bestSetDeltaGrams,
    text: parts.length ? parts.join(' · ') : '与上次持平',
  };
}




