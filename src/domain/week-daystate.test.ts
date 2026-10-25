/**
 * dayState / dayStatesForWeek 补充测试。
 *
 * 这两个函数驱动日历视图，优先级链很长
 * （done > in_progress > partial > missed > scheduled > excused > rest），
 * 现有 week.test.ts 未覆盖，这里按优先级逐级验证。
 */

import { describe, expect, it } from 'vitest';
import {
  computeWeek,
  dayState,
  dayStatesForWeek,
  statusLabel,
  targetNarrative,
  type PlannedOccurrence,
  type WeekGoal,
} from './week';
import type { Session, SetRecord } from './types';

const WEEK = '2026-10-19';
const TODAY = '2026-10-21'; // 周三，周内

function occ(
  id: string,
  day: number,
  disposition: PlannedOccurrence['disposition'] = 'scheduled',
  extra: Partial<PlannedOccurrence> = {},
): PlannedOccurrence {
  const date = `2026-10-${String(19 + day).padStart(2, '0')}`;
  return {
    id, planVersionId: 'v1', weekStart: WEEK, originalDate: date, scheduledDate: date,
    slotId: `slot-${day}`, title: '训练', exerciseIds: ['bb-squat'], disposition,
    ...extra,
  };
}

function workSet(id: string): SetRecord {
  return {
    id, kind: 'work', status: 'completed', loadGrams: 100000, reps: 5,
    durationSeconds: null, distanceMeters: null, rpe: null,
    completedAt: '2026-10-20T10:00:00.000Z',
  };
}

function session(
  id: string,
  day: number,
  opts: {
    occurrenceId?: string;
    credit?: boolean;
    status?: Session['status'];
    sets?: SetRecord[];
  } = {},
): Session {
  const date = `2026-10-${String(19 + day).padStart(2, '0')}`;
  return {
    id, templateId: null, dayId: null, title: '训练', status: opts.status ?? 'completed',
    startedAt: `${date}T10:00:00.000Z`, endedAt: `${date}T11:00:00.000Z`,
    businessDate: date, restEndsAt: null, note: '',
    ...(opts.occurrenceId ? { occurrenceId: opts.occurrenceId } : {}),
    ...(opts.credit !== undefined ? { goalCreditConfirmed: opts.credit } : {}),
    exercises: [{
      id: `se_${id}`, exerciseId: 'bb-squat', order: 0, targetSets: 3,
      repMin: 5, repMax: 8, restSeconds: 120, incrementGrams: 2500,
      sets: opts.sets ?? [workSet(`set_${id}`)],
    }],
  };
}

function goal(n: number, t: number): WeekGoal {
  return { id: `goal_${WEEK}`, weekStart: WEEK, originalPlannedCount: n, minimumTarget: t, adjustments: [] };
}

function resultFor(occurrences: PlannedOccurrence[], sessions: Session[], g: WeekGoal | null = null) {
  return computeWeek({ weekStart: WEEK, goal: g, occurrences, sessions, now: new Date(`${TODAY}T20:00:00`) });
}

