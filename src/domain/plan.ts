/**
 * 周计划生成与命令：按 09/11 号规范。
 *
 * - 日程按已确认周安排产生唯一发生项，planVersionId + weekStart + slotId 去重（11:51）。
 * - 预建未来 4 周；不足时补建，命令幂等。
 * - 计划换版只影响生效日后未开始项目，记一次调整；历史保持。
 * - 历史空白不自动补造成未完成。
 */

import type { Template } from '../content/types';
import {
  canDispose,
  canSetMinimumTarget,
  initialWeekGoal,
  inWeek,
  type Disposition,
  type PlannedOccurrence,
  type WeekGoal,
} from './week';
import { addDays, businessDate } from './units';
import type { Session } from './types';

/** 预建周数：当周 + 未来 3 周。 */
export const PREDEFINED_WEEKS = 4;

export function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  const offset = (d.getDay() + 6) % 7;
  return addDays(date, -offset);
}

export interface BuildOptions {
  template: Template;
  fromWeekStart: string;
  weeks: number;
  today: string;
  idFactory: (prefix: string) => string;
}

/** 按模板生成若干周的发生项；同一 slot 每周唯一。 */
export function buildOccurrences(options: BuildOptions): PlannedOccurrence[] {
  const { template, fromWeekStart, weeks, today, idFactory } = options;
  const out: PlannedOccurrence[] = [];
  for (let w = 0; w < weeks; w += 1) {
    const weekStart = addDays(fromWeekStart, w * 7);
    for (const day of template.days) {
      const date = addDays(weekStart, day.slot);
      // 计划生效周只包含生效日及以后的安排
      if (date < today) continue;
      out.push({
        id: idFactory('occ'),
        planVersionId: `${template.id}@v${template.version}`,
        weekStart,
        originalDate: date,
        scheduledDate: date,
        slotId: `${template.id}-${day.id}`,
        title: day.title,
        exerciseIds: day.exercises.map((e) => e.exerciseId),
        disposition: 'scheduled',
      });
    }
  }
  return out;
}

/** 幂等补齐：已存在的 (planVersionId, weekStart, slotId) 不重复创建。 */
export function ensureOccurrences(
  existing: PlannedOccurrence[],
  options: BuildOptions,
): PlannedOccurrence[] {
  const keys = new Set(existing.map((o) => `${o.planVersionId}|${o.weekStart}|${o.slotId}`));
  const generated = buildOccurrences(options);
  const fresh = generated.filter(
    (o) => !keys.has(`${o.planVersionId}|${o.weekStart}|${o.slotId}`),
  );
  return [...existing, ...fresh];
}

/** 为每个有项目的周确保存在唯一 WeekGoal。 */
export function ensureWeekGoals(
  existing: WeekGoal[],
  occurrences: PlannedOccurrence[],
): WeekGoal[] {
  const byWeek = new Map<string, PlannedOccurrence[]>();
  for (const o of occurrences) {
    const list = byWeek.get(o.weekStart) ?? [];
    list.push(o);
    byWeek.set(o.weekStart, list);
  }
  const known = new Map(existing.map((g) => [g.weekStart, g]));
  const out = [...existing];
  for (const [weekStart, list] of byWeek) {
    if (known.has(weekStart)) continue;
    out.push(initialWeekGoal(weekStart, list));
  }
  return out.sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
}

export interface PlanChangeResult {
  occurrences: PlannedOccurrence[];
  goals: WeekGoal[];
  affectedWeeks: string[];
}

function hasStartedSession(o: PlannedOccurrence, sessions: Session[]): boolean {
  return sessions.some(
    (s) => s.occurrenceId === o.id && (s.status === 'active' || s.status === 'paused' || s.status === 'completed'),
  );
}

/**
 * 换模板：只改生效日及以后、且未开始的项目（09:25）。
 * 已开始/完成项目与历史会话不动；原 N 不变，A 按新集合重算，记一次调整。
 */
