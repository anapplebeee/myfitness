import { describe, expect, it } from 'vitest';
import {
  MODE_META,
  blankSetForMode,
  isCompletedWorkSet,
  setSummary,
  validateSetForExercise,
  volumeEligible,
} from './tracking';
import { sessionVolumeGrams, bestSet } from './metrics';
import { EXERCISE_BY_ID, EXERCISES } from '../content/exercises';
import type { Exercise } from '../content/types';
import type { Session, SetRecord } from './types';

function set(partial: Partial<SetRecord> = {}): SetRecord {
  return {
    id: 's1',
    kind: 'work',
    status: 'completed',
    loadGrams: 100000,
    reps: 5,
    durationSeconds: null,
    distanceMeters: null,
    rpe: null,
    completedAt: '2026-10-20T10:00:00.000Z',
    ...partial,
  };
}

function ex(partial: Partial<Exercise> & Pick<Exercise, 'id'>): Exercise {
  return {
    name: '测试动作',
    group: 'core',
    equipment: '自重',
    mode: 'load_reps',
    load: 'totalExternal',
    ...partial,
  };
}

describe('AC-T05 · 跟踪模式元数据', () => {
  it('四种模式都有元数据', () => {
    expect(Object.keys(MODE_META)).toEqual(['load_reps', 'reps', 'duration', 'distance_duration']);
  });

  it('只有负重模式计容量与力量', () => {
    expect(MODE_META.load_reps.countsVolume).toBe(true);
    expect(MODE_META.load_reps.countsStrength).toBe(true);
    expect(MODE_META.reps.countsVolume).toBe(false);
    expect(MODE_META.duration.countsVolume).toBe(false);
    expect(MODE_META.distance_duration.countsVolume).toBe(false);
  });

  it('volumeEligible 只认外部负荷', () => {
    expect(volumeEligible('totalExternal')).toBe(true);
    expect(volumeEligible('perImplement')).toBe(true);
    expect(volumeEligible('bodyweight')).toBe(false);
    expect(volumeEligible('assistance')).toBe(false);
    expect(volumeEligible('added')).toBe(false);
  });
});

describe('AC-T05 · 按模式校验', () => {
  it('负重模式要求重量与次数', () => {
    const e = ex({ id: 'x', mode: 'load_reps' });
    expect(validateSetForExercise(e, set({ loadGrams: null })).ok).toBe(false);
    expect(validateSetForExercise(e, set({ reps: null })).ok).toBe(false);
    expect(validateSetForExercise(e, set()).ok).toBe(true);
  });

  it('辅助模式不允许 0 辅助重量', () => {
    const e = ex({ id: 'x', mode: 'load_reps', load: 'assistance' });
    expect(validateSetForExercise(e, set({ loadGrams: 0 })).ok).toBe(false);
    expect(validateSetForExercise(e, set({ loadGrams: 10000 })).ok).toBe(true);
  });

  it('次数模式只要求次数', () => {
    const e = ex({ id: 'x', mode: 'reps', load: 'bodyweight' });
    expect(validateSetForExercise(e, set({ loadGrams: null, reps: 12 })).ok).toBe(true);
    expect(validateSetForExercise(e, set({ reps: null })).ok).toBe(false);
  });

  it('计时模式只要求时长', () => {
    const e = ex({ id: 'x', mode: 'duration' });
    expect(validateSetForExercise(e, set({ loadGrams: null, reps: null, durationSeconds: 45 })).ok).toBe(true);
    expect(validateSetForExercise(e, set({ durationSeconds: 0 })).ok).toBe(false);
    expect(validateSetForExercise(e, set({ durationSeconds: null })).ok).toBe(false);
  });

  it('距离模式要求距离与时长', () => {
    const e = ex({ id: 'x', mode: 'distance_duration' });
    expect(
      validateSetForExercise(e, set({ loadGrams: null, reps: null, distanceMeters: 2000, durationSeconds: 720 })).ok,
    ).toBe(true);
    expect(validateSetForExercise(e, set({ distanceMeters: null, durationSeconds: 720 })).ok).toBe(false);
    expect(validateSetForExercise(e, set({ distanceMeters: 2000, durationSeconds: null })).ok).toBe(false);
  });

  it('跳过的组永远校验通过', () => {
    const e = ex({ id: 'x' });
    expect(validateSetForExercise(e, set({ status: 'skipped', loadGrams: null })).ok).toBe(true);
  });
});

