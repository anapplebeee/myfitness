import type { LoadConvention, MuscleGroup, TrackingMode } from '../domain/types';
import type { Exercise, Template } from './types';
import { EXERCISE_PACKS, packExercisesToLibrary } from './packs';

export type { Exercise, Template } from './types';

export const MUSCLES: Array<{ id: MuscleGroup; label: string; short: string }> = [
  { id: 'chest', label: '胸部', short: '胸' },
  { id: 'back', label: '背部', short: '背' },
  { id: 'legs', label: '腿部', short: '腿' },
  { id: 'glutes', label: '臀部', short: '臀' },
  { id: 'shoulders', label: '肩部', short: '肩' },
  { id: 'arms', label: '手臂', short: '臂' },
  { id: 'core', label: '核心', short: '核' },
  { id: 'cardio', label: '有氧', short: '氧' },
];

interface ExerciseOptions {
  mode?: TrackingMode;
  load?: LoadConvention;
  implementCount?: number;
}

const e = (
  id: string,
  name: string,
  group: MuscleGroup,
  equipment: string,
  cues: string[],
  alternatives: string[] = [],
  options: ExerciseOptions = {},
): Exercise => ({
  id,
  name,
  group,
  equipment,
  mode: options.mode ?? 'load_reps',
  load: options.load ?? 'totalExternal',
  ...(options.implementCount ? { implementCount: options.implementCount } : {}),
  cues,
  alternatives,
});

