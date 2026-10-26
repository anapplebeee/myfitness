/**
 * 训练事实的更正、补录与删除：按 09:50-56 与 11 号。
 *
 * 关键约束：
 * - 任何过去日期允许补录，不限制 7 天；不能完成未来训练。
 * - 删除用 tombstone，不能只改统计；恢复需显式操作。
 * - 日期变更若移出原关联周，必须同时解除关联，提示重新匹配。
 * - 更正后重算受影响旧周/新周及之后连续周（由纯函数派生，无需缓存失效）。
 */

import type { Session, SessionExercise, SetRecord } from './types';
import { addDays, businessDate } from './units';

export interface ValidationIssue {
  message: string;
}

export function isFutureDate(date: string, today = businessDate()): boolean {
  return date > today;
}

export interface BackfillInput {
  date: string;
  title: string;
  exerciseIds: string[];
  selfReported: boolean;
}

export interface BackfillResult {
  session?: Session;
  issue?: string;
}

/**
 * 补录一场训练。
 * - selfReported=true 时不要求组记录，completionBasis=自报。
 * - 否则生成逐组空壳供后续填写。
 */
export function buildBackfill(
  input: BackfillInput,
  today: string,
  idFactory: (prefix: string) => string,
  now = new Date(),
): BackfillResult {
  if (!input.date) return { issue: '请选择日期' };
  if (isFutureDate(input.date, today)) return { issue: '不能补录未来的训练' };
  if (!input.title.trim()) return { issue: '请填写训练名称' };
  if (!input.selfReported && input.exerciseIds.length === 0) {
    return { issue: '至少选择一个动作，或改为"仅确认练过"' };
  }

  const startedAt = new Date(`${input.date}T19:00:00`);
  const exercises: SessionExercise[] = input.exerciseIds.map((exerciseId, order) => ({
    id: idFactory('se'),
    exerciseId,
    order,
    targetSets: 3,
    repMin: 8,
    repMax: 12,
    restSeconds: 90,
    incrementGrams: 2500,
    sets: input.selfReported
      ? []
      : Array.from({ length: 3 }, () => ({
          id: idFactory('set'),
          kind: 'work' as const,
          status: 'planned' as const,
          loadGrams: null,
          reps: null,
          durationSeconds: null,
          distanceMeters: null,
          rpe: null,
          completedAt: null,
        })),
  }));

  return {
    session: {
      id: idFactory('s'),
      templateId: null,
      dayId: null,
      title: input.title.trim(),
      status: 'completed',
      startedAt: startedAt.toISOString(),
      endedAt: new Date(startedAt.getTime() + 60 * 60 * 1000).toISOString(),
      businessDate: input.date,
      restEndsAt: null,
      note: '',
      completionBasis: input.selfReported ? 'selfReported' : 'sets',
      backfilledAt: now.toISOString(),
      exercises,
    },
  };
}

export interface DateChangeResult {
  session?: Session;
  issue?: string;
  /** 日期移出原关联周时必须解除关联。 */
  clearedOccurrence: boolean;
  weekChanged: boolean;
}