export function switchTemplate(options: {
  occurrences: PlannedOccurrence[];
  goals: WeekGoal[];
  next: Template;
  effectiveFrom: string;
  sessions: Session[];
  idFactory: (prefix: string) => string;
  recordedAt: string;
}): PlanChangeResult {
  const { occurrences, goals, next, effectiveFrom, sessions, idFactory, recordedAt } = options;
  const actionable = (o: PlannedOccurrence): boolean =>
    o.disposition === 'scheduled' && o.scheduledDate >= effectiveFrom && !hasStartedSession(o, sessions);

  const kept = occurrences.map((o) => {
    if (!actionable(o)) return o;
    return {
      ...o,
      disposition: 'cancelled' as Disposition,
      dispositionReason: '换模板',
      disposedAt: recordedAt,
    };
  });

  const targetWeekStart = mondayOf(effectiveFrom);
  const merged = ensureOccurrences(kept, {
    template: next,
    fromWeekStart: targetWeekStart,
    weeks: PREDEFINED_WEEKS,
    today: effectiveFrom,
    idFactory,
  });

  const affectedWeeks = [...new Set([...kept, ...merged].map((o) => o.weekStart))].sort();
  let nextGoals = ensureWeekGoals(goals, merged);

  for (const weekStart of affectedWeeks) {
    const idx = nextGoals.findIndex((g) => g.weekStart === weekStart);
    if (idx < 0) continue;
    const goal = nextGoals[idx]!;
    const weekOcc = merged.filter((o) => o.weekStart === weekStart);
    const before = occurrences.filter((o) => o.weekStart === weekStart);
    const A = weekOcc.filter((o) => o.disposition === 'scheduled').length;
    const target = Math.min(goal.minimumTarget, A);
    const updated: WeekGoal = {
      ...goal,
      minimumTarget: target,
      adjustments: [
        ...goal.adjustments,
        {
          id: idFactory('adj'),
          beforeOccurrenceIds: before.filter((o) => o.disposition === 'scheduled').map((o) => o.id),
          afterOccurrenceIds: weekOcc.filter((o) => o.disposition === 'scheduled').map((o) => o.id),
          beforeMinimum: goal.minimumTarget,
          afterMinimum: target,
          reason: '换模板',
          recordedAt,
        },
      ],
    };
    nextGoals = nextGoals.map((g, i) => (i === idx ? updated : g));
  }

  return { occurrences: merged, goals: nextGoals, affectedWeeks };
}

export type OccurrenceCommand =
  | { kind: 'excuse'; id: string; reason: string }
  | { kind: 'cancel'; id: string; reason: string }
  | { kind: 'restore'; id: string }
  | { kind: 'postpone'; id: string; date: string };

export interface CommandResult {
  occurrences: PlannedOccurrence[];
  goals: WeekGoal[];
  error?: string;
}

/**
 * 执行单条计划命令。
 * - 有 active/paused 关联会话时禁止改动。
 * - 顺延限同周，保留 originalDate。
 * - 豁免/取消从 A 排除，K 随之重算。
 */
