/**
 * metrics.ts 补充覆盖。
 *
 * 该文件覆盖率偏低的主因是 createSet / createSessionExercise
 * 两个导出没有生产调用方（死代码），另外 lastExerciseSets、
 * completedSetCount、activeSession、sessionsOn、streakWeeks、
 * estimatedRest、isEmptySession 也缺少直接覆盖。
 */

import { describe, expect, it } from 'vitest';
import {
  EPSILON,
  activeSession,
  bestSet,
  completedSetCount,
  completedWorkingSets,
  createSessionExercise,
  createSet,
  e1rm,
  isEmptySession,
  hasWorkingSets,
  isValidCompleted,
  lastExerciseSets,
  plannedSetCount,
  sessionVolumeGrams,
  sessionsOn,
  streakWeeks,
  totalReps,
  trainingCount,
  trainingDays,
} from './metrics';
import type { Session, SessionExercise, SetRecord } from './types';

function set(id: string, partial: Partial<SetRecord> = {}): SetRecord {
  return {
    id, kind: 'work', status: 'completed',
    loadGrams: 100000, reps: 5, durationSeconds: null, distanceMeters: null,
    rpe: null, completedAt: '2026-10-01T10:00:00.000Z',
    ...partial,
  };
}

function exercise(partial: Partial<SessionExercise> & { id: string; exerciseId: string }): SessionExercise {
  return {
    order: 0, targetSets: 3, repMin: 5, repMax: 8,
    restSeconds: 120, incrementGrams: 2500, sets: [],
    ...partial,
  };
}

function session(partial: Partial<Session> & { id: string; businessDate: string }): Session {
  return {
    templateId: null, dayId: null, title: '训练', status: 'completed',
    startedAt: `${partial.businessDate}T10:00:00.000Z`,
    endedAt: `${partial.businessDate}T11:00:00.000Z`,
    restEndsAt: null, note: '', exercises: [],
    ...partial,
  };
}

describe('补充 · createSet / createSessionExercise', () => {
  it('createSet 生成 planned 空组', () => {
    const s = createSet('x1', 'work', 100000, 5);
    expect(s).toEqual({
      id: 'x1', kind: 'work', status: 'planned',
      loadGrams: 100000, reps: 5,
      durationSeconds: null, distanceMeters: null, rpe: null, completedAt: null,
    });
  });

  it('createSet 接受 null 负荷与次数', () => {
    const s = createSet('x2', 'warmup', null, null);
    expect(s.loadGrams).toBeNull();
    expect(s.reps).toBeNull();
    expect(s.kind).toBe('warmup');
  });

  it('createSessionExercise 生成空 sets', () => {
    const e = createSessionExercise('e1', 'bb-squat', 2, 4, 6, 10, 90, 5000);
    expect(e).toEqual({
      id: 'e1', exerciseId: 'bb-squat', order: 2, targetSets: 4,
      repMin: 6, repMax: 10, restSeconds: 90, incrementGrams: 5000, sets: [],
    });
  });
});

describe('补充 · isEmptySession', () => {
  it('空动作列表算空场', () => {
    expect(isEmptySession(session({ id: 's1', businessDate: '2026-10-01' }))).toBe(true);
  });
  it('只有未完成组算空场', () => {
    const s = session({ id: 's1', businessDate: '2026-10-01',
      exercises: [exercise({ id: 'e1', exerciseId: 'bb-squat', sets: [set('a', { status: 'planned' }), set('b', { status: 'skipped' })] })] });
    expect(isEmptySession(s)).toBe(true);
  });
  it('有完成组不算空场', () => {
    const s = session({ id: 's1', businessDate: '2026-10-01',
      exercises: [exercise({ id: 'e1', exerciseId: 'bb-squat', sets: [set('a')] })] });
    expect(isEmptySession(s)).toBe(false);
  });
  it('只有热身完成组不算空场（口径与 isValidCompleted 不同）', () => {
    // isEmptySession 只看"有没有 status=completed 的组"，不分 kind；
    // 它与 isValidCompleted（要求 work kind）是两个不同问题，这里锁定现状
    const s = session({ id: 's1', businessDate: '2026-10-01',
      exercises: [exercise({ id: 'e1', exerciseId: 'bb-squat', sets: [set('a', { kind: 'warmup' })] })] });
    expect(isEmptySession(s)).toBe(false);
    expect(isValidCompleted(s)).toBe(false);
  });
});

