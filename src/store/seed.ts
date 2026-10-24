/** 首次进入时的示例数据：让空状态也有可信的内容，而不是白屏。 */

import type { AppState, Session, SetRecord } from '../domain/types';
import { addDays, businessDate } from '../domain/units';
import { TEMPLATES } from '../content/exercises';
import { buildOccurrences, mondayOf } from '../domain/plan';
import { initialWeekGoal, type PlannedOccurrence, type WeekGoal } from '../domain/week';

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function makeSets(count: number, load: number, reps: number, done: boolean): SetRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    id: uid('set'),
    kind: i === 0 && count > 3 ? 'warmup' : 'work',
    status: done ? 'completed' : 'planned',
    loadGrams: i === 0 && count > 3 ? Math.round(load * 0.6) : load,
    reps: i === 0 && count > 3 ? 10 : reps,
    durationSeconds: null,
    distanceMeters: null,
    rpe: done ? 7.5 : null,
    completedAt: done ? new Date().toISOString() : null,
  }));
}

export function seedState(): AppState {
  const today = businessDate();
  const template = TEMPLATES[2] ?? TEMPLATES[0]!;

  const sessions: Session[] = [];
  const baseWeights = new Map<string, number>([
    ['bb-bench', 72500],
    ['bb-squat', 95000],
    ['bb-row', 60000],
    ['ohp', 42500],
    ['rdl', 80000],
    ['lat-pulldown', 55000],
    ['leg-press', 120000],
  ]);

  for (let week = 12; week >= 1; week -= 1) {
    const perWeek = week % 2 === 0 ? 4 : 3;
    for (let i = 0; i < perWeek; i += 1) {
      const dayIndex = (week + i) % template.days.length;
      const day = template.days[dayIndex];
      if (!day) continue;
      const date = addDays(today, -(week * 7 - i * 2));
      const started = new Date(`${date}T19:${String(10 + i * 7).padStart(2, '0')}:00`);
      const progress = (12 - week) / 12;
      sessions.push({
        id: uid('s'),
        templateId: template.id,
        dayId: day.id,
        title: day.title,
        status: 'completed',
        startedAt: started.toISOString(),
        endedAt: new Date(started.getTime() + 62 * 60 * 1000).toISOString(),
        businessDate: date,
        restEndsAt: null,
        note: '',
        exercises: day.exercises.map((pe, order) => ({
          id: uid('se'),
          exerciseId: pe.exerciseId,
          order,
          targetSets: pe.sets,
          repMin: pe.repMin,
          repMax: pe.repMax,
          restSeconds: pe.restSeconds,
          incrementGrams: pe.incrementGrams,
          sets: makeSets(
            pe.sets,
            Math.round(((baseWeights.get(pe.exerciseId) ?? 40000) * (1 + progress * 0.12)) / 2500) * 2500,
            Math.round((pe.repMin + pe.repMax) / 2),
            true,
          ),
        })),
      });
    }
  }

  const weights = Array.from({ length: 14 }, (_, i) => {
    const date = addDays(today, -i * 3);
    return {
      id: uid('w'),
      date,
      grams: Math.round((78200 - i * 95 + (i % 3) * 180) / 100) * 100,
    };
  }).reverse();

  const foods = [
    { slot: 'breakfast' as const, label: '燕麦片 + 牛奶', kcal: 420, protein: 24 },
    { slot: 'lunch' as const, label: '鸡胸肉饭 + 西兰花', kcal: 720, protein: 52 },
    { slot: 'snack' as const, label: '乳清蛋白粉', kcal: 150, protein: 28 },
  ].map((f, i) => ({
    id: uid('f'),
    date: today,
    slot: f.slot,
    label: f.label,
    kcal: f.kcal,
    protein: f.protein,
    createdAt: new Date(`${today}T${String(8 + i * 3).padStart(2, '0')}:00:00`).toISOString(),
  }));

  // 历史周的计划：按模板生成，并把已完成的会话挂到对应项目上
  const historyWeeks = 4;
  const occurrences: PlannedOccurrence[] = [];
  const weekGoals: WeekGoal[] = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}_${(seq += 1).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  for (let back = historyWeeks; back >= -3; back -= 1) {
    const weekStart = addDays(mondayOf(today), -back * 7);
    const built = buildOccurrences({
      template,
      fromWeekStart: weekStart,
      weeks: 1,
      today: addDays(weekStart, -7),
      idFactory: nextId,
    });
    occurrences.push(...built);
    weekGoals.push(initialWeekGoal(weekStart, built));
  }

  // 把已完成会话按日期匹配到同日项目，模拟真实使用后的状态
  for (const s of sessions) {
    const day = occurrences.find(
      (o) => o.weekStart === mondayOf(s.businessDate) && o.scheduledDate === s.businessDate,
    );
    if (!day) continue;
    s.occurrenceId = day.id;
    s.goalCreditConfirmed = true;
  }

  // 给最近一周加一个豁免示例，让界面能展示"原始 N → 调整后 A"
  const currentWeek = mondayOf(today);
  const currentWeekOcc = occurrences.filter((o) => o.weekStart === currentWeek);
  const lastFuture = [...currentWeekOcc].reverse().find((o) => o.scheduledDate > today);
  if (lastFuture) {
    lastFuture.disposition = 'excused';
    lastFuture.dispositionReason = '出差';
    lastFuture.disposedAt = new Date().toISOString();
    const goal = weekGoals.find((g) => g.weekStart === currentWeek);
    if (goal) {
      const A = currentWeekOcc.filter((o) => o.disposition === 'scheduled').length;
      goal.minimumTarget = Math.min(goal.minimumTarget, A);
    }
  }

  return {
    version: 2,
    createdAt: new Date().toISOString(),
    // 首次启动必须走引导：新用户不该一打开就看到 42 场示例训练并误以为是自己的数据
    onboarded: false,
    profile: {
      name: '',
      experience: 'intermediate',
      equipment: 'gym',
      weeklyTarget: 4,
      heightCm: 176,
      sex: 'male',
      birthYear: 1994,
      activity: 1.5,
      restrictions: [],
      allergies: [],
      restrictionsConfirmed: false,
    },
    activeTemplateId: template.id,
    activeTemplateSince: addDays(today, -historyWeeks * 7),
    sessions: sessions.sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1)),
    weights,
    foods,
    goals: [],
    bodyGoalGrams: 74000,
    targetKcal: 2350,
    targetProtein: 165,
    weeklyGoal: 4,
    occurrences,
    weekGoals: weekGoals.sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1)),
    customTemplates: [],
    datasetId: `ds_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    lastBackupKey: null,
  };
}