export function runOccurrenceCommand(options: {
  command: OccurrenceCommand;
  occurrences: PlannedOccurrence[];
  goals: WeekGoal[];
  sessions: Session[];
  recordedAt: string;
  idFactory: (prefix: string) => string;
}): CommandResult {
  const { command, occurrences, goals, sessions, recordedAt } = options;
  const target = occurrences.find((o) => o.id === command.id);
  if (!target) return { occurrences, goals, error: '找不到这项安排' };

  const allowed = canDispose(target, sessions);
  if (!allowed.ok) return { occurrences, goals, error: allowed.reason };

  let updated: PlannedOccurrence;
  switch (command.kind) {
    case 'excuse':
      updated = {
        ...target,
        disposition: 'excused',
        dispositionReason: command.reason,
        disposedAt: recordedAt,
      };
      break;
    case 'cancel':
      updated = {
        ...target,
        disposition: 'cancelled',
        dispositionReason: command.reason,
        disposedAt: recordedAt,
      };
      break;
    case 'restore':
      updated = {
        ...target,
        disposition: 'scheduled',
        dispositionReason: undefined,
        disposedAt: recordedAt,
      };
      break;
    case 'postpone': {
      if (!inWeek(command.date, target.weekStart)) {
        return { occurrences, goals, error: '只能顺延到同一周内；跨周请用豁免或保留未完成' };
      }
      updated = { ...target, scheduledDate: command.date };
      break;
    }
    default:
      return { occurrences, goals, error: '未知操作' };
  }

  const nextOcc = occurrences.map((o) => (o.id === target.id ? updated : o));

  const nextGoals = goals.map((g) => {
    if (g.weekStart !== target.weekStart) return g;
    const A = nextOcc.filter((o) => o.weekStart === g.weekStart && o.disposition === 'scheduled').length;

    /*
     * 重算存储的 minimumTarget。
     *
     * 要区分两种"K 小于 N"的原因，处理方式不同：
     *
     *  a) 用户主动调低（经 changeMinimumTarget，最近一次调整的 reason 不是"计划调整"）
     *     —— 这是用户的明确意愿，恢复项目不应把它推回去。
     *
     *  b) 系统因 A 变小而压缩（豁免/取消触发，reason 以"计划调整"开头）
     *     —— 这只是可执行项变少后的临时收缩，恢复后应当回升。
     *
     * 原实现一律用 Math.min，只能降不能升：用户豁免一次后目标永久卡在低值，
     * 违反 09 号规范 L50"恢复 → A/K 重算"。
     */
    const lastAdj = g.adjustments[g.adjustments.length - 1];
    const loweredBySystem = lastAdj ? /^计划调整/.test(lastAdj.reason) : false;
    const ceiling = Math.min(g.originalPlannedCount, A);
    const target2 = loweredBySystem ? Math.max(g.minimumTarget, ceiling) : g.minimumTarget;
    const clamped = Math.min(target2, A);

    if (clamped === g.minimumTarget) return g;
    return {
      ...g,
      minimumTarget: clamped,
      adjustments: [
        ...g.adjustments,
        {
          id: options.idFactory('adj'),
          beforeOccurrenceIds: occurrences
            .filter((o) => o.weekStart === g.weekStart && o.disposition === 'scheduled')
            .map((o) => o.id),
          afterOccurrenceIds: nextOcc
            .filter((o) => o.weekStart === g.weekStart && o.disposition === 'scheduled')
            .map((o) => o.id),
          beforeMinimum: g.minimumTarget,
          afterMinimum: clamped,
          reason: `计划调整：${command.kind}`,
          recordedAt,
        },
      ],
    };
  });

  return { occurrences: nextOcc, goals: nextGoals };
}

export interface TargetChangeResult {
  goals: WeekGoal[];
  error?: string;
}

/** 用户主动调整最低目标，必须记原因。 */
export function changeMinimumTarget(options: {
  goals: WeekGoal[];
  occurrences: PlannedOccurrence[];
  weekStart: string;
  next: number;
  reason: string;
  recordedAt: string;
  idFactory: (prefix: string) => string;
}): TargetChangeResult {
  const { goals, occurrences, weekStart, next, reason, recordedAt, idFactory } = options;
  const idx = goals.findIndex((g) => g.weekStart === weekStart);
  if (idx < 0) return { goals, error: '这一周还没有目标' };
  const goal = goals[idx]!;
  const check = canSetMinimumTarget(goal, occurrences, next);
  if (!check.ok) return { goals, error: check.reason };

  const weekOcc = occurrences.filter((o) => o.weekStart === weekStart);
  const updated: WeekGoal = {
    ...goal,
    minimumTarget: next,
    adjustments: [
      ...goal.adjustments,
      {
        id: idFactory('adj'),
        beforeOccurrenceIds: weekOcc.filter((o) => o.disposition === 'scheduled').map((o) => o.id),
        afterOccurrenceIds: weekOcc.filter((o) => o.disposition === 'scheduled').map((o) => o.id),
        beforeMinimum: goal.minimumTarget,
        afterMinimum: next,
        reason,
        recordedAt,
      },
    ],
  };
  return { goals: goals.map((g, i) => (i === idx ? updated : g)) };
}

/** 找到某周仍未满足的项目，用于训练结束时手动匹配。 */
export function openOccurrencesForWeek(
  occurrences: PlannedOccurrence[],
  weekStart: string,
  satisfiedIds: string[],
): PlannedOccurrence[] {
  const done = new Set(satisfiedIds);
  return occurrences.filter(
    (o) => o.weekStart === weekStart && o.disposition === 'scheduled' && !done.has(o.id),
  );
}

export function todayString(now: Date = new Date()): string {
  return businessDate(now);
}