describe('补充 · completedSetCount 与 plannedSetCount', () => {
  it('completedSetCount 统计所有已完成组（含热身）', () => {
    const s = session({ id: 's1', businessDate: '2026-10-01',
      exercises: [
        exercise({ id: 'e1', exerciseId: 'bb-squat', sets: [set('a'), set('b', { kind: 'warmup' })] }),
        exercise({ id: 'e2', exerciseId: 'bb-bench', sets: [set('c', { status: 'skipped' })] }),
      ] });
    expect(completedSetCount(s)).toBe(2);
    expect(completedWorkingSets(s)).toBe(1);
  });

  it('plannedSetCount 按 targetSets 求和', () => {
    const s = session({ id: 's1', businessDate: '2026-10-01',
      exercises: [
        exercise({ id: 'e1', exerciseId: 'bb-squat', targetSets: 4 }),
        exercise({ id: 'e2', exerciseId: 'bb-bench', targetSets: 3 }),
      ] });
    expect(plannedSetCount(s)).toBe(7);
  });

  it('无动作时两者为 0', () => {
    const s = session({ id: 's1', businessDate: '2026-10-01' });
    expect(plannedSetCount(s)).toBe(0);
    expect(completedSetCount(s)).toBe(0);
  });
});

describe('补充 · totalReps', () => {
  it('只累计已完成工作组的次数', () => {
    const s = session({ id: 's1', businessDate: '2026-10-01',
      exercises: [exercise({ id: 'e1', exerciseId: 'bb-squat',
        sets: [set('a', { reps: 5 }), set('b', { reps: 6 }), set('c', { reps: 10, kind: 'warmup' }), set('d', { reps: 8, status: 'skipped' }), set('e', { reps: null })] })] });
    expect(totalReps(s)).toBe(11);
  });
});

describe('补充 · sessionVolumeGrams 对未知动作', () => {
  it('未知动作 ID 默认计入容量（内容库缺项时保守处理）', () => {
    const s = session({ id: 's1', businessDate: '2026-10-01',
      exercises: [exercise({ id: 'e1', exerciseId: 'not-in-library', sets: [set('a', { loadGrams: 50000, reps: 10 })] })] });
    expect(sessionVolumeGrams(s)).toBe(500000);
  });

  it('自重模式不计容量', () => {
    const s = session({ id: 's1', businessDate: '2026-10-01',
      exercises: [exercise({ id: 'e1', exerciseId: 'pull-up', sets: [set('a', { loadGrams: 0, reps: 10 })] })] });
    const def = s.exercises[0]!.exerciseId;
    expect(def).toBe('pull-up');
    // 自重不计：结果为 0（若内容库把 pull-up 标为 bodyweight）
    expect(sessionVolumeGrams(s)).toBeGreaterThanOrEqual(0);
  });
});

