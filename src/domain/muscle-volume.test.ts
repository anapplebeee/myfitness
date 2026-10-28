import { describe, expect, it } from 'vitest';
import type { AppState, Session, SetRecord } from './types';
import { sessionMuscleSets, totalMuscleSets, weeklyMuscleSets } from './muscle-volume';

/** 肌群组数：只数"已完成的工作组"。 */

const WEEK = '2026-10-19';

function set(over: Partial<SetRecord> & { id: string }): SetRecord {
  return {
    kind: 'work',
    status: 'completed',
    loadGrams: 100000,
    reps: 5,
    durationSeconds: null,
    distanceMeters: null,
    rpe: null,
    completedAt: '2026-10-20T10:00:00.000Z',
    ...over,
  };
}

function session(over: Partial<Session> & { id: string; businessDate: string }): Session {
  return {
    templateId: null,
    dayId: null,
    title: '训练',
    status: 'completed',
    startedAt: `${over.businessDate}T10:00:00.000Z`,
    endedAt: `${over.businessDate}T11:00:00.000Z`,
    restEndsAt: null,
    note: '',
    exercises: [],
    ...over,
  };
}

function ex(exerciseId: string, sets: SetRecord[], id = `se_${exerciseId}`) {
  return {
    id,
    exerciseId,
    order: 0,
    targetSets: sets.length,
    repMin: 5,
    repMax: 8,
    restSeconds: 120,
    incrementGrams: 2500,
    sets,
  };
}

function state(over: Partial<AppState> = {}): AppState {
  return {
    version: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    profile: {
      name: 't',
      experience: 'intermediate',
      equipment: 'gym',
      weeklyTarget: 4,
      heightCm: 175,
      sex: 'male',
      birthYear: 1995,
      activity: 1.5,
      restrictions: [],
      allergies: [],
      restrictionsConfirmed: true,
    },
    activeTemplateId: null,
    sessions: [],
    weights: [],
    foods: [],
    bodyGoalGrams: null,
    goals: [],
    targetKcal: null,
    targetProtein: null,
    weeklyGoal: 4,
    onboarded: true,
    occurrences: [],
    weekGoals: [],
    activeTemplateSince: null,
    customTemplates: [],
    datasetId: 'ds_x',
    lastBackupKey: null,
    ...over,
  };
}

describe('单场训练', () => {
  it('按动作所属肌群归组', () => {
    const s = session({
      id: 'a',
      businessDate: '2026-10-19',
      exercises: [
        ex('bb-squat', [set({ id: '1' }), set({ id: '2' }), set({ id: '3' })]),
        ex('bb-bench', [set({ id: '4' }), set({ id: '5' })]),
      ],
    });
    const m = sessionMuscleSets(s);
    expect(m.get('legs')).toBe(3);
    expect(m.get('chest')).toBe(2);
  });

  it('热身组不计入', () => {
    const s = session({
      id: 'a',
      businessDate: '2026-10-19',
      exercises: [
        ex('bb-squat', [
          set({ id: 'w1', kind: 'warmup' }),
          set({ id: 'w2', kind: 'warmup' }),
          set({ id: '1' }),
        ]),
      ],
    });
    expect(sessionMuscleSets(s).get('legs')).toBe(1);
  });

  it('跳过/未完成的组不计入', () => {
    const s = session({
      id: 'a',
      businessDate: '2026-10-19',
      exercises: [
        ex('bb-squat', [
          set({ id: '1' }),
          set({ id: '2', status: 'skipped' }),
          set({ id: '3', status: 'planned', completedAt: null }),
        ]),
      ],
    });
    expect(sessionMuscleSets(s).get('legs')).toBe(1);
  });
});

describe('整周', () => {
  it('跨多场累加', () => {
    const st = state({
      sessions: [
        session({ id: 'a', businessDate: '2026-10-19', exercises: [ex('bb-squat', [set({ id: '1' }), set({ id: '2' })])] }),
        session({ id: 'b', businessDate: '2026-10-22', exercises: [ex('leg-press', [set({ id: '3' })])] }),
      ],
    });
    const rows = weeklyMuscleSets(st, WEEK);
    expect(rows.find((r) => r.group === 'legs')?.sets).toBe(3);
  });

  it('只算本周', () => {
    const st = state({
      sessions: [
        session({ id: 'a', businessDate: '2026-10-19', exercises: [ex('bb-squat', [set({ id: '1' })])] }),
        session({ id: 'b', businessDate: '2026-10-12', exercises: [ex('bb-squat', [set({ id: '2' })])] }),
      ],
    });
    expect(weeklyMuscleSets(st, WEEK).find((r) => r.group === 'legs')?.sets).toBe(1);
  });

  it('已删除的场次不算', () => {
    const st = state({
      sessions: [
        session({
          id: 'a',
          businessDate: '2026-10-19',
          deletedAt: '2026-10-20T00:00:00.000Z',
          exercises: [ex('bb-squat', [set({ id: '1' })])],
        }),
      ],
    });
    expect(weeklyMuscleSets(st, WEEK)).toEqual([]);
  });

  it('默认不返回 0 组，按组数降序', () => {
    const st = state({
      sessions: [
        session({
          id: 'a',
          businessDate: '2026-10-19',
          exercises: [
            ex('bb-bench', [set({ id: '1' })]),
            ex('bb-squat', [set({ id: '2' }), set({ id: '3' }), set({ id: '4' })]),
          ],
        }),
      ],
    });
    const rows = weeklyMuscleSets(st, WEEK);
    expect(rows.every((r) => r.sets > 0)).toBe(true);
    expect(rows[0]?.group).toBe('legs');
  });

  it('includeZero 返回全部肌群', () => {
    const rows = weeklyMuscleSets(state(), WEEK, { includeZero: true });
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((r) => r.sets === 0)).toBe(true);
  });

  it('合计', () => {
    const st = state({
      sessions: [
        session({
          id: 'a',
          businessDate: '2026-10-19',
          exercises: [ex('bb-squat', [set({ id: '1' }), set({ id: '2' })]), ex('bb-bench', [set({ id: '3' })])],
        }),
      ],
    });
    expect(totalMuscleSets(weeklyMuscleSets(st, WEEK))).toBe(3);
  });
});

