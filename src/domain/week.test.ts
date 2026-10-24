/**
 * 09 号 §9 固定示例 W01–W16。
 * 每条用例的期望值直接取自 docs/09-checkin-model.md:105-122。
 */

import { describe, expect, it } from 'vitest';
import {
  applyMinimumTargetChange,
  canDispose,
  canSetMinimumTarget,
  computeWeek,
  dayStatesForWeek,
  foldStreak,
  initialWeekGoal,
  isValidCompletedSession,
  postpone,
  streakOfEndedWeeks,
  type PlannedOccurrence,
  type WeekGoal,
} from './week';
import type { Session, SetRecord } from './types';

const WEEK = '2026-10-19'; // 周一
const NOW_AFTER = new Date('2026-10-26T00:10:00'); // 下周一时间点，本周已结算
const NOW_DURING = new Date('2026-10-22T20:00:00'); // 周四，周进行中

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
    completedAt: '2026-10-20T10:00:00.000Z',
  };
}

function warmupOnly(id: string): SetRecord {
  return { ...workSet(id), kind: 'warmup' };
}

function session(
  id: string,
  date: string,
  opts: {
    occurrenceId?: string;
    credit?: boolean;
    status?: Session['status'];
    basis?: Session['completionBasis'];
    sets?: SetRecord[];
  } = {},
): Session {
  return {
    id,
    templateId: null,
    dayId: null,
    title: '训练',
    status: opts.status ?? 'completed',
    startedAt: `${date}T10:00:00.000Z`,
    endedAt: `${date}T11:00:00.000Z`,
    businessDate: date,
    restEndsAt: null,
    note: '',
    ...(opts.occurrenceId ? { occurrenceId: opts.occurrenceId } : {}),
    ...(opts.credit !== undefined ? { goalCreditConfirmed: opts.credit } : {}),
    ...(opts.basis ? { completionBasis: opts.basis } : {}),
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
        sets: opts.sets ?? [workSet(`set_${id}`)],
      },
    ],
  };
}

function goal(n: number, t: number): WeekGoal {
  return { id: `goal_${WEEK}`, weekStart: WEEK, originalPlannedCount: n, minimumTarget: t, adjustments: [] };
}

describe('W01 周内顺延不改目标', () => {
  it('N4/T4 周三移周六，完成3项 → A4/K4/D3，周末未达标', () => {
    const occurrences = [occ('o1', 0), occ('o2', 1), occ('o3', 2), occ('o4', 3)];
    const moved = postpone(occurrences[2]!, '2026-10-24', WEEK);
    const list = [occurrences[0]!, occurrences[1]!, moved, occurrences[3]!];
    const sessions = [
      session('s1', '2026-10-19', { occurrenceId: 'o1', credit: true }),
      session('s2', '2026-10-20', { occurrenceId: 'o2', credit: true }),
      session('s3', '2026-10-24', { occurrenceId: 'o3', credit: true }),
    ];
    const r = computeWeek({ weekStart: WEEK, goal: goal(4, 4), occurrences: list, sessions, now: NOW_AFTER });
    expect(r.adjustedPlanned).toBe(4);
    expect(r.minimumTarget).toBe(4);
    expect(r.completedOccurrences).toBe(3);
    expect(r.status).toBe('notAchieved');
    expect(moved.originalDate).toBe('2026-10-21');
    expect(moved.scheduledDate).toBe('2026-10-24');
  });
});

describe('W02 豁免后重算目标', () => {
  it('N4/T4 豁免1项完成3项 → A3/K3/D3 achieved/full，显示原4调整3', () => {
    const occurrences = [occ('o1', 0), occ('o2', 1), occ('o3', 2), occ('o4', 3, 'excused')];
    const sessions = [
      session('s1', '2026-10-19', { occurrenceId: 'o1', credit: true }),
      session('s2', '2026-10-20', { occurrenceId: 'o2', credit: true }),
      session('s3', '2026-10-21', { occurrenceId: 'o3', credit: true }),
    ];
    const r = computeWeek({ weekStart: WEEK, goal: goal(4, 4), occurrences, sessions, now: NOW_AFTER });
    expect(r.adjustedPlanned).toBe(3);
    expect(r.minimumTarget).toBe(3);
    expect(r.completedOccurrences).toBe(3);
    expect(r.status).toBe('achieved');
    expect(r.full).toBe(true);
    expect(r.excusedCount).toBe(1);
    expect(r.originalPlanned).toBe(4);
  });
});

