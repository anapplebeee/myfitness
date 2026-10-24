/** 判定与统计：纯函数，不依赖 DOM、存储与真实时钟。 */

import type { Session, SessionExercise, SetRecord } from './types';

export const EPSILON = 1e-9;

export function isWorkingSet(set: SetRecord): boolean {
  return set.kind === 'work' && set.status === 'completed';
}

export function completedWorkingSets(session: Session): number {
  let count = 0;
  for (const ex of session.exercises) {
    for (const set of ex.sets) if (isWorkingSet(set)) count += 1;
  }
  return count;
}

export function isEmptySession(session: Session): boolean {
  return session.exercises.every((ex) => ex.sets.every((s) => s.status !== 'completed'));
}

/** 有效完成：completed 且至少一个完成工作组；放弃/仅热身不算。 */
export function isValidCompleted(session: Session): boolean {
  return session.status === 'completed' && completedWorkingSets(session) > 0;
}

export function sessionVolumeGrams(session: Session): number {
  let total = 0;
  for (const ex of session.exercises) {
    for (const set of ex.sets) {
      if (!isWorkingSet(set) || set.loadGrams === null || set.reps === null) continue;
      total += set.loadGrams * set.reps;
    }
  }
  return total;
}

export function totalReps(session: Session): number {
  let total = 0;
  for (const ex of session.exercises) {
    for (const set of ex.sets) {
      if (isWorkingSet(set) && set.reps !== null) total += set.reps;
    }
  }
  return total;
}

export function plannedSetCount(session: Session): number {
  return session.exercises.reduce((sum, ex) => sum + ex.targetSets, 0);
}

export function completedSetCount(session: Session): number {
  return session.exercises.reduce(
    (sum, ex) => sum + ex.sets.filter((s) => s.status === 'completed').length,
    0,
  );
}

/** 训练次数、训练天数、周目标完成数：三者口径不同，不合并。 */
export function trainingCount(sessions: Session[]): number {
  return sessions.filter(isValidCompleted).length;
}

export function trainingDays(sessions: Session[]): number {
  const days = new Set<string>();
  for (const s of sessions) if (isValidCompleted(s)) days.add(s.businessDate);
  return days.size;
}

export function sessionsOn(sessions: Session[], date: string): Session[] {
  return sessions.filter((s) => s.businessDate === date);
}

export function activeSession(sessions: Session[]): Session | null {
  return sessions.find((s) => s.status === 'active' || s.status === 'paused') ?? null;
}

/** e1RM：Epley，仅适用于 1–10 次外部负荷工作组。 */
export function e1rm(loadGrams: number, reps: number): number | null {
  if (reps < 1 || reps > 10) return null;
  if (!Number.isFinite(loadGrams) || loadGrams <= 0) return null;
  return loadGrams * (1 + reps / 30);
}

export interface ExerciseBest {
  loadGrams: number;
  reps: number;
  date: string;
}

/** 某动作的历史最佳工作组，比较键为动作 ID + 负荷约定。 */
export function bestSet(sessions: Session[], exerciseId: string): ExerciseBest | null {
  let best: ExerciseBest | null = null;
  for (const session of sessions) {
    if (!isValidCompleted(session)) continue;
    for (const ex of session.exercises) {
      if (ex.exerciseId !== exerciseId) continue;
      for (const set of ex.sets) {
        if (!isWorkingSet(set) || set.loadGrams === null || set.reps === null) continue;
        if (!best || set.loadGrams > best.loadGrams) {
          best = { loadGrams: set.loadGrams, reps: set.reps, date: session.businessDate };
        }
      }
    }
  }
  return best;
}

/** 最近一次可比记录的该动作数据，用于训练现场预填。 */
export function lastExerciseSets(
  sessions: Session[],
  exerciseId: string,
  excludeSessionId: string | null,
): SetRecord[] {
  let latest: Session | null = null;
  for (const session of sessions) {
    if (session.id === excludeSessionId) continue;
    if (!isValidCompleted(session)) continue;
    if (!session.exercises.some((ex) => ex.exerciseId === exerciseId)) continue;
    if (!latest || session.startedAt > latest.startedAt) latest = session;
  }
  if (!latest) return [];
  const found = latest.exercises.find((ex) => ex.exerciseId === exerciseId);
  if (!found) return [];
  return found.sets.filter(isWorkingSet);
}

/**
 * 注意：周完成数只由 domain/week.ts 的 computeWeek 定义（被唯一满足的项目数）。
 * 这里曾有 weekCompletion 按会话计数，与 09 号口径冲突，已删除以免出现第二个数据源。
 */

export function streakWeeks(weekEnds: Array<{ start: string; achieved: boolean; hasGoal: boolean }>): number {
  let streak = 0;
  for (const week of weekEnds) {
    if (!week.hasGoal) continue;
    if (week.achieved) streak += 1;
    else streak = 0;
  }
  return streak;
}

export function estimatedRest(secondsLeft: number): boolean {
  return secondsLeft > 0;
}

export function createSet(
  id: string,
  kind: SetRecord['kind'],
  loadGrams: number | null,
  reps: number | null,
): SetRecord {
  return {
    id,
    kind,
    status: 'planned',
    loadGrams,
    reps,
    durationSeconds: null,
    distanceMeters: null,
    rpe: null,
    completedAt: null,
  };
}

export function createSessionExercise(
  id: string,
  exerciseId: string,
  order: number,
  targetSets: number,
  repMin: number,
  repMax: number,
  restSeconds: number,
  incrementGrams: number,
): SessionExercise {
  return {
    id,
    exerciseId,
    order,
    targetSets,
    repMin,
    repMax,
    restSeconds,
    incrementGrams,
    sets: [],
  };
}
