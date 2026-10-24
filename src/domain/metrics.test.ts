import { describe, expect, it } from 'vitest';
import {
  bestSet,
  completedWorkingSets,
  e1rm,
  isValidCompleted,
  lastExerciseSets,
  plannedSetCount,
  sessionVolumeGrams,
  trainingDays,
} from './metrics';
import type { Session, SessionExercise, SetRecord } from './types';

function set(partial: Partial<SetRecord> & { id: string }): SetRecord {
  return {
    kind: 'work',
    status: 'completed',
    loadGrams: 100000,
    reps: 5,
    durationSeconds: null,
    distanceMeters: null,
    rpe: null,
    completedAt: '2026-10-01T10:00:00.000Z',
    ...partial,
  };
}

function exercise(partial: Partial<SessionExercise> & { id: string; exerciseId: string }): SessionExercise {
  return {
    order: 0,
    targetSets: 3,
    repMin: 5,
    repMax: 8,
    restSeconds: 120,
    incrementGrams: 2500,
    sets: [],
    ...partial,
  };
}

function session(partial: Partial<Session> & { id: string; businessDate: string }): Session {
  return {
    templateId: null,
    dayId: null,
    title: '训练',
    status: 'completed',
    startedAt: `${partial.businessDate}T10:00:00.000Z`,
    endedAt: `${partial.businessDate}T11:00:00.000Z`,
    restEndsAt: null,
    note: '',
    exercises: [],
    ...partial,
  };
}

describe('AC-T10 · 有效完成判定', () => {
  it('只有完成且至少一个工作组才算有效', () => {
    const s = session({
      id: 's1',
      businessDate: '2026-10-01',
      exercises: [exercise({ id: 'e1', exerciseId: 'bb-squat', sets: [set({ id: 'x1' })] })],
    });
    expect(isValidCompleted(s)).toBe(true);
  });

  it('只有热身组不算有效训练', () => {
    const s = session({
      id: 's2',
      businessDate: '2026-10-01',
      exercises: [
        exercise({ id: 'e1', exerciseId: 'bb-squat', sets: [set({ id: 'x1', kind: 'warmup' })] }),
      ],
    });
    expect(isValidCompleted(s)).toBe(false);
  });

  it('放弃的场次不算有效', () => {
    const s = session({
      id: 's3',
      businessDate: '2026-10-01',
      status: 'discarded',
      exercises: [exercise({ id: 'e1', exerciseId: 'bb-squat', sets: [set({ id: 'x1' })] })],
    });
    expect(isValidCompleted(s)).toBe(false);
  });

  it('跳过的组不算完成', () => {
    const s = session({
      id: 's4',
      businessDate: '2026-10-01',
      exercises: [
        exercise({ id: 'e1', exerciseId: 'bb-squat', sets: [set({ id: 'x1', status: 'skipped' })] }),
      ],
    });
    expect(completedWorkingSets(s)).toBe(0);
    expect(isValidCompleted(s)).toBe(false);
  });
});

describe('AC-T13 · 容量与组数口径', () => {
  it('容量只累计已完成工作组', () => {
    const s = session({
      id: 's5',
      businessDate: '2026-10-01',
      exercises: [
        exercise({
          id: 'e1',
          exerciseId: 'bb-squat',
          sets: [
            set({ id: 'a', loadGrams: 100000, reps: 5 }),
            set({ id: 'b', loadGrams: 100000, reps: 5 }),
            set({ id: 'c', status: 'skipped' }),
            set({ id: 'd', kind: 'warmup', loadGrams: 60000, reps: 10 }),
          ],
        }),
      ],
    });
    expect(sessionVolumeGrams(s)).toBe(1000000);
    expect(completedWorkingSets(s)).toBe(2);
  });

  it('计划组数按目标而非实际组数', () => {
    const s = session({
      id: 's6',
      businessDate: '2026-10-01',
      exercises: [
        exercise({ id: 'e1', exerciseId: 'bb-squat', targetSets: 4, sets: [set({ id: 'a' })] }),
        exercise({ id: 'e2', exerciseId: 'bb-bench', targetSets: 3, sets: [] }),
      ],
    });
    expect(plannedSetCount(s)).toBe(7);
  });
});

describe('AC-T13 · e1RM 估算', () => {
  it('Epley 公式在 1–10 次内有效', () => {
    expect(e1rm(100000, 1)).toBeCloseTo(103333.33, 1);
    expect(e1rm(100000, 10)).toBeCloseTo(133333.33, 1);
  });

  it('超出 1–10 次返回 null', () => {
    expect(e1rm(100000, 0)).toBeNull();
    expect(e1rm(100000, 11)).toBeNull();
  });

  it('非法重量返回 null', () => {
    expect(e1rm(0, 5)).toBeNull();
    expect(e1rm(-5, 5)).toBeNull();
  });
});

describe('AC-T14 · 最佳与上次记录', () => {
  const sessions: Session[] = [
    session({
      id: 's10',
      businessDate: '2026-10-01',
      startedAt: '2026-10-01T10:00:00.000Z',
      exercises: [
        exercise({
          id: 'e1',
          exerciseId: 'bb-squat',
          sets: [set({ id: 'a', loadGrams: 90000, reps: 5 })],
        }),
      ],
    }),
    session({
      id: 's11',
      businessDate: '2026-10-08',
      startedAt: '2026-10-08T10:00:00.000Z',
      exercises: [
        exercise({
          id: 'e2',
          exerciseId: 'bb-squat',
          sets: [set({ id: 'b', loadGrams: 100000, reps: 6 })],
        }),
      ],
    }),
  ];

  it('最佳记录取最大重量', () => {
    const best = bestSet(sessions, 'bb-squat');
    expect(best?.loadGrams).toBe(100000);
    expect(best?.reps).toBe(6);
    expect(best?.date).toBe('2026-10-08');
  });

  it('无记录返回 null', () => {
    expect(bestSet(sessions, 'unknown')).toBeNull();
  });

  it('上次记录取最近一场，可排除当前场次', () => {
    const last = lastExerciseSets(sessions, 'bb-squat', 's11');
    expect(last).toHaveLength(1);
    expect(last[0]?.loadGrams).toBe(90000);
  });
});

describe('AC-W06 · 训练次数与天数', () => {
  it('同一天两场训练只算一天', () => {
    const sessions: Session[] = [
      session({
        id: 'd1',
        businessDate: '2026-10-01',
        exercises: [exercise({ id: 'e1', exerciseId: 'bb-squat', sets: [set({ id: 'a' })] })],
      }),
      session({
        id: 'd2',
        businessDate: '2026-10-01',
        startedAt: '2026-10-01T18:00:00.000Z',
        exercises: [exercise({ id: 'e2', exerciseId: 'bb-bench', sets: [set({ id: 'b' })] })],
      }),
    ];
    expect(trainingDays(sessions)).toBe(1);
  });
});

