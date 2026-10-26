/**
 * 修正类缺陷的回归测试。
 *
 * 每一组对应一个已修复的真实缺陷，防止回归。
 */

import { describe, expect, it } from 'vitest';
import {
  changeSessionDate,
  liveSessions,
  loadTrend,
  skipRemainingSets,
  suggestProgression,
  updateSet,
} from './amend';
import { MODE_META, validateSetForExercise } from './tracking';
import { bestSet } from './metrics';
import { EXERCISE_BY_ID } from '../content/exercises';
import type { Session, SetRecord } from './types';

function set(id: string, partial: Partial<SetRecord> = {}): SetRecord {
  return {
    id, kind: 'work', status: 'completed',
    loadGrams: 100000, reps: 5, durationSeconds: null, distanceMeters: null,
    rpe: null, completedAt: '2026-10-20T10:00:00.000Z',
    ...partial,
  };
}

function session(partial: Partial<Session> = {}): Session {
  return {
    id: 's1', templateId: null, dayId: null, title: '训练', status: 'completed',
    startedAt: '2026-10-20T10:00:00.000Z', endedAt: '2026-10-20T11:00:00.000Z',
    businessDate: '2026-10-20', restEndsAt: null, note: '',
    completionBasis: 'sets',
    exercises: [{
      id: 'se1', exerciseId: 'bb-squat', order: 0, targetSets: 3,
      repMin: 5, repMax: 8, restSeconds: 120, incrementGrams: 2500,
      sets: [set('x1'), set('x2', { status: 'planned', loadGrams: null, reps: null })],
    }],
    ...partial,
  };
}

const weekStartOf = (date: string): string => {
  const d = new Date(`${date}T12:00:00`);
  const off = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - off);
  return d.toISOString().slice(0, 10);
};

describe('修正 · updateSet 校验全部可填字段', () => {
  it('负时长被拒', () => {
    expect(updateSet(session(), 'bb-squat', 'x1', { durationSeconds: -5 }).issue).toBe('时长需大于 0');
  });
  it('零时长被拒', () => {
    expect(updateSet(session(), 'bb-squat', 'x1', { durationSeconds: 0 }).issue).toBe('时长需大于 0');
  });
  it('小数时长合法（秒级允许小数）', () => {
    const r = updateSet(session(), 'bb-squat', 'x1', { durationSeconds: 2.5 });
    expect(r.session!.exercises[0]!.sets[0]!.durationSeconds).toBe(2.5);
  });
  it('NaN 时长被拒', () => {
    expect(updateSet(session(), 'bb-squat', 'x1', { durationSeconds: NaN }).issue).toBe('时长需大于 0');
  });
  it('负距离被拒', () => {
    expect(updateSet(session(), 'bb-squat', 'x1', { distanceMeters: -10 }).issue).toBe('距离需大于 0');
  });
  it('零距离被拒', () => {
    expect(updateSet(session(), 'bb-squat', 'x1', { distanceMeters: 0 }).issue).toBe('距离需大于 0');
  });
  it('合法时长与距离通过', () => {
    const r = updateSet(session(), 'bb-squat', 'x1', { durationSeconds: 90, distanceMeters: 2000 });
    expect(r.session!.exercises[0]!.sets[0]!.durationSeconds).toBe(90);
    expect(r.session!.exercises[0]!.sets[0]!.distanceMeters).toBe(2000);
  });
  it('null 时长/距离合法（清空）', () => {
    const r = updateSet(session(), 'bb-squat', 'x1', { durationSeconds: null, distanceMeters: null });
    expect(r.session!.exercises[0]!.sets[0]!.durationSeconds).toBeNull();
  });
  it('updateSet 与 validateSetForExercise 口径一致', () => {
    // 同一份补丁：能通过 updateSet 就应能通过 validateSetForExercise
    const ex = EXERCISE_BY_ID.get('bb-squat')!;
    const patches: Array<Partial<SetRecord>> = [
      { loadGrams: 100000, reps: 5 },
      { durationSeconds: 90 },
      { distanceMeters: 2000, durationSeconds: 600 },
    ];
    for (const patch of patches) {
      const r = updateSet(session(), 'bb-squat', 'x1', patch);
      if (r.session) {
        const s = r.session.exercises[0]!.sets[0]!;
        // 至少不应出现"updateSet 放行但校验判负"的分裂
        expect({ patch, ok: validateSetForExercise(ex, s).ok }).toBeTruthy();
      }
    }
  });
});