describe('W03 低目标达标但未全做', () => {
  it('N4/T3 无豁免完成3项 → achieved，full=false', () => {
    const occurrences = [occ('o1', 0), occ('o2', 1), occ('o3', 2), occ('o4', 3)];
    const sessions = [
      session('s1', '2026-10-19', { occurrenceId: 'o1', credit: true }),
      session('s2', '2026-10-20', { occurrenceId: 'o2', credit: true }),
      session('s3', '2026-10-21', { occurrenceId: 'o3', credit: true }),
    ];
    const r = computeWeek({ weekStart: WEEK, goal: goal(4, 3), occurrences, sessions, now: NOW_AFTER });
    expect(r.status).toBe('achieved');
    expect(r.full).toBe(false);
    expect(r.minimumTarget).toBe(3);
    expect(r.adjustedPlanned).toBe(4);
  });
});

describe('W04 全豁免进入休整', () => {
  it('A0/K0 → paused，连续数不增加', () => {
    const occurrences = [occ('o1', 0, 'excused'), occ('o2', 1, 'excused')];
    const r = computeWeek({ weekStart: WEEK, goal: goal(2, 2), occurrences, sessions: [], now: NOW_AFTER });
    expect(r.adjustedPlanned).toBe(0);
    expect(r.minimumTarget).toBe(0);
    expect(r.status).toBe('paused');
    expect(foldStreak([r])).toBe(0);
  });
});

describe('W05 无计划训练', () => {
  it('同一天两场 → unplanned，次数2/天数1', () => {
    const sessions = [session('s1', '2026-10-20'), session('s2', '2026-10-20')];
    const r = computeWeek({ weekStart: WEEK, goal: null, occurrences: [], sessions, now: NOW_AFTER });
    expect(r.status).toBe('unplanned');
    expect(r.actualSessionCount).toBe(2);
    expect(r.trainingDays).toBe(1);
    expect(r.completedOccurrences).toBe(0);
  });
});

describe('W06 重复结束/同步幂等', () => {
  it('同一会话出现两次 → 次数1，同一项目只满足1次', () => {
    const occurrences = [occ('o1', 0)];
    const s = session('s1', '2026-10-19', { occurrenceId: 'o1', credit: true });
    const r = computeWeek({
      weekStart: WEEK,
      goal: goal(1, 1),
      occurrences,
      sessions: [s, { ...s }],
      now: NOW_AFTER,
    });
    expect(r.actualSessionCount).toBe(1);
    expect(r.completedOccurrences).toBe(1);
  });
});

describe('W07 已结算周补录', () => {
  it('补录后满足目标 → 改为 achieved', () => {
    const occurrences = [occ('o1', 0), occ('o2', 1)];
    const before = computeWeek({
      weekStart: WEEK,
      goal: goal(2, 2),
      occurrences,
      sessions: [session('s1', '2026-10-19', { occurrenceId: 'o1', credit: true })],
      now: NOW_AFTER,
    });
    expect(before.status).toBe('notAchieved');

    const after = computeWeek({
      weekStart: WEEK,
      goal: goal(2, 2),
      occurrences,
      sessions: [
        session('s1', '2026-10-19', { occurrenceId: 'o1', credit: true }),
        session('s2', '2026-10-20', { occurrenceId: 'o2', credit: true }),
      ],
      now: NOW_AFTER,
    });
    expect(after.status).toBe('achieved');
  });
});

describe('W08 删除关键会话', () => {
  it('删除后 → notAchieved', () => {
    const occurrences = [occ('o1', 0), occ('o2', 1)];
    const r = computeWeek({
      weekStart: WEEK,
      goal: goal(2, 2),
      occurrences,
      sessions: [session('s1', '2026-10-19', { occurrenceId: 'o1', credit: true })],
      now: NOW_AFTER,
    });
    expect(r.status).toBe('notAchieved');
    expect(r.completedOccurrences).toBe(1);
  });
});

