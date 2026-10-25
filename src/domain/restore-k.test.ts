import { describe, expect, it } from 'vitest';
import { runOccurrenceCommand } from './plan';
import type { PlannedOccurrence, WeekGoal } from './week';

let n = 0;
const idFactory = (p: string) => `${p}_${++n}`;
const WEEK = '2026-10-19';

function occ(id: string, day: number, disposition: PlannedOccurrence['disposition'] = 'scheduled'): PlannedOccurrence {
  const date = `2026-10-${String(19 + day).padStart(2, '0')}`;
  return {
    id, planVersionId: 'v1', weekStart: WEEK, originalDate: date, scheduledDate: date,
    slotId: `slot-${day}`, title: '训练', exerciseIds: ['bb-squat'], disposition,
  };
}
function goal(nCount: number, t: number): WeekGoal {
  return { id: `goal_${WEEK}`, weekStart: WEEK, originalPlannedCount: nCount, minimumTarget: t, adjustments: [] };
}

describe('恢复与 K 重算（09 号规范 L50）', () => {
  it('无调整记录时恢复不自动上调 K（保护用户主动调低）', () => {
    const occurrences = [occ('o1', 0, 'excused'), occ('o2', 1)];
    const goals = [goal(2, 1)];
    const r = runOccurrenceCommand({
      command: { kind: 'restore', id: 'o1' },
      occurrences, goals, sessions: [], recordedAt: 'x', idFactory,
    });
    const info = {
      beforeK: goals[0]!.minimumTarget,
      afterK: r.goals[0]!.minimumTarget,
      o1: r.occurrences.find((o) => o.id === 'o1')?.disposition,
      A: r.occurrences.filter((o) => o.weekStart === WEEK && o.disposition === 'scheduled').length,
    };
    expect(info).toEqual({ beforeK: 1, afterK: 1, o1: 'scheduled', A: 2 });
  });
});

