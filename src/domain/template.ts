/**
 * 模板编辑与版本化：按 11:51 与 09:25。
 *
 * 关键约束：
 * - 模板是版本化实体；改动生成新版本，不原地修改历史。
 * - 换版只影响生效日后未开始的项目；已开始/完成项目和历史会话保持。
 * - 版本号参与 planVersionId，因此新版本自然产生新的发生项身份。
 */

import type { PlanDay, PlanExercise, Template } from '../content/types';
import { EXERCISE_BY_ID } from '../content/exercises';

export interface TemplateIssue {
  path: string;
  message: string;
}

const MAX_SETS = 10;
const MIN_REPS = 1;
const MAX_REPS = 100;
const MIN_REST = 0;
const MAX_REST = 600;

export function validateTemplate(t: Template): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  if (!t.title.trim()) issues.push({ path: 'title', message: '模板需要一个名称' });
  if (!t.days.length) issues.push({ path: 'days', message: '至少需要一个训练日' });
  if (t.days.length > 7) issues.push({ path: 'days', message: '一周最多 7 个训练日' });

  const slots = new Set<number>();
  for (const day of t.days) {
    if (day.slot < 0 || day.slot > 6) {
      issues.push({ path: `day.${day.id}.slot`, message: '训练日必须在周一到周日之间' });
    }
    if (slots.has(day.slot)) {
      issues.push({ path: `day.${day.id}.slot`, message: '同一天不能有两个训练日' });
    }
    slots.add(day.slot);

    if (!day.exercises.length) {
      issues.push({ path: `day.${day.id}.exercises`, message: `${day.title} 至少需要一个动作` });
    }
    if (day.exercises.length > 12) {
      issues.push({ path: `day.${day.id}.exercises`, message: `${day.title} 动作过多，建议不超过 12 个` });
    }

    for (const ex of day.exercises) {
      const name = EXERCISE_BY_ID.get(ex.exerciseId)?.name ?? '未知动作';
      if (!EXERCISE_BY_ID.has(ex.exerciseId)) {
        issues.push({ path: `day.${day.id}.${ex.exerciseId}`, message: `动作不存在：${ex.exerciseId}` });
      }
      if (ex.sets < 1 || ex.sets > MAX_SETS) {
        issues.push({ path: `day.${day.id}.${ex.exerciseId}.sets`, message: `${name} 的组数需在 1–${MAX_SETS} 之间` });
      }
      if (ex.repMin < MIN_REPS || ex.repMin > MAX_REPS) {
        issues.push({ path: `day.${day.id}.${ex.exerciseId}.repMin`, message: `${name} 的次数下限不合法` });
      }
      if (ex.repMax < ex.repMin || ex.repMax > MAX_REPS) {
        issues.push({ path: `day.${day.id}.${ex.exerciseId}.repMax`, message: `${name} 的次数上限必须不小于下限` });
      }
      if (ex.restSeconds < MIN_REST || ex.restSeconds > MAX_REST) {
        issues.push({ path: `day.${day.id}.${ex.exerciseId}.rest`, message: `${name} 的休息需在 0–${MAX_REST} 秒之间` });
      }
    }
  }
  return issues;
}

export function cloneTemplate(t: Template): Template {
  return {
    ...t,
    days: t.days.map((d) => ({
      ...d,
      exercises: d.exercises.map((e) => ({ ...e })),
    })),
  };
}

/** 生成新版本：版本号 +1，其余内容不变。 */
export function bumpVersion(t: Template): Template {
  return { ...cloneTemplate(t), version: t.version + 1 };
}

export function blankTemplate(id: string, title = '我的计划'): Template {
  return {
    id,
    title,
    subtitle: '自建计划',
    daysPerWeek: 1,
    level: 'beginner',
    equipment: 'gym',
    version: 1,
    progression: '达到重复区间上限后加最小配重；达不到下限则保持重量',
    days: [
      {
        id: `${id}-d0`,
        title: '训练日 1',
        slot: 0,
        exercises: [],
      },
    ],
  };
}

export function addDay(t: Template, id: string, slot: number): Template {
  const next = cloneTemplate(t);
  next.days.push({
    id,
    title: `训练日 ${next.days.length + 1}`,
    slot: Math.min(6, Math.max(0, slot)),
    exercises: [],
  });
  next.daysPerWeek = next.days.length;
  return next;
}

export function removeDay(t: Template, dayId: string): Template {
  const next = cloneTemplate(t);
  next.days = next.days.filter((d) => d.id !== dayId);
  next.daysPerWeek = Math.max(1, next.days.length);
  return next;
}

export function updateDay(t: Template, dayId: string, patch: Partial<Pick<PlanDay, 'title' | 'slot'>>): Template {
  const next = cloneTemplate(t);
  const day = next.days.find((d) => d.id === dayId);
  if (day) Object.assign(day, patch);
  return next;
}

export function addExercise(t: Template, dayId: string, ex: PlanExercise): Template {
  const next = cloneTemplate(t);
  const day = next.days.find((d) => d.id === dayId);
  if (day) day.exercises.push({ ...ex });
  return next;
}

export function removeExercise(t: Template, dayId: string, index: number): Template {
  const next = cloneTemplate(t);
  const day = next.days.find((d) => d.id === dayId);
  if (day && index >= 0 && index < day.exercises.length) day.exercises.splice(index, 1);
  return next;
}

export function updateExercise(
  t: Template,
  dayId: string,
  index: number,
  patch: Partial<PlanExercise>,
): Template {
  const next = cloneTemplate(t);
  const day = next.days.find((d) => d.id === dayId);
  const ex = day?.exercises[index];
  if (ex) Object.assign(ex, patch);
  return next;
}

export function moveExercise(t: Template, dayId: string, index: number, delta: number): Template {
  const next = cloneTemplate(t);
  const day = next.days.find((d) => d.id === dayId);
  if (!day) return next;
  const target = index + delta;
  if (target < 0 || target >= day.exercises.length) return next;
  const [item] = day.exercises.splice(index, 1);
  if (item) day.exercises.splice(target, 0, item);
  return next;
}

export function defaultPlanExercise(exerciseId: string): PlanExercise {
  return {
    exerciseId,
    sets: 3,
    repMin: 8,
    repMax: 12,
    restSeconds: 90,
    incrementGrams: 2500,
  };
}

/** 简述模板规模，用于列表展示。 */
export function templateSummary(t: Template): string {
  const total = t.days.reduce((s, d) => s + d.exercises.length, 0);
  return `${t.days.length} 天 · ${total} 个动作`;
}

/** 改动是否会影响未来安排（有内容变化才值得升版本）。 */
export function isSameTemplate(a: Template, b: Template): boolean {
  const strip = (t: Template) => JSON.stringify({ ...t, version: 0 });
  return strip(a) === strip(b);
}
