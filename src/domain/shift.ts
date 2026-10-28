/**
 * 周计划后移（延期）。
 *
 * 支持两种范围：
 * - day：只移这一天；如果次日已被占用，链式把后面那天的也往后推（级联）；
 * - tail：本周从这一天起的所有安排整体后移一天。
 *
 * 跨周（越过周日）时由用户二选一：
 * - drop：移除超出的项（本周少练一天）；
 * - next-week：放进下周（同星期几优先，占用则找下周第一个空位）。
 */

import type { Session } from './types';
import {
  canDispose,
  initialWeekGoal,
  isValidCompletedSession,
  type PlannedOccurrence,
  type WeekGoal,
} from './week';
import { addDays } from './units';

export type ShiftScope = 'day' | 'tail';
export type OverflowStrategy = 'drop' | 'next-week';

export interface ShiftPreview {
  scope: ShiftScope;
  date: string;
  /** 会被移动的项 */
  moving: PlannedOccurrence[];
  /** 移动后会超出本周的项 */
  overflow: PlannedOccurrence[];
  /** 因冲突被连带移动的项数（不含起始日） */
  cascaded: number;
  /** 有完成/进行中会话、因此不能移动的项数 */
  locked: number;
  error?: string;
}

export interface ShiftResult {
  occurrences: PlannedOccurrence[];
  goals: WeekGoal[];
  moved: number;
  dropped: number;
  toNextWeek: number;
  /** 已完成/进行中、被跳过的项数 */
  locked: number;
  error?: string;
}

function active(occurrences: PlannedOccurrence[]): PlannedOccurrence[] {
  return occurrences.filter((o) => o.disposition === 'scheduled');
}

/**
 * 已发生的事实不能随计划后移。
 *
 * 复用 week.ts 的 canDispose（进行中的场次不能改计划），
 * 再补上"已完成"这一条：已完成项目后移会把原周的完成数改掉，
 * 用户练过的训练被重新解释。
 */
function lockedIds(occurrences: PlannedOccurrence[], sessions: Session[]): Set<string> {
  const locked = new Set<string>();
  for (const o of occurrences) {
    if (!canDispose(o, sessions).ok) {
      locked.add(o.id);
      continue;
    }
    const done = sessions.some(
      (s) => !s.deletedAt && s.occurrenceId === o.id && isValidCompletedSession(s),
    );
    if (done) locked.add(o.id);
  }
  return locked;
}

/** 本周最后一天（周日）。 */
function weekEndOf(weekStart: string): string {
  return addDays(weekStart, 6);
}

/**
 * 计算"要移动哪些项"，不落库。
 * day 模式从 date 起找连续被占用的日期链；tail 模式取 date 及之后全部。
 */
export function previewShift(
  occurrences: PlannedOccurrence[],
  weekStart: string,
  scope: ShiftScope,
  date: string,
  sessions: Session[] = [],
): ShiftPreview {
  const locked = lockedIds(occurrences, sessions);
  const weekActive = active(occurrences).filter((o) => o.weekStart === weekStart);
  // 已完成/进行中的项不参与后移，只统计给界面提示
  const inWeekActive = weekActive.filter((o) => !locked.has(o.id));
  const lockedInWeek = weekActive.filter((o) => locked.has(o.id));
  const byDate = new Map<string, PlannedOccurrence[]>();
  for (const o of inWeekActive) {
    const list = byDate.get(o.scheduledDate) ?? [];
    list.push(o);
    byDate.set(o.scheduledDate, list);
  }

  const weekEnd = weekEndOf(weekStart);

  /*
   * 整体后移：从 date 起所有"还能动"的项各 +1。
   * 起始日本身已经完成也没关系——那是已发生的事实，留在原位，
   * 后面还没做的照常往后推。
   */
  if (scope === 'tail') {
    const moving = inWeekActive.filter((o) => o.scheduledDate >= date);
    if (!moving.length) {
      const lockedOnDate = lockedInWeek.some((o) => o.scheduledDate === date);
      return {
        scope,
        date,
        moving: [],
        overflow: [],
        cascaded: 0,
        locked: lockedInWeek.length,
        error: lockedOnDate ? '这一天已完成，本周没有可后移的安排' : '这一天之后没有可后移的安排',
      };
    }
    const overflow = moving.filter((o) => addDays(o.scheduledDate, 1) > weekEnd);
    return { scope, date, moving, overflow, cascaded: 0, locked: lockedInWeek.length };
  }

  // 单日后移：这一天必须还有可移动项；整天都完成时明确拒绝
  if (!byDate.has(date)) {
    const lockedOnDate = lockedInWeek.some((o) => o.scheduledDate === date);
    return {
      scope,
      date,
      moving: [],
      overflow: [],
      cascaded: 0,
      locked: lockedInWeek.length,
      error: lockedOnDate ? '这一天已完成，不能后移' : '这一天没有可后移的安排',
    };
  }

  // 链式冲突：date、date+1… 连续被占用的日期都要各后移一天
  const chain: string[] = [];
  let cursor = date;
  while (byDate.has(cursor) && chain.length < 7) {
    chain.push(cursor);
    cursor = addDays(cursor, 1);
  }
  const chainSet = new Set(chain);
  const moving = inWeekActive.filter((o) => chainSet.has(o.scheduledDate));
  const overflow = moving.filter((o) => addDays(o.scheduledDate, 1) > weekEnd);
  const cascaded = Math.max(0, moving.length - (byDate.get(date)?.length ?? 0));

  return { scope, date, moving, overflow, cascaded, locked: lockedInWeek.length };
}