describe('AC-T05 · 有效工作组判定', () => {
  it('热身组不算有效组', () => {
    const e = ex({ id: 'x' });
    expect(isCompletedWorkSet(e, set({ kind: 'warmup' }))).toBe(false);
  });

  it('未完成组不算', () => {
    const e = ex({ id: 'x' });
    expect(isCompletedWorkSet(e, set({ status: 'planned' }))).toBe(false);
  });

  it('数据完整的工作组算', () => {
    const e = ex({ id: 'x' });
    expect(isCompletedWorkSet(e, set())).toBe(true);
  });

  it('计时组缺时长不算', () => {
    const e = ex({ id: 'y', mode: 'duration' });
    expect(isCompletedWorkSet(e, set({ durationSeconds: null }))).toBe(false);
  });
});

describe('AC-T05 · 组摘要展示', () => {
  it('负重显示 kg × 次', () => {
    expect(setSummary(ex({ id: 'x' }), set({ loadGrams: 100000, reps: 5 }))).toBe('100 kg × 5');
  });

  it('自重显示次数', () => {
    const e = ex({ id: 'x', mode: 'reps', load: 'bodyweight' });
    expect(setSummary(e, set({ reps: 12, loadGrams: null }))).toBe('12 次');
  });

  it('计时显示分:秒', () => {
    const e = ex({ id: 'x', mode: 'duration' });
    expect(setSummary(e, set({ durationSeconds: 90, loadGrams: null }))).toBe('1:30');
  });

  it('距离显示米与时长', () => {
    const e = ex({ id: 'x', mode: 'distance_duration' });
    expect(setSummary(e, set({ distanceMeters: 2000, durationSeconds: 720, loadGrams: null }))).toBe('2000 m · 12:00');
  });

  it('辅助显示辅助重量', () => {
    const e = ex({ id: 'x', load: 'assistance' });
    expect(setSummary(e, set({ loadGrams: 20000, reps: 8 }))).toBe('辅助 20 kg × 8');
  });
});

describe('AC-T13 · 容量不混算非负重模式', () => {
  function session(exerciseId: string, sets: SetRecord[]): Session {
    return {
      id: 'sess',
      templateId: null,
      dayId: null,
      title: '训练',
      status: 'completed',
      startedAt: '2026-10-20T10:00:00.000Z',
      endedAt: '2026-10-20T11:00:00.000Z',
      businessDate: '2026-10-20',
      restEndsAt: null,
      note: '',
      exercises: [
        {
          id: 'se1',
          exerciseId,
          order: 0,
          targetSets: 3,
          repMin: 5,
          repMax: 8,
          restSeconds: 120,
          incrementGrams: 2500,
          sets,
        },
      ],
    };
  }

  it('负重动作计入容量', () => {
    const s = session('bb-squat', [set({ loadGrams: 100000, reps: 5 })]);
    expect(sessionVolumeGrams(s)).toBe(500000);
  });

  it('自重动作不计入容量', () => {
    const s = session('pullup', [set({ loadGrams: null, reps: 10 })]);
    expect(sessionVolumeGrams(s)).toBe(0);
  });

  it('计时动作不计入容量', () => {
    const s = session('plank', [set({ loadGrams: null, reps: null, durationSeconds: 60 })]);
    expect(sessionVolumeGrams(s)).toBe(0);
  });

  it('距离动作不计入容量', () => {
    const s = session('incline-walk', [set({ loadGrams: null, reps: null, distanceMeters: 2000, durationSeconds: 900 })]);
    expect(sessionVolumeGrams(s)).toBe(0);
  });

  it('混合场次只累加负重部分', () => {
    const s: Session = {
      ...session('bb-squat', [set({ loadGrams: 100000, reps: 5 })]),
      exercises: [
        {
          id: 'se1',
          exerciseId: 'bb-squat',
          order: 0,
          targetSets: 3,
          repMin: 5,
          repMax: 8,
          restSeconds: 120,
          incrementGrams: 2500,
          sets: [set({ id: 'a', loadGrams: 100000, reps: 5 })],
        },
        {
          id: 'se2',
          exerciseId: 'pullup',
          order: 1,
          targetSets: 3,
          repMin: 5,
          repMax: 8,
          restSeconds: 120,
          incrementGrams: 2500,
          sets: [set({ id: 'b', loadGrams: null, reps: 10 })],
        },
      ],
    };
    expect(sessionVolumeGrams(s)).toBe(500000);
  });
});

