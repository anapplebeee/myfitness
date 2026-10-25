import { describe, expect, it } from 'vitest';
import { runOccurrenceCommand } from './plan';
import type { PlannedOccurrence, WeekGoal } from './week';
import type { Session } from './types';

/**
 * K（有效最低目标）的重算口径。
 *
 * 09 号规范 §3：K = min(当前 minimumTarget, A)，
 *              且 §4 明确"恢复 → disposition=scheduled → A/K 重算"。
 *
 * 这里区分两条容易混淆的规则，它们并不矛盾：
 *
 *  1. 系统因素（豁免/取消）把 A 压小后，恢复应当让 K 回升。
 *     否则用户豁免一次，目标就永久卡在低值。
 *
 *  2. 用户主动把目标调低（changeMinimumTarget），恢复项目不应把它推回去。
 *     这是用户的明确意愿，不能被系统覆盖。
 *
 * 判据是最近一次调整记录的 reason：
 *   "计划调整：…"  → 系统压缩，可回升
 *   其他           → 用户意愿，不回升
 */

const WEEK = '2026-10-19';
let seq = 0;
const idFactory = (p: string): string => `${p}_${++seq}`;

function occ(id: string, day: number, disposition: PlannedOccurrence['disposition'] = 'scheduled'): PlannedOccurrence {
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
  };
}

function goal(originalN: number, minimumT: number): WeekGoal {
  return { id: `goal_${WEEK}`, weekStart: WEEK, originalPlannedCount: originalN, minimumTarget: minimumT, adjustments: [] };
}

function base(occurrences: PlannedOccurrence[], goals: WeekGoal[]) {
  return {
    occurrences,
    goals,
    sessions: [] as Session[],
    recordedAt: '2026-10-19T10:00:00.000Z',
    idFactory,
  };
}

describe('K 重算 · 系统压缩后恢复应回升', () => {
  it('豁免使 K 从 2 降到 1', () => {
    const r = runOccurrenceCommand({
      ...base([occ('o1', 0), occ('o2', 1)], [goal(2, 2)]),
      command: { kind: 'excuse', id: 'o1', reason: '生病' },
    });
    expect(r.goals[0]!.minimumTarget).toBe(1);
    expect(r.goals[0]!.adjustments).toHaveLength(1);
  });

  it('恢复后 K 回到 2（规范 L50 "A/K 重算"）', () => {
    const b = base([occ('o1', 0), occ('o2', 1)], [goal(2, 2)]);
    const excused = runOccurrenceCommand({ ...b, command: { kind: 'excuse', id: 'o1', reason: '生病' } });
    const restored = runOccurrenceCommand({
      ...b,
      occurrences: excused.occurrences,
      goals: excused.goals,
      command: { kind: 'restore', id: 'o1' },
    });
    // 修复前这里会因为 Math.min 单向压缩而永远停在 1
    expect(restored.goals[0]!.minimumTarget).toBe(2);
    expect(restored.occurrences.find((o) => o.id === 'o1')?.disposition).toBe('scheduled');
  });

  it('恢复不会超过原始计划数 N', () => {
    const b = base([occ('o1', 0), occ('o2', 1)], [goal(2, 2)]);
    const excused = runOccurrenceCommand({ ...b, command: { kind: 'excuse', id: 'o1', reason: '生病' } });
    const restored = runOccurrenceCommand({
      ...b,
      occurrences: excused.occurrences,
      goals: excused.goals,
      command: { kind: 'restore', id: 'o1' },
    });
    expect(restored.goals[0]!.minimumTarget).toBeLessThanOrEqual(2);
  });

  it('豁免两项再全部恢复，K 完整回到 N', () => {
    const b = base([occ('o1', 0), occ('o2', 1)], [goal(2, 2)]);
    const e1 = runOccurrenceCommand({ ...b, command: { kind: 'excuse', id: 'o1', reason: '生病' } });
    const e2 = runOccurrenceCommand({
      ...b,
      occurrences: e1.occurrences,
      goals: e1.goals,
      command: { kind: 'excuse', id: 'o2', reason: '出差' },
    });
    expect(e2.goals[0]!.minimumTarget).toBe(0);
    const r1 = runOccurrenceCommand({
      ...b,
      occurrences: e2.occurrences,
      goals: e2.goals,
      command: { kind: 'restore', id: 'o1' },
    });
    const r2 = runOccurrenceCommand({
      ...b,
      occurrences: r1.occurrences,
      goals: r1.goals,
      command: { kind: 'restore', id: 'o2' },
    });
    expect(r2.goals[0]!.minimumTarget).toBe(2);
  });
});

describe('K 重算 · 用户主动调低不被覆盖', () => {
  it('无调整记录时，恢复不把 K 推回去', () => {
    const r = runOccurrenceCommand({
      ...base([occ('o1', 0, 'excused'), occ('o2', 1)], [goal(2, 1)]),
      command: { kind: 'restore', id: 'o1' },
    });
    expect(r.goals[0]!.minimumTarget).toBe(1);
  });

  it('用户调低后再恢复项目，仍是用户的低值', () => {
    // 模拟：用户把 K 设为 1（无"计划调整"记录），随后恢复一个已豁免项
    const g: WeekGoal = { ...goal(3, 1) };
    const r = runOccurrenceCommand({
      ...base([occ('o1', 0, 'excused'), occ('o2', 1), occ('o3', 2)], [g]),
      command: { kind: 'restore', id: 'o1' },
    });
    expect(r.goals[0]!.minimumTarget).toBe(1);
  });
});

describe('K 重算 · 边界', () => {
  it('A 为 0 时 K 为 0', () => {
    const b = base([occ('o1', 0)], [goal(1, 1)]);
    const r = runOccurrenceCommand({ ...b, command: { kind: 'excuse', id: 'o1', reason: '生病' } });
    expect(r.goals[0]!.minimumTarget).toBe(0);
  });

  it('恢复不改变其他周的目标', () => {
    const other: WeekGoal = { id: 'g2', weekStart: '2026-10-26', originalPlannedCount: 3, minimumTarget: 3, adjustments: [] };
    const r = runOccurrenceCommand({
      ...base([occ('o1', 0, 'excused'), occ('o2', 1)], [goal(2, 1), other]),
      command: { kind: 'restore', id: 'o1' },
    });
    expect(r.goals[1]).toEqual(other);
  });
});
