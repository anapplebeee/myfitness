/**
 * plan.ts 补充测试：预建幂等、换模板边界、命令校验。
 *
 * 现有 plan.test.ts 已覆盖主路径；这里补齐：
 * - ensureOccurrences / ensureWeekGoals 的幂等与去重键
 * - switchTemplate 对已开始会话、历史周的保留
 * - runOccurrenceCommand 的活跃会话拦截与跨周顺延
 * - changeMinimumTarget 的错误分支
 * - openOccurrencesForWeek 的过滤口径
 */

import { describe, expect, it } from 'vitest';
import {
  PREDEFINED_WEEKS,
  buildOccurrences,
  changeMinimumTarget,
  ensureOccurrences,
  ensureWeekGoals,
  mondayOf,
  openOccurrencesForWeek,
  runOccurrenceCommand,
  switchTemplate,
  type BuildOptions,
} from './plan';
import { initialWeekGoal, type PlannedOccurrence, type WeekGoal } from './week';
import type { Session } from './types';
import { TEMPLATE_BY_ID, TEMPLATES } from '../content/exercises';

let n = 0;
const idFactory = (p: string) => `${p}_${++n}`;

const WEEK = '2026-10-19'; // 周一

function occ(
  id: string,
  day: number,
  disposition: PlannedOccurrence['disposition'] = 'scheduled',
  extra: Partial<PlannedOccurrence> = {},
): PlannedOccurrence {
  const date = `2026-10-${String(19 + day).padStart(2, '0')}`;
  return {
    id,
    planVersionId: 'v1',
    weekStart: WEEK,
    originalDate: date,
    scheduledDate: date,
    slotId: `slot-${day}`,
    title: '训练',
    exerciseIds: ['bb-squat'],
    disposition,
    ...extra,
  };
}

function goal(weekStart: string, n: number, t: number): WeekGoal {
  return { id: `goal_${weekStart}`, weekStart, originalPlannedCount: n, minimumTarget: t, adjustments: [] };
}

function session(id: string, occurrenceId: string, status: Session['status'] = 'completed'): Session {
  return {
    id, templateId: null, dayId: null, title: '训练', status,
    startedAt: '2026-10-19T10:00:00.000Z', endedAt: '2026-10-19T11:00:00.000Z',
    businessDate: '2026-10-19', restEndsAt: null, note: '',
    occurrenceId,
    exercises: [],
  };
}

const template = TEMPLATES[0]!;

describe('补充 · mondayOf 与 todayString', () => {
  it('mondayOf 与 week.ts 口径一致', () => {
    expect(mondayOf('2026-10-19')).toBe('2026-10-19');
    expect(mondayOf('2026-10-25')).toBe('2026-10-19');
    expect(mondayOf('2026-10-26')).toBe('2026-10-26');
  });
  it('mondayOf 跨月周日', () => {
    expect(mondayOf('2026-11-01')).toBe('2026-10-26');
  });
});