const BUILTIN_EXERCISES: Exercise[] = [
  e('bb-squat', '杠铃深蹲', 'legs', '杠铃', ['脚掌三点着地', '下蹲至大腿平行', '核心持续收紧'], ['goblet-squat', 'leg-press']),
  e('goblet-squat', '高脚杯深蹲', 'legs', '哑铃', ['哑铃贴胸', '膝盖与脚尖同向'], ['bb-squat', 'leg-press']),
  e('leg-press', '腿举', 'legs', '器械', ['腰背贴紧靠垫', '不要锁死膝盖'], ['bb-squat']),
  e('rdl', '罗马尼亚硬拉', 'legs', '杠铃', ['髋后移', '背部中立', '杠贴腿'], ['db-rdl', 'hip-thrust']),
  e('db-rdl', '哑铃硬拉', 'legs', '哑铃', ['肩胛稳定', '控制离心'], ['rdl']),
  e('leg-curl', '腿弯举', 'legs', '器械', ['慢速离心', '不要甩'], []),
  e('leg-extension', '腿屈伸', 'legs', '器械', ['顶点停顿', '避免弹震'], []),
  e('calf-raise', '站姿提踵', 'legs', '器械', ['全幅度', '顶点收缩一秒'], []),

  e('hip-thrust', '杠铃臀推', 'glutes', '杠铃', ['下巴微收', '顶峰夹臀'], ['glute-bridge']),
  e('glute-bridge', '臀桥', 'glutes', '自重', ['脚跟发力', '肋骨下沉'], ['hip-thrust']),
  e('hip-abduction', '坐姿外展', 'glutes', '器械', ['控制回位', '不要借力'], []),

  e('bb-bench', '杠铃卧推', 'chest', '杠铃', ['肩胛后缩下沉', '杠落至胸线', '手腕中立'], ['db-bench', 'pushup']),
  e('db-bench', '哑铃卧推', 'chest', '哑铃', ['下放到肘略低于肩', '双脚踩实'], ['bb-bench', 'pushup']),
  e('incline-db', '上斜哑铃卧推', 'chest', '哑铃', ['30 度上斜', '推到锁骨上方'], ['bb-bench']),
  e('cable-fly', '绳索夹胸', 'chest', '器械', ['肘微屈固定', '顶峰挤压'], ['pushup']),
  e('pushup', '俯卧撑', 'chest', '自重', ['身体成一条线', '肘约 45 度'], ['db-bench'], { mode: 'reps', load: 'bodyweight' }),
  e('dip', '双杠臂屈伸', 'chest', '自重', ['肩不要耸', '下放到舒适深度'], ['pushup'], { mode: 'reps', load: 'bodyweight' }),

  e('pullup', '引体向上', 'back', '自重', ['先沉肩', '胸口靠近横杆'], ['lat-pulldown'], { mode: 'reps', load: 'bodyweight' }),
  e('lat-pulldown', '高位下拉', 'back', '器械', ['肘向下向后', '不要后仰过多'], ['pullup']),
  e('bb-row', '杠铃划船', 'back', '杠铃', ['髋铰链', '拉到下腹'], ['db-row']),
  e('db-row', '单臂哑铃划船', 'back', '哑铃', ['躯干稳定', '肘贴身体'], ['bb-row']),
  e('seated-row', '坐姿划船', 'back', '器械', ['肩胛后缩', '不要用腰甩'], ['cable-row']),
  e('cable-row', '绳索划船', 'back', '器械', ['核心稳定', '慢速回位'], ['seated-row']),
  e('face-pull', '面拉', 'back', '器械', ['拉向面部', '外旋收尾'], []),
  e('shrug', '耸肩', 'back', '哑铃', ['直上直下', '顶点停顿'], []),

  e('ohp', '站姿推举', 'shoulders', '杠铃', ['核心收紧', '杠过头顶'], ['db-shoulder-press']),
  e('db-shoulder-press', '哑铃肩推', 'shoulders', '哑铃', ['不要塌腰', '控制下放'], ['ohp']),
  e('lateral-raise', '侧平举', 'shoulders', '哑铃', ['小指略高', '不要耸肩'], ['cable-lateral']),
  e('cable-lateral', '绳索侧平举', 'shoulders', '器械', ['持续张力', '慢速'], ['lateral-raise']),
  e('rear-delt-fly', '俯身飞鸟', 'shoulders', '哑铃', ['肘微屈', '肩胛不夹紧'], []),

  e('bb-curl', '杠铃弯举', 'arms', '杠铃', ['肘固定', '不借力'], ['db-curl']),
  e('db-curl', '哑铃弯举', 'arms', '哑铃', ['顶点挤压', '慢速离心'], ['bb-curl']),
  e('hammer-curl', '锤式弯举', 'arms', '哑铃', ['掌心相对', '控制下放'], []),
  e('triceps-pushdown', '绳索下压', 'arms', '器械', ['肘贴身', '底部伸展'], ['skull-crusher']),
  e('skull-crusher', '仰卧臂屈伸', 'arms', '杠铃', ['上臂固定', '控制下放'], ['triceps-pushdown']),
  e('overhead-triceps', '过顶臂屈伸', 'arms', '哑铃', ['肘朝前', '全幅度'], []),

  e('plank', '平板支撑', 'core', '自重', ['臀不塌', '呼吸均匀'], [], { mode: 'duration' }),
  e('hanging-leg-raise', '悬垂举腿', 'core', '自重', ['控制摆动', '骨盆后倾'], [], { mode: 'reps', load: 'bodyweight' }),
  e('cable-crunch', '绳索卷腹', 'core', '器械', ['脊柱屈曲', '不要用手拉'], []),
  e('ab-wheel', '健腹轮', 'core', '自重', ['核心收紧', '不要塌腰'], [], { mode: 'reps', load: 'bodyweight' }),

  e('incline-walk', '坡度快走', 'cardio', '跑步机', ['保持心率区间', '不要扶扶手'], [], { mode: 'distance_duration' }),
  e('rower', '划船机', 'cardio', '器械', ['腿-核心-手', '节奏稳定'], [], { mode: 'distance_duration' }),
];

/** 内置动作 + 内容包动作；ID 冲突时内置优先。 */
export const EXERCISES: Exercise[] = (() => {
  const builtinIds = new Set(BUILTIN_EXERCISES.map((e) => e.id));
  const fromPacks = packExercisesToLibrary(EXERCISE_PACKS).filter((e) => !builtinIds.has(e.id));
  return [...BUILTIN_EXERCISES, ...fromPacks];
})();

export const EXERCISE_BY_ID = new Map(EXERCISES.map((x) => [x.id, x]));

export function exerciseName(id: string): string {
  return EXERCISE_BY_ID.get(id)?.name ?? '自定义动作';
}

export function exerciseGroup(id: string): MuscleGroup {
  return EXERCISE_BY_ID.get(id)?.group ?? 'core';
}

const pe = (exerciseId: string, sets: number, repMin: number, repMax: number, restSeconds: number, incrementGrams = 2500) => ({
  exerciseId,
  sets,
  repMin,
  repMax,
  restSeconds,
  incrementGrams,
});

