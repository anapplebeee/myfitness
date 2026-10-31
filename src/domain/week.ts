/**
 * 周目标与结算：严格按 docs/09-checkin-model.md 实现。
 *
 * 关键口径：
 * - 计划、执行、统计分离；打卡是派生结果，没有额外"点打卡"动作。
 * - 原始计划数 N 不可事后修改；有效最低目标 K = min(minimumTarget, A)。
 * - 状态优先级：unplanned → paused → upcoming → ongoing → achieved/notAchieved。
 * - 同一会话最多满足一个项目，同一项目最多一场有效会话。
 */

import type { Session } from './types';
import { addDays, businessDate } from './units';
import { isValidCompleted } from './metrics';

export type Disposition = 'scheduled' | 'excused' | 'cancelled';

export type WeekStatus =
  | 'unplanned'
  | 'paused'
  | 'upcoming'
  | 'ongoing'
  | 'achieved'
  | 'notAchieved';

export interface PlannedOccurrence {
  id: string;
  planVersionId: string;
  weekStart: string;
  originalDate: string;
  scheduledDate: string;
  slotId: string;
  title: string;
  exerciseIds: string[];
  disposition: Disposition;
  /** 仅用于展示与审计；完成关联以 session.occurrenceId 为唯一权威。 */
  dispositionReason?: string;
  disposedAt?: string;
}

export interface GoalAdjustment {
  id: string;
  beforeOccurrenceIds: string[];
  afterOccurrenceIds: string[];
  beforeMinimum: number;
  afterMinimum: number;
  reason: string;
  recordedAt: string;
}

export interface WeekGoal {
  id: string;
  weekStart: string;
  originalPlannedCount: number;
  minimumTarget: number;
  adjustments: GoalAdjustment[];
}

export const RULE_VERSION = 1;

/**
 * 委托给 metrics 的唯一口径，避免两套判定继续分叉。
 * 保留这个导出名，是因为 week 的调用方语义是"算不算一次训练"。
 */
export function isValidCompletedSession(session: Session): boolean {
  return isValidCompleted(session);
}

export function weekRange(weekStart: string): { from: string; to: string } {
  return { from: weekStart, to: addDays(weekStart, 7) };
}

function startOfWeekDate(weekStart: string): Date {
  return new Date(`${weekStart}T00:00:00`);
}

function endOfWeekDate(weekStart: string): Date {
  const d = startOfWeekDate(weekStart);
  d.setDate(d.getDate() + 7);
  return d;
}

export function inWeek(date: string, weekStart: string): boolean {
  const { from, to } = weekRange(weekStart);
  return date >= from && date < to;
}

export interface WeekResult {
  weekStart: string;
  status: WeekStatus;
  originalPlanned: number;
  adjustedPlanned: number;
  minimumTarget: number;
  completedOccurrences: number;
  actualSessionCount: number;
  trainingDays: number;
  excusedCount: number;
  cancelledCount: number;
  targetReached: boolean;
  full: boolean;
  satisfiedOccurrenceIds: string[];
  missedOccurrenceIds: string[];
  /** 本周有效会话（去重后按时间升序）。 */
  sessionIds: string[];
}

export interface WeekInput {
  weekStart: string;
  goal: WeekGoal | null;
  occurrences: PlannedOccurrence[];
  sessions: Session[];
  now: Date;
  ruleVersion?: number;
}

const EMPTY_RESULT_BASE = {
  originalPlanned: 0,
  adjustedPlanned: 0,
  minimumTarget: 0,
  completedOccurrences: 0,
  actualSessionCount: 0,
  trainingDays: 0,
  excusedCount: 0,
  cancelledCount: 0,
  targetReached: false,
  full: false,
  satisfiedOccurrenceIds: [] as string[],
  missedOccurrenceIds: [] as string[],
  sessionIds: [] as string[],
};

