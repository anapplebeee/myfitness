/** 领域类型：v1 事实模型的最小可用子集（见 docs/11-data-model.md）。 */

import type { PlannedOccurrence, WeekGoal } from './week';
import type { Template } from '../content/types';

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
  /** 最近一次编辑时间，用于审计展示。 */
  editedAt?: string;
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
  /**
   * 记账时区。
   *
   * 目前**没有代码读取它**——业务日期由 units.ts 的 businessDate()
   * 按设备本地时区计算。保留字段是为了兼容已有导出文件，
   * 不要据此认为"跨时区问题已处理"：那需要真正实现时区感知的业务日期，
   * 是独立工作量。快照层面的时区口径见 sync.ts 的 ACCOUNTING_TIMEZONE。
   */
  accountingTimezone?: string;
  /** 补录时间，仅表示录入晚，不降低事实可信度。 */
  backfilledAt?: string;
  /** 删除墓碑；统计与列表按此过滤，不物理删除事实。 */
  deletedAt?: string;
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
  /**
   * 来源。`plan` 表示"按计划完成"的占位条目：
   * 手动记录同一餐次时会自动替换它，避免计划与实际重复计数。
   */
  source?: 'plan' | 'manual';
  createdAt: string;
}

export interface WeightEntry {
  id: Id;
  date: string;
  grams: number;
  note?: string;
}

/** 一次饮水记录（毫升）。按条记录而不是只存每日总量，才能做"撤销"和"什么时候喝的"。 */
export interface WaterEntry {
  id: Id;
  date: string;
  ml: number;
  createdAt: string;
}

/** 8 类常见过敏原代码。 */
export type AllergenCode =
  | 'gluten'
  | 'egg'
  | 'milk'
  | 'soy'
  | 'peanut'
  | 'treenut'
  | 'fish'
  | 'shellfish';

/** 三态：不能只用布尔值，否则无法区分"确认不含"与"未标注"。 */
export type AllergenPresence = 'contains' | 'mayContain' | 'free';

/** 限制类型；allergen 走确定性过滤，其余走提示。 */
export type RestrictionKind = 'allergen' | 'intolerance' | 'religious' | 'medical' | 'preference';

/** strict 排除 contains+mayContain；avoid 只排除 contains 并提示 mayContain。 */
export type RestrictionSeverity = 'avoid' | 'strict';

export interface DietRestriction {
  id: string;
  kind: RestrictionKind;
  code: string;
  label: string;
  severity: RestrictionSeverity;
  source: string;
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

import type { Goal } from './goals';

/**
 * 本地提醒设置。
 *
 * 不依赖服务端：原生端用 Capacitor Local Notifications，网页端用系统通知 +
 * 前台计时降级。所有字段都可缺省，旧数据读取时回落到默认值。
 */
export interface ReminderSettings {
  workoutEnabled: boolean;
  /** HH:mm */
  workoutTime: string;
  waterEnabled: boolean;
  /** 每多少分钟提醒一次 */
  waterIntervalMin: number;
  /** HH:mm */
  waterStart: string;
  /** HH:mm */
  waterEnd: string;
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
  /** 用户设定的目标（体重/力量/频率），可为空数组。 */
  goals: Goal[];
  targetKcal: number | null;
  targetProtein: number | null;
  /**
   * 每日饮水记录。旧数据没有这个字段，读取时按空数组处理，
   * 所以这里保持可选，避免破坏已有的导入文件与测试夹具。
   */
  water?: WaterEntry[];
  /** 每日饮水目标（ml）。可改；未设置时界面用参考值并明确标注。 */
  waterGoalMl?: number;
  /** 本地提醒设置（训练 / 喝水）。旧数据没有，读取时回落到默认值。 */
  reminders?: ReminderSettings;
  /**
   * 示例数据标识。引导时选择"保留示例数据"为 true，"从空白开始"为 false。
   * 顶栏据此常驻"示例数据"标记，避免示例记录被当成真实数据。
   */
  demoMode?: boolean;
  weeklyGoal: number;
  onboarded: boolean;
  /** 周计划发生项与周目标（09 号模型）。 */
  occurrences: PlannedOccurrence[];
  weekGoals: WeekGoal[];
  /** 计划生效日；换模板只影响此日之后的安排。 */
  activeTemplateSince: string | null;
  /** 用户自建或改版后的模板；内置模板仍在内容库。 */
  customTemplates: Template[];
  /** 稳定数据集 ID，用于区分不同来源的导出文件。 */
  datasetId: string;
  /** 最近一次替换前自动备份的存储键。 */
  lastBackupKey: string | null;
}





