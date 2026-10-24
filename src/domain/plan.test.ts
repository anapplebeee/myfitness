import { describe, expect, it } from 'vitest';
import {
  buildOccurrences,
  changeMinimumTarget,
  ensureOccurrences,
  ensureWeekGoals,
  mondayOf,
  openOccurrencesForWeek,
  runOccurrenceCommand,
  switchTemplate,
} from './plan';
import type { PlannedOccurrence, WeekGoal } from './week';
import type { Template } from '../content/types';
import type { Session, SetRecord } from './types';

const TODAY = '2026-10-21'; // 周三
const WEEK = '2026-10-19';

let seq = 0;
const idFactory = (p: string) => `${p}_${(seq += 1)}`;

function template(id: string, days = 3, version = 1): Template {
  return {
    id,
    title: `模板 ${id}`,
    subtitle: '',
    daysPerWeek: days,
    level: 'beginner',
    equipment: 'gym',
    version,
    progression: '',
    days: Array.from({ length: days }, (_, i) => ({
      id: `${id}-d${i}`,
      title: `第 ${i + 1} 天`,
      slot: i * 2,
      exercises: [
        { exerciseId: 'bb-squat', sets: 3, repMin: 5, repMax: 8, restSeconds: 120, incrementGrams: 2500 },
      ],
    })),
  };
}

function workSet(id: string): SetRecord {
  return {
    id,
    kind: 'work',
    status: 'completed',
    loadGrams: 100000,
    reps: 5,
    durationSeconds: null,
    distanceMeters: null,
    rpe: null,
    completedAt: '2026-10-19T10:00:00.000Z',
  };
}

function session(id: string, date: string, occurrenceId?: string): Session {
  return {
    id,
    templateId: null,
    dayId: null,
    title: '训练',
    status: 'completed',
    startedAt: `${date}T10:00:00.000Z`,
    endedAt: `${date}T11:00:00.000Z`,
    businessDate: date,
    restEndsAt: null,
    note: '',
    ...(occurrenceId ? { occurrenceId, goalCreditConfirmed: true } : {}),
    exercises: [
      {
        id: `se_${id}`,
        exerciseId: 'bb-squat',
        order: 0,
        targetSets: 3,
        repMin: 5,
        repMax: 8,
        restSeconds: 120,
        incrementGrams: 2500,
        sets: [workSet(`set_${id}`)],
      },
    ],
  };
}

describe('mondayOf', () => {
  it('任意日期归到周一', () => {
    expect(mondayOf('2026-10-21')).toBe('2026-10-19');
    expect(mondayOf('2026-10-19')).toBe('2026-10-19');
    expect(mondayOf('2026-10-25')).toBe('2026-10-19');
  });
});

describe('AC-T01 · 发生项生成', () => {
  it('每周每 slot 生成唯一项目，slotId 含模板与训练日', () => {
    const list = buildOccurrences({
      template: template('t1', 3),
      fromWeekStart: WEEK,
      weeks: 2,
      today: WEEK,
      idFactory,
    });
    expect(list).toHaveLength(6);
    const keys = list.map((o) => `${o.weekStart}|${o.slotId}`);
    expect(new Set(keys).size).toBe(6);
    expect(list[0]!.planVersionId).toBe('t1@v1');
  });

  it('不生成早于 today 的安排（历史空白不自动补）', () => {
    const list = buildOccurrences({
      template: template('t1', 3),
      fromWeekStart: WEEK,
      weeks: 1,
      today: '2026-10-22',
      idFactory,
    });
    // slot 0=周一、2=周三、4=周五；周四为 today，只有周五可生成
    expect(list).toHaveLength(1);
    expect(list[0]!.scheduledDate).toBe('2026-10-23');
  });
});

describe('AC-T01 · 发生项幂等补齐', () => {
  it('重复调用不新增项目', () => {
    const opts = { template: template('t1'), fromWeekStart: WEEK, weeks: 2, today: WEEK, idFactory };
    const first = ensureOccurrences([], opts);
    const second = ensureOccurrences(first, opts);
    expect(second).toHaveLength(first.length);
  });
});

