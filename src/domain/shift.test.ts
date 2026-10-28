import { describe, expect, it } from 'vitest';
import { applyShift, previewShift } from './shift';
import type { Session } from './types';
import type { PlannedOccurrence, WeekGoal } from './week';

const WEEK = '2026-10-26'; // 周一，周日 = 2026-11-01

/** 造一个"已完成"的关联会话：shift 不能移动它。 */
function doneSession(occId: string): Session {
  return {
    id: `s_${occId}`,
    occurrenceId: occId,
    status: 'completed',
    exercises: [{ sets: [{ kind: 'work', status: 'completed' }] }],
  } as unknown as Session;
}

function occ(
  id: string,
  date: string,
  weekStart = WEEK,
  disposition: PlannedOccurrence['disposition'] = 'scheduled',
): PlannedOccurrence {
  return {
    id,
    planVersionId: 'pv1',
    weekStart,
    originalDate: date,
    scheduledDate: date,
    slotId: 'slot1',
    title: `训练 ${id}`,
    exerciseIds: [],
    disposition,
  };
}

function goal(weekStart = WEEK, count = 3): WeekGoal {
  return {
    id: `g_${weekStart}`,
    weekStart,
    originalPlannedCount: count,
    minimumTarget: count,
    adjustments: [],
  };
}

const run = (occurrences: PlannedOccurrence[], opts: Partial<Parameters<typeof applyShift>[0]> = {}) =>
  applyShift({
    occurrences,
    goals: [goal()],
    weekStart: WEEK,
    scope: 'day',
    date: '2026-10-26',
    strategy: 'drop',
    recordedAt: '2026-10-27T00:00:00.000Z',
    idFactory: (p) => `${p}_1`,
    ...opts,
  });

describe('previewShift', () => {
  it('day：次日空着时只移一天', () => {
    const p = previewShift([occ('a', '2026-10-26')], WEEK, 'day', '2026-10-26');
    expect(p.moving.map((o) => o.id)).toEqual(['a']);
    expect(p.overflow).toHaveLength(0);
  });

  it('day：连续占用时链式级联', () => {
    const list = [occ('a', '2026-10-26'), occ('b', '2026-10-27'), occ('c', '2026-10-28')];
    const p = previewShift(list, WEEK, 'day', '2026-10-26');
    expect(p.moving.map((o) => o.id).sort()).toEqual(['a', 'b', 'c']);
    expect(p.cascaded).toBe(2);
  });

  it('day：中间有空洞就停在空洞前（不无脑推整周）', () => {
    const list = [occ('a', '2026-10-26'), occ('b', '2026-10-28')];
    const p = previewShift(list, WEEK, 'day', '2026-10-26');
    expect(p.moving.map((o) => o.id)).toEqual(['a']);
  });

  it('tail：从这一天起全部后移', () => {
    const list = [occ('a', '2026-10-25', '2026-10-19'), occ('b', '2026-10-26'), occ('c', '2026-10-28')];
    const p = previewShift(list, WEEK, 'tail', '2026-10-26');
    expect(p.moving.map((o) => o.id).sort()).toEqual(['b', 'c']);
  });

  it('没有可移动项时给出错误', () => {
    const p = previewShift([occ('a', '2026-10-27')], WEEK, 'day', '2026-10-26');
    expect(p.error).toBeTruthy();
  });

  it('已豁免/取消的项不参与后移', () => {
    const list = [occ('a', '2026-10-26'), occ('b', '2026-10-26', WEEK, 'excused')];
    const p = previewShift(list, WEEK, 'day', '2026-10-26');
    expect(p.moving.map((o) => o.id)).toEqual(['a']);
  });
});

describe('applyShift', () => {
  it('day：无冲突时整体 +1 天', () => {
    const r = run([occ('a', '2026-10-26')]);
    expect(r.occurrences[0]!.scheduledDate).toBe('2026-10-27');
    expect(r.dropped).toBe(0);
  });

  it('day：级联后每项各 +1 天，顺序不乱', () => {
    const r = run([occ('a', '2026-10-26'), occ('b', '2026-10-27'), occ('c', '2026-10-28')]);
    const byId = Object.fromEntries(r.occurrences.map((o) => [o.id, o.scheduledDate]));
    expect(byId).toEqual({ a: '2026-10-27', b: '2026-10-28', c: '2026-10-29' });
  });

  it('跨周 drop：超出周日的项被取消，最低目标压缩并留审计', () => {
    const r = run([occ('a', '2026-10-31'), occ('b', '2026-11-01')], {
      scope: 'tail',
      date: '2026-10-31',
      strategy: 'drop',
      goals: [goal(WEEK, 2)],
    });
    const b = r.occurrences.find((o) => o.id === 'b')!;
    expect(b.disposition).toBe('cancelled');
    expect(b.dispositionReason).toContain('减少一天');
    expect(r.dropped).toBe(1);
    expect(r.goals[0]!.minimumTarget).toBe(1);
    expect(r.goals[0]!.adjustments.at(-1)?.reason).toContain('后移超出本周');
  });

  it('跨周 next-week：同星期几优先，周次改成下周', () => {
    const r = run([occ('a', '2026-11-01')], {
      date: '2026-11-01',
      strategy: 'next-week',
      goals: [goal(WEEK, 1)],
    });
    const a = r.occurrences[0]!;
    expect(a.weekStart).toBe('2026-11-02');
    expect(a.scheduledDate).toBe('2026-11-08');
    expect(r.toNextWeek).toBe(1);
    expect(r.goals.find((g) => g.weekStart === '2026-11-02')).toBeTruthy();
  });

  it('跨周 next-week：下周同日被占则找第一个空位', () => {
    const r = run(
      [occ('a', '2026-11-01'), occ('taken', '2026-11-08', '2026-11-02')],
      { date: '2026-11-01', strategy: 'next-week', goals: [goal(WEEK, 1)] },
    );
    const a = r.occurrences.find((o) => o.id === 'a')!;
    expect(a.scheduledDate).toBe('2026-11-02');
  });

  it('没有可移动项时原样返回并报错', () => {
    const r = run([occ('a', '2026-10-27')], { date: '2026-10-26' });
    expect(r.error).toBeTruthy();
    expect(r.moved).toBe(0);
  });

  it('已完成项目不参与后移：原周完成数不会被改写', () => {
    const list = [occ('done', '2026-10-26'), occ('b', '2026-10-27')];
    const r = run(list, {
      scope: 'tail',
      date: '2026-10-26',
      sessions: [doneSession('done')],
      goals: [goal(WEEK, 2)],
    });
    const byId = Object.fromEntries(r.occurrences.map((o) => [o.id, o.scheduledDate]));
    expect(byId.done).toBe('2026-10-26');
    expect(byId.b).toBe('2026-10-28');
    expect(r.locked).toBe(1);
  });

  it('整天的安排都已完成时拒绝后移，并说明原因', () => {
    const r = run([occ('done', '2026-10-26')], {
      date: '2026-10-26',
      sessions: [doneSession('done')],
    });
    expect(r.error).toContain('已完成');
    expect(r.moved).toBe(0);
  });
});