describe('W09 跨午夜归开始日', () => {
  it('周日23:50开始周一结束 → 只计周日所在周', () => {
    const s: Session = {
      ...session('s1', '2026-10-25', { occurrenceId: 'o1', credit: true }),
      startedAt: '2026-10-25T23:50:00.000Z',
      endedAt: '2026-10-26T00:30:00.000Z',
    };
    const occurrences = [occ('o1', 6)];
    const thisWeek = computeWeek({ weekStart: WEEK, goal: goal(1, 1), occurrences, sessions: [s], now: NOW_AFTER });
    const nextWeek = computeWeek({
      weekStart: '2026-10-26',
      goal: null,
      occurrences: [],
      sessions: [s],
      now: NOW_AFTER,
    });
    expect(thisWeek.actualSessionCount).toBe(1);
    expect(nextWeek.actualSessionCount).toBe(0);
  });
});

describe('W10 只有热身组', () => {
  it('不计有效完成和周目标', () => {
    const occurrences = [occ('o1', 0)];
    const s = session('s1', '2026-10-19', {
      occurrenceId: 'o1',
      credit: true,
      sets: [warmupOnly('w1')],
    });
    expect(isValidCompletedSession(s)).toBe(false);
    const r = computeWeek({ weekStart: WEEK, goal: goal(1, 1), occurrences, sessions: [s], now: NOW_AFTER });
    expect(r.actualSessionCount).toBe(0);
    expect(r.completedOccurrences).toBe(0);
    expect(r.status).toBe('notAchieved');
  });
});

describe('W11 周中已达标', () => {
  it('ongoing 且 targetReached，连续周暂不增加', () => {
    const occurrences = [occ('o1', 0), occ('o2', 1)];
    const sessions = [
      session('s1', '2026-10-19', { occurrenceId: 'o1', credit: true }),
      session('s2', '2026-10-20', { occurrenceId: 'o2', credit: true }),
    ];
    const r = computeWeek({ weekStart: WEEK, goal: goal(2, 2), occurrences, sessions, now: NOW_DURING });
    expect(r.status).toBe('ongoing');
    expect(r.targetReached).toBe(true);
    expect(streakOfEndedWeeks([r])).toBe(0);
  });
});

describe('W12 同日两项完成一项', () => {
  it('done 并显示漏项，D1', () => {
    const occurrences = [occ('o1', 0), occ('o2', 0)];
    const sessions = [session('s1', '2026-10-19', { occurrenceId: 'o1', credit: true })];
    const r = computeWeek({ weekStart: WEEK, goal: goal(2, 1), occurrences, sessions, now: NOW_AFTER });
    expect(r.completedOccurrences).toBe(1);
    expect(r.missedOccurrenceIds).toEqual(['o2']);

    const cells = dayStatesForWeek(WEEK, occurrences, sessions, r, '2026-10-26');
    const firstDay = cells[0]!;
    expect(firstDay.primary).toBe('done');
    expect(firstDay.missedNote).toBe('另有 1 项未完成');
  });
});

describe('W13 换模板调整只应用一次', () => {
  it('原 N 不变，A 按新集合，调整事件不重复', () => {
    const before = [occ('o1', 0), occ('o2', 1), occ('o3', 2), occ('o4', 3)];
    const g = goal(4, 4);
    const next = applyMinimumTargetChange(g, before, 2, '换模板后只保留 2 项', '2026-10-20T10:00:00Z', 'adj1');
    expect(next.adjustments).toHaveLength(1);
    expect(next.minimumTarget).toBe(2);
    expect(next.originalPlannedCount).toBe(4);
    expect(g.minimumTarget).toBe(4);
    // 同一调整再次施加会产生第二条记录，但调用方按稳定 ID 去重
    expect(next.adjustments[0]?.id).toBe('adj1');
  });
});

describe('W14 换时区不改历史', () => {
  it('businessDate 已固化，跨时区重算结果一致', () => {
    const occurrences = [occ('o1', 0)];
    const sessions = [session('s1', '2026-10-19', { occurrenceId: 'o1', credit: true })];
    const shanghai = computeWeek({ weekStart: WEEK, goal: goal(1, 1), occurrences, sessions, now: NOW_AFTER });
    const newYork = computeWeek({ weekStart: WEEK, goal: goal(1, 1), occurrences, sessions, now: NOW_AFTER });
    expect(shanghai.status).toBe(newYork.status);
    expect(shanghai.completedOccurrences).toBe(newYork.completedOccurrences);
    expect(sessions[0]!.businessDate).toBe('2026-10-19');
  });
});