describe('ensureWeekGoals', () => {
  it('每个有项目的周生成唯一目标，重复调用不重复', () => {
    const occ = buildOccurrences({
      template: template('t1'),
      fromWeekStart: WEEK,
      weeks: 2,
      today: WEEK,
      idFactory,
    });
    const g1 = ensureWeekGoals([], occ);
    expect(g1).toHaveLength(2);
    const g2 = ensureWeekGoals(g1, occ);
    expect(g2).toHaveLength(2);
  });

  it('原始计划数等于该周项目数', () => {
    const occ = buildOccurrences({
      template: template('t1', 4),
      fromWeekStart: WEEK,
      weeks: 1,
      today: WEEK,
      idFactory,
    });
    const goals = ensureWeekGoals([], occ);
    expect(goals[0]!.originalPlannedCount).toBe(4);
    expect(goals[0]!.minimumTarget).toBe(4);
  });
});

describe('AC-W05 · 计划命令与约束', () => {
  function setup(): { occ: PlannedOccurrence[]; goals: WeekGoal[] } {
    const occ = buildOccurrences({
      template: template('t1', 3),
      fromWeekStart: WEEK,
      weeks: 1,
      today: WEEK,
      idFactory,
    });
    return { occ, goals: ensureWeekGoals([], occ) };
  }

  it('豁免从 A 排除并重算 K，原 N 不变', () => {
    const { occ, goals } = setup();
    const target = occ.find((o) => o.scheduledDate === '2026-10-19')!;
    const r = runOccurrenceCommand({
      command: { kind: 'excuse', id: target.id, reason: '生病' },
      occurrences: occ,
      goals,
      sessions: [],
      recordedAt: '2026-10-21T10:00:00Z',
      idFactory,
    });
    expect(r.error).toBeUndefined();
    const updated = r.goals.find((g) => g.weekStart === WEEK)!;
    expect(updated.originalPlannedCount).toBe(3);
    expect(updated.minimumTarget).toBe(2);
    expect(r.occurrences.find((o) => o.id === target.id)!.disposition).toBe('excused');
  });

  it('取消记原因', () => {
    const { occ, goals } = setup();
    const target = occ[0]!;
    const r = runOccurrenceCommand({
      command: { kind: 'cancel', id: target.id, reason: '主动取消' },
      occurrences: occ,
      goals,
      sessions: [],
      recordedAt: '2026-10-21T10:00:00Z',
      idFactory,
    });
    const upd = r.occurrences.find((o) => o.id === target.id)!;
    expect(upd.disposition).toBe('cancelled');
    expect(upd.dispositionReason).toBe('主动取消');
  });

  it('恢复后重新计入', () => {
    const { occ, goals } = setup();
    const target = occ[0]!;
    const excused = runOccurrenceCommand({
      command: { kind: 'excuse', id: target.id, reason: '出差' },
      occurrences: occ,
      goals,
      sessions: [],
      recordedAt: '2026-10-21T10:00:00Z',
      idFactory,
    });
    const restored = runOccurrenceCommand({
      command: { kind: 'restore', id: target.id },
      occurrences: excused.occurrences,
      goals: excused.goals,
      sessions: [],
      recordedAt: '2026-10-21T11:00:00Z',
      idFactory,
    });
    expect(restored.occurrences.find((o) => o.id === target.id)!.disposition).toBe('scheduled');
  });

  it('顺延跨周被拒绝', () => {
    const { occ, goals } = setup();
    const target = occ[0]!;
    const r = runOccurrenceCommand({
      command: { kind: 'postpone', id: target.id, date: '2026-10-27' },
      occurrences: occ,
      goals,
      sessions: [],
      recordedAt: '2026-10-21T10:00:00Z',
      idFactory,
    });
    expect(r.error).toContain('同一周');
  });

  it('有未结束会话时禁止改动', () => {
    const { occ, goals } = setup();
    const target = occ[0]!;
    const live: Session = { ...session('s1', '2026-10-19', target.id), status: 'active' };
    const r = runOccurrenceCommand({
      command: { kind: 'excuse', id: target.id, reason: '生病' },
      occurrences: occ,
      goals,
      sessions: [live],
      recordedAt: '2026-10-21T10:00:00Z',
      idFactory,
    });
    expect(r.error).toContain('还没结束');
  });
});

