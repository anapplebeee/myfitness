/**
 * AI 上下文构造。
 *
 * 关键约束（AC-AI01）：上下文必须区分三类信息——
 *   actual   实际发生了什么（已完成的训练、已记录的饮食与体重）
 *   planned  计划要做什么（模板、周目标）
 *   missing  数据缺失（没记录、没设目标、该字段为空）
 *
 * 为什么必须区分：模型很容易把"计划 4 组"当成"已完成 4 组"，
 * 或把"没记录饮食"当成"摄入 0 卡"。把 missing 显式写进上下文，
 * 模型才不会用编造的数字填空白。
 *
 * 隐私：只发送与训练/饮食/体重相关的聚合数据，
 * 不发送姓名、datasetId、同步配置、密钥。
 */

import type { AppState } from './types';
import { completedWorkingSets, isValidCompleted, sessionVolumeGrams } from './metrics';
import { exerciseName } from '../content/exercises';

export type ContextField<T> = { known: true; value: T } | { known: false; reason: string };

export interface TrainingSummary {
  businessDate: string;
  title: string;
  sets: number;
  volumeKg: number;
  exercises: { name: string; sets: string[] }[];
}

export interface AiContext {
  /** 实际数据 */
  actual: {
    recentSessions: TrainingSummary[];
    sessionCount: number;
    latestWeightKg: ContextField<number>;
    todayNutrition: ContextField<{ kcal: number; proteinG: number; entries: number }>;
  };
  /** 计划数据 */
  planned: {
    weeklyGoal: ContextField<number>;
    activeTemplate: ContextField<string>;
    goals: string[];
  };
  /** 缺失说明 */
  missing: string[];
}

/**
 * 构造发给模型的上下文。
 *
 * @param today 业务日期（yyyy-mm-dd），由调用方注入，便于测试
 */
export function buildAiContext(state: AppState, today: string): AiContext {
  const missing: string[] = [];

  const valid = state.sessions.filter(isValidCompleted);
  const sorted = [...valid].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const recent = sorted.slice(0, 8);

  const recentSessions: TrainingSummary[] = recent.map((s) => ({
    businessDate: s.businessDate,
    title: s.title,
    sets: completedWorkingSets(s),
    volumeKg: Math.round(sessionVolumeGrams(s) / 1000),
    exercises: s.exercises.map((ex) => ({
      name: exerciseName(ex.exerciseId),
      sets: ex.sets
        .filter((x) => x.kind === 'work' && x.status === 'completed')
        .map((x) =>
          x.loadGrams !== null && x.reps !== null
            ? `${x.loadGrams / 1000}kg×${x.reps}`
            : x.reps !== null
              ? `自重×${x.reps}`
              : x.durationSeconds !== null
                ? `${x.durationSeconds}s`
                : '—',
        ),
    })),
  }));

  if (!recentSessions.length) missing.push('还没有任何已完成的训练记录');

  const weights = [...state.weights].sort((a, b) => (a.date < b.date ? 1 : -1));
  const latestWeight: ContextField<number> = weights[0]
    ? { known: true, value: weights[0].grams / 1000 }
    : { known: false, reason: '没有体重记录' };
  if (!weights.length) missing.push('没有体重记录，无法评估体重趋势');

  const todayFoods = state.foods.filter((f) => f.date === today);
  const nutrition: ContextField<{ kcal: number; proteinG: number; entries: number }> = todayFoods.length
    ? {
        known: true,
        value: {
          kcal: Math.round(todayFoods.reduce((a, f) => a + (f.kcal ?? 0), 0)),
          proteinG: Math.round(todayFoods.reduce((a, f) => a + (f.protein ?? 0), 0)),
          entries: todayFoods.length,
        },
      }
    : { known: false, reason: '今天没有饮食记录（这不等于摄入 0）' };
  if (!todayFoods.length) missing.push('今天没有饮食记录，不能据此判断摄入量');

  const weeklyGoal: ContextField<number> =
    state.weeklyGoal > 0 ? { known: true, value: state.weeklyGoal } : { known: false, reason: '未设置每周训练次数' };
  if (state.weeklyGoal <= 0) missing.push('未设置每周训练次数目标');

  const tpl = state.customTemplates.find((t) => t.id === state.activeTemplateId);
  const activeTemplate: ContextField<string> = tpl
    ? { known: true, value: `${tpl.title}（${tpl.days.length} 天/周）` }
    : { known: false, reason: '未选择训练模板' };

  const goals = state.goals.map((g) => {
    if (g.kind === 'bodyweight') return `体重目标 ${g.targetGrams / 1000}kg`;
    if (g.kind === 'strength') return `力量目标 ${exerciseName(g.exerciseId)} ${g.targetGrams / 1000}kg`;
    return `每周训练 ${g.perWeek} 次`;
  });

  return {
    actual: {
      recentSessions,
      sessionCount: valid.length,
      latestWeightKg: latestWeight,
      todayNutrition: nutrition,
    },
    planned: {
      weeklyGoal,
      activeTemplate,
      goals,
    },
    missing,
  };
}

/**
 * 把上下文渲染成给模型的文本。
 *
 * 明确写出"缺失"而不是省略，是为了让模型知道哪些数字不能编。
 */
export function renderContext(ctx: AiContext): string {
  const lines: string[] = [];

  lines.push('【实际数据】');
  lines.push(`- 已完成训练总场次：${ctx.actual.sessionCount}`);
  lines.push(
    `- 最近体重：${
      ctx.actual.latestWeightKg.known
        ? `${ctx.actual.latestWeightKg.value} kg`
        : `未知（${ctx.actual.latestWeightKg.reason}）`
    }`,
  );
  lines.push(
    `- 今日饮食：${
      ctx.actual.todayNutrition.known
        ? `${ctx.actual.todayNutrition.value.kcal} kcal / 蛋白 ${ctx.actual.todayNutrition.value.proteinG} g / ${ctx.actual.todayNutrition.value.entries} 条记录`
        : `未知（${ctx.actual.todayNutrition.reason}）`
    }`,
  );

  if (ctx.actual.recentSessions.length) {
    lines.push('- 最近训练：');
    for (const s of ctx.actual.recentSessions) {
      lines.push(`  · ${s.businessDate} ${s.title}：${s.sets} 组，容量 ${s.volumeKg} kg`);
      for (const ex of s.exercises) {
        if (ex.sets.length) lines.push(`    - ${ex.name}：${ex.sets.join('，')}`);
      }
    }
  }

  lines.push('');
  lines.push('【计划数据】');
  lines.push(
    `- 每周训练目标：${
      ctx.planned.weeklyGoal.known ? `${ctx.planned.weeklyGoal.value} 次` : `未知（${ctx.planned.weeklyGoal.reason}）`
    }`,
  );
  lines.push(
    `- 当前模板：${
      ctx.planned.activeTemplate.known ? ctx.planned.activeTemplate.value : `未知（${ctx.planned.activeTemplate.reason}）`
    }`,
  );
  lines.push(`- 已设目标：${ctx.planned.goals.length ? ctx.planned.goals.join('；') : '无'}`);

  if (ctx.missing.length) {
    lines.push('');
    lines.push('【数据缺失——不要用编造的数字填补】');
    for (const m of ctx.missing) lines.push(`- ${m}`);
  }

  return lines.join('\n');
}