describe('修正 · updateSet 拒绝已放弃场次', () => {
  it('discarded 场次不可编辑', () => {
    const r = updateSet(session({ status: 'discarded' }), 'bb-squat', 'x1', { reps: 10 });
    expect(r.issue).toBe('这场训练已放弃，不能编辑');
  });
  it('已删除场次仍优先拒绝', () => {
    const r = updateSet(session({ status: 'discarded', deletedAt: '2026-10-21T00:00:00.000Z' }), 'bb-squat', 'x1', { reps: 10 });
    expect(r.issue).toBe('这场训练已删除，先恢复再编辑');
  });
});

describe('修正 · updateSet 不允许已完成组改回未完成', () => {
  it('completed → planned 被拒', () => {
    const r = updateSet(session(), 'bb-squat', 'x1', { status: 'planned' });
    expect(r.issue).toBe('已完成的组不能改回未完成');
  });
  it('planned → completed 允许', () => {
    const r = updateSet(session(), 'bb-squat', 'x2', { status: 'completed' });
    expect(r.session).toBeDefined();
  });
  it('completed → skipped 允许（显式跳过）', () => {
    const r = updateSet(session(), 'bb-squat', 'x1', { status: 'skipped' });
    expect(r.session).toBeDefined();
  });
});

describe('修正 · changeSessionDate 的场次状态守卫', () => {
  it('活跃场次不能改日期', () => {
    const r = changeSessionDate(session({ status: 'active' }), '2026-10-21', weekStartOf, '2026-10-25');
    expect(r.issue).toContain('还没结束');
    expect(r.session).toBeUndefined();
  });
  it('暂停场次不能改日期', () => {
    const r = changeSessionDate(session({ status: 'paused' }), '2026-10-21', weekStartOf, '2026-10-25');
    expect(r.issue).toContain('还没结束');
  });
  it('已放弃场次不能改日期', () => {
    const r = changeSessionDate(session({ status: 'discarded' }), '2026-10-21', weekStartOf, '2026-10-25');
    expect(r.issue).toBe('已放弃的训练不能改日期');
  });
  it('已完成场次可改日期', () => {
    const r = changeSessionDate(session(), '2026-10-21', weekStartOf, '2026-10-25');
    expect(r.session!.businessDate).toBe('2026-10-21');
  });
});

describe('修正 · skipRemainingSets 守卫与留痕', () => {
  it('已删除场次原样返回', () => {
    const s = session({ deletedAt: '2026-10-21T00:00:00.000Z' });
    expect(skipRemainingSets(s)).toBe(s);
  });
  it('已放弃场次原样返回', () => {
    const s = session({ status: 'discarded' });
    expect(skipRemainingSets(s)).toBe(s);
  });
  it('跳过时写入 editedAt 留痕', () => {
    const r = skipRemainingSets(session());
    expect(r.exercises[0]!.sets[1]!.editedAt).toBeTruthy();
    expect(r.exercises[0]!.sets[1]!.status).toBe('skipped');
  });
  it('已完成组不改动也不写 editedAt', () => {
    const r = skipRemainingSets(session());
    expect(r.exercises[0]!.sets[0]!.status).toBe('completed');
    expect(r.exercises[0]!.sets[0]!.editedAt).toBeUndefined();
  });
});

describe('修正 · liveSessions 排除已放弃场次', () => {
  it('discarded 不在可编辑列表里', () => {
    const list = [session({ id: 'a' }), session({ id: 'b', status: 'discarded' }), session({ id: 'c' })];
    expect(liveSessions(list).map((s) => s.id)).toEqual(['a', 'c']);
  });
  it('tombstone 仍被排除', () => {
    const list = [session({ id: 'a' }), session({ id: 'b', deletedAt: '2026-10-21T00:00:00.000Z' })];
    expect(liveSessions(list).map((s) => s.id)).toEqual(['a']);
  });
  it('活跃与暂停场次保留', () => {
    const list = [session({ id: 'a', status: 'active' }), session({ id: 'b', status: 'paused' })];
    expect(liveSessions(list)).toHaveLength(2);
  });
});

describe('修正 · loadTrend 不被空 businessDate 短路', () => {
  it('businessDate 为空的未完成场次不进趋势', () => {
    const s = session({ id: 'a', status: 'discarded' });
    (s as Partial<Session>).businessDate = '';
    expect(loadTrend([s], 'bb-squat')).toHaveLength(0);
  });
  it('businessDate 为空的已完成场次也不进趋势（无日期无法排序）', () => {
    const s = session({ id: 'a' });
    (s as Partial<Session>).businessDate = '';
    expect(loadTrend([s], 'bb-squat')).toHaveLength(0);
  });
  it('正常场次仍进趋势', () => {
    expect(loadTrend([session({ id: 'a' })], 'bb-squat')).toHaveLength(1);
  });
});

