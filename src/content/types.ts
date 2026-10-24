/** 内容库类型：模板与动作的结构定义。 */

import type { MuscleGroup, TrackingMode, LoadConvention } from '../domain/types';

export interface Exercise {
  id: string;
  name: string;
  alias?: string[];
  group: MuscleGroup;
  equipment: string;
  mode: TrackingMode;
  load: LoadConvention;
  implementCount?: number;
  cues?: string[];
  alternatives?: string[];
}

export interface PlanExercise {
  exerciseId: string;
  sets: number;
  repMin: number;
  repMax: number;
  restSeconds: number;
  incrementGrams: number;
}

export interface PlanDay {
  id: string;
  title: string;
  /** 0 = 周一 …… 6 = 周日。 */
  slot: number;
  exercises: PlanExercise[];
}

export interface Template {
  id: string;
  title: string;
  subtitle: string;
  daysPerWeek: number;
  level: 'beginner' | 'intermediate';
  equipment: 'gym' | 'home' | 'minimal';
  version: number;
  progression: string;
  days: PlanDay[];
}

export interface Food {
  id: string;
  name: string;
  alias?: string[];
  group: 'protein' | 'carb' | 'fat' | 'veg' | 'dairy' | 'fruit' | 'snack';
  kcal: number;
  protein: number;
  carb: number;
  fat: number;
  portion: { label: string; grams: number };
}