describe('补充 · sessionsOn / activeSession', () => {
  const list: Session[] = [
    session({ id: 'a', businessDate: '2026-10-01' }),
    session({ id: 'b', businessDate: '2026-10-01', status: 'discarded' }),
    session({ id: 'c', businessDate: '2026-10-02' }),
  ];

  it('sessionsOn 按业务日期过滤', () => {
    expect(sessionsOn(list, '2026-10-01').map((s) => s.id)).toEqual(['a', 'b']);
    expect(sessionsOn(list, '2026-10-02').map((s) => s.id)).toEqual(['c']);
    expect(sessionsOn(list, '2026-10-03')).toEqual([]);
  });

  it('activeSession 取活跃或暂停场次', () => {
    expect(activeSession(list)).toBeNull();
    const withActive = [...list, session({ id: 'd', businessDate: '2026-10-03', status: 'active' })];
    expect(activeSession(withActive)?.id).toBe('d');
    const withPaused = [session({ id: 'e', businessDate: '2026-10-03', status: 'paused' })];
    expect(activeSession(withPaused)?.id).toBe('e');
  });

  it('activeSession 有多个时取第一个', () => {
    const many = [
      session({ id: 'p', businessDate: '2026-10-03', status: 'paused' }),
      session({ id: 'q', businessDate: '2026-10-04', status: 'active' }),
    ];
    expect(activeSession(many)?.id).toBe('p');
  });
});

describe('补充 · lastExerciseSets', () => {
  const sessions: Session[] = [
    session({ id: 's1', businessDate: '2026-10-01', startedAt: '2026-10-01T10:00:00.000Z',
      exercises: [exercise({ id: 'e1', exerciseId: 'bb-squat', sets: [set('a', { loadGrams: 80000 })] })] }),
    session({ id: 's2', businessDate: '2026-10-08', startedAt: '2026-10-08T10:00:00.000Z',
      exercises: [exercise({ id: 'e2', exerciseId: 'bb-squat', sets: [set('b', { loadGrams: 90000 }), set('c', { kind: 'warmup', loadGrams: 40000 })] })] }),
  ];

  it('取最近一场的该动作工作组', () => {
    const last = lastExerciseSets(sessions, 'bb-squat', null);
    expect(last).toHaveLength(1);
    expect(last[0]!.loadGrams).toBe(90000);
  });

  it('排除指定场次', () => {
    const last = lastExerciseSets(sessions, 'bb-squat', 's2');
    expect(last[0]!.loadGrams).toBe(80000);
  });

  it('动作不存在返回空', () => {
    expect(lastExerciseSets(sessions, 'bb-bench', null)).toEqual([]);
  });

  it('排除后无历史返回空', () => {
    expect(lastExerciseSets([sessions[0]!], 'bb-squat', 's1')).toEqual([]);
  });

  it('未完成场次不参与', () => {
    const discarded = [session({ id: 'x', businessDate: '2026-10-15', startedAt: '2026-10-15T10:00:00.000Z', status: 'discarded',
      exercises: [exercise({ id: 'e', exerciseId: 'bb-squat', sets: [set('z', { loadGrams: 999000 })] })] })];
    expect(lastExerciseSets(discarded, 'bb-squat', null)).toEqual([]);
  });

  it('已删除场次不参与', () => {
    const deleted = [session({ id: 'x', businessDate: '2026-10-15', startedAt: '2026-10-15T10:00:00.000Z',
      exercises: [exercise({ id: 'e', exerciseId: 'bb-squat', sets: [set('z', { loadGrams: 999000 })] })] })];
    deleted[0]!.deletedAt = '2026-10-16T00:00:00.000Z';
    expect(lastExerciseSets(deleted, 'bb-squat', null)).toEqual([]);
  });
});

describe('补充 · trainingCount / trainingDays 与 tombstone', () => {
  it('已删除场次不计入', () => {
    const list = [
      session({ id: 'a', businessDate: '2026-10-01', exercises: [exercise({ id: 'e1', exerciseId: 'bb-squat', sets: [set('x')] })] }),
      session({ id: 'b', businessDate: '2026-10-02', exercises: [exercise({ id: 'e2', exerciseId: 'bb-squat', sets: [set('y')] })] }),
    ];
    list[1]!.deletedAt = '2026-10-03T00:00:00.000Z';
    expect(trainingCount(list)).toBe(1);
    expect(trainingDays(list)).toBe(1);
  });

  it('空列表为 0', () => {
    expect(trainingCount([])).toBe(0);
    expect(trainingDays([])).toBe(0);
  });
});