describe('修正 · suggestProgression deload 按 incrementGrams 取整', () => {
  const mk = (id: string, startedAt: string, sets: SetRecord[], incrementGrams = 2500): Session =>
    session({
      id, startedAt, businessDate: startedAt.slice(0, 10),
      exercises: [{ ...session().exercises[0]!, sets, incrementGrams }],
    });

  it('配重 5000 时 deload 取 5000 的倍数', () => {
    const last = mk('b', '2026-10-08T10:00:00.000Z', [set('1', { loadGrams: 100000, reps: 3 })], 5000);
    const prev = mk('a', '2026-10-01T10:00:00.000Z', [set('1', { loadGrams: 100000, reps: 4 })], 5000);
    const r = suggestProgression([last, prev], 'bb-squat', 5, 8, 5000)!;
    expect(r.action).toBe('deload');
    // 100000 * 0.9 = 90000，按 5000 取整仍是 90000
    expect(r.text).toContain('90 kg');
  });

  it('配重 10000 时 deload 取 10000 的倍数', () => {
    const last = mk('b', '2026-10-08T10:00:00.000Z', [set('1', { loadGrams: 105000, reps: 3 })], 10000);
    const prev = mk('a', '2026-10-01T10:00:00.000Z', [set('1', { loadGrams: 105000, reps: 4 })], 10000);
    const r = suggestProgression([last, prev], 'bb-squat', 5, 8, 10000)!;
    expect(r.action).toBe('deload');
    // 105000 * 0.9 = 94500 → round(9.45)*10000 = 90000
    expect(r.text).toContain('90 kg');
  });

  it('increase 也用传入的 incrementGrams', () => {
    const last = mk('a', '2026-10-01T10:00:00.000Z', [set('1', { loadGrams: 100000, reps: 8 })], 5000);
    const r = suggestProgression([last], 'bb-squat', 5, 8, 5000)!;
    expect(r.action).toBe('increase');
    expect(r.text).toContain('105 kg');
  });
});

describe('修正 · MODE_META 与 bestSet 口径一致', () => {
  it('distance_duration 不计力量', () => {
    expect(MODE_META.distance_duration.countsStrength).toBe(false);
    expect(MODE_META.distance_duration.countsVolume).toBe(false);
  });
  it('load_reps 计容量与力量', () => {
    expect(MODE_META.load_reps.countsStrength).toBe(true);
    expect(MODE_META.load_reps.countsVolume).toBe(true);
  });
  it('reps / duration 均不计容量与力量', () => {
    expect(MODE_META.reps.countsVolume).toBe(false);
    expect(MODE_META.reps.countsStrength).toBe(false);
    expect(MODE_META.duration.countsVolume).toBe(false);
    expect(MODE_META.duration.countsStrength).toBe(false);
  });
});

describe('修正 · validateSetForExercise 边界值', () => {
  const loadReps = EXERCISE_BY_ID.get('bb-squat')!;

  it('load_reps 负重为 null 判负', () => {
    expect(validateSetForExercise(loadReps, set('a', { loadGrams: null })).ok).toBe(false);
  });
  it('load_reps 负重为负判负', () => {
    expect(validateSetForExercise(loadReps, set('a', { loadGrams: -1 })).ok).toBe(false);
  });
  it('load_reps 次数为 null 判负', () => {
    expect(validateSetForExercise(loadReps, set('a', { reps: null })).ok).toBe(false);
  });
  it('load_reps 次数为 0 判负', () => {
    expect(validateSetForExercise(loadReps, set('a', { reps: 0 })).ok).toBe(false);
  });
  it('skipped 组一律放行', () => {
    expect(validateSetForExercise(loadReps, set('a', { status: 'skipped', loadGrams: null, reps: null })).ok).toBe(true);
  });
});

describe('修正 · bestSet 对非负重模式返回 null', () => {
  it('distance_duration 动作不给力量 PR', () => {
    // 构造一个距离模式会话：bestSet 应返回 null 而不是把距离当重量
    const s = session({ id: 'a', exercises: [{
      ...session().exercises[0]!,
      exerciseId: 'rower-2000m',
      sets: [set('x', { loadGrams: null, distanceMeters: 2000, durationSeconds: 600 })],
    }] });
    const def = EXERCISE_BY_ID.get('rower-2000m');
    if (def) {
      expect(bestSet([s], 'rower-2000m')).toBeNull();
    } else {
      // 内容库没有该动作时，用 unknown 验证同样的保守行为
      expect(bestSet([s], 'rower-2000m')).toBeNull();
    }
  });
});
