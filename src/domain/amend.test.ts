import { describe, expect, it } from 'vitest';
import {
  buildBackfill,
  changeSessionDate,
  contributesToVolume,
  isFutureDate,
  isLive,
  liveSessions,
  loadTrend,
  pendingSetCount,
  restoreTombstone,
  skipRemainingSets,
  suggestProgression,
  tombstone,
  updateSet,
} from './amend';
import { mondayOf } from './plan';
import type { Session, SetRecord } from './types';

const TODAY = '2026-10-24';

let seq = 0;
const idFactory = (p: string) => `${p}_${(seq += 1)}`;

function set(id: string, partial: Partial<SetRecord> = {}): SetRecord {
  return {
    id,
    kind: 'work',
    status: 'completed',
    loadGrams: 100000,
    reps: 8,
    durationSeconds: null,
    distanceMeters: null,
    rpe: null,
    completedAt: '2026-10-20T10:00:00.000Z',
    ...partial,
  };
}

function session(id: string, date: string, opts: { sets?: SetRecord[]; occurrenceId?: string } = {}): Session {
  return {
    id,
    templateId: null,
    dayId: null,
    title: '训练',
    status: 'completed',
    startedAt: `${date}T19:00:00.000Z`,
    endedAt: `${date}T20:00:00.000Z`,
    businessDate: date,
    restEndsAt: null,
    note: '',
    ...(opts.occurrenceId ? { occurrenceId: opts.occurrenceId, goalCreditConfirmed: true } : {}),
    exercises: [
      {
        id: `se_${id}`,
        exerciseId: 'bb-squat',
        order: 0,
        targetSets: 3,
        repMin: 6,
        repMax: 10,
        restSeconds: 120,
        incrementGrams: 2500,
        sets: opts.sets ?? [set(`s_${id}`)],
      },
    ],
  };
}

describe('isFutureDate', () => {
  it('晚于今天算未来', () => {
    expect(isFutureDate('2026-10-25', TODAY)).toBe(true);
    expect(isFutureDate('2026-10-24', TODAY)).toBe(false);
    expect(isFutureDate('2026-10-20', TODAY)).toBe(false);
  });
});

describe('AC-T18 · 补录与自报完成', () => {
  it('过去日期可补录', () => {
    const r = buildBackfill(
      { date: '2026-10-01', title: '补录', exerciseIds: ['bb-squat'], selfReported: false },
      TODAY,
      idFactory,
    );
    expect(r.session).toBeDefined();
    expect(r.session!.businessDate).toBe('2026-10-01');
    expect(r.session!.completionBasis).toBe('sets');
    expect(r.session!.backfilledAt).toBeTruthy();
  });

  it('不能补录未来', () => {
    const r = buildBackfill(
      { date: '2026-12-01', title: '补录', exerciseIds: ['bb-squat'], selfReported: false },
      TODAY,
      idFactory,
    );
    expect(r.issue).toContain('未来');
  });

  it('自报完成不生成组记录', () => {
    const r = buildBackfill(
      { date: '2026-10-01', title: '只确认练过', exerciseIds: [], selfReported: true },
      TODAY,
      idFactory,
    );
    expect(r.session!.completionBasis).toBe('selfReported');
    expect(r.session!.exercises).toHaveLength(0);
  });

  it('非自报但没选动作报错', () => {
    const r = buildBackfill(
      { date: '2026-10-01', title: '补录', exerciseIds: [], selfReported: false },
      TODAY,
      idFactory,
    );
    expect(r.issue).toBeTruthy();
  });

  it('名称为空报错', () => {
    const r = buildBackfill(
      { date: '2026-10-01', title: '   ', exerciseIds: ['bb-squat'], selfReported: false },
      TODAY,
      idFactory,
    );
    expect(r.issue).toContain('名称');
  });
});

describe('AC-T19 · 更正日期与跨周解除关联', () => {
  it('同日不解除关联', () => {
    const s = session('s1', '2026-10-20', { occurrenceId: 'occ1' });
    const r = changeSessionDate(s, '2026-10-21', mondayOf, TODAY);
    expect(r.weekChanged).toBe(false);
    expect(r.clearedOccurrence).toBe(false);
    expect(r.session!.occurrenceId).toBe('occ1');
  });

  it('跨周解除关联并保留事实', () => {
    // 10-20 属 10-19 周，10-13 属 10-12 周，两者都是过去日期
    const s = session('s1', '2026-10-20', { occurrenceId: 'occ1' });
    const r = changeSessionDate(s, '2026-10-13', mondayOf, TODAY);
    expect(r.issue).toBeUndefined();
    expect(r.weekChanged).toBe(true);
    expect(r.clearedOccurrence).toBe(true);
    expect(r.session!.occurrenceId).toBeUndefined();
    expect(r.session!.goalCreditConfirmed).toBe(false);
    expect(r.session!.exercises).toHaveLength(1);
  });

  it('跨周但没有关联项目时不报解除', () => {
    const s = session('s1', '2026-10-20');
    const r = changeSessionDate(s, '2026-10-13', mondayOf, TODAY);
    expect(r.weekChanged).toBe(true);
    expect(r.clearedOccurrence).toBe(false);
  });

  it('不能改到未来', () => {
    const s = session('s1', '2026-10-20');
    const r = changeSessionDate(s, '2026-11-20', mondayOf, TODAY);
    expect(r.issue).toContain('未来');
  });

  it('同日改期保留本地时分', () => {
    const s = session('s1', '2026-10-20');
    const before = new Date(s.startedAt);
    const r = changeSessionDate(s, '2026-10-22', mondayOf, TODAY);
    const after = new Date(r.session!.startedAt);
    expect(r.session!.businessDate).toBe('2026-10-22');
    expect(after.getHours()).toBe(before.getHours());
    expect(after.getMinutes()).toBe(before.getMinutes());
  });
});

