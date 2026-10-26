/**
 * 周报。
 *
 * 为什么需要：训练 App 的留存靠"看得见的进步"，而单次记录给不了这个。
 * 用户每天记一笔，一个月后回头看，需要有人把"你比上个月强了多少"算给他看。
 *
 * 纯函数：只做投影，不碰 DOM、不读时钟（today 由调用方传入）。
 */

import type { AppState } from './types';
import { addDays, businessDate } from './units';
import { computeWeek, weekRange } from './week';
import { completedWorkingSets, isValidCompleted, sessionVolumeGrams } from './metrics';
import { EXERCISE_BY_ID } from '../content/exercises';

export interface WeeklyReport {
  weekStart: string;
  /** 周起止日期，用于标题 */
  from: string;
  to: string;
  /** 本周完成场次 */
  sessions: number;
  /** 上周完成场次，用于对比 */
  prevSessions: number;
  /** 本周总容量（克） */
  volumeGrams: number;
  prevVolumeGrams: number;
  /** 完成的工作组数 */
  sets: number;
  prevSets: number;
  /** 训练天数（同一天练两次算一天） */
  days: number;
  /**
   * 周目标完成率 0..1。
   * 没有设定周目标时为 null——不要显示成 0%，那会让人误以为没完成。
   */
  goalRate: number | null;
  /** 本周最重的一组 */
  bestLift: { exerciseId: string; loadGrams: number; reps: number } | null;
  /** 本周刷新个人最好成绩的动作数 */
  prCount: number;
  /**
   * 这一周是否还没结束。
   *
   * 进行中的周不显示环比：周中拿"暂时 0 次"去比上周，
   * 会得出红色的 -100%，用户一天没练就像被判了退步。
   * 环比只在一周结束后才有意义。
   */
  inProgress: boolean;
}

/**
 * 取某一周的已完成场次（按业务日期过滤，已排除删除与未完成）。
 *
 * through 用于"进行中的周"：只统计到今天为止，
 * 否则拿半周去比上一整周，会得出 -100% 这种误导性的结论。
 */
/** 两个业务日期相差几天（后者减前者）。统一用中午做基准，避开夏令时。 */
function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`).getTime();
  const b = new Date(`${to}T12:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function sessionsInWeek(state: AppState, weekStart: string, through?: string): AppState['sessions'] {
  const { from, to } = weekRange(weekStart);
  const upper = through && through < to ? addDays(through, 1) : to;
  return state.sessions.filter(
    (s) => isValidCompleted(s) && s.businessDate >= from && s.businessDate < upper,
  );
}

function volumeOf(sessions: AppState['sessions']): number {
  return sessions.reduce((sum, s) => sum + sessionVolumeGrams(s), 0);
}

function setsOf(sessions: AppState['sessions']): number {
  return sessions.reduce((sum, s) => sum + completedWorkingSets(s), 0);
}

function daysOf(sessions: AppState['sessions']): number {
  return new Set(sessions.map((s) => s.businessDate)).size;
}

/** 某场次里每个动作的最好一组（只比重量，自重不算 PR）。 */
function bestByExercise(sessions: AppState['sessions']): Map<string, { loadGrams: number; reps: number }> {
  const out = new Map<string, { loadGrams: number; reps: number }>();
  for (const s of sessions) {
    for (const ex of s.exercises) {
      for (const set of ex.sets) {
        if (set.kind !== 'work' || set.status !== 'completed') continue;
        if (set.loadGrams === null || set.reps === null || set.loadGrams <= 0) continue;
        const cur = out.get(ex.exerciseId);
        if (!cur || set.loadGrams > cur.loadGrams) {
          out.set(ex.exerciseId, { loadGrams: set.loadGrams, reps: set.reps });
        }
      }
    }
  }
  return out;
}

/**
 * 构造周报。
 *
 * @param state 应用状态
 * @param weekStart 周一日期（YYYY-MM-DD）
 */
export function buildWeeklyReport(state: AppState, weekStart: string, now: Date = new Date()): WeeklyReport {
  const prevStart = addDays(weekStart, -7);
  const { to: weekEndExclusive } = weekRange(weekStart);
  const todayStr = businessDate(now);
  /*
   * 本周是否还在进行中。
   *
   * 进行中时，与上周的对比必须限定在"同样的天数"：
   * 周二拿 0 场去比上周整周 4 场，会显示 -100%，
   * 用户一天没练就被判"退步"，这既不公平也不真实。
   */
  const inProgress = todayStr >= weekRange(weekStart).from && todayStr < weekEndExclusive;
  const through = inProgress ? todayStr : undefined;
  const prevThrough = inProgress
    ? addDays(prevStart, Math.max(0, daysBetween(weekRange(weekStart).from, todayStr)))
    : undefined;

  const cur = sessionsInWeek(state, weekStart, through);
  const prev = sessionsInWeek(state, prevStart, prevThrough);

  /*
   * 周目标完成率走 computeWeek 的规范口径（09 号文档的 N/A/K 模型），
   * 不在这里自己数一遍——那会形成第二个数据源，
   * 一旦两处口径分叉，周报和周目标页会显示不同的完成数。
   */
  const goal = state.weekGoals.find((g) => g.weekStart === weekStart) ?? null;
  const week = computeWeek({
    weekStart,
    goal,
    occurrences: state.occurrences,
    sessions: state.sessions,
    now,
  });

  let goalRate: number | null = null;
  if (week.minimumTarget > 0) {
    goalRate = Math.max(0, Math.min(1, week.completedOccurrences / week.minimumTarget));
  }

  // 本周最重的一组
  let bestLift: WeeklyReport['bestLift'] = null;
  for (const [exerciseId, b] of bestByExercise(cur)) {
    if (!bestLift || b.loadGrams > bestLift.loadGrams) {
      bestLift = { exerciseId, loadGrams: b.loadGrams, reps: b.reps };
    }
  }

  // 刷新纪录的动作数：本周最好 > 历史最好（本周之前）
  const beforeThisWeek = state.sessions.filter(
    (s) => isValidCompleted(s) && s.businessDate < weekRange(weekStart).from,
  );
  const historyBest = bestByExercise(beforeThisWeek);
  let prCount = 0;
  for (const [exerciseId, b] of bestByExercise(cur)) {
    const prevBest = historyBest.get(exerciseId);
    if (!prevBest || b.loadGrams > prevBest.loadGrams) prCount += 1;
  }

  return {
    weekStart,
    from: weekRange(weekStart).from,
    to: addDays(weekRange(weekStart).to, -1),
    sessions: cur.length,
    prevSessions: prev.length,
    volumeGrams: volumeOf(cur),
    prevVolumeGrams: volumeOf(prev),
    sets: setsOf(cur),
    prevSets: setsOf(prev),
    days: daysOf(cur),
    goalRate,
    bestLift,
    prCount,
    inProgress,
  };
}

/** 动作名，供 UI 显示。查不到时回退 id，不显示空白。 */
export function bestLiftName(report: WeeklyReport): string | null {
  if (!report.bestLift) return null;
  return EXERCISE_BY_ID.get(report.bestLift.exerciseId)?.name ?? report.bestLift.exerciseId;
}

export type Trend = 'up' | 'down' | 'flat';

/** 变化趋势。上周为 0 时不表态（避免"+100%"这种吓人的假涨幅）。 */
export function trendOf(current: number, previous: number): Trend {
  if (previous <= 0) return 'flat';
  if (current > previous) return 'up';
  if (current < previous) return 'down';
  return 'flat';
}

/** 环比百分比，四舍五入到整数；上周为 0 时返回 null。 */
export function changePct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}



