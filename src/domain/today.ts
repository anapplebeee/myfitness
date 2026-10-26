/**
 * 今日训练状态。
 *
 * 问题来源（用户反馈）：训练已经结束、或者今天这项已经顺延走了，
 * 今日页/训练页仍然摆着"开始训练"，用户不知道到底算不算完成；
 * 周目标里那一项也没有跟着变成完成。根因是"今天该练什么"分散在
 * 模板、发生项、会话三处各算一遍。
 *
 * 这里把三者合成唯一结论，页面只读这个结论，不再各算各的。
 */

import type { Session } from './types';
import { isValidCompletedSession, type PlannedOccurrence, type WeekResult } from './week';

export type TodayState =
  /** 有未结束的会话 */
  | 'live'
  /** 今天已经有有效训练 */
  | 'done'
  /** 今天有计划且还没做 */
  | 'planned'
  /** 今天的计划被顺延到本周其他天 */
  | 'moved'
  /** 今天没有安排 */
  | 'rest';

export interface TodayTraining {
  state: TodayState;
  /** 今天的计划项（顺延走的那项也会返回，便于说明"顺延到哪天"）。 */
  occurrence: PlannedOccurrence | null;
  /** state === 'moved' 时的目标日期。 */
  movedTo: string | null;
  /** 今天已完成/进行中的那场训练。 */
  session: Session | null;
  /** 今天还剩几项计划没做。 */
  openCount: number;
  /** 今天的计划项是否已被训练满足（计入周目标）。 */
  credited: boolean;
}

export interface TodayInput {
  today: string;
  occurrences: PlannedOccurrence[];
  sessions: Session[];
  /** 今天所在周的统计结果（来自 computeWeek）。 */
  result: WeekResult;
}

export function todayTraining(input: TodayInput): TodayTraining {
  const { today, result } = input;
  const daySessions = input.sessions.filter((s) => !s.deletedAt && s.businessDate === today);

  const live =
    daySessions.find((s) => s.status === 'active' || s.status === 'paused') ?? null;
  const done =
    [...daySessions]
      .filter(isValidCompletedSession)
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0] ?? null;

  const occToday = input.occurrences.filter(
    (o) =>
      o.weekStart === result.weekStart &&
      o.disposition === 'scheduled' &&
      o.scheduledDate === today,
  );
  const satisfied = new Set(result.satisfiedOccurrenceIds);
  const open = occToday.filter((o) => !satisfied.has(o.id));
  const credited = occToday.some((o) => satisfied.has(o.id));

  const moved =
    input.occurrences.find(
      (o) =>
        o.weekStart === result.weekStart &&
        o.disposition === 'scheduled' &&
        o.originalDate === today &&
        o.scheduledDate !== today,
    ) ?? null;

  const base = { occurrence: occToday[0] ?? moved, movedTo: null, openCount: open.length, credited };

  if (live) return { ...base, state: 'live', session: live };
  if (done) return { ...base, state: 'done', session: done };
  if (open.length) return { ...base, state: 'planned', session: null, occurrence: open[0]! };
  if (moved) {
    return { ...base, state: 'moved', session: null, occurrence: moved, movedTo: moved.scheduledDate };
  }
  return { ...base, state: 'rest', session: null, occurrence: null };
}

/** 状态文案，供今日页与训练页共用，避免两处措辞不一致。 */
export function todayStateLabel(state: TodayState): string {
  switch (state) {
    case 'live':
      return '训练进行中';
    case 'done':
      return '今天已完成';
    case 'planned':
      return '待训练';
    case 'moved':
      return '已顺延';
    default:
      return '休息日';
  }
}
