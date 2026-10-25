import { describe, expect, it } from 'vitest';
import { buildAiContext, renderContext } from './ai-context';
import type { AppState, FoodEntry, Session, SetRecord, WeightEntry } from './types';

const TODAY = '2026-10-25';

function baseState(over: Partial<AppState> = {}): AppState {
  return {
    version: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    profile: {
      name: '测试',
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
    datasetId: 'ds_test',
    lastBackupKey: null,
    ...over,
  };
}

function set(loadGrams: number, reps: number): SetRecord {
  return {
    id: 's' + Math.random().toString(36).slice(2),
    kind: 'work',
    status: 'completed',
    loadGrams,
    reps,
    durationSeconds: null,
    distanceMeters: null,
    rpe: null,
    completedAt: '2026-10-20T10:00:00.000Z',
  };
}

function session(date: string, sets: SetRecord[], over: Partial<Session> = {}): Session {
  return {
    id: 'sess_' + date,
    templateId: null,
    dayId: null,
    title: '下肢 A',
    status: 'completed',
    startedAt: `${date}T10:00:00.000Z`,
    endedAt: `${date}T11:00:00.000Z`,
    businessDate: date,
    restEndsAt: null,
    note: '',
    exercises: [
      {
        id: 'se1',
        exerciseId: 'bb-squat',
        order: 0,
        targetSets: 4,
        repMin: 5,
        repMax: 8,
        restSeconds: 120,
        incrementGrams: 2500,
        sets,
      },
    ],
    ...over,
  };
}

describe('AC-AI01 · 上下文区分实际与缺失', () => {
  it('没有任何数据时，missing 明确列出缺什么', () => {
    const ctx = buildAiContext(baseState(), TODAY);
    expect(ctx.actual.sessionCount).toBe(0);
    expect(ctx.missing.length).toBeGreaterThan(0);
    expect(ctx.missing.some((m) => m.includes('训练'))).toBe(true);
    expect(ctx.missing.some((m) => m.includes('体重'))).toBe(true);
  });

  it('没记录饮食时，上下文明确说"不等于摄入 0"', () => {
    const ctx = buildAiContext(baseState(), TODAY);
    expect(ctx.actual.todayNutrition.known).toBe(false);
    if (!ctx.actual.todayNutrition.known) {
      expect(ctx.actual.todayNutrition.reason).toContain('不等于摄入 0');
    }
  });

  it('渲染文本里缺失项显式出现，而不是被省略', () => {
    const text = renderContext(buildAiContext(baseState(), TODAY));
    expect(text).toContain('数据缺失');
    expect(text).toContain('不要用编造的数字填补');
    expect(text).toContain('未知');
  });

  it('有体重记录时取最新一条（按日期）', () => {
    const weights: WeightEntry[] = [
      { id: 'w1', date: '2026-10-01', grams: 80000 },
      { id: 'w2', date: '2026-10-24', grams: 78200 },
    ];
    const ctx = buildAiContext(baseState({ weights }), TODAY);
    expect(ctx.actual.latestWeightKg.known).toBe(true);
    if (ctx.actual.latestWeightKg.known) expect(ctx.actual.latestWeightKg.value).toBe(78.2);
  });

  it('只统计今天的饮食，不混入昨天', () => {
    const foods: FoodEntry[] = [
      { id: 'f1', date: TODAY, slot: 'breakfast', label: '鸡蛋', kcal: 140, protein: 12, createdAt: '' },
      { id: 'f2', date: '2026-10-24', slot: 'lunch', label: '米饭', kcal: 300, protein: 6, createdAt: '' },
    ];
    const ctx = buildAiContext(baseState({ foods }), TODAY);
    expect(ctx.actual.todayNutrition.known).toBe(true);
    if (ctx.actual.todayNutrition.known) {
      expect(ctx.actual.todayNutrition.value.kcal).toBe(140);
      expect(ctx.actual.todayNutrition.value.entries).toBe(1);
    }
  });
});

describe('AC-AI01 · 计划与实际不混淆', () => {
  it('计划 4 组不会被当成已完成 4 组', () => {
    // 只完成 2 组，targetSets 是 4
    const s = session('2026-10-24', [set(100000, 5), set(100000, 5)]);
    const ctx = buildAiContext(baseState({ sessions: [s] }), TODAY);
    expect(ctx.actual.recentSessions[0]!.sets).toBe(2);
  });

  it('未选择模板时计划字段标记为未知', () => {
    const ctx = buildAiContext(baseState(), TODAY);
    expect(ctx.planned.activeTemplate.known).toBe(false);
  });

  it('周目标为 0 时标记为未知并列入缺失', () => {
    const ctx = buildAiContext(baseState({ weeklyGoal: 0 }), TODAY);
    expect(ctx.planned.weeklyGoal.known).toBe(false);
    expect(ctx.missing.some((m) => m.includes('每周训练次数'))).toBe(true);
  });

  it('目标会出现在计划数据里', () => {
    const ctx = buildAiContext(
      baseState({
        goals: [{ kind: 'bodyweight', targetGrams: 70000, startGrams: 80000, targetDate: null, createdAt: '' }],
      }),
      TODAY,
    );
    expect(ctx.planned.goals.some((g) => g.includes('70'))).toBe(true);
  });
});

describe('AC-AI01 · 隐私边界', () => {
  it('上下文不含姓名', () => {
    const text = renderContext(buildAiContext(baseState(), TODAY));
    expect(text).not.toContain('测试');
  });

  it('上下文不含 datasetId', () => {
    const text = renderContext(buildAiContext(baseState(), TODAY));
    expect(text).not.toContain('ds_test');
  });

  it('只取最近 8 场训练，避免上下文过大', () => {
    const sessions = Array.from({ length: 15 }, (_, i) =>
      session(`2026-09-${String(i + 1).padStart(2, '0')}`, [set(100000, 5)]),
    );
    const ctx = buildAiContext(baseState({ sessions }), TODAY);
    expect(ctx.actual.recentSessions.length).toBe(8);
    expect(ctx.actual.sessionCount).toBe(15);
  });

  it('无效场次不计入统计', () => {
    const sessions = [session('2026-10-24', [set(100000, 5)], { status: 'discarded' })];
    const ctx = buildAiContext(baseState({ sessions }), TODAY);
    expect(ctx.actual.sessionCount).toBe(0);
  });
});