export function computeWeek(input: WeekInput): WeekResult {
  const { weekStart, goal, occurrences, sessions, now } = input;

  // 本周项目集合 S：按 ID 去重，先归一化到本周
  const seen = new Set<string>();
  const set: PlannedOccurrence[] = [];
  for (const occ of occurrences) {
    if (occ.weekStart !== weekStart) continue;
    if (seen.has(occ.id)) continue;
    seen.add(occ.id);
    set.push(occ);
  }

  const active = set.filter((o) => o.disposition === 'scheduled');
  const A = active.length;
  const excusedCount = set.filter((o) => o.disposition === 'excused').length;
  const cancelledCount = set.filter((o) => o.disposition === 'cancelled').length;

  // 本周有效会话（去重）
  // tombstone 不参与统计：删除是显式事实（types.ts:88、amend.ts:140）。
  // 这里显式过滤而不只依赖 isValidCompletedSession，避免将来有人
  // 给有效性判定加新口径时把删除的会话重新放回统计。
  const weekSessions: Session[] = [];
  const sessionSeen = new Set<string>();
  for (const s of sessions) {
    if (sessionSeen.has(s.id)) continue;
    if (s.deletedAt) continue;
    if (!inWeek(s.businessDate, weekStart)) continue;
    if (!isValidCompletedSession(s)) continue;
    sessionSeen.add(s.id);
    weekSessions.push(s);
  }
  weekSessions.sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));

  const trainingDays = new Set(weekSessions.map((s) => s.businessDate)).size;

  // 关键：goal 为空必须先处理，不能在解引用之后再判空
  // （09 号原伪代码在 K=min(goal...) 处先解引用，goal 为 null 时会崩，见 13 号评审）
  if (!goal) {
    return {
      ...EMPTY_RESULT_BASE,
      weekStart,
      status: 'unplanned',
      adjustedPlanned: A,
      excusedCount,
      cancelledCount,
      actualSessionCount: weekSessions.length,
      trainingDays,
      sessionIds: weekSessions.map((s) => s.id),
    };
  }

  if (set.length === 0 && goal.originalPlannedCount === 0) {
    return {
      ...EMPTY_RESULT_BASE,
      weekStart,
      status: 'unplanned',
      originalPlanned: goal.originalPlannedCount,
      actualSessionCount: weekSessions.length,
      trainingDays,
      sessionIds: weekSessions.map((s) => s.id),
    };
  }

  const K = Math.min(goal.minimumTarget, A);

  // D：被本周有效完成会话唯一满足的项目数
  const satisfied: string[] = [];
  for (const occ of active) {
    const matched = weekSessions.find(
      (s) => s.occurrenceId === occ.id && s.goalCreditConfirmed === true,
    );
    if (matched) satisfied.push(occ.id);
  }
  const D = satisfied.length;

  // 未满足：仍未完成、未豁免/取消的项目（历史日期才叫 missed，未来只是 scheduled）
  const missed = active.filter((o) => !satisfied.includes(o.id)).map((o) => o.id);

  const weekStartDate = startOfWeekDate(weekStart);
  const weekEndDate = endOfWeekDate(weekStart);

  let status: WeekStatus;
  if (K === 0) status = 'paused';
  else if (now.getTime() < weekStartDate.getTime()) status = 'upcoming';
  else if (now.getTime() < weekEndDate.getTime()) status = 'ongoing';
  else status = D >= K ? 'achieved' : 'notAchieved';

  return {
    weekStart,
    status,
    originalPlanned: goal.originalPlannedCount,
    adjustedPlanned: A,
    minimumTarget: K,
    completedOccurrences: D,
    actualSessionCount: weekSessions.length,
    trainingDays,
    excusedCount,
    cancelledCount,
    targetReached: K > 0 && D >= K,
    full: A > 0 && D === A,
    satisfiedOccurrenceIds: satisfied,
    missedOccurrenceIds: missed,
    sessionIds: weekSessions.map((s) => s.id),
  };
}

/** 连续达标周：achieved 加 1，notAchieved 归 0，paused/unplanned 保持，ongoing/upcoming 不参与。 */
export function foldStreak(results: WeekResult[]): number {
  let streak = 0;
  for (const r of results) {
    if (r.status === 'achieved') streak += 1;
    else if (r.status === 'notAchieved') streak = 0;
    // paused / unplanned / ongoing / upcoming：保持当前值，不增加也不清零
  }
  return streak;
}