describe('补充 · buildOccurrences', () => {
  const opts = (today: string): BuildOptions => ({
    template, fromWeekStart: WEEK, weeks: PREDEFINED_WEEKS, today, idFactory,
  });

  it('预建周数是 4', () => {
    expect(PREDEFINED_WEEKS).toBe(4);
  });

  it('不生成今天以前的安排', () => {
    const out = buildOccurrences(opts('2026-10-20'));
    expect(out.every((o) => o.scheduledDate >= '2026-10-20')).toBe(true);
  });

  it('today 之后全部 4 周都有安排', () => {
    const out = buildOccurrences(opts(WEEK));
    const weeks = new Set(out.map((o) => o.weekStart));
    expect(weeks.size).toBe(4);
  });

  it('每周每 slot 唯一', () => {
    const out = buildOccurrences(opts(WEEK));
    const keys = out.map((o) => `${o.weekStart}|${o.slotId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('planVersionId 带模板版本', () => {
    const out = buildOccurrences(opts(WEEK));
    expect(out[0]!.planVersionId).toBe(`${template.id}@v${template.version}`);
  });

  it('weekStart 与 scheduledDate 同周', () => {
    const out = buildOccurrences(opts(WEEK));
    for (const o of out) {
      expect(o.scheduledDate >= o.weekStart).toBe(true);
      // 同周内：不超过 weekStart+6 天
      const start = new Date(`${o.weekStart}T12:00:00`);
      start.setDate(start.getDate() + 6);
      expect(o.scheduledDate <= start.toISOString().slice(0, 10)).toBe(true);
    }
  });
});

describe('补充 · ensureOccurrences 幂等', () => {
  const opts: BuildOptions = { template, fromWeekStart: WEEK, weeks: 2, today: WEEK, idFactory };

  it('空集合 → 生成全部', () => {
    const out = ensureOccurrences([], opts);
    expect(out.length).toBe(buildOccurrences(opts).length);
  });

  it('重复调用不增加数量', () => {
    const first = ensureOccurrences([], opts);
    const second = ensureOccurrences(first, opts);
    expect(second.length).toBe(first.length);
    expect(second).toEqual(first);
  });

  it('不同 planVersionId 视为不同 key，不互相去重', () => {
    const existing: PlannedOccurrence[] = [{
      id: 'old1', planVersionId: 'other@v1', weekStart: WEEK, originalDate: '2026-10-19',
      scheduledDate: '2026-10-19', slotId: template.days[0]!.id, title: 't',
      exerciseIds: [], disposition: 'scheduled',
    }];
    const out = ensureOccurrences(existing, opts);
    expect(out.length).toBe(existing.length + buildOccurrences(opts).length);
  });

  it('保留已取消/豁免的既有项', () => {
    const existing = [occ('x1', 0, 'excused')];
    const out = ensureOccurrences(existing, opts);
    expect(out.find((o) => o.id === 'x1')?.disposition).toBe('excused');
  });

  it('原数组不被修改', () => {
    const existing: PlannedOccurrence[] = [];
    ensureOccurrences(existing, opts);
    expect(existing).toHaveLength(0);
  });
});

describe('补充 · ensureWeekGoals', () => {
  it('为每个有项目的周建目标', () => {
    const occs = [occ('a', 0), occ('b', 1), { ...occ('c', 0), weekStart: '2026-10-26' }];
    const goals = ensureWeekGoals([], occs);
    expect(goals.map((g) => g.weekStart)).toEqual([WEEK, '2026-10-26']);
    expect(goals[0]!.originalPlannedCount).toBe(2);
    expect(goals[0]!.minimumTarget).toBe(2);
  });

  it('已有目标不被覆盖', () => {
    const existing = [goal(WEEK, 5, 2)];
    const goals = ensureWeekGoals(existing, [occ('a', 0), occ('b', 1)]);
    expect(goals).toHaveLength(1);
    expect(goals[0]!.originalPlannedCount).toBe(5);
    expect(goals[0]!.minimumTarget).toBe(2);
  });

  it('按 weekStart 升序输出', () => {
    const occs = [
      { ...occ('a', 0), weekStart: '2026-11-02' },
      { ...occ('b', 0), weekStart: WEEK },
      { ...occ('c', 0), weekStart: '2026-10-26' },
    ];
    expect(ensureWeekGoals([], occs).map((g) => g.weekStart)).toEqual([WEEK, '2026-10-26', '2026-11-02']);
  });

  it('与 initialWeekGoal 结果一致', () => {
    const occs = [occ('a', 0), occ('b', 1, 'excused')];
    expect(ensureWeekGoals([], occs)[0]).toEqual(initialWeekGoal(WEEK, occs));
  });
});

describe('补充 · runOccurrenceCommand', () => {
  const base = {
    occurrences: [occ('o1', 0), occ('o2', 1)],
    goals: [goal(WEEK, 2, 2)],
    sessions: [] as Session[],
    recordedAt: '2026-10-19T10:00:00.000Z',
    idFactory,
  };

  it('找不到项目返回错误且不改状态', () => {
    const r = runOccurrenceCommand({ ...base, command: { kind: 'excuse', id: 'nope', reason: '生病' } });
    expect(r.error).toBe('找不到这项安排');
    expect(r.occurrences).toBe(base.occurrences);
    expect(r.goals).toBe(base.goals);
  });

  it('有活跃会话时拒绝任何改动', () => {
    for (const status of ['active', 'paused'] as const) {
      const r = runOccurrenceCommand({
        ...base,
        sessions: [session('s1', 'o1', status)],
        command: { kind: 'excuse', id: 'o1', reason: '生病' },
      });
      expect(r.error).toContain('还没结束');
      expect(r.occurrences.find((o) => o.id === 'o1')?.disposition).toBe('scheduled');
    }
  });

  it('已完成的会话不阻止豁免', () => {
    const r = runOccurrenceCommand({
      ...base,
      sessions: [session('s1', 'o1')],
      command: { kind: 'excuse', id: 'o1', reason: '生病' },
    });
    expect(r.error).toBeUndefined();
    expect(r.occurrences.find((o) => o.id === 'o1')?.disposition).toBe('excused');
  });

  it('豁免写入原因与时间', () => {
    const r = runOccurrenceCommand({ ...base, command: { kind: 'excuse', id: 'o1', reason: '出差' } });
    const o = r.occurrences.find((x) => x.id === 'o1')!;
    expect(o.dispositionReason).toBe('出差');
    expect(o.disposedAt).toBe(base.recordedAt);
  });

  it('取消写入原因与时间', () => {
    const r = runOccurrenceCommand({ ...base, command: { kind: 'cancel', id: 'o2', reason: '换模板' } });
    const o = r.occurrences.find((x) => x.id === 'o2')!;
    expect(o.disposition).toBe('cancelled');
    expect(o.dispositionReason).toBe('换模板');
  });

  it('恢复为 scheduled 并清空原因', () => {
    const start = { ...base, occurrences: [occ('o1', 0, 'excused', { dispositionReason: '生病' }), occ('o2', 1)] };
    const r = runOccurrenceCommand({ ...start, command: { kind: 'restore', id: 'o1' } });
    const o = r.occurrences.find((x) => x.id === 'o1')!;
    expect(o.disposition).toBe('scheduled');
    expect(o.dispositionReason).toBeUndefined();
  });

  it('顺延限同周内', () => {
    const r = runOccurrenceCommand({ ...base, command: { kind: 'postpone', id: 'o1', date: '2026-10-22' } });
    expect(r.error).toBeUndefined();
    expect(r.occurrences.find((o) => o.id === 'o1')?.scheduledDate).toBe('2026-10-22');
  });

  it('顺延跨周被拒', () => {
    const r = runOccurrenceCommand({ ...base, command: { kind: 'postpone', id: 'o1', date: '2026-10-26' } });
    expect(r.error).toContain('同一周内');
  });

  it('顺延保留 originalDate', () => {
    const r = runOccurrenceCommand({ ...base, command: { kind: 'postpone', id: 'o1', date: '2026-10-24' } });
    const o = r.occurrences.find((x) => x.id === 'o1')!;
    expect(o.originalDate).toBe('2026-10-19');
    expect(o.scheduledDate).toBe('2026-10-24');
  });

  it('豁免使 K 从 2 降到 1 并记调整', () => {
    const r = runOccurrenceCommand({ ...base, command: { kind: 'excuse', id: 'o1', reason: '生病' } });
    expect(r.goals[0]!.minimumTarget).toBe(1);
    expect(r.goals[0]!.adjustments).toHaveLength(1);
    expect(r.goals[0]!.adjustments[0]!.beforeMinimum).toBe(2);
    expect(r.goals[0]!.adjustments[0]!.afterMinimum).toBe(1);
  });

  it('恢复不自动上调用户已降低的 K（只下调不上调）', () => {
    // 设计口径：K 只在 A 变小时自动下调；恢复项目不自动把用户降过的目标调回去
    const start = {
      ...base,
      occurrences: [occ('o1', 0, 'excused'), occ('o2', 1)],
      goals: [goal(WEEK, 2, 1)],
    };
    const r = runOccurrenceCommand({ ...start, command: { kind: 'restore', id: 'o1' } });
    expect(r.goals[0]!.minimumTarget).toBe(1);
    expect(r.occurrences.find((o) => o.id === 'o1')?.disposition).toBe('scheduled');
  });

  it('不影响其他周的目标', () => {
    const start = { ...base, goals: [goal(WEEK, 2, 2), goal('2026-10-26', 2, 2)] };
    const r = runOccurrenceCommand({ ...start, command: { kind: 'excuse', id: 'o1', reason: '生病' } });
    expect(r.goals[1]).toEqual(goal('2026-10-26', 2, 2));
  });

  it('K 无需下调时不追加调整记录', () => {
    const start = { ...base, goals: [goal(WEEK, 2, 1)] };
    const r = runOccurrenceCommand({ ...start, command: { kind: 'excuse', id: 'o1', reason: '生病' } });
    expect(r.goals[0]!.adjustments).toHaveLength(0);
  });

  it('原数组不被修改', () => {
    const occs = [occ('o1', 0), occ('o2', 1)];
    const goals = [goal(WEEK, 2, 2)];
    runOccurrenceCommand({ ...base, occurrences: occs, goals, command: { kind: 'excuse', id: 'o1', reason: 'x' } });
    expect(occs[0]!.disposition).toBe('scheduled');
    expect(goals[0]!.minimumTarget).toBe(2);
  });
});

describe('补充 · changeMinimumTarget', () => {
  const base = {
    goals: [goal(WEEK, 3, 3)],
    occurrences: [occ('o1', 0), occ('o2', 1), occ('o3', 2)],
    weekStart: WEEK,
    reason: '这周忙',
    recordedAt: '2026-10-19T10:00:00.000Z',
    idFactory,
  };
  it('周无目标返回错误', () => {
    const r = changeMinimumTarget({ ...base, next: 1, weekStart: '2026-10-26' });
    expect(r.error).toBe('这一周还没有目标');
  });

  it('合法降低', () => {
    const r = changeMinimumTarget({ ...base, next: 1 });
    expect(r.error).toBeUndefined();
    expect(r.goals[0]!.minimumTarget).toBe(1);
  });

  it('非法值返回校验原因', () => {
    expect(changeMinimumTarget({ ...base, next: 4 }).error).toBeTruthy();
    expect(changeMinimumTarget({ ...base, next: -1 }).error).toBeTruthy();
  });

  it('记录原因', () => {
    const r = changeMinimumTarget({ ...base, next: 2 });
    expect(r.goals[0]!.adjustments[0]!.reason).toBe('这周忙');
  });
});

describe('补充 · openOccurrencesForWeek', () => {
  const occs = [
    occ('o1', 0),
    occ('o2', 1, 'excused'),
    occ('o3', 2, 'cancelled'),
    { ...occ('o4', 0), weekStart: '2026-10-26' },
  ];

  it('只返回未满足的 scheduled 项', () => {
    const out = openOccurrencesForWeek(occs, WEEK, ['o1']);
    expect(out.map((o) => o.id)).toEqual([]);
  });

  it('排除已满足项', () => {
    const out = openOccurrencesForWeek(occs, WEEK, []);
    expect(out.map((o) => o.id)).toEqual(['o1']);
  });

  it('不跨周', () => {
    const out = openOccurrencesForWeek(occs, WEEK, ['o1']);
    expect(out.every((o) => o.weekStart === WEEK)).toBe(true);
  });
});

describe('补充 · switchTemplate', () => {
  const base = {
    occurrences: [occ('o1', 0), occ('o2', 1)],
    goals: [goal(WEEK, 2, 2), goal('2026-10-26', 2, 2)],
    next: TEMPLATES[1] ?? TEMPLATES[0]!,
    effectiveFrom: '2026-10-21',
    sessions: [] as Session[],
    idFactory,
    recordedAt: '2026-10-21T00:00:00.000Z',
  };

  it('返回受影响周', () => {
    const r = switchTemplate(base);
    expect(r.affectedWeeks).toContain(WEEK);
    expect(r.affectedWeeks).toContain('2026-10-26');
  });

  it('生效日之前的项目保持 scheduled', () => {
    const r = switchTemplate(base);
    // o1 是 10-19，早于 effectiveFrom 10-21
    expect(r.occurrences.find((o) => o.id === 'o1')?.disposition).toBe('scheduled');
  });

  it('生效日当天的项目即被取消', () => {
    // base 的 effectiveFrom 是 10-21；改用 10-21、10-22 的项目验证"当天即取消"
    const onEffective = [occ('o3', 2), occ('o4', 3)];
    const r2 = switchTemplate({
      ...base,
      occurrences: [occ('o1', 0), ...onEffective],
      effectiveFrom: '2026-10-21',
    });
    expect(r2.occurrences.find((o) => o.id === 'o3')?.disposition).toBe('cancelled');
    expect(r2.occurrences.find((o) => o.id === 'o3')?.dispositionReason).toBe('换模板');
    expect(r2.occurrences.find((o) => o.id === 'o4')?.disposition).toBe('cancelled');
  });

  it('生效日之前的项目即使晚于今天也不动', () => {
    const r = switchTemplate({ ...base, effectiveFrom: '2026-10-25' });
    expect(r.occurrences.find((o) => o.id === 'o1')?.disposition).toBe('scheduled');
    expect(r.occurrences.find((o) => o.id === 'o2')?.disposition).toBe('scheduled');
  });

  it('已开始的项目不动', () => {
    const r = switchTemplate({ ...base, sessions: [session('s1', 'o2', 'active')] });
    expect(r.occurrences.find((o) => o.id === 'o2')?.disposition).toBe('scheduled');
  });

  it('已完成的项目不动', () => {
    const r = switchTemplate({ ...base, sessions: [session('s1', 'o2', 'completed')] });
    expect(r.occurrences.find((o) => o.id === 'o2')?.disposition).toBe('scheduled');
  });

  it('原 N 不变', () => {
    const r = switchTemplate(base);
    expect(r.goals.find((g) => g.weekStart === WEEK)!.originalPlannedCount).toBe(2);
  });

  it('受影响周的 K 按新 A 重算', () => {
    const r = switchTemplate(base);
    const g = r.goals.find((x) => x.weekStart === WEEK)!;
    const A = r.occurrences.filter((o) => o.weekStart === WEEK && o.disposition === 'scheduled').length;
    expect(g.minimumTarget).toBe(Math.min(g.minimumTarget, A));
  });

  it('每个受影响周都记一次调整', () => {
    const r = switchTemplate(base);
    for (const w of r.affectedWeeks) {
      const g = r.goals.find((x) => x.weekStart === w);
      if (g) expect(g.adjustments.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('换模板后新模板安排已生成', () => {
    const r = switchTemplate(base);
    const newIds = new Set(TEMPLATE_BY_ID.get(base.next.id)!.days.map((d) => `${base.next.id}-${d.id}`));
    expect(r.occurrences.some((o) => newIds.has(o.slotId))).toBe(true);
  });

  it('不重复生成同 slot', () => {
    const r = switchTemplate(base);
    const keys = r.occurrences.map((o) => `${o.planVersionId}|${o.weekStart}|${o.slotId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