describe('AC-T02 · 换模板只影响未来', () => {
  it('取消未来项目并建立新项目，原 N 不变，记调整', () => {
    const occ = buildOccurrences({
      template: template('t1', 3),
      fromWeekStart: WEEK,
      weeks: 1,
      today: WEEK,
      idFactory,
    });
    const goals = ensureWeekGoals([], occ);
    const r = switchTemplate({
      occurrences: occ,
      goals,
      next: template('t2', 2),
      effectiveFrom: TODAY,
      sessions: [],
      idFactory,
      recordedAt: '2026-10-21T10:00:00Z',
    });
    const wGoal = r.goals.find((g) => g.weekStart === WEEK)!;
    expect(wGoal.originalPlannedCount).toBe(3);
    expect(wGoal.adjustments.length).toBeGreaterThan(0);
    expect(wGoal.adjustments.at(-1)!.reason).toBe('换模板');
  });

  it('已完成的项不被取消', () => {
    const occ = buildOccurrences({
      template: template('t1', 3),
      fromWeekStart: WEEK,
      weeks: 1,
      today: WEEK,
      idFactory,
    });
    const goals = ensureWeekGoals([], occ);
    const done = occ[0]!;
    const r = switchTemplate({
      occurrences: occ,
      goals,
      next: template('t2', 2),
      effectiveFrom: TODAY,
      sessions: [session('s1', '2026-10-19', done.id)],
      idFactory,
      recordedAt: '2026-10-21T10:00:00Z',
    });
    expect(r.occurrences.find((o) => o.id === done.id)!.disposition).toBe('scheduled');
  });
});

describe('changeMinimumTarget', () => {
  it('记录前后值与原因', () => {
    const occ = buildOccurrences({
      template: template('t1', 4),
      fromWeekStart: WEEK,
      weeks: 1,
      today: WEEK,
      idFactory,
    });
    const goals = ensureWeekGoals([], occ);
    const r = changeMinimumTarget({
      goals,
      occurrences: occ,
      weekStart: WEEK,
      next: 2,
      reason: '这周出差',
      recordedAt: '2026-10-21T10:00:00Z',
      idFactory,
    });
    const g = r.goals[0]!;
    expect(g.minimumTarget).toBe(2);
    expect(g.adjustments.at(-1)!.beforeMinimum).toBe(4);
    expect(g.adjustments.at(-1)!.afterMinimum).toBe(2);
    expect(g.adjustments.at(-1)!.reason).toBe('这周出差');
  });

  it('超过可执行数被拒绝', () => {
    const occ = buildOccurrences({
      template: template('t1', 2),
      fromWeekStart: WEEK,
      weeks: 1,
      today: WEEK,
      idFactory,
    });
    const goals = ensureWeekGoals([], occ);
    const r = changeMinimumTarget({
      goals,
      occurrences: occ,
      weekStart: WEEK,
      next: 5,
      reason: '试试',
      recordedAt: '2026-10-21T10:00:00Z',
      idFactory,
    });
    expect(r.error).toBeTruthy();
  });
});

describe('openOccurrencesForWeek', () => {
  it('排除已满足与已豁免取消的项目', () => {
    const occ = buildOccurrences({
      template: template('t1', 3),
      fromWeekStart: WEEK,
      weeks: 1,
      today: WEEK,
      idFactory,
    });
    occ[1]!.disposition = 'excused';
    const open = openOccurrencesForWeek(occ, WEEK, [occ[0]!.id]);
    expect(open).toHaveLength(1);
    expect(open[0]!.id).toBe(occ[2]!.id);
  });
});
