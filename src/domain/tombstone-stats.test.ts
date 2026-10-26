/**
 * CRITICAL 验证：tombstone（deletedAt）会话是否仍计入统计。
 *
 * 三个独立审查都指向同一处：
 * - amend.ts:140 "删除用 tombstone…统计侧按 deleted 过滤"
 * - types.ts:88  "统计与列表按此过滤"
 * - SessionDetailView.vue:142 "这场训练已删除，不计入任何统计"
 *
 * 这里用测试实证：若这些断言失败，说明删除的会话仍在影响周统计与日历。
 */

import { describe, expect, it } from 'vitest';
import { computeWeek, dayState, canDispose, isValidCompletedSession, type PlannedOccurrence, type WeekGoal } from './week';
import { bestSet, isValidCompleted, trainingCount, trainingDays } from './metrics';
import { tombstone } from './amend';
import type { Session, SetRecord } from './types';

const WEEK = '2026-10-19';
const NOW_AFTER = new Date('2026-10-26T00:10:00');

function occ(id: string, day: number, disposition: PlannedOccurrence['disposition'] = 'scheduled'): PlannedOccurrence {
  const date = `2026-10-${String(19 + day).padStart(2, '0')}`;
  return {
    id, planVersionId: 'v1', weekStart: WEEK, originalDate: date, scheduledDate: date,
    slotId: `slot-${day}`, title: '训练', exerciseIds: ['bb-squat'], disposition,
  };
}

function workSet(id: string): SetRecord {
  return {
    id, kind: 'work', status: 'completed', loadGrams: 100000, reps: 5,
    durationSeconds: null, distanceMeters: null, rpe: null,
    completedAt: '2026-10-20T10:00:00.000Z',
  };
}

function session(id: string, day: number, occurrenceId?: string): Session {
  const date = `2026-10-${String(19 + day).padStart(2, '0')}`;
  return {
    id, templateId: null, dayId: null, title: '训练', status: 'completed',
    startedAt: `${date}T10:00:00.000Z`, endedAt: `${date}T11:00:00.000Z`,
    businessDate: date, restEndsAt: null, note: '',
    ...(occurrenceId ? { occurrenceId, goalCreditConfirmed: true } : {}),
    exercises: [{
      id: `se_${id}`, exerciseId: 'bb-squat', order: 0, targetSets: 3,
      repMin: 5, repMax: 8, restSeconds: 120, incrementGrams: 2500,
      sets: [workSet(`set_${id}`)],
    }],
  };
}

function goal(n: number, t: number): WeekGoal {
  return { id: `goal_${WEEK}`, weekStart: WEEK, originalPlannedCount: n, minimumTarget: t, adjustments: [] };
}

describe('CRITICAL · tombstone 会话不应计入统计', () => {
  it('computeWeek：删除的会话不计入 actualSessionCount', () => {
    const occs = [occ('o1', 0)];
    const deleted = tombstone(session('s1', 0, 'o1'));
    const r = computeWeek({ weekStart: WEEK, goal: goal(1, 1), occurrences: occs, sessions: [deleted], now: NOW_AFTER });
    expect(r.actualSessionCount).toBe(0);
  });

  it('computeWeek：删除的会话不计入 trainingDays', () => {
    const deleted = tombstone(session('s1', 0));
    const r = computeWeek({ weekStart: WEEK, goal: goal(1, 1), occurrences: [occ('o1', 0)], sessions: [deleted], now: NOW_AFTER });
    expect(r.trainingDays).toBe(0);
  });

  it('computeWeek：删除的会话不满足周目标', () => {
    const deleted = tombstone(session('s1', 0, 'o1'));
    const r = computeWeek({ weekStart: WEEK, goal: goal(1, 1), occurrences: [occ('o1', 0)], sessions: [deleted], now: NOW_AFTER });
    expect(r.completedOccurrences).toBe(0);
    expect(r.status).toBe('notAchieved');
  });

  it('computeWeek：无计划周的删除会话也不计入次数', () => {
    const deleted = tombstone(session('s1', 0));
    const r = computeWeek({ weekStart: WEEK, goal: null, occurrences: [], sessions: [deleted], now: NOW_AFTER });
    expect(r.actualSessionCount).toBe(0);
  });

  it('isValidCompletedSession：tombstone 返回 false', () => {
    expect(isValidCompletedSession(tombstone(session('s1', 0)))).toBe(false);
  });

  it('isValidCompleted（metrics）：tombstone 返回 false', () => {
    expect(isValidCompleted(tombstone(session('s1', 0)))).toBe(false);
  });

  it('trainingCount / trainingDays 排除 tombstone', () => {
    const list = [session('a', 0), tombstone(session('b', 1)), session('c', 2)];
    expect(trainingCount(list)).toBe(2);
    expect(trainingDays(list)).toBe(2);
  });

  it('bestSet 排除 tombstone', () => {
    const list = [tombstone(session('a', 0))];
    expect(bestSet(list, 'bb-squat')).toBeNull();
  });

  it('dayState：删除的会话不显示为 done', () => {
    const occs = [occ('o1', 1)];
    const deleted = tombstone(session('s1', 1, 'o1'));
    const r = computeWeek({ weekStart: WEEK, goal: goal(1, 1), occurrences: occs, sessions: [deleted], now: NOW_AFTER });
    const cell = dayState('2026-10-20', occs, [deleted], r, '2026-10-21');
    expect(cell.primary).not.toBe('done');
    expect(cell.doneCount).toBe(0);
  });

  it('canDispose：删除的活跃会话不再阻止处置', () => {
    const o = occ('o1', 0);
    const deleted = { ...session('s1', 0, 'o1'), status: 'active' as const, deletedAt: '2026-10-20T00:00:00.000Z' };
    expect(canDispose(o, [deleted]).ok).toBe(true);
  });
});
