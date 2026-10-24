/** 领域类型：v1 事实模型的最小可用子集（见 docs/11-data-model.md）。 */

export type Id = string;

export type LoadConvention = 'totalExternal' | 'perImplement' | 'bodyweight' | 'added' | 'assistance';
export type TrackingMode = 'load_reps' | 'reps' | 'duration' | 'distance_duration';

export interface Exercise {
  id: Id;
  name: string;
  alias?: string[];
  group: MuscleGroup;
  equipment: string;
  mode: TrackingMode;
  load: LoadConvention;
  implementCount?: number;
  cues?: string[];
  alternatives?: Id[];
}

export type MuscleGroup =
  | 'chest'
  | 'back'
  | 'legs'
  | 'glutes'
  | 'shoulders'
  | 'arms'
  | 'core'
  | 'cardio';

export interface PlanDay {
  id: Id;
  title: string;
  slot: number;
  exercises: PlanExercise[];
}

export interface PlanExercise {
  exerciseId: Id;
  sets: number;
  repMin: number;
  repMax: number;
  restSeconds: number;
  incrementGrams: number;
}

export interface Template {
  id: Id;
  title: string;
  subtitle: string;
  daysPerWeek: number;
  level: 'beginner' | 'intermediate';
  equipment: 'gym' | 'home' | 'minimal';
  days: PlanDay[];
  progression: string;
  version: number;
}

export type SetKind = 'warmup' | 'work';
export type SetStatus = 'planned' | 'completed' | 'skipped';

export interface SetRecord {
  id: Id;
  kind: SetKind;
  status: SetStatus;
  loadGrams: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  rpe: number | null;
  completedAt: string | null;
}

export interface SessionExercise {
  id: Id;
  exerciseId: Id;
  order: number;
  targetSets: number;
  repMin: number;
  repMax: number;
  restSeconds: number;
  incrementGrams: number;
  sets: SetRecord[];
}

export type SessionStatus = 'active' | 'paused' | 'completed' | 'discarded';

export interface Session {
  id: Id;
  templateId: Id | null;
  dayId: Id | null;
  title: string;
  status: SessionStatus;
  startedAt: string;
  endedAt: string | null;
  businessDate: string;
  restEndsAt: string | null;
  note: string;
  exercises: SessionExercise[];
  /** 匹配的项目；完成关联的唯一权威引用（11:27）。 */
  occurrenceId?: Id;
  /** 仅由用户显式确认写入；不因计划更新而改变。 */
  goalCreditConfirmed?: boolean;
  /** 完成依据：逐组 / 本人补录 / 旧数据导入。 */
  completionBasis?: 'sets' | 'selfReported' | 'legacyReported';
  /** 记账时区，用于跨时区不重归历史。 */
  accountingTimezone?: string;
  /** 补录时间，仅表示录入晚，不降低事实可信度。 */
  backfilledAt?: string;
}

export type Slot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface FoodEntry {
  id: Id;
  date: string;
  slot: Slot;
  label: string;
  kcal: number;
  protein: number;
  carb?: number;
  fat?: number;
  createdAt: string;
}

export interface WeightEntry {
  id: Id;
  date: string;
  grams: number;
  note?: string;
}

export interface Profile {
  name: string;
  experience: 'beginner' | 'intermediate' | 'advanced';
  equipment: 'gym' | 'home' | 'minimal';
  weeklyTarget: number;
  heightCm: number | null;
  sex: 'male' | 'female' | null;
  birthYear: number | null;
  activity: number | null;
  restrictions: string[];
  allergies: string[];
  restrictionsConfirmed: boolean;
}

export interface Targets {
  kcal: number;
  protein: number;
  carb: number;
  fat: number;
}

export interface AppState {
  version: 2;
  createdAt: string;
  profile: Profile;
  activeTemplateId: Id | null;
  sessions: Session[];
  weights: WeightEntry[];
  foods: FoodEntry[];
  bodyGoalGrams: number | null;
  targetKcal: number | null;
  targetProtein: number | null;
  weeklyGoal: number;
  onboarded: boolean;
}