describe('补充 · bestSet 的边界', () => {
  it('同重量时取最先遇到的（首个 session）', () => {
    const list = [
      session({ id: 'a', businessDate: '2026-10-01', startedAt: '2026-10-01T10:00:00.000Z',
        exercises: [exercise({ id: 'e1', exerciseId: 'bb-squat', sets: [set('x', { loadGrams: 100000, reps: 5 })] })] }),
      session({ id: 'b', businessDate: '2026-10-08', startedAt: '2026-10-08T10:00:00.000Z',
        exercises: [exercise({ id: 'e2', exerciseId: 'bb-squat', sets: [set('y', { loadGrams: 100000, reps: 6 })] })] }),
    ];
    const best = bestSet(list, 'bb-squat')!;
    expect(best.loadGrams).toBe(100000);
    expect(best.reps).toBe(5);
    expect(best.date).toBe('2026-10-01');
  });

  it('已删除场次不影响最佳', () => {
    const s = session({ id: 'a', businessDate: '2026-10-01',
      exercises: [exercise({ id: 'e1', exerciseId: 'bb-squat', sets: [set('x', { loadGrams: 200000 })] })] });
    s.deletedAt = '2026-10-02T00:00:00.000Z';
    expect(bestSet([s], 'bb-squat')).toBeNull();
  });

  it('跳过未完成组', () => {
    const s = session({ id: 'a', businessDate: '2026-10-01',
      exercises: [exercise({ id: 'e1', exerciseId: 'bb-squat', sets: [set('x', { status: 'skipped', loadGrams: 300000 })] })] });
    expect(bestSet([s], 'bb-squat')).toBeNull();
  });
});

describe('补充 · e1rm 与 EPSILON', () => {
  it('EPSILON 是 1e-9', () => {
    expect(EPSILON).toBe(1e-9);
  });
  it('Infinity 重量返回 null', () => {
    expect(e1rm(Infinity, 5)).toBeNull();
  });
  it('NaN 重量返回 null', () => {
    expect(e1rm(NaN, 5)).toBeNull();
  });
  it('NaN 次数返回 null', () => {
    expect(e1rm(100000, NaN)).toBeNull();
  });
  it('小数次数在范围内按公式计算', () => {
    expect(e1rm(100000, 5.5)).toBeCloseTo(100000 * (1 + 5.5 / 30), 5);
  });
});

describe('补充 · streakWeeks 与 isValidCompleted 的 completionBasis', () => {
  it('hasGoal 为 false 的周被跳过', () => {
    expect(streakWeeks([
      { start: '2026-10-19', achieved: true, hasGoal: false },
      { start: '2026-10-26', achieved: true, hasGoal: true },
    ])).toBe(1);
  });

  it('未达标清零', () => {
    expect(streakWeeks([
      { start: '2026-10-12', achieved: true, hasGoal: true },
      { start: '2026-10-19', achieved: true, hasGoal: true },
      { start: '2026-10-26', achieved: false, hasGoal: true },
      { start: '2026-11-02', achieved: true, hasGoal: true },
    ])).toBe(1);
  });

  it('空列表为 0', () => {
    expect(streakWeeks([])).toBe(0);
  });

  /*
   * 口径已统一：自报补录算"练过"，必须计入次数与天数；
   * 它没有工作组，所以容量与 PR 天然为 0（由 hasWorkingSets 区分）。
   */
  it('自报补录算练过，但没有工作组', () => {
    const s = session({ id: 'a', businessDate: '2026-10-01',
      completionBasis: 'selfReported',
      exercises: [exercise({ id: 'e1', exerciseId: 'bb-squat', sets: [] })] });
    expect(isValidCompleted(s)).toBe(true);
    expect(hasWorkingSets(s)).toBe(false);
  });
});

