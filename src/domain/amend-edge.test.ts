import { describe, expect, it } from 'vitest';
import {
  buildBackfill,
  changeSessionDate,
  contributesToVolume,
  hasTrainingWithin,
  isFutureDate,
  isLive,
  loadTrend,
  liveSessions,
  pendingSetCount,
  restoreTombstone,
  skipRemainingSets,
  suggestProgression,
  tombstone,
  updateSet,
} from './amend';
import type { Session, SetRecord } from './types';
import { isValidCompletedSession } from './week';

let n = 0;
const idFactory = (p: string) => `${p}_${++n}`;

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
    startedAt: '2026-10-20T19:30:00.000Z', endedAt: '2026-10-20T20:30:00.000Z',
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

// 本地时区周一
const weekStartOf = (date: string): string => {
  const d = new Date(`${date}T12:00:00`);
  const off = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - off);
  return d.toISOString().slice(0, 10);
};

describe('补充 · buildBackfill', () => {
  it('缺日期被拒', () => {
    expect(buildBackfill({ date: '', title: 't', exerciseIds: ['bb-squat'], selfReported: false }, '2026-10-20', idFactory).issue).toBe('请选择日期');
  });
  it('未来日期被拒', () => {
    expect(buildBackfill({ date: '2026-10-21', title: 't', exerciseIds: ['bb-squat'], selfReported: false }, '2026-10-20', idFactory).issue).toBe('不能补录未来的训练');
  });
  it('同一天不算未来', () => {
    const r = buildBackfill({ date: '2026-10-20', title: 't', exerciseIds: ['bb-squat'], selfReported: false }, '2026-10-20', idFactory);
    expect(r.session).toBeDefined();
  });
  it('空白标题被拒', () => {
    expect(buildBackfill({ date: '2026-10-01', title: '   ', exerciseIds: ['bb-squat'], selfReported: false }, '2026-10-20', idFactory).issue).toBe('请填写训练名称');
  });
  it('标题去除首尾空格', () => {
    const r = buildBackfill({ date: '2026-10-01', title: '  腿部  ', exerciseIds: ['bb-squat'], selfReported: false }, '2026-10-20', idFactory);
    expect(r.session!.title).toBe('腿部');
  });
  it('非自报且无动作被拒', () => {
    expect(buildBackfill({ date: '2026-10-01', title: 't', exerciseIds: [], selfReported: false }, '2026-10-20', idFactory).issue).toContain('至少选择一个动作');
  });
  it('自报允许无动作', () => {
    const r = buildBackfill({ date: '2026-10-01', title: 't', exerciseIds: [], selfReported: true }, '2026-10-20', idFactory);
    expect(r.session).toBeDefined();
    expect(r.session!.completionBasis).toBe('selfReported');
    expect(r.session!.exercises).toHaveLength(0);
  });
  it('不填组数时按自报处理，不生成空壳组', () => {
    const r = buildBackfill({ date: '2026-10-01', title: 't', exerciseIds: ['bb-squat', 'bb-bench'], selfReported: false }, '2026-10-20', idFactory);
    expect(r.session!.exercises).toHaveLength(2);
    for (const ex of r.session!.exercises) {
      expect(ex.sets).toHaveLength(0);
    }
    expect(r.session!.completionBasis).toBe('selfReported');
  });

  /*
   * 回归：补录曾经"存了等于没存"——生成的全是 planned 组，
   * 而有效训练要求至少 1 个 completed 工作组，于是被历史/累计/周目标全部过滤。
   */
  it('补录后必须能被算作有效训练（出现在历史里）', () => {
    const r = buildBackfill(
      { date: '2026-10-01', title: '补录', exerciseIds: ['bb-squat'], selfReported: false, setsPerExercise: 3, reps: 8, loadKg: 60 },
      '2026-10-20',
      idFactory,
    );
    expect(isValidCompletedSession(r.session!)).toBe(true);
    const sets = r.session!.exercises[0]!.sets;
    expect(sets).toHaveLength(3);
    expect(sets.every((s) => s.status === 'completed')).toBe(true);
    expect(sets.every((s) => s.reps === 8 && s.loadGrams === 60000)).toBe(true);
  });

  it('不填组数时自动走自报口径，仍然可见', () => {
    const r = buildBackfill(
      { date: '2026-10-01', title: '补录', exerciseIds: ['bb-squat'], selfReported: false, setsPerExercise: 0 },
      '2026-10-20',
      idFactory,
    );
    expect(r.session!.completionBasis).toBe('selfReported');
    expect(isValidCompletedSession(r.session!)).toBe(true);
  });
  it('生成的 set id 唯一', () => {
    const r = buildBackfill({ date: '2026-10-01', title: 't', exerciseIds: ['a', 'b', 'c'], selfReported: false }, '2026-10-20', idFactory);
    const ids = r.session!.exercises.flatMap((e) => e.sets.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('生成的 exercise id 唯一', () => {
    const r = buildBackfill({ date: '2026-10-01', title: 't', exerciseIds: ['a', 'b', 'c'], selfReported: false }, '2026-10-20', idFactory);
    const ids = r.session!.exercises.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('startedAt 落在所选日期的本地 19:00', () => {
    const r = buildBackfill({ date: '2026-10-01', title: 't', exerciseIds: ['bb-squat'], selfReported: false }, '2026-10-20', idFactory);
    expect(new Date(r.session!.startedAt).getHours()).toBe(19);
  });
  it('endedAt 晚于 startedAt 一小时', () => {
    const r = buildBackfill({ date: '2026-10-01', title: 't', exerciseIds: ['bb-squat'], selfReported: false }, '2026-10-20', idFactory);
    expect(new Date(r.session!.endedAt!).getTime() - new Date(r.session!.startedAt).getTime()).toBe(3600 * 1000);
  });
  it('backfilledAt 使用传入 now', () => {
    const fixed = new Date('2026-05-05T05:05:05.000Z');
    const r = buildBackfill({ date: '2026-10-01', title: 't', exerciseIds: ['bb-squat'], selfReported: false }, '2026-10-20', idFactory, fixed);
    expect(r.session!.backfilledAt).toBe(fixed.toISOString());
  });
});

describe('补充 · changeSessionDate', () => {
  it('同周内改日期不解除关联', () => {
    const s = session({ occurrenceId: 'o1', goalCreditConfirmed: true });
    const r = changeSessionDate(s, '2026-10-21', weekStartOf, '2026-10-25');
    expect(r.clearedOccurrence).toBe(false);
    expect(r.weekChanged).toBe(false);
    expect(r.session!.occurrenceId).toBe('o1');
    expect(r.session!.goalCreditConfirmed).toBe(true);
  });

  it('跨周改日期解除关联并清 credit', () => {
    const s = session({ occurrenceId: 'o1', goalCreditConfirmed: true });
    const r = changeSessionDate(s, '2026-10-26', weekStartOf, '2026-11-01');
    expect(r.weekChanged).toBe(true);
    expect(r.clearedOccurrence).toBe(true);
    expect(r.session!.occurrenceId).toBeUndefined();
    expect(r.session!.goalCreditConfirmed).toBe(false);
  });

  it('跨周但本无关联时 clearedOccurrence 为 false', () => {
    const s = session();
    const r = changeSessionDate(s, '2026-10-26', weekStartOf, '2026-11-01');
    expect(r.weekChanged).toBe(true);
    expect(r.clearedOccurrence).toBe(false);
  });

  it('保留本地时分而不是 UTC 时刻', () => {
    // 用本地时刻构造：new Date(无 Z 后缀) 按本地时区解析
    const localStartedAt = new Date('2026-10-20T19:30:00').toISOString();
    const s = session({ startedAt: localStartedAt });
    const r = changeSessionDate(s, '2026-10-21', weekStartOf, '2026-10-25');
    const d = new Date(r.session!.startedAt);
    expect(d.getHours()).toBe(19);
    expect(d.getMinutes()).toBe(30);
  });

  it('UTC 时刻被换算为等价本地时刻后保留', () => {
    // 2026-10-20T19:30:00Z 在东八区是次日 03:30，改日期后应保留 03:30
    const s = session({ startedAt: '2026-10-20T19:30:00.000Z' });
    const r = changeSessionDate(s, '2026-10-21', weekStartOf, '2026-10-25');
    const d = new Date(r.session!.startedAt);
    expect(d.getHours()).toBe(new Date('2026-10-20T19:30:00.000Z').getHours());
    expect(d.getMinutes()).toBe(30);
  });

  it('businessDate 更新为新日期', () => {
    const r = changeSessionDate(session(), '2026-10-22', weekStartOf, '2026-10-25');
    expect(r.session!.businessDate).toBe('2026-10-22');
  });

  it('空日期被拒', () => {
    const r = changeSessionDate(session(), '', weekStartOf, '2026-10-25');
    expect(r.issue).toBe('请选择日期');
    expect(r.session).toBeUndefined();
  });

  it('未来日期被拒', () => {
    const r = changeSessionDate(session(), '2026-10-30', weekStartOf, '2026-10-25');
    expect(r.issue).toBe('不能把训练改到未来');
  });

  it('周日跨到下一周（周六改周日不跨周）', () => {
    // 2026-10-24 是周六，2026-10-25 是周日，同属 10-19 周
    const r = changeSessionDate(session({ businessDate: '2026-10-24' }), '2026-10-25', weekStartOf, '2026-10-25');
    expect(r.weekChanged).toBe(false);
  });

  it('周日改下周一跨周', () => {
    const r = changeSessionDate(session({ businessDate: '2026-10-25' }), '2026-10-26', weekStartOf, '2026-10-26');
    expect(r.weekChanged).toBe(true);
  });

  it('无 endedAt 的会话不产出 endedAt', () => {
    const s = session();
    delete (s as Partial<Session>).endedAt;
    const r = changeSessionDate(s, '2026-10-21', weekStartOf, '2026-10-25');
    expect(r.session!.endedAt).toBeUndefined();
  });
});

describe('补充 · tombstone 与恢复', () => {
  it('tombstone 保留所有字段', () => {
    const s = session({ occurrenceId: 'o1' });
    const t = tombstone(s, new Date('2026-10-21T00:00:00.000Z'));
    expect(t.deletedAt).toBe('2026-10-21T00:00:00.000Z');
    expect(t.id).toBe(s.id);
    expect(t.exercises).toEqual(s.exercises);
    expect(t.occurrenceId).toBe('o1');
  });
  it('恢复清除 deletedAt', () => {
    const r = restoreTombstone(tombstone(session()));
    expect(r.deletedAt).toBeUndefined();
  });
  it('isLive 判定', () => {
    expect(isLive(session())).toBe(true);
    expect(isLive(tombstone(session()))).toBe(false);
  });
  it('liveSessions 过滤', () => {
    const list = [session({ id: 'a' }), tombstone(session({ id: 'b' })), session({ id: 'c' })];
    expect(liveSessions(list).map((s) => s.id)).toEqual(['a', 'c']);
  });
  it('重复 tombstone 覆盖时间戳', () => {
    const t1 = tombstone(session(), new Date('2026-10-21T00:00:00.000Z'));
    const t2 = tombstone(t1, new Date('2026-10-22T00:00:00.000Z'));
    expect(t2.deletedAt).toBe('2026-10-22T00:00:00.000Z');
  });
});

describe('补充 · updateSet', () => {
  it('已删除场次不可编辑', () => {
    const r = updateSet(tombstone(session()), 'bb-squat', 'x1', { reps: 10 });
    expect(r.issue).toBe('这场训练已删除，先恢复再编辑');
  });
  it('动作不存在', () => {
    expect(updateSet(session(), 'nope', 'x1', { reps: 10 }).issue).toBe('找不到该动作');
  });
  it('组不存在', () => {
    expect(updateSet(session(), 'bb-squat', 'nope', { reps: 10 }).issue).toBe('找不到该组');
  });
  it('负重量被拒', () => {
    expect(updateSet(session(), 'bb-squat', 'x1', { loadGrams: -1 }).issue).toBe('重量不合法');
  });
  it('NaN 重量被拒', () => {
    expect(updateSet(session(), 'bb-squat', 'x1', { loadGrams: NaN }).issue).toBe('重量不合法');
  });
  it('Infinity 重量被拒', () => {
    expect(updateSet(session(), 'bb-squat', 'x1', { loadGrams: Infinity }).issue).toBe('重量不合法');
  });
  it('零重量合法', () => {
    const r = updateSet(session(), 'bb-squat', 'x1', { loadGrams: 0 });
    expect(r.session!.exercises[0]!.sets[0]!.loadGrams).toBe(0);
  });
  it('null 重量合法（清空）', () => {
    const r = updateSet(session(), 'bb-squat', 'x1', { loadGrams: null });
    expect(r.session!.exercises[0]!.sets[0]!.loadGrams).toBeNull();
  });
  it('次数 0 被拒', () => {
    expect(updateSet(session(), 'bb-squat', 'x1', { reps: 0 }).issue).toContain('次数需在 1–100');
  });
  it('次数 101 被拒', () => {
    expect(updateSet(session(), 'bb-squat', 'x1', { reps: 101 }).issue).toContain('次数需在 1–100');
  });
  it('小数次数被拒', () => {
    expect(updateSet(session(), 'bb-squat', 'x1', { reps: 5.5 }).issue).toContain('次数需在 1–100');
  });
  it('null 次数合法', () => {
    const r = updateSet(session(), 'bb-squat', 'x1', { reps: null });
    expect(r.session!.exercises[0]!.sets[0]!.reps).toBeNull();
  });
  it('次数边界 1 和 100 合法', () => {
    expect(updateSet(session(), 'bb-squat', 'x1', { reps: 1 }).session).toBeDefined();
    expect(updateSet(session(), 'bb-squat', 'x1', { reps: 100 }).session).toBeDefined();
  });
  it('写入 editedAt', () => {
    const r = updateSet(session(), 'bb-squat', 'x1', { reps: 10 });
    expect(r.session!.exercises[0]!.sets[0]!.editedAt).toBeTruthy();
  });
  it('只改目标组，其他组不变', () => {
    const r = updateSet(session(), 'bb-squat', 'x1', { reps: 99 });
    expect(r.session!.exercises[0]!.sets[1]!.reps).toBe(null);
    expect(r.session!.exercises[0]!.sets[1]!.editedAt).toBeUndefined();
  });
  it('原 session 不被修改（不可变）', () => {
    const s = session();
    updateSet(s, 'bb-squat', 'x1', { reps: 99 });
    expect(s.exercises[0]!.sets[0]!.reps).toBe(5);
  });
});

describe('补充 · skipRemainingSets 与 pendingSetCount', () => {
  it('只跳过 planned 组', () => {
    const r = skipRemainingSets(session());
    expect(r.exercises[0]!.sets[0]!.status).toBe('completed');
    expect(r.exercises[0]!.sets[1]!.status).toBe('skipped');
  });
  it('pendingSetCount 统计 planned', () => {
    expect(pendingSetCount(session())).toBe(1);
  });
  it('全部跳过后 pending 为 0', () => {
    expect(pendingSetCount(skipRemainingSets(session()))).toBe(0);
  });
  it('原 session 不被修改', () => {
    const s = session();
    skipRemainingSets(s);
    expect(s.exercises[0]!.sets[1]!.status).toBe('planned');
  });
});

describe('补充 · contributesToVolume', () => {
  it('自报补录不计容量', () => {
    expect(contributesToVolume(session({ completionBasis: 'selfReported' }))).toBe(false);
  });
  it('legacyReported 不计容量', () => {
    expect(contributesToVolume(session({ completionBasis: 'legacyReported' }))).toBe(false);
  });
  it('逐组记录计容量', () => {
    expect(contributesToVolume(session({ completionBasis: 'sets' }))).toBe(true);
  });
});

describe('补充 · loadTrend', () => {
  it('取每次训练的最大工作组', () => {
    const s1 = session({ id: 'a', businessDate: '2026-10-01', startedAt: '2026-10-01T10:00:00.000Z',
      exercises: [{ ...session().exercises[0]!, sets: [set('a1', { loadGrams: 90000 }), set('a2', { loadGrams: 110000 })] }] });
    const s2 = session({ id: 'b', businessDate: '2026-10-08', startedAt: '2026-10-08T10:00:00.000Z',
      exercises: [{ ...session().exercises[0]!, sets: [set('b1', { loadGrams: 120000 })] }] });
    const trend = loadTrend([s1, s2], 'bb-squat');
    expect(trend).toEqual([
      { date: '2026-10-01', value: 110 },
      { date: '2026-10-08', value: 120 },
    ]);
  });
  it('跳过已删除场次', () => {
    const s1 = session({ id: 'a', businessDate: '2026-10-01' });
    const s2 = tombstone(session({ id: 'b', businessDate: '2026-10-08' }));
    expect(loadTrend([s1, s2], 'bb-squat')).toHaveLength(1);
  });
  it('跳过未完成场次', () => {
    const s1 = session({ id: 'a', businessDate: '2026-10-01', status: 'discarded' });
    expect(loadTrend([s1], 'bb-squat')).toHaveLength(0);
  });
  it('忽略自重组（loadGrams 为 null）', () => {
    const s1 = session({ id: 'a', businessDate: '2026-10-01',
      exercises: [{ ...session().exercises[0]!, sets: [set('a1', { loadGrams: null, reps: 10 })] }] });
    expect(loadTrend([s1], 'bb-squat')).toHaveLength(0);
  });
  it('按日期升序', () => {
    const mk = (id: string, d: string) => session({ id, businessDate: d, startedAt: `${d}T10:00:00.000Z` });
    const trend = loadTrend([mk('b', '2026-10-08'), mk('a', '2026-10-01')], 'bb-squat');
    expect(trend.map((p) => p.date)).toEqual(['2026-10-01', '2026-10-08']);
  });
});

describe('补充 · suggestProgression', () => {
  const mk = (id: string, startedAt: string, sets: SetRecord[]) =>
    session({ id, startedAt, businessDate: startedAt.slice(0, 10),
      exercises: [{ ...session().exercises[0]!, sets }] });

  it('无记录返回 null', () => {
    expect(suggestProgression([], 'bb-squat', 5, 8, 2500)).toBeNull();
  });

  it('全部达到上限 → increase', () => {
    const s = mk('a', '2026-10-01T10:00:00.000Z', [
      set('1', { reps: 8 }), set('2', { reps: 8 }), set('3', { reps: 8 }),
    ]);
    const r = suggestProgression([s], 'bb-squat', 5, 8, 2500)!;
    expect(r.action).toBe('increase');
    expect(r.text).toContain('102.5 kg');
  });

  it('lb 单位输出', () => {
    const s = mk('a', '2026-10-01T10:00:00.000Z', [set('1', { reps: 8 })]);
    const r = suggestProgression([s], 'bb-squat', 5, 8, 2500, 'lb')!;
    expect(r.text).toContain('lb');
  });

  it('连续两次低于下限 → deload', () => {
    const last = mk('b', '2026-10-08T10:00:00.000Z', [set('1', { reps: 3 }), set('2', { reps: 4 })]);
    const prev = mk('a', '2026-10-01T10:00:00.000Z', [set('1', { reps: 4 }), set('2', { reps: 3 })]);
    const r = suggestProgression([last, prev], 'bb-squat', 5, 8, 2500)!;
    expect(r.action).toBe('deload');
    expect(r.text).toContain('90 kg');
  });

  it('仅本次低于下限 → hold', () => {
    const last = mk('b', '2026-10-08T10:00:00.000Z', [set('1', { reps: 3 })]);
    const prev = mk('a', '2026-10-01T10:00:00.000Z', [set('1', { reps: 6 })]);
    const r = suggestProgression([last, prev], 'bb-squat', 5, 8, 2500)!;
    expect(r.action).toBe('hold');
    expect(r.text).toContain('先保持');
  });

  it('未达上限但达标 → hold 并把次数做满', () => {
    const s = mk('a', '2026-10-01T10:00:00.000Z', [set('1', { reps: 6 }), set('2', { reps: 6 })]);
    const r = suggestProgression([s], 'bb-squat', 5, 8, 2500)!;
    expect(r.action).toBe('hold');
    expect(r.text).toContain('先把次数做满 8');
  });

  it('忽略已删除场次', () => {
    const live = mk('a', '2026-10-08T10:00:00.000Z', [set('1', { reps: 8 })]);
    const dead = tombstone(mk('b', '2026-10-09T10:00:00.000Z', [set('1', { reps: 3 })]));
    const r = suggestProgression([live, dead], 'bb-squat', 5, 8, 2500)!;
    expect(r.action).toBe('increase');
  });

  it('忽略未完成场次', () => {
    const s = mk('a', '2026-10-01T10:00:00.000Z', [set('1', { reps: 3 })]);
    s.status = 'discarded';
    expect(suggestProgression([s], 'bb-squat', 5, 8, 2500)).toBeNull();
  });

  it('自重动作（loadGrams 全 null）不给 increase', () => {
    const s = mk('a', '2026-10-01T10:00:00.000Z', [set('1', { loadGrams: null, reps: 10 })]);
    const r = suggestProgression([s], 'bb-squat', 5, 8, 2500)!;
    expect(r.action).not.toBe('increase');
  });

  it('只有已完成组参与判断', () => {
    const s = mk('a', '2026-10-01T10:00:00.000Z', [
      set('1', { reps: 8 }), set('2', { reps: 3, status: 'planned' }),
    ]);
    const r = suggestProgression([s], 'bb-squat', 5, 8, 2500)!;
    expect(r.action).toBe('increase');
  });
});

describe('补充 · hasTrainingWithin', () => {
  it('窗口内有训练', () => {
    expect(hasTrainingWithin([session({ businessDate: '2026-10-18' })], 7, '2026-10-20')).toBe(true);
  });
  it('窗口外训练', () => {
    expect(hasTrainingWithin([session({ businessDate: '2026-10-01' })], 7, '2026-10-20')).toBe(false);
  });
  it('忽略已删除', () => {
    expect(hasTrainingWithin([tombstone(session({ businessDate: '2026-10-19' }))], 7, '2026-10-20')).toBe(false);
  });
  it('忽略未完成', () => {
    expect(hasTrainingWithin([session({ businessDate: '2026-10-19', status: 'active' })], 7, '2026-10-20')).toBe(false);
  });
  it('今天算在窗口内', () => {
    expect(hasTrainingWithin([session({ businessDate: '2026-10-20' })], 7, '2026-10-20')).toBe(true);
  });
});

describe('补充 · isFutureDate', () => {
  it('严格大于', () => {
    expect(isFutureDate('2026-10-21', '2026-10-20')).toBe(true);
    expect(isFutureDate('2026-10-20', '2026-10-20')).toBe(false);
    expect(isFutureDate('2026-10-19', '2026-10-20')).toBe(false);
  });
});
