/** 首次进入时的示例数据：让空状态也有可信的内容，而不是白屏。 */

import type { AppState, Session, SetRecord } from '../domain/types';
import { addDays, businessDate } from '../domain/units';
import { TEMPLATES } from '../content/exercises';

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

  return {
    version: 2,
    createdAt: new Date().toISOString(),
    onboarded: true,
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
    sessions: sessions.sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1)),
    weights,
    foods,
    bodyGoalGrams: 74000,
    targetKcal: 2350,
    targetProtein: 165,
    weeklyGoal: 4,
  };
}
