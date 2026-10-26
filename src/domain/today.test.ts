import { describe, expect, it } from 'vitest';
import { todayStateLabel, todayTraining } from './today';
import { computeWeek, initialWeekGoal, type PlannedOccurrence } from './week';
import type { Session, SetRecord } from './types';

const TODAY = '2026-10-21'; // 周三
const WEEK = '2026-10-19';

function workSet(): SetRecord {
  return {
    id: 'set1',
    kind: 'work',
    status: 'completed',
    loadGrams: 100000,
    reps: 5,
    durationSeconds: null,
    distanceMeters: null,
    rpe: null,
    completedAt: `${TODAY}T10:00:00.000Z`,
  };
}

function occurrence(id: string, date = TODAY, extra: Partial<PlannedOccurrence> = {}): PlannedOccurrence {
  return {
    id,
    planVersionId: 'v1',
    weekStart: WEEK,
    originalDate: date,
    scheduledDate: date,
    slotId: `slot-${id}`,
    title: '推日',
    exerciseIds: ['bb-bench'],
    disposition: 'scheduled',
    ...extra,
  };
}

function session(id: string, status: Session['status'], extra: Partial<Session> = {}): Session {
  return {
    id,
    templateId: 'tpl',
    dayId: 'day',
    title: '推日',
    status,
    startedAt: `${TODAY}T19:00:00.000Z`,
    endedAt: status === 'completed' ? `${TODAY}T20:00:00.000Z` : null,
    businessDate: TODAY,
    restEndsAt: null,
    note: '',
    exercises: [
      {
        id: 'se1',
        exerciseId: 'bb-bench',
        order: 0,
        targetSets: 3,
        repMin: 5,
        repMax: 8,
        restSeconds: 120,
        incrementGrams: 2500,
        sets: [workSet()],
      },
    ],
    ...extra,
  };
}

function build(occurrences: PlannedOccurrence[], sessions: Session[], now = new Date(`${TODAY}T21:00:00`)) {
  const result = computeWeek({
    weekStart: WEEK,
    goal: initialWeekGoal(WEEK, occurrences),
    occurrences,
    sessions,
    now,
  });
  return todayTraining({ today: TODAY, occurrences, sessions, result });
}

describe('todayTraining', () => {
  it('有未结束会话时优先显示进行中', () => {
    const occ = occurrence('o1');
    const info = build([occ], [session('s1', 'active')]);
    expect(info.state).toBe('live');
    expect(info.session?.id).toBe('s1');
  });

  it('已计入周目标的训练 → done 且 credited', () => {
    const occ = occurrence('o1');
    const info = build([occ], [session('s1', 'completed', { occurrenceId: 'o1', goalCreditConfirmed: true })]);
    expect(info.state).toBe('done');
    expect(info.credited).toBe(true);
    expect(info.openCount).toBe(0);
  });

  it('练了但没计入周目标时，仍是 done 但 credited=false', () => {
    const occ = occurrence('o1');
    const info = build([occ], [session('s1', 'completed')]);
    expect(info.state).toBe('done');
    expect(info.credited).toBe(false);
    expect(info.openCount).toBe(1);
  });

  it('有计划没做 → planned', () => {
    const info = build([occurrence('o1')], []);
    expect(info.state).toBe('planned');
    expect(info.occurrence?.id).toBe('o1');
    expect(info.openCount).toBe(1);
  });

  it('计划被顺延到本周其他天 → moved 并给出目标日期', () => {
    const moved = occurrence('o1', TODAY, { scheduledDate: '2026-10-23' });
    const info = build([moved], []);
    expect(info.state).toBe('moved');
    expect(info.movedTo).toBe('2026-10-23');
  });

  it('顺延后当天补练了 → 以训练事实为准', () => {
    const moved = occurrence('o1', TODAY, { scheduledDate: '2026-10-23' });
    const info = build([moved], [session('s1', 'completed')]);
    expect(info.state).toBe('done');
  });

  it('没有安排也没有训练 → rest', () => {
    const info = build([], []);
    expect(info.state).toBe('rest');
    expect(info.occurrence).toBeNull();
  });

  it('已删除的会话不参与判断', () => {
    const info = build([occurrence('o1')], [session('s1', 'completed', { deletedAt: `${TODAY}T22:00:00.000Z` })]);
    expect(info.state).toBe('planned');
  });
});

describe('todayStateLabel', () => {
  it('文案稳定', () => {
    expect(todayStateLabel('done')).toBe('今天已完成');
    expect(todayStateLabel('moved')).toBe('已顺延');
    expect(todayStateLabel('rest')).toBe('休息日');
  });
});
