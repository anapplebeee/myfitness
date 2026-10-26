/**
 * 月度日历：把"只有周日历、看不到整月训练"补上。
 *
 * 周口径沿用 09 号模型（computeWeek + dayState），这里只负责
 * 把若干周拼成一张月表，保证同一个日期在周视图和月视图里
 * 得到的状态完全一致——否则用户会看到两个互相矛盾的事实。
 */

import type { Session } from './types';
import { addDays, parseBusinessDate, weekStartOf } from './units';
import {
  computeWeek,
  dayState,
  isValidCompletedSession,
  type DayCell,
  type PlannedOccurrence,
  type WeekGoal,
  type WeekResult,
} from './week';

export interface MonthCell extends DayCell {
  /** 属于当前月；相邻月的补位格会淡化。 */
  inMonth: boolean;
  /** 该日期所属周的周一，点击后可直接跳到周视图。 */
  weekStart: string;
}

export interface MonthRange {
  /** YYYY-MM */
  month: string;
  /** 当月 1 日 */
  first: string;
  /** 网格第一天（周一） */
  from: string;
  /** 网格最后一天（周日） */
  to: string;
  rows: number;
  days: number;
}

export function monthRange(anchor: string): MonthRange {
  const month = anchor.slice(0, 7);
  const first = `${month}-01`;
  const from = weekStartOf(first);
  const d = parseBusinessDate(first);
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const offset = Math.round(
    (parseBusinessDate(first).getTime() - parseBusinessDate(from).getTime()) / 86_400_000,
  );
  const rows = Math.ceil((offset + days) / 7);
  return { month, first, from, to: addDays(from, rows * 7 - 1), rows, days };
}

export interface MonthCellsInput {
  /** 该月任意一天 */
  anchor: string;
  occurrences: PlannedOccurrence[];
  sessions: Session[];
  goalForWeek: (weekStart: string) => WeekGoal | null;
  today: string;
  now?: Date;
}

export function monthCells(input: MonthCellsInput): MonthCell[] {
  const range = monthRange(input.anchor);
  const now = input.now ?? new Date();
  const results = new Map<string, WeekResult>();
  const cells: MonthCell[] = [];

  for (let i = 0; i < range.rows * 7; i += 1) {
    const date = addDays(range.from, i);
    const weekStart = weekStartOf(date);
    let result = results.get(weekStart);
    if (!result) {
      result = computeWeek({
        weekStart,
        goal: input.goalForWeek(weekStart),
        occurrences: input.occurrences,
        sessions: input.sessions,
        now,
      });
      results.set(weekStart, result);
    }
    cells.push({
      ...dayState(date, input.occurrences, input.sessions, result, input.today),
      inMonth: date.slice(0, 7) === range.month,
      weekStart,
    });
  }
  return cells;
}

export interface MonthSummary {
  /** 有有效训练的天数 */
  trainedDays: number;
  /** 有效训练场次 */
  sessionCount: number;
  /** 当月计划项（不含豁免/取消） */
  plannedCount: number;
  /** 已完成的天数 */
  doneDays: number;
  /** 有漏项的天数 */
  missedDays: number;
}

export function monthSummary(input: {
  month: string;
  cells: MonthCell[];
  sessions: Session[];
  occurrences: PlannedOccurrence[];
}): MonthSummary {
  const valid = input.sessions.filter(
    (s) =>
      !s.deletedAt &&
      s.businessDate.slice(0, 7) === input.month &&
      isValidCompletedSession(s),
  );
  const trainedDays = new Set(valid.map((s) => s.businessDate));
  const planned = input.occurrences.filter(
    (o) => o.disposition === 'scheduled' && o.scheduledDate.slice(0, 7) === input.month,
  );
  const inMonth = input.cells.filter((c) => c.inMonth);

  return {
    trainedDays: trainedDays.size,
    sessionCount: valid.length,
    plannedCount: planned.length,
    doneDays: inMonth.filter((c) => c.primary === 'done').length,
    missedDays: inMonth.filter((c) => c.primary === 'missed' || c.primary === 'partial').length,
  };
}

/** 月份标题：2026年10月。 */
export function monthLabel(month: string): string {
  return `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;
}

/** 按月前后移动，返回该月 1 日。 */
export function shiftMonth(month: string, delta: number): string {
  const d = new Date(`${month}-01T12:00:00`);
  d.setMonth(d.getMonth() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
