import { describe, expect, it } from 'vitest';
import { PARTIAL_RATIO, completionSummary, shouldDefaultCredit } from './completion';
import type { Session, SetRecord } from './types';

let n = 0;
const id = (p: string) => `${p}_${++n}`;

function set(partial: Partial<SetRecord> = {}): SetRecord {
  return {
    id: id('set'),
    kind: 'work',
    status: 'planned',
    loadGrams: 100000,
    reps: 5,
    durationSeconds: null,
    distanceMeters: null,
    rpe: null,
    completedAt: null,
    ...partial,
  };
}

function session(sets: SetRecord[][], partial: Partial<Session> = {}): Session {
  return {
    id: id('s'),
    templateId: 'tpl-4day',
    dayId: 'd1',
    title: '上肢 A',
    status: 'completed',
    startedAt: '2026-10-20T10:00:00.000Z',
    endedAt: '2026-10-20T11:00:00.000Z',
    businessDate: '2026-10-20',
    restEndsAt: null,
    note: '',
    completionBasis: 'sets',
    exercises: sets.map((group, i) => ({
      id: id('se'),
      exerciseId: `ex-${i}`,
      order: i,
      targetSets: group.length,
      repMin: 8,
      repMax: 12,
      restSeconds: 90,
      incrementGrams: 2500,
      sets: group,
    })),
    ...partial,
  };
}

const done = (count: number, total = count) => [
  ...Array.from({ length: count }, () => set({ status: 'completed', completedAt: '2026-10-20T10:05:00.000Z' })),
  ...Array.from({ length: Math.max(0, total - count) }, () => set()),
];

describe('完成度 · completionSummary', () => {
  it('全部完成 → 100%，不算部分完成', () => {
    const s = completionSummary(session([done(4, 4)]));
    expect(s.ratio).toBe(1);
    expect(s.partial).toBe(false);
    expect(s.text).toBe('4/4 组');
  });

  it('16 组只做 1 组 → 部分完成，且默认不计入周目标', () => {
    const one = session([done(1, 16)]);
    const s = completionSummary(one);
    expect(s.completedWorkSets).toBe(1);
    expect(s.plannedWorkSets).toBe(16);
    expect(s.partial).toBe(true);
    expect(shouldDefaultCredit(one)).toBe(false);
  });

  it('只做了一组但计划就一组 → 仍然算练完', () => {
    const s = completionSummary(session([done(1, 1)]));
    expect(s.ratio).toBe(1);
    expect(s.partial).toBe(false);
  });

  it(`比例低于 ${PARTIAL_RATIO} 才算没练够`, () => {
    // 3/4 = 75% ≥ 60%
    expect(completionSummary(session([done(3, 4)])).partial).toBe(false);
    // 3/6 = 50% < 60%
    expect(completionSummary(session([done(3, 6)])).partial).toBe(true);
  });

  it('热身组不计入分母', () => {
    const s = session([
      [
        set({ kind: 'warmup', status: 'completed', completedAt: '2026-10-20T10:01:00.000Z' }),
        set({ status: 'completed', completedAt: '2026-10-20T10:05:00.000Z' }),
        set({ status: 'completed', completedAt: '2026-10-20T10:06:00.000Z' }),
        set({ status: 'completed', completedAt: '2026-10-20T10:07:00.000Z' }),
      ],
    ]);
    const r = completionSummary(s);
    expect(r.plannedWorkSets).toBe(3);
    expect(r.partial).toBe(false);
  });

  it('自报训练不判部分完成', () => {
    const s = completionSummary(session([[]], { completionBasis: 'selfReported' }));
    expect(s.partial).toBe(false);
    expect(shouldDefaultCredit(session([[]], { completionBasis: 'selfReported' }))).toBe(true);
  });

  it('已删除的场次不算有效训练，也不判部分完成', () => {
    const s = completionSummary(session([done(1, 16)], { deletedAt: '2026-10-20T12:00:00.000Z' }));
    expect(s.partial).toBe(false);
  });
});