/** 连续达标只统计已结束周，输入按 weekStart 升序。 */
export function streakOfEndedWeeks(results: WeekResult[]): number {
  const ended = results
    .filter((r) => r.status === 'achieved' || r.status === 'notAchieved' || r.status === 'paused' || r.status === 'unplanned')
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
  return foldStreak(ended);
}

export function initialWeekGoal(weekStart: string, occurrences: PlannedOccurrence[]): WeekGoal {
  const count = occurrences.filter((o) => o.weekStart === weekStart).length;
  return {
    id: `goal_${weekStart}`,
    weekStart,
    originalPlannedCount: count,
    minimumTarget: count,
    adjustments: [],
  };
}

export interface TargetChangeCheck {
  ok: boolean;
  reason?: string;
}

/** 最低目标变更校验：提高不超过当前 A；降到 0 仅允许 A=0。 */
export function canSetMinimumTarget(
  goal: WeekGoal,
  occurrences: PlannedOccurrence[],
  next: number,
): TargetChangeCheck {
  const A = occurrences.filter((o) => o.weekStart === goal.weekStart && o.disposition === 'scheduled').length;
  if (!Number.isInteger(next)) return { ok: false, reason: '目标必须是整数' };
  if (next < 0) return { ok: false, reason: '目标不能为负' };
  if (next > A) return { ok: false, reason: `最高只能设为当前可执行的 ${A} 项` };
  if (next === 0 && A > 0) {
    return { ok: false, reason: '还有未处理的项目，休整请用豁免或取消表达' };
  }
  if (next > goal.originalPlannedCount) {
    return { ok: false, reason: '不能超过原始计划数' };
  }
  return { ok: true };
}

/** 追加一次目标调整，保留原值与原因，按序不可重复。 */
export function applyMinimumTargetChange(
  goal: WeekGoal,
  occurrences: PlannedOccurrence[],
  next: number,
  reason: string,
  recordedAt: string,
  adjustmentId: string,
): WeekGoal {
  const check = canSetMinimumTarget(goal, occurrences, next);
  if (!check.ok) throw new Error(check.reason ?? '目标变更不合法');
  const weekOcc = occurrences.filter((o) => o.weekStart === goal.weekStart);
  return {
    ...goal,
    minimumTarget: next,
    adjustments: [
      ...goal.adjustments,
      {
        id: adjustmentId,
        beforeOccurrenceIds: weekOcc.filter((o) => o.disposition === 'scheduled').map((o) => o.id),
        afterOccurrenceIds: weekOcc.filter((o) => o.disposition === 'scheduled').map((o) => o.id),
        beforeMinimum: goal.minimumTarget,
        afterMinimum: next,
        reason,
        recordedAt,
      },
    ],
  };
}

export const EXCUSE_REASONS = ['生病', '伤病', '出差', '工作', '主动休息', '其他'] as const;
export type ExcuseReason = (typeof EXCUSE_REASONS)[number];

/** 有 active/paused 会话关联时不能直接顺延/取消/豁免。已删除的会话不算。 */
export function canDispose(occurrence: PlannedOccurrence, sessions: Session[]): TargetChangeCheck {
  const live = sessions.find(
    (s) =>
      !s.deletedAt &&
      s.occurrenceId === occurrence.id && (s.status === 'active' || s.status === 'paused'),
  );
  if (live) return { ok: false, reason: '这场训练还没结束，先结束或解除关联再改计划' };
  return { ok: true };
}

/** 顺延只改 scheduledDate，保留 originalDate，不改变 A 或 K。 */
export function postpone(
  occurrence: PlannedOccurrence,
  nextDate: string,
  weekStart: string,
): PlannedOccurrence {
  if (!inWeek(nextDate, weekStart)) {
    throw new Error('只能顺延到同一周内，跨周请豁免或保留未完成');
  }
  return { ...occurrence, scheduledDate: nextDate };
}

export type DayState =
  | 'done'
  | 'in_progress'
  | 'partial'
  | 'excused'
  | 'missed'
  | 'scheduled'
  | 'rest';

export interface DayCell {
  date: string;
  primary: DayState;
  doneCount: number;
  openCount: number;
  excusedCount: number;
  movedCount: number;
  inProgress: boolean;
  /** 一天完成一项漏一项时的"另有 N 项未完成"。 */
  missedNote: string | null;
}