/** 在下周找一个空位：优先同星期几，被占则从周一起找第一个空位。 */
function nextWeekSlot(
  weekStart: string,
  preferred: string,
  taken: Set<string>,
): string {
  const nextWeek = addDays(weekStart, 7);
  const sameWeekday = addDays(preferred, 7);
  if (!taken.has(sameWeekday)) return sameWeekday;
  for (let i = 0; i < 7; i += 1) {
    const d = addDays(nextWeek, i);
    if (!taken.has(d)) return d;
  }
  return sameWeekday;
}

/**
 * 应用后移。
 * 调用前应先用 previewShift 判断是否跨周，让用户选择策略。
 */
export function applyShift(options: {
  occurrences: PlannedOccurrence[];
  goals: WeekGoal[];
  weekStart: string;
  scope: ShiftScope;
  date: string;
  strategy: OverflowStrategy;
  recordedAt: string;
  idFactory: (prefix: string) => string;
  /** 关联会话：已完成/进行中的项不参与后移 */
  sessions?: Session[];
}): ShiftResult {
  const { weekStart, scope, date, strategy, recordedAt, idFactory } = options;
  const preview = previewShift(options.occurrences, weekStart, scope, date, options.sessions ?? []);
  if (preview.error) {
    return {
      occurrences: options.occurrences,
      goals: options.goals,
      moved: 0,
      dropped: 0,
      toNextWeek: 0,
      locked: preview.locked,
      error: preview.error,
    };
  }

  const movingIds = new Set(preview.moving.map((o) => o.id));
  const weekEnd = weekEndOf(weekStart);
  const nextWeek = addDays(weekStart, 7);

  // 下周已占用的日期，避免放进去又冲突
  const takenNext = new Set(
    active(options.occurrences)
      .filter((o) => o.weekStart === nextWeek)
      .map((o) => o.scheduledDate),
  );

  let dropped = 0;
  let toNextWeek = 0;

  const occurrences = options.occurrences.map((o) => {
    if (!movingIds.has(o.id)) return o;
    const shifted = addDays(o.scheduledDate, 1);
    if (shifted <= weekEnd) {
      return { ...o, scheduledDate: shifted };
    }
    if (strategy === 'drop') {
      dropped += 1;
      return {
        ...o,
        disposition: 'cancelled' as const,
        dispositionReason: '后移超出本周，减少一天',
        disposedAt: recordedAt,
      };
    }
    // 加入下周
    const slot = nextWeekSlot(weekStart, o.scheduledDate, takenNext);
    takenNext.add(slot);
    toNextWeek += 1;
    return { ...o, weekStart: nextWeek, scheduledDate: slot };
  });

  // 本周目标：可执行项变少时压缩最低目标，并留审计
  const beforeIds = active(options.occurrences)
    .filter((o) => o.weekStart === weekStart)
    .map((o) => o.id);
  const goals = options.goals.map((g) => {
    if (g.weekStart !== weekStart) return g;
    const A = occurrences.filter((o) => o.weekStart === weekStart && o.disposition === 'scheduled').length;
    if (A >= g.minimumTarget) return g;
    const clamped = Math.max(0, A);
    return {
      ...g,
      minimumTarget: clamped,
      adjustments: [
        ...g.adjustments,
        {
          id: idFactory('adj'),
          beforeOccurrenceIds: beforeIds,
          afterOccurrenceIds: occurrences
            .filter((o) => o.weekStart === weekStart && o.disposition === 'scheduled')
            .map((o) => o.id),
          beforeMinimum: g.minimumTarget,
          afterMinimum: clamped,
          reason: strategy === 'drop' ? '计划调整：后移超出本周' : '计划调整：后移跨周',
          recordedAt,
        },
      ],
    };
  });

  // 下周目标：没有就建，有就把原始计划数加上搬过去的项
  if (toNextWeek > 0) {
    const existing = goals.find((g) => g.weekStart === nextWeek);
    if (existing) {
      const idx = goals.indexOf(existing);
      goals[idx] = { ...existing, originalPlannedCount: existing.originalPlannedCount + toNextWeek };
    } else {
      goals.push(initialWeekGoal(nextWeek, occurrences.filter((o) => o.weekStart === nextWeek)));
    }
  }

  return { occurrences, goals, moved: preview.moving.length, dropped, toNextWeek, locked: preview.locked };
}