describe('AC-D05 · 墓碑删除与恢复', () => {
  it('删除后不在 liveSessions 里', () => {
    const s = session('s1', '2026-10-20');
    const deleted = tombstone(s);
    expect(isLive(deleted)).toBe(false);
    expect(liveSessions([s, deleted])).toHaveLength(1);
  });

  it('恢复后回到 liveSessions', () => {
    const s = session('s1', '2026-10-20');
    const restored = restoreTombstone(tombstone(s));
    expect(isLive(restored)).toBe(true);
  });

  it('墓碑保留原始数据', () => {
    const s = session('s1', '2026-10-20');
    const deleted = tombstone(s);
    expect(deleted.exercises).toEqual(s.exercises);
    expect(deleted.deletedAt).toBeTruthy();
  });
});

describe('AC-T19 · 单组更正', () => {
  it('更正重量与次数并记编辑时间', () => {
    const s = session('s1', '2026-10-20');
    const r = updateSet(s, 'bb-squat', 's_s1', { loadGrams: 110000, reps: 6 });
    const updated = r.session!.exercises[0]!.sets[0]!;
    expect(updated.loadGrams).toBe(110000);
    expect(updated.reps).toBe(6);
    expect(updated.editedAt).toBeTruthy();
  });

  it('非法次数被拒', () => {
    const s = session('s1', '2026-10-20');
    expect(updateSet(s, 'bb-squat', 's_s1', { reps: 0 }).issue).toContain('次数');
    expect(updateSet(s, 'bb-squat', 's_s1', { reps: 101 }).issue).toContain('次数');
  });

  it('负重量被拒', () => {
    const s = session('s1', '2026-10-20');
    expect(updateSet(s, 'bb-squat', 's_s1', { loadGrams: -1 }).issue).toContain('重量');
  });

  it('已删除的场次不能编辑', () => {
    const s = tombstone(session('s1', '2026-10-20'));
    expect(updateSet(s, 'bb-squat', 's_s1', { reps: 5 }).issue).toContain('恢复');
  });

  it('找不到动作或组时返回错误', () => {
    const s = session('s1', '2026-10-20');
    expect(updateSet(s, 'nope', 's_s1', { reps: 5 }).issue).toBeTruthy();
    expect(updateSet(s, 'bb-squat', 'nope', { reps: 5 }).issue).toBeTruthy();
  });
});

describe('AC-T17 · 未录组跳过', () => {
  it('pendingSetCount 统计 planned 组', () => {
    const s = session('s1', '2026-10-20', {
      sets: [set('a'), set('b', { status: 'planned', loadGrams: null, reps: null })],
    });
    expect(pendingSetCount(s)).toBe(1);
  });

  it('skipRemainingSets 把 planned 变 skipped', () => {
    const s = session('s1', '2026-10-20', {
      sets: [set('a'), set('b', { status: 'planned' }), set('c', { status: 'planned' })],
    });
    const next = skipRemainingSets(s);
    expect(pendingSetCount(next)).toBe(0);
    expect(next.exercises[0]!.sets.filter((x) => x.status === 'skipped')).toHaveLength(2);
  });
});

describe('补录不计算容量', () => {
  it('自报完成不计容量', () => {
    const s: Session = { ...session('s1', '2026-10-20'), completionBasis: 'selfReported' };
    expect(contributesToVolume(s)).toBe(false);
  });

  it('逐组记录计容量', () => {
    expect(contributesToVolume(session('s1', '2026-10-20'))).toBe(true);
  });
});

describe('AC-T19 · 负荷趋势', () => {
  it('按日期升序返回每次最大工作组', () => {
    const sessions = [
      session('s1', '2026-10-20', { sets: [set('a', { loadGrams: 100000 }), set('b', { loadGrams: 105000 })] }),
      session('s2', '2026-10-22', { sets: [set('c', { loadGrams: 110000 })] }),
    ];
    const trend = loadTrend(sessions, 'bb-squat');
    expect(trend).toHaveLength(2);
    expect(trend[0]!.value).toBe(105);
    expect(trend[1]!.value).toBe(110);
  });

  it('排除墓碑场次', () => {
    const sessions = [session('s1', '2026-10-20'), tombstone(session('s2', '2026-10-22'))];
    expect(loadTrend(sessions, 'bb-squat')).toHaveLength(1);
  });
});

describe('AC-T19 · 渐进建议', () => {
  it('所有组达上限时建议加配重', () => {
    const s = session('s1', '2026-10-20', {
      sets: [set('a', { reps: 10 }), set('b', { reps: 10 })],
    });
    const tip = suggestProgression([s], 'bb-squat', 6, 10, 2500, 'kg');
    expect(tip?.action).toBe('increase');
    expect(tip?.text).toContain('102.5');
  });

  it('首次低于下限建议保持', () => {
    const s = session('s1', '2026-10-20', { sets: [set('a', { reps: 4 })] });
    const tip = suggestProgression([s], 'bb-squat', 6, 10, 2500, 'kg');
    expect(tip?.action).toBe('hold');
  });

  it('连续两次低于下限建议减重', () => {
    const s1 = session('s1', '2026-10-18', { sets: [set('a', { reps: 4 })] });
    const s2 = session('s2', '2026-10-20', { sets: [set('b', { reps: 4 })] });
    const tip = suggestProgression([s1, s2], 'bb-squat', 6, 10, 2500, 'kg');
    expect(tip?.action).toBe('deload');
  });

  it('没有记录返回 null', () => {
    expect(suggestProgression([], 'bb-squat', 6, 10, 2500)).toBeNull();
  });
});