/** 日历状态：主显示 done > in_progress > partial > missed > scheduled > excused > rest。 */
export function dayState(
  date: string,
  occurrences: PlannedOccurrence[],
  sessions: Session[],
  result: WeekResult,
  today: string,
): DayCell {
  const dayOcc = occurrences.filter((o) => o.weekStart === result.weekStart && o.scheduledDate === date);
  // 已删除的场次不参与日历状态
  const daySessions = sessions.filter((s) => s.businessDate === date && !s.deletedAt);

  const validDone = daySessions.filter(isValidCompletedSession);
  const live = daySessions.filter((s) => s.status === 'active' || s.status === 'paused');
  const partial = daySessions.some(
    (s) =>
      s.status === 'discarded' ||
      (s.status === 'completed' && !isValidCompletedSession(s)) ||
      s.exercises.some((ex) => ex.sets.some((st) => st.status === 'skipped' || st.status === 'planned')),
  );

  const scheduled = dayOcc.filter((o) => o.disposition === 'scheduled');
  const excused = dayOcc.filter((o) => o.disposition === 'excused');
  const satisfiedIds = new Set(result.satisfiedOccurrenceIds);
  const openScheduled = scheduled.filter((o) => !satisfiedIds.has(o.id));
  const doneScheduled = scheduled.filter((o) => satisfiedIds.has(o.id));

  const isPast = date < today;
  const missedHere = isPast ? openScheduled.filter((o) => o.scheduledDate < today) : [];
  const movedCount = dayOcc.filter((o) => o.originalDate !== o.scheduledDate).length;

  let primary: DayState;
  if (validDone.length > 0) primary = 'done';
  else if (live.length > 0) primary = 'in_progress';
  else if (partial) primary = 'partial';
  else if (missedHere.length > 0) primary = 'missed';
  else if (openScheduled.length > 0 && date >= today) primary = 'scheduled';
  else if (excused.length > 0 && dayOcc.length > 0) primary = 'excused';
  else primary = 'rest';

  const missedCount = missedHere.length;
  return {
    date,
    primary,
    doneCount: Math.max(validDone.length, doneScheduled.length),
    openCount: openScheduled.length,
    excusedCount: excused.length,
    movedCount,
    inProgress: live.length > 0,
    missedNote: primary === 'done' && missedCount > 0 ? `另有 ${missedCount} 项未完成` : null,
  };
}

export function dayStatesForWeek(
  weekStart: string,
  occurrences: PlannedOccurrence[],
  sessions: Session[],
  result: WeekResult,
  today: string,
): DayCell[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    return dayState(date, occurrences, sessions, result, today);
  });
}

export function statusLabel(status: WeekStatus): string {
  switch (status) {
    case 'achieved':
      return '已达标';
    case 'notAchieved':
      return '未达标';
    case 'ongoing':
      return '进行中';
    case 'paused':
      return '休整周';
    case 'upcoming':
      return '未开始';
    default:
      return '无计划';
  }
}

/** 展示用：原始 N 与调整后 A 不一致时说明原因。 */
export function targetNarrative(result: WeekResult): string {
  if (result.originalPlanned === 0) return '本周没有设定计划';
  if (result.adjustedPlanned === result.originalPlanned) {
    return `原始 ${result.originalPlanned} 项 · 最低目标 ${result.minimumTarget} 项`;
  }
  return `原始 ${result.originalPlanned} 项 → 调整后 ${result.adjustedPlanned} 项 · 最低目标 ${result.minimumTarget} 项`;
}

/** 本周剩余天数（含今天），用于"还剩几天可安排"。 */
export function daysLeftInWeek(today: string, weekStart: string): number {
  const { to } = weekRange(weekStart);
  if (today >= to) return 0;
  let count = 0;
  let cursor = today;
  while (cursor < to) {
    count += 1;
    cursor = addDays(cursor, 1);
  }
  return count;
}

export function currentWeekStart(now: Date = new Date()): string {
  const date = businessDate(now);
  const d = new Date(`${date}T12:00:00`);
  const offset = (d.getDay() + 6) % 7;
  return addDays(date, -offset);
}