describe('AC-T14 · 力量 PR 只对负重动作', () => {
  it('自重动作没有力量 PR', () => {
    const s: Session = {
      id: 's1',
      templateId: null,
      dayId: null,
      title: 't',
      status: 'completed',
      startedAt: '2026-10-20T10:00:00.000Z',
      endedAt: '2026-10-20T11:00:00.000Z',
      businessDate: '2026-10-20',
      restEndsAt: null,
      note: '',
      exercises: [
        {
          id: 'se1',
          exerciseId: 'pullup',
          order: 0,
          targetSets: 3,
          repMin: 5,
          repMax: 8,
          restSeconds: 120,
          incrementGrams: 2500,
          sets: [set({ loadGrams: null, reps: 10 })],
        },
      ],
    };
    expect(bestSet([s], 'pullup')).toBeNull();
  });

  it('负重动作有力量 PR', () => {
    const s: Session = {
      id: 's1',
      templateId: null,
      dayId: null,
      title: 't',
      status: 'completed',
      startedAt: '2026-10-20T10:00:00.000Z',
      endedAt: '2026-10-20T11:00:00.000Z',
      businessDate: '2026-10-20',
      restEndsAt: null,
      note: '',
      exercises: [
        {
          id: 'se1',
          exerciseId: 'bb-squat',
          order: 0,
          targetSets: 3,
          repMin: 5,
          repMax: 8,
          restSeconds: 120,
          incrementGrams: 2500,
          sets: [set({ loadGrams: 120000, reps: 5 })],
        },
      ],
    };
    expect(bestSet([s], 'bb-squat')?.loadGrams).toBe(120000);
  });
});

describe('AC-T01 · 内容库模式标注正确', () => {
  it('平板支撑是计时模式', () => {
    expect(EXERCISE_BY_ID.get('plank')?.mode).toBe('duration');
  });

  it('坡度快走与划船机是距离模式', () => {
    expect(EXERCISE_BY_ID.get('incline-walk')?.mode).toBe('distance_duration');
    expect(EXERCISE_BY_ID.get('rower')?.mode).toBe('distance_duration');
  });

  it('自重动作是次数模式且负荷为自重', () => {
    for (const id of ['pushup', 'dip', 'pullup', 'hanging-leg-raise', 'ab-wheel']) {
      expect(EXERCISE_BY_ID.get(id)?.mode).toBe('reps');
      expect(EXERCISE_BY_ID.get(id)?.load).toBe('bodyweight');
    }
  });

  it('杠铃/哑铃/器械动作仍是负重模式', () => {
    for (const id of ['bb-squat', 'bb-bench', 'db-row', 'lat-pulldown', 'leg-press']) {
      expect(EXERCISE_BY_ID.get(id)?.mode).toBe('load_reps');
      expect(EXERCISE_BY_ID.get(id)?.load).toBe('totalExternal');
    }
  });

  it('每种模式至少有一个动作，覆盖不算虚设', () => {
    const modes = new Set(EXERCISES.map((e) => e.mode));
    expect(modes.has('load_reps')).toBe(true);
    expect(modes.has('reps')).toBe(true);
    expect(modes.has('duration')).toBe(true);
    expect(modes.has('distance_duration')).toBe(true);
  });
});

describe('blankSetForMode', () => {
  it('生成草稿组且所有数值为空', () => {
    const s = blankSetForMode(ex({ id: 'x' }), 'new');
    expect(s.id).toBe('new');
    expect(s.status).toBe('planned');
    expect(s.loadGrams).toBeNull();
    expect(s.reps).toBeNull();
    expect(s.durationSeconds).toBeNull();
    expect(s.distanceMeters).toBeNull();
  });
});