describe('W15 取消豁免重算', () => {
  it('恢复 scheduled 后 A/K 重算，展示调整前后', () => {
    const excusedOcc = [occ('o1', 0, 'excused'), occ('o2', 1)];
    const withExcuse = computeWeek({
      weekStart: WEEK,
      goal: goal(2, 2),
      occurrences: excusedOcc,
      sessions: [],
      now: NOW_AFTER,
    });
    expect(withExcuse.adjustedPlanned).toBe(1);
    expect(withExcuse.minimumTarget).toBe(1);

    const restored = [occ('o1', 0, 'scheduled'), occ('o2', 1)];
    const afterRestore = computeWeek({
      weekStart: WEEK,
      goal: goal(2, 2),
      occurrences: restored,
      sessions: [],
      now: NOW_AFTER,
    });
    expect(afterRestore.adjustedPlanned).toBe(2);
    expect(afterRestore.minimumTarget).toBe(2);
  });
});

describe('W16 会话改期跨周', () => {
  it('解除旧关联后旧周不再计入', () => {
    const prevOcc = [occ('o1', 0)];
    const movedSession = session('s1', '2026-10-20');
    const prevWeek = computeWeek({
      weekStart: WEEK,
      goal: goal(1, 1),
      occurrences: prevOcc,
      sessions: [movedSession],
      now: NOW_AFTER,
    });
    expect(prevWeek.completedOccurrences).toBe(0);

    const nextWeekStart = '2026-10-26';
    const nextSessions = [session('s1', '2026-10-27')];
    const nextWeek = computeWeek({
      weekStart: nextWeekStart,
      goal: null,
      occurrences: [],
      sessions: nextSessions,
      now: NOW_AFTER,
    });
    expect(nextWeek.actualSessionCount).toBe(1);
  });
});

describe('连续周折叠', () => {
  it('achieved 累加，notAchieved 归零，paused/unplanned 跳过', () => {
    const mk = (weekStart: string, status: Parameters<typeof foldStreak>[0][number]['status']) =>
      ({ weekStart, status }) as Parameters<typeof foldStreak>[0][number];
    const results = [
      mk('2026-09-28', 'achieved'),
      mk('2026-10-05', 'paused'),
      mk('2026-10-12', 'achieved'),
      mk('2026-10-19', 'achieved'),
    ];
    expect(foldStreak(results)).toBe(3);
    expect(foldStreak([...results, mk('2026-10-26', 'notAchieved')])).toBe(0);
    expect(foldStreak([...results, mk('2026-10-26', 'unplanned')])).toBe(3);
  });
});

describe('目标变更校验', () => {
  const occurrences = [occ('o1', 0), occ('o2', 1), occ('o3', 2)];

  it('提高目标不超过当前 A', () => {
    expect(canSetMinimumTarget(goal(3, 1), occurrences, 3).ok).toBe(true);
    expect(canSetMinimumTarget(goal(3, 1), occurrences, 4).ok).toBe(false);
  });

  it('降低到 0 只在 A=0 时允许', () => {
    expect(canSetMinimumTarget(goal(3, 1), occurrences, 0).ok).toBe(false);
    const allExcused = [occ('o1', 0, 'excused'), occ('o2', 1, 'excused'), occ('o3', 2, 'excused')];
    expect(canSetMinimumTarget(goal(3, 1), allExcused, 0).ok).toBe(true);
  });

  it('不能超过原始计划数', () => {
    expect(canSetMinimumTarget(goal(3, 1), occurrences, 5).ok).toBe(false);
  });
});

describe('有活动会话时禁止改计划', () => {
  it('active/paused 会话阻止顺延/取消/豁免', () => {
    const o = occ('o1', 0);
    const live = session('s1', '2026-10-19', { occurrenceId: 'o1', credit: false, status: 'active' });
    expect(canDispose(o, [live]).ok).toBe(false);
    expect(canDispose(o, []).ok).toBe(true);
  });
});

describe('顺延只能同周', () => {
  it('跨周顺延抛错', () => {
    const o = occ('o1', 0);
    expect(() => postpone(o, '2026-10-27', WEEK)).toThrow();
    expect(postpone(o, '2026-10-25', WEEK).scheduledDate).toBe('2026-10-25');
  });
});

describe('initialWeekGoal', () => {
  it('按该周项目数初始化 N=T', () => {
    const g = initialWeekGoal(WEEK, [occ('o1', 0), occ('o2', 1)]);
    expect(g.originalPlannedCount).toBe(2);
    expect(g.minimumTarget).toBe(2);
  });
});
