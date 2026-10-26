import { describe, expect, it } from 'vitest';
import { bestLiftName, buildWeeklyReport, changePct, trendOf } from './report';
import type { AppState, Session, SetRecord } from './types';

/** 周报：只验数字对不对，排版由截图检查。 */

const WEEK = '2026-10-19'; // 周一，到 10-25 周日

function set(over: Partial<SetRecord> & { id: string }): SetRecord {
  return {
    kind: 'work',
    status: 'completed',
    loadGrams: null,
    reps: null,
    durationSeconds: null,
    distanceMeters: null,
    rpe: null,
    completedAt: '2026-10-20T10:00:00.000Z',
    ...over,
  };
}

function session(over: Partial<Session> & { id: string; businessDate: string }): Session {
  return {
    templateId: null,
    dayId: null,
    title: '训练',
    status: 'completed',
    startedAt: `${over.businessDate}T10:00:00.000Z`,
    endedAt: `${over.businessDate}T11:00:00.000Z`,
    restEndsAt: null,
    note: '',
    exercises: [
      {
        id: `se_${over.id}`,
        exerciseId: 'bb-squat',
        order: 0,
        targetSets: 1,
        repMin: 5,
        repMax: 8,
        restSeconds: 120,
        incrementGrams: 2500,
        sets: [set({ id: `x_${over.id}`, loadGrams: 100000, reps: 5 })],
      },
    ],
    ...over,
  };
}

function state(over: Partial<AppState> = {}): AppState {
  return {
    version: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    profile: {
      name: 't',
      experience: 'intermediate',
      equipment: 'gym',
      weeklyTarget: 4,
      heightCm: 175,
      sex: 'male',
      birthYear: 1995,
      activity: 1.5,
      restrictions: [],
      allergies: [],
      restrictionsConfirmed: true,
    },
    activeTemplateId: null,
    sessions: [],
    weights: [],
    foods: [],
    bodyGoalGrams: null,
    goals: [],
    targetKcal: null,
    targetProtein: null,
    weeklyGoal: 4,
    onboarded: true,
    occurrences: [],
    weekGoals: [],
    activeTemplateSince: null,
    customTemplates: [],
    datasetId: 'ds_x',
    lastBackupKey: null,
    ...over,
  };
}

describe('周报 · 基本统计', () => {
  it('只统计本周已完成的场次', () => {
    const s = state({
      sessions: [
        session({ id: 'a', businessDate: '2026-10-19' }),
        session({ id: 'b', businessDate: '2026-10-25' }),
        // 上周，不该计入
        session({ id: 'c', businessDate: '2026-10-18' }),
        // 未完成，不该计入
        session({ id: 'd', businessDate: '2026-10-20', status: 'active', endedAt: null }),
        // 已删除，不该计入
        session({ id: 'e', businessDate: '2026-10-21', deletedAt: '2026-10-22T00:00:00.000Z' }),
      ],
    });
    const r = buildWeeklyReport(s, WEEK);
    expect(r.sessions).toBe(2);
    expect(r.prevSessions).toBe(1);
  });

  it('训练天数去重', () => {
    const s = state({
      sessions: [
        session({ id: 'a', businessDate: '2026-10-19' }),
        session({ id: 'b', businessDate: '2026-10-19' }),
      ],
    });
    expect(buildWeeklyReport(s, WEEK).days).toBe(1);
  });

  it('起止日期正确', () => {
    const r = buildWeeklyReport(state(), WEEK);
    expect(r.from).toBe('2026-10-19');
    expect(r.to).toBe('2026-10-25');
  });

  it('空数据不崩，全部为 0', () => {
    const r = buildWeeklyReport(state(), WEEK);
    expect(r.sessions).toBe(0);
    expect(r.volumeGrams).toBe(0);
    expect(r.sets).toBe(0);
    expect(r.bestLift).toBeNull();
    expect(r.goalRate).toBeNull();
  });
});

