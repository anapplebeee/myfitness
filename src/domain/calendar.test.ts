/**
 * 月历口径测试。
 *
 * 重点不是"格子画得对不对"，而是**同一天在月视图与周视图里状态一致**：
 * 用户看到月历上标了完成，点进那一周也必须是完成。
 */

import { describe, expect, it } from 'vitest';
import { monthCells, monthLabel, monthRange, monthSummary, shiftMonth } from './calendar';
import { computeWeek, initialWeekGoal, type PlannedOccurrence, type WeekGoal } from './week';
import type { Session, SetRecord } from './types';

function workSet(id: string): SetRecord {
  return {
    id,
    kind: 'work',
    status: 'completed',
    loadGrams: 100000,
    reps: 5,
    durationSeconds: null,
    distanceMeters: null,
    rpe: null,
    completedAt: '2026-10-05T10:00:00.000Z',
  };
}

function occurrence(id: string, date: string, weekStart: string): PlannedOccurrence {
  return {
    id,
    planVersionId: 'v1',
    weekStart,
    originalDate: date,
    scheduledDate: date,
    slotId: `slot-${id}`,
    title: '推日',
    exerciseIds: ['bb-bench'],
    disposition: 'scheduled',
  };
}

function session(id: string, date: string, occurrenceId?: string): Session {
  return {
    id,
    templateId: 'tpl',
    dayId: 'day',
    title: '推日',
    status: 'completed',
    startedAt: `${date}T19:00:00.000Z`,
    endedAt: `${date}T20:00:00.000Z`,
    businessDate: date,
    restEndsAt: null,
    note: '',
    exercises: [
      {
        id: `se_${id}`,
        exerciseId: 'bb-bench',
        order: 0,
        targetSets: 3,
        repMin: 5,
        repMax: 8,
        restSeconds: 120,
        incrementGrams: 2500,
        sets: [workSet(`set_${id}`)],
      },
    ],
    ...(occurrenceId ? { occurrenceId, goalCreditConfirmed: true } : {}),
  };
}

function goalsFor(occurrences: PlannedOccurrence[]): (weekStart: string) => WeekGoal | null {
  const weeks = [...new Set(occurrences.map((o) => o.weekStart))];
  const goals = new Map(
    weeks.map((w) => [w, initialWeekGoal(w, occurrences)]),
  );
  return (weekStart) => goals.get(weekStart) ?? null;
}

const TODAY = '2026-10-20';

describe('monthRange', () => {
  it('从当月 1 日所在周的周一开始，到周日结束', () => {
    const range = monthRange('2026-10-15');
    expect(range.month).toBe('2026-10');
    expect(range.first).toBe('2026-10-01');
    expect(range.from).toBe('2026-09-28'); // 周四 → 补到周一
    expect(range.to).toBe('2026-11-01');
    expect(range.rows).toBe(5);
  });

  it('2 月也能得到整格', () => {
    const range = monthRange('2027-02-10');
    expect(range.days).toBe(28);
    expect(range.rows).toBe(4);
    expect(range.to).toBe('2027-02-28');
  });
});

describe('monthCells', () => {
  it('格子数为整周，且当月天数正确', () => {
    const cells = monthCells({
      anchor: '2026-10-15',
      occurrences: [],
      sessions: [],
      goalForWeek: () => null,
      today: TODAY,
    });
    expect(cells).toHaveLength(35);
    expect(cells.filter((c) => c.inMonth)).toHaveLength(31);
    expect(cells[0]!.date).toBe('2026-09-28');
    expect(cells[0]!.inMonth).toBe(false);
  });

  it('已完成的计划项在月视图里是 done，与周视图一致', () => {
    const week = '2026-10-05';
    const occ = occurrence('o1', '2026-10-05', week);
    const sessions = [session('s1', '2026-10-05', 'o1')];
    const goalForWeek = goalsFor([occ]);

    const cells = monthCells({
      anchor: '2026-10-15',
      occurrences: [occ],
      sessions,
      goalForWeek,
      today: TODAY,
      now: new Date('2026-10-20T12:00:00'),
    });
    const day = cells.find((c) => c.date === '2026-10-05')!;
    expect(day.primary).toBe('done');

    const weekResult = computeWeek({
      weekStart: week,
      goal: goalForWeek(week),
      occurrences: [occ],
      sessions,
      now: new Date('2026-10-20T12:00:00'),
    });
    expect(weekResult.satisfiedOccurrenceIds).toEqual(['o1']);
    expect(day.weekStart).toBe(week);
  });

  it('过去的计划项没完成标记为 missed', () => {
    const week = '2026-10-05';
    const occ = occurrence('o1', '2026-10-05', week);
    const cells = monthCells({
      anchor: '2026-10-15',
      occurrences: [occ],
      sessions: [],
      goalForWeek: goalsFor([occ]),
      today: TODAY,
    });
    expect(cells.find((c) => c.date === '2026-10-05')!.primary).toBe('missed');
  });

  it('未来的计划项是 scheduled，不会提前标成漏做', () => {
    const week = '2026-10-19';
    const occ = occurrence('o1', '2026-10-22', week);
    const cells = monthCells({
      anchor: '2026-10-15',
      occurrences: [occ],
      sessions: [],
      goalForWeek: goalsFor([occ]),
      today: TODAY,
    });
    expect(cells.find((c) => c.date === '2026-10-22')!.primary).toBe('scheduled');
  });
});

describe('monthSummary', () => {
  it('统计训练天数、次数与计划项', () => {
    const week = '2026-10-05';
    const occ = occurrence('o1', '2026-10-05', week);
    const sessions = [session('s1', '2026-10-05', 'o1'), session('s2', '2026-10-05')];
    const cells = monthCells({
      anchor: '2026-10-15',
      occurrences: [occ],
      sessions,
      goalForWeek: goalsFor([occ]),
      today: TODAY,
    });
    const summary = monthSummary({ month: '2026-10', cells, sessions, occurrences: [occ] });
    expect(summary.trainedDays).toBe(1);
    expect(summary.sessionCount).toBe(2);
    expect(summary.plannedCount).toBe(1);
    expect(summary.doneDays).toBe(1);
  });

  it('删除的会话不计入', () => {
    const deleted = { ...session('s3', '2026-10-06'), deletedAt: '2026-10-07T00:00:00.000Z' };
    const cells = monthCells({
      anchor: '2026-10-15',
      occurrences: [],
      sessions: [deleted],
      goalForWeek: () => null,
      today: TODAY,
    });
    const summary = monthSummary({ month: '2026-10', cells, sessions: [deleted], occurrences: [] });
    expect(summary.sessionCount).toBe(0);
    expect(summary.trainedDays).toBe(0);
  });
});

describe('月份导航', () => {
  it('跨年移动', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12-01');
  });

  it('标题可读', () => {
    expect(monthLabel('2026-10')).toBe('2026年10月');
  });
});