/** 更正场次日期；跨周时解除关联，保留训练事实。 */
export function changeSessionDate(
  session: Session,
  nextDate: string,
  weekStartOf: (date: string) => string,
  today = businessDate(),
): DateChangeResult {
  if (!nextDate) return { issue: '请选择日期', clearedOccurrence: false, weekChanged: false };
  // 未结束/已放弃的场次改日期会让 activeSession 与周归属错乱，与 canDispose 同口径
  if (session.status === 'active' || session.status === 'paused') {
    return { issue: '这场训练还没结束，先结束或解除关联再改日期', clearedOccurrence: false, weekChanged: false };
  }
  if (session.status === 'discarded') {
    return { issue: '已放弃的训练不能改日期', clearedOccurrence: false, weekChanged: false };
  }
  if (isFutureDate(nextDate, today)) {
    return { issue: '不能把训练改到未来', clearedOccurrence: false, weekChanged: false };
  }
  const oldWeek = weekStartOf(session.businessDate);
  const newWeek = weekStartOf(nextDate);
  const weekChanged = oldWeek !== newWeek;
  const clearedOccurrence = weekChanged && Boolean(session.occurrenceId);

  // 必须取"本地时分"再拼新日期。直接截 ISO 字符串取到的是 UTC 时刻，
  // 当作本地时间解析会让实际时间点整体偏移（见 amend.test.ts）。
  const keepLocalTime = (iso: string): string => {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${nextDate}T${hh}:${mm}:${ss}`;
  };

  const next: Session = {
    ...session,
    businessDate: nextDate,
    startedAt: new Date(keepLocalTime(session.startedAt)).toISOString(),
    ...(session.endedAt ? { endedAt: new Date(keepLocalTime(session.endedAt)).toISOString() } : {}),
    ...(clearedOccurrence ? { occurrenceId: undefined, goalCreditConfirmed: false } : {}),
  };
  return { session: next, clearedOccurrence, weekChanged };
}

/** 删除用 tombstone：保留事实与审计，统计侧按 deleted 过滤。 */
export function tombstone(session: Session, at = new Date()): Session {
  return { ...session, deletedAt: at.toISOString() };
}

export function restoreTombstone(session: Session): Session {
  return { ...session, deletedAt: undefined };
}

export function isLive(session: Session): boolean {
  return !session.deletedAt;
}

/**
 * 过滤掉 tombstone，供所有统计与列表使用。
 *
 * 同时排除已放弃场次：放弃是显式的"这场不算"，
 * store.visibleSessions() 直接用它驱动可编辑列表，
 * 留着 discarded 会让用户编辑一场自己已放弃的训练。
 */
export function liveSessions(sessions: Session[]): Session[] {
  return sessions.filter((s) => isLive(s) && s.status !== 'discarded');
}

export interface SetEditIssue {
  message: string;
}

/**
 * 更正单组数据；已删除或已放弃场次不允许编辑。
 *
 * 校验口径必须覆盖全部可填字段：
 * 原来只查 loadGrams/reps，于是 durationSeconds: -5、distanceMeters: 2.5
 * 都能通过 updateSet，却在 tracking.validateSetForExercise 处判为无效，
 * 出现"两套合法标准"。同时 isWorkingSet 只看 kind+status，
 * 这些脏数据照样计入 completedWorkingSets 与周统计。
 */
export function updateSet(
  session: Session,
  exerciseId: string,
  setId: string,
  patch: Partial<SetRecord>,
): { session?: Session; issue?: string } {
  if (session.deletedAt) return { issue: '这场训练已删除，先恢复再编辑' };
  if (session.status === 'discarded') return { issue: '这场训练已放弃，不能编辑' };
  const ex = session.exercises.find((e) => e.exerciseId === exerciseId);
  if (!ex) return { issue: '找不到该动作' };
  const set = ex.sets.find((s) => s.id === setId);
  if (!set) return { issue: '找不到该组' };

  if (patch.loadGrams !== undefined && patch.loadGrams !== null) {
    if (!Number.isFinite(patch.loadGrams) || patch.loadGrams < 0) return { issue: '重量不合法' };
  }
  if (patch.reps !== undefined && patch.reps !== null) {
    if (!Number.isInteger(patch.reps) || patch.reps < 1 || patch.reps > 100) {
      return { issue: '次数需在 1–100 之间' };
    }
  }
  if (patch.durationSeconds !== undefined && patch.durationSeconds !== null) {
    if (!Number.isFinite(patch.durationSeconds) || patch.durationSeconds <= 0) {
      return { issue: '时长需大于 0' };
    }
  }
  if (patch.distanceMeters !== undefined && patch.distanceMeters !== null) {
    if (!Number.isFinite(patch.distanceMeters) || patch.distanceMeters <= 0) {
      return { issue: '距离需大于 0' };
    }
  }
  // 不允许把已完成组改回未完成状态而保留旧的 completedAt
  if (patch.status === 'planned' && set.status === 'completed') {
    return { issue: '已完成的组不能改回未完成' };
  }

  const next: Session = {
    ...session,
    exercises: session.exercises.map((e) =>
      e.id !== ex.id
        ? e
        : {
            ...e,
            sets: e.sets.map((s) =>
              s.id !== set.id
                ? s
                : {
                    ...s,
                    ...patch,
                    status: patch.status ?? s.status,
                    editedAt: new Date().toISOString(),
                  },
            ),
          },
    ),
  };
  return { session: next };
}

/**
 * 把某一组标记为跳过（结束前处理未录组的显式操作）。
 *
 * 与 updateSet 一致：已删除/已放弃场次不可改，且写入 editedAt 留痕
 * ——批量跳过同样是事实变更，不能无声无息。
 */
export function skipRemainingSets(session: Session): Session {
  if (session.deletedAt) return session;
  if (session.status === 'discarded') return session;
  const now = new Date().toISOString();
  return {
    ...session,
    exercises: session.exercises.map((e) => ({
      ...e,
      sets: e.sets.map((s) => (s.status === 'planned' ? { ...s, status: 'skipped' as const, editedAt: now } : s)),
    })),
  };
}

/** 未录的计划组数量，用于结束前提示。 */
export function pendingSetCount(session: Session): number {
  return session.exercises.reduce(
    (sum, e) => sum + e.sets.filter((s) => s.status === 'planned').length,
    0,
  );
}

/** 补录不计算容量或 PR（09:50）。 */
export function contributesToVolume(session: Session): boolean {
  if (session.completionBasis === 'selfReported' || session.completionBasis === 'legacyReported') {
    return false;
  }
  return true;
}

export interface TrendPoint {
  date: string;
  value: number;
}

/** 某动作的重量趋势（取每次训练的最大工作组）。 */
export function loadTrend(sessions: Session[], exerciseId: string): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (const s of liveSessions(sessions)) {
    // 只认已完成场次；businessDate 缺失的脏数据直接跳过，
    // 不能用 `businessDate && ...` 短路——那会让空日期的未完成场次混进趋势
    if (s.status !== 'completed' || !s.businessDate) continue;
    const ex = s.exercises.find((e) => e.exerciseId === exerciseId);
    if (!ex) continue;
    const top = ex.sets
      .filter((x) => x.kind === 'work' && x.status === 'completed' && x.loadGrams)
      .reduce((max, x) => Math.max(max, x.loadGrams ?? 0), 0);
    if (top > 0) points.push({ date: s.businessDate, value: top / 1000 });
  }
  return points.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export interface ProgressionSuggestion {
  exerciseId: string;
  action: 'increase' | 'hold' | 'deload';
  text: string;
}

/**
 * 渐进建议：全部工作组达到上限次数则加最小配重；
 * 连续两次未达下限则减 10% 重量。
 */
export function suggestProgression(
  sessions: Session[],
  exerciseId: string,
  repMin: number,
  repMax: number,
  incrementGrams: number,
  unit: 'kg' | 'lb' = 'kg',
): ProgressionSuggestion | null {
  const ordered = liveSessions(sessions)
    .filter((s) => s.status === 'completed')
    .filter((s) => s.exercises.some((e) => e.exerciseId === exerciseId))
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));

  if (!ordered.length) return null;

  const extract = (s: Session) => {
    const ex = s.exercises.find((e) => e.exerciseId === exerciseId);
    if (!ex) return null;
    const work = ex.sets.filter((x) => x.kind === 'work' && x.status === 'completed');
    if (!work.length) return null;
    const top = work.reduce((max, x) => Math.max(max, x.loadGrams ?? 0), 0);
    const allAtMax = work.every((x) => (x.reps ?? 0) >= repMax);
    const anyBelowMin = work.some((x) => (x.reps ?? 0) < repMin);
    return { top, allAtMax, anyBelowMin, count: work.length };
  };

  const last = extract(ordered[0]!);
  if (!last) return null;
  const prev = ordered[1] ? extract(ordered[1]!) : null;

  const fmt = (grams: number) => {
    const v = unit === 'kg' ? grams / 1000 : (grams / 1000) * 2.2046226218;
    return `${Math.round(v * 10) / 10} ${unit}`;
  };

  if (last.allAtMax && last.top > 0) {
    const next = last.top + incrementGrams;
    return {
      exerciseId,
      action: 'increase',
      text: `所有工作组都达到 ${repMax} 次，下次可加到 ${fmt(next)}`,
    };
  }
  if (last.anyBelowMin && prev?.anyBelowMin && last.top > 0) {
    // 按该动作自己的最小配重取整，不能写死 2500——
    // 配重 5000 的动作会被 round 到 2500 的倍数，建议值比实际可用重量低一档
    const step = incrementGrams > 0 ? incrementGrams : 2500;
    const next = Math.round((last.top * 0.9) / step) * step;
    return {
      exerciseId,
      action: 'deload',
      text: `连续两次低于 ${repMin} 次，建议降到 ${fmt(next)} 重新累积`,
    };
  }
  if (last.anyBelowMin) {
    return { exerciseId, action: 'hold', text: `有组低于 ${repMin} 次，这次先保持 ${fmt(last.top)}` };
  }
  return {
    exerciseId,
    action: 'hold',
    text: `${last.count} 组完成，保持在 ${fmt(last.top)}，先把次数做满 ${repMax}`,
  };
}

/** 最近 N 天是否有训练，用于空状态提示。 */
export function hasTrainingWithin(sessions: Session[], days: number, today = businessDate()): boolean {
  const from = addDays(today, -days);
  return liveSessions(sessions).some(
    (s) => s.status === 'completed' && s.businessDate >= from && s.businessDate <= today,
  );
}
