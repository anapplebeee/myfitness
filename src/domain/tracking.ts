/**
 * 跟踪模式：不同动作记录不同的量。
 *
 * - load_reps：负重 × 次数（杠铃/哑铃/器械）
 * - reps：自重次数（引体、俯卧撑、健腹轮）
 * - duration：纯计时（平板支撑）
 * - distance_duration：距离 + 时长（跑步机、划船机）
 *
 * 关键口径（11:55）：
 * - 总外部容量只对"外部负荷可定义"的可比较工作组计算。
 * - 自重/辅助不强行归入同一容量，否则数值没有意义。
 * - 计时/距离类不参与力量 PR 与 e1RM。
 */

import type { Exercise } from '../content/types';
import type { LoadConvention, SetRecord, TrackingMode } from './types';

export interface ModeMeta {
  mode: TrackingMode;
  /** 主输入控件标签 */
  primaryLabel: string;
  /** 是否需要第二个数值 */
  secondaryLabel: string | null;
  /** 单位 */
  primaryUnit: string;
  secondaryUnit: string | null;
  /** 是否参与容量计算 */
  countsVolume: boolean;
  /** 是否参与力量 PR / e1RM */
  countsStrength: boolean;
}

export const MODE_META: Record<TrackingMode, ModeMeta> = {
  load_reps: {
    mode: 'load_reps',
    primaryLabel: '重量',
    secondaryLabel: '次数',
    primaryUnit: 'kg',
    secondaryUnit: '次',
    countsVolume: true,
    countsStrength: true,
  },
  reps: {
    mode: 'reps',
    primaryLabel: '次数',
    secondaryLabel: null,
    primaryUnit: '次',
    secondaryUnit: null,
    countsVolume: false,
    countsStrength: false,
  },
  duration: {
    mode: 'duration',
    primaryLabel: '时长',
    secondaryLabel: null,
    primaryUnit: '秒',
    secondaryUnit: null,
    countsVolume: false,
    countsStrength: false,
  },
  distance_duration: {
    mode: 'distance_duration',
    primaryLabel: '距离',
    secondaryLabel: '时长',
    primaryUnit: 'm',
    secondaryUnit: '秒',
    countsVolume: false,
    countsStrength: true,
  },
};

/** 负荷约定是否可计算"总外部容量"（11:55）。 */
export function volumeEligible(load: LoadConvention): boolean {
  return load === 'totalExternal' || load === 'perImplement';
}

export interface SetValidity {
  ok: boolean;
  issue?: string;
}

/** 按动作模式校验一组数据是否完整可提交。 */
export function validateSetForExercise(exercise: Exercise, set: SetRecord): SetValidity {
  const meta = MODE_META[exercise.mode];

  if (set.status === 'skipped') return { ok: true };

  switch (exercise.mode) {
    case 'load_reps': {
      if (set.loadGrams === null || set.loadGrams < 0) return { ok: false, issue: '请填写重量' };
      if (set.reps === null || set.reps < 1) return { ok: false, issue: '请填写次数' };
      if (exercise.load === 'assistance' && set.loadGrams === 0) {
        return { ok: false, issue: '辅助重量需大于 0，或改用自重模式' };
      }
      return { ok: true };
    }
    case 'reps': {
      if (set.reps === null || set.reps < 1) return { ok: false, issue: '请填写次数' };
      return { ok: true };
    }
    case 'duration': {
      if (set.durationSeconds === null || set.durationSeconds <= 0) {
        return { ok: false, issue: '请填写时长' };
      }
      return { ok: true };
    }
    case 'distance_duration': {
      if (set.distanceMeters === null || set.distanceMeters <= 0) {
        return { ok: false, issue: '请填写距离' };
      }
      if (set.durationSeconds === null || set.durationSeconds <= 0) {
        return { ok: false, issue: '请填写时长' };
      }
      return { ok: true };
    }
    default: {
      void meta;
      return { ok: false, issue: '未知的跟踪模式' };
    }
  }
}

/** 这一组是否构成"有效工作组"（不同模式的完成标准不同）。 */
export function isCompletedWorkSet(exercise: Exercise, set: SetRecord): boolean {
  if (set.kind !== 'work' || set.status !== 'completed') return false;
  return validateSetForExercise(exercise, set).ok;
}

/** 展示用摘要，例如 "100kg × 5" / "12 次" / "1:30" / "2000m · 12:00"。 */
export function setSummary(exercise: Exercise, set: SetRecord, unit: 'kg' | 'lb' = 'kg'): string {
  const fmtLoad = (grams: number): string => {
    const v = unit === 'kg' ? grams / 1000 : (grams / 1000) * 2.2046226218;
    return `${Math.round(v * 10) / 10} ${unit}`;
  };
  const fmtTime = (sec: number): string => {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  switch (exercise.mode) {
    case 'load_reps':
      if (exercise.load === 'bodyweight') {
        return `${set.reps ?? 0} 次（自重）`;
      }
      if (exercise.load === 'assistance') {
        return `辅助 ${set.loadGrams !== null ? fmtLoad(set.loadGrams) : '—'} × ${set.reps ?? 0}`;
      }
      return `${set.loadGrams !== null ? fmtLoad(set.loadGrams) : '—'} × ${set.reps ?? 0}`;
    case 'reps':
      return `${set.reps ?? 0} 次`;
    case 'duration':
      return set.durationSeconds !== null ? fmtTime(set.durationSeconds) : '—';
    case 'distance_duration': {
      const dist = set.distanceMeters !== null ? `${Math.round(set.distanceMeters)} m` : '—';
      const time = set.durationSeconds !== null ? fmtTime(set.durationSeconds) : '—';
      return `${dist} · ${time}`;
    }
    default:
      return '—';
  }
}

/** 新一组按模式预填：力量沿用上次负荷，其余留空。 */
export function blankSetForMode(exercise: Exercise, id: string): SetRecord {
  return {
    id,
    kind: 'work',
    status: 'planned',
    loadGrams: exercise.mode === 'load_reps' ? null : null,
    reps: exercise.mode === 'load_reps' || exercise.mode === 'reps' ? null : null,
    durationSeconds: null,
    distanceMeters: null,
    rpe: null,
    completedAt: null,
  };
}