describe('周报 · 对比与趋势', () => {
  it('能算出与上周的容量差', () => {
    const s = state({
      sessions: [
        session({ id: 'a', businessDate: '2026-10-19' }),
        session({ id: 'b', businessDate: '2026-10-12' }),
        session({ id: 'c', businessDate: '2026-10-13' }),
      ],
    });
    const r = buildWeeklyReport(s, WEEK);
    expect(r.volumeGrams).toBe(500000);
    expect(r.prevVolumeGrams).toBe(1000000);
  });

  it('上周为 0 时不给百分比（避免假涨幅）', () => {
    expect(changePct(5, 0)).toBeNull();
    expect(trendOf(5, 0)).toBe('flat');
  });

  it('涨跌方向正确', () => {
    expect(trendOf(10, 5)).toBe('up');
    expect(trendOf(3, 5)).toBe('down');
    expect(trendOf(5, 5)).toBe('flat');
  });

  it('百分比四舍五入', () => {
    expect(changePct(12, 10)).toBe(20);
    expect(changePct(10, 12)).toBe(-17);
  });
});

describe('周报 · 纪录', () => {
  it('本周重量超过历史最好算一次 PR', () => {
    const s = state({
      sessions: [
        session({ id: 'old', businessDate: '2026-10-01' }),
        session({
          id: 'new',
          businessDate: '2026-10-20',
          exercises: [
            {
              id: 'se_new',
              exerciseId: 'bb-squat',
              order: 0,
              targetSets: 1,
              repMin: 5,
              repMax: 8,
              restSeconds: 120,
              incrementGrams: 2500,
              sets: [set({ id: 'x', loadGrams: 120000, reps: 5 })],
            },
          ],
        }),
      ],
    });
    const r = buildWeeklyReport(s, WEEK);
    expect(r.prCount).toBe(1);
    expect(r.bestLift?.loadGrams).toBe(120000);
  });

  it('未超过历史不算 PR', () => {
    const s = state({
      sessions: [
        session({ id: 'old', businessDate: '2026-10-01' }),
        session({ id: 'new', businessDate: '2026-10-20' }),
      ],
    });
    expect(buildWeeklyReport(s, WEEK).prCount).toBe(0);
  });

  it('自重动作不参与最重组的比较', () => {
    const s = state({
      sessions: [
        session({
          id: 'a',
          businessDate: '2026-10-19',
          exercises: [
            {
              id: 'se',
              exerciseId: 'pull-up',
              order: 0,
              targetSets: 1,
              repMin: 5,
              repMax: 8,
              restSeconds: 120,
              incrementGrams: 0,
              sets: [set({ id: 'x', loadGrams: null, reps: 12 })],
            },
          ],
        }),
      ],
    });
    expect(buildWeeklyReport(s, WEEK).bestLift).toBeNull();
  });

  it('bestLiftName 能取到中文名', () => {
    const s = state({ sessions: [session({ id: 'a', businessDate: '2026-10-19' })] });
    const r = buildWeeklyReport(s, WEEK);
    expect(bestLiftName(r)).toBeTruthy();
    expect(bestLiftName(r)).not.toBe('bb-squat');
  });
});

describe('周报 · 进行中的周按同期对比', () => {
  /*
   * 关键行为：本周还没结束时，不能拿"半周"去比"上一整周"。
   * 周二 0 场 vs 上周整周 4 场 = -100%，用户一天没练就被判退步。
   * 正确做法是把上周也截到同样的天数。
   */
  const prevWeekSessions = [
    session({ id: 'p1', businessDate: '2026-10-12' }), // 上周一
    session({ id: 'p2', businessDate: '2026-10-13' }), // 上周二
    session({ id: 'p3', businessDate: '2026-10-15' }), // 上周四
    session({ id: 'p4', businessDate: '2026-10-17' }), // 上周六
  ];

  it('本周进行中时，上周只算到同样的天数', () => {
    const s = state({ sessions: prevWeekSessions });
    // 本周二是 2026-10-20
    const r = buildWeeklyReport(s, WEEK, new Date('2026-10-20T09:00:00'));
    expect(r.sessions).toBe(0);
    // 只应统计上周一、上周二两天，而不是全部 4 场
    expect(r.prevSessions).toBe(2);
  });

  it('本周已结束时，上周按整周统计', () => {
    const s = state({ sessions: prevWeekSessions });
    // 下周一，本周已结束
    const r = buildWeeklyReport(s, WEEK, new Date('2026-10-26T09:00:00'));
    expect(r.prevSessions).toBe(4);
  });

  it('同期都是 0 时不产生百分比', () => {
    const r = buildWeeklyReport(state(), WEEK, new Date('2026-10-20T09:00:00'));
    expect(changePct(r.sessions, r.prevSessions)).toBeNull();
    expect(trendOf(r.sessions, r.prevSessions)).toBe('flat');
  });
});