export const TEMPLATES: Template[] = [
  {
    id: 'full-2',
    title: '全身基础 · 每周 2 次',
    subtitle: '每次覆盖全身大肌群，适合刚开始规律训练的人',
    daysPerWeek: 2,
    level: 'beginner',
    equipment: 'gym',
    version: 1,
    progression: '全部工作组达到上限次数后，下次加 2.5kg；连续两次达不到下限则保持重量',
    days: [
      {
        id: 'full-2-a',
        title: '全身 A',
        slot: 0,
        exercises: [pe('bb-squat', 3, 6, 8, 150), pe('bb-bench', 3, 6, 8, 120), pe('bb-row', 3, 8, 10, 120), pe('plank', 3, 30, 45, 60)],
      },
      {
        id: 'full-2-b',
        title: '全身 B',
        slot: 1,
        exercises: [pe('rdl', 3, 6, 8, 150), pe('db-shoulder-press', 3, 8, 10, 120), pe('lat-pulldown', 3, 8, 10, 120), pe('calf-raise', 3, 12, 15, 60)],
      },
    ],
  },
  {
    id: 'full-3',
    title: '全身进阶 · 每周 3 次',
    subtitle: '推、拉、腿交替，训练频率与恢复的平衡点',
    daysPerWeek: 3,
    level: 'beginner',
    equipment: 'gym',
    version: 1,
    progression: '达到上限次数加 2.5kg；停滞两周减 10% 重量重新累积',
    days: [
      {
        id: 'full-3-a',
        title: '全身 A · 蹲主导',
        slot: 0,
        exercises: [pe('bb-squat', 4, 5, 8, 180), pe('bb-bench', 4, 6, 8, 150), pe('bb-row', 3, 8, 10, 120), pe('lateral-raise', 3, 12, 15, 60)],
      },
      {
        id: 'full-3-b',
        title: '全身 B · 髋主导',
        slot: 1,
        exercises: [pe('rdl', 4, 6, 8, 180), pe('ohp', 4, 6, 8, 150), pe('lat-pulldown', 3, 8, 12, 120), pe('hanging-leg-raise', 3, 8, 12, 60)],
      },
      {
        id: 'full-3-c',
        title: '全身 C · 混合',
        slot: 2,
        exercises: [pe('leg-press', 4, 10, 12, 150), pe('incline-db', 4, 8, 10, 120), pe('seated-row', 4, 8, 12, 120), pe('triceps-pushdown', 3, 10, 15, 60)],
      },
    ],
  },
  {
    id: 'upper-lower-4',
    title: '上下肢四分化 · 每周 4 次',
    subtitle: '上肢 / 下肢各两次，适合已有训练习惯的人',
    daysPerWeek: 4,
    level: 'intermediate',
    equipment: 'gym',
    version: 1,
    progression: '主项 5–8 次区间，达到上限加 2.5kg；辅助动作达到上限加最小配重',
    days: [
      {
        id: 'ul-upper-1',
        title: '上肢 A · 水平推拉',
        slot: 0,
        exercises: [pe('bb-bench', 4, 5, 8, 180), pe('bb-row', 4, 6, 8, 150), pe('incline-db', 3, 8, 10, 120), pe('lat-pulldown', 3, 8, 12, 90), pe('triceps-pushdown', 3, 10, 15, 60)],
      },
      {
        id: 'ul-lower-1',
        title: '下肢 A · 蹲主导',
        slot: 1,
        exercises: [pe('bb-squat', 5, 5, 6, 180), pe('rdl', 3, 8, 10, 150), pe('leg-curl', 3, 10, 12, 90), pe('calf-raise', 4, 12, 15, 60)],
      },
      {
        id: 'ul-upper-2',
        title: '上肢 B · 垂直推拉',
        slot: 2,
        exercises: [pe('ohp', 4, 5, 8, 150), pe('pullup', 4, 6, 10, 150), pe('db-shoulder-press', 3, 8, 10, 120), pe('db-row', 3, 10, 12, 90), pe('bb-curl', 3, 10, 12, 60)],
      },
      {
        id: 'ul-lower-2',
        title: '下肢 B · 髋主导',
        slot: 3,
        exercises: [pe('hip-thrust', 4, 8, 10, 150), pe('leg-press', 4, 10, 12, 150), pe('leg-extension', 3, 12, 15, 90), pe('ab-wheel', 3, 8, 12, 60)],
      },
    ],
  },
];

export const TEMPLATE_BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));