describe('补充 · dayState 优先级链', () => {
  it('有有效完成 → done', () => {
    const occs = [occ('o1', 1)];
    const sessions = [session('s1', 1, { occurrenceId: 'o1', credit: true })];
    const r = resultFor(occs, sessions, goal(1, 1));
    const cell = dayState('2026-10-20', occs, sessions, r, TODAY);
    expect(cell.primary).toBe('done');
    expect(cell.doneCount).toBe(1);
  });

  it('有活跃会话 → in_progress', () => {
    const occs = [occ('o1', 1)];
    const sessions = [session('s1', 1, { status: 'active' })];
    const r = resultFor(occs, sessions, goal(1, 1));
    const cell = dayState('2026-10-20', occs, sessions, r, TODAY);
    expect(cell.primary).toBe('in_progress');
    expect(cell.inProgress).toBe(true);
  });

  it('有暂停会话 → in_progress', () => {
    const occs = [occ('o1', 1)];
    const sessions = [session('s1', 1, { status: 'paused' })];
    const r = resultFor(occs, sessions, goal(1, 1));
    expect(dayState('2026-10-20', occs, sessions, r, TODAY).primary).toBe('in_progress');
  });

  it('放弃的场次 → partial', () => {
    const occs = [occ('o1', 1)];
    const sessions = [session('s1', 1, { status: 'discarded' })];
    const r = resultFor(occs, sessions, goal(1, 1));
    expect(dayState('2026-10-20', occs, sessions, r, TODAY).primary).toBe('partial');
  });

  it('完成但无工作组 → partial', () => {
    const occs = [occ('o1', 1)];
    const sessions = [session('s1', 1, { sets: [] })];
    const r = resultFor(occs, sessions, goal(1, 1));
    expect(dayState('2026-10-20', occs, sessions, r, TODAY).primary).toBe('partial');
  });

  it('有跳过组的已完成场次 → partial', () => {
    const occs = [occ('o1', 1)];
    const sessions = [
      session('s1', 1, { occurrenceId: 'o1', credit: true }),
      session('s2', 1, { sets: [workSet('a'), { ...workSet('b'), status: 'skipped' }] }),
    ];
    const r = resultFor(occs, sessions, goal(1, 1));
    // 注意：s2 也是有效完成（有 completed work set），所以是 done
    expect(dayState('2026-10-20', occs, sessions, r, TODAY).primary).toBe('done');
  });

  it('过去日期未完成 → missed', () => {
    const occs = [occ('o1', 0)];
    const r = resultFor(occs, [], goal(1, 1));
    const cell = dayState('2026-10-19', occs, [], r, TODAY);
    expect(cell.primary).toBe('missed');
  });

  it('未来日期未完成 → scheduled', () => {
    const occs = [occ('o1', 5)];
    const r = resultFor(occs, [], goal(1, 1));
    const cell = dayState('2026-10-24', occs, [], r, TODAY);
    expect(cell.primary).toBe('scheduled');
    expect(cell.openCount).toBe(1);
  });

  it('豁免项且无其他 → excused', () => {
    const occs = [occ('o1', 0, 'excused')];
    const r = resultFor(occs, [], goal(0, 0));
    const cell = dayState('2026-10-19', occs, [], r, TODAY);
    expect(cell.primary).toBe('excused');
    expect(cell.excusedCount).toBe(1);
  });

  it('无项目无会话 → rest', () => {
    const r = resultFor([], []);
    const cell = dayState('2026-10-19', [], [], r, TODAY);
    expect(cell.primary).toBe('rest');
    expect(cell.doneCount).toBe(0);
    expect(cell.openCount).toBe(0);
  });

  it('取消项不算 rest 也不算 excused', () => {
    const occs = [occ('o1', 0, 'cancelled')];
    const r = resultFor(occs, [], goal(0, 0));
    expect(dayState('2026-10-19', occs, [], r, TODAY).primary).toBe('rest');
  });

  it('done 优先于 in_progress（同一天既有完成又有进行中）', () => {
    const occs = [occ('o1', 1)];
    const sessions = [
      session('s1', 1, { occurrenceId: 'o1', credit: true }),
      session('s2', 1, { status: 'active' }),
    ];
    const r = resultFor(occs, sessions, goal(1, 1));
    expect(dayState('2026-10-20', occs, sessions, r, TODAY).primary).toBe('done');
  });

  it('in_progress 优先于 partial', () => {
    const occs = [occ('o1', 1)];
    const sessions = [
      session('s1', 1, { status: 'active' }),
      session('s2', 1, { status: 'discarded' }),
    ];
    const r = resultFor(occs, sessions, goal(1, 1));
    expect(dayState('2026-10-20', occs, sessions, r, TODAY).primary).toBe('in_progress');
  });
});

describe('补充 · dayState 计数与备注', () => {
  it('doneCount 取有效场次与已满足项目的较大值', () => {
    const occs = [occ('o1', 1), occ('o2', 1)];
    const sessions = [
      session('s1', 1, { occurrenceId: 'o1', credit: true }),
      session('s2', 1, { occurrenceId: 'o2', credit: true }),
    ];
    const r = resultFor(occs, sessions, goal(2, 2));
    expect(dayState('2026-10-20', occs, sessions, r, TODAY).doneCount).toBe(2);
  });

  it('openCount 只统计未满足的 scheduled', () => {
    const occs = [occ('o1', 1), occ('o2', 1)];
    const sessions = [session('s1', 1, { occurrenceId: 'o1', credit: true })];
    const r = resultFor(occs, sessions, goal(2, 2));
    expect(dayState('2026-10-20', occs, sessions, r, TODAY).openCount).toBe(1);
  });

  it('movedCount 统计顺延过的项目', () => {
    const moved = { ...occ('o1', 2), scheduledDate: '2026-10-23' };
    const occs = [moved];
    const r = resultFor(occs, [], goal(1, 1));
    const cell = dayState('2026-10-23', occs, [], r, TODAY);
    expect(cell.movedCount).toBe(1);
  });

  it('未顺延时 movedCount 为 0', () => {
    const occs = [occ('o1', 2)];
    const r = resultFor(occs, [], goal(1, 1));
    expect(dayState('2026-10-21', occs, [], r, TODAY).movedCount).toBe(0);
  });

  it('完成但有漏项时给出 missedNote', () => {
    const occs = [occ('o1', 1), occ('o2', 1)];
    const sessions = [session('s1', 1, { occurrenceId: 'o1', credit: true })];
    const r = resultFor(occs, sessions, goal(2, 2));
    // o2 在 10-20 且未满足，日期 10-20 < TODAY 10-21 → missed
    const cell = dayState('2026-10-20', occs, sessions, r, TODAY);
    // s1 已完成 → primary done，同时有漏项
    expect(cell.primary).toBe('done');
    expect(cell.missedNote).toContain('另有');
  });

  it('无漏项时 missedNote 为 null', () => {
    const occs = [occ('o1', 1)];
    const sessions = [session('s1', 1, { occurrenceId: 'o1', credit: true })];
    const r = resultFor(occs, sessions, goal(1, 1));
    expect(dayState('2026-10-20', occs, sessions, r, TODAY).missedNote).toBeNull();
  });
});

describe('补充 · dayStatesForWeek', () => {
  it('固定返回 7 天', () => {
    const r = resultFor([occ('o1', 0)], [], goal(1, 1));
    expect(dayStatesForWeek(WEEK, [occ('o1', 0)], [], r, TODAY)).toHaveLength(7);
  });

  it('日期从周一连续到周日', () => {
    const r = resultFor([], []);
    const cells = dayStatesForWeek(WEEK, [], [], r, TODAY);
    expect(cells.map((c) => c.date)).toEqual([
      '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22',
      '2026-10-23', '2026-10-24', '2026-10-25',
    ]);
  });

  it('跨月周也连续', () => {
    const r = resultFor([], []);
    const cells = dayStatesForWeek('2026-10-26', [], [], r, '2026-10-28');
    expect(cells[0]!.date).toBe('2026-10-26');
    expect(cells[6]!.date).toBe('2026-11-01');
  });
});

describe('补充 · statusLabel 与 targetNarrative', () => {
  it('全部状态有中文标签', () => {
    expect(statusLabel('achieved')).toBe('已达标');
    expect(statusLabel('notAchieved')).toBe('未达标');
    expect(statusLabel('ongoing')).toBe('进行中');
    expect(statusLabel('paused')).toBe('休整周');
    expect(statusLabel('upcoming')).toBe('未开始');
    expect(statusLabel('unplanned')).toBe('无计划');
  });

  it('无计划时的叙述', () => {
    const r = resultFor([], [], null);
    expect(targetNarrative(r)).toBe('本周没有设定计划');
  });

  it('未调整时只显示原始数', () => {
    const occs = [occ('o1', 0), occ('o2', 1)];
    const r = resultFor(occs, [], goal(2, 2));
    expect(targetNarrative(r)).toBe('原始 2 项 · 最低目标 2 项');
  });

  it('调整后显示前后对比', () => {
    const occs = [occ('o1', 0), occ('o2', 1, 'excused')];
    const r = resultFor(occs, [], goal(2, 2));
    expect(targetNarrative(r)).toContain('→');
    expect(targetNarrative(r)).toContain('调整后 1 项');
  });
});
