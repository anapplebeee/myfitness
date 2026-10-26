/**
 * 分享卡片的数据模型。
 *
 * 纯函数：只把 Session 投影成"卡片上要显示什么"，不碰 canvas、不碰 DOM。
 * 这样卡片内容可以单测，渲染出错也不会被误判成数据错。
 *
 * 设计原则：卡片是给外人看的，不是训练日志。
 * 所以只挑三个最有说服力的数字（容量、组数、时长）加三条主项，
 * 而不是把所有组都列出来——列全了没人看得懂，也没人愿意转发。
 */

import type { Session } from './types';
import { completedWorkingSets, e1rm, isValidCompleted, sessionVolumeGrams } from './metrics';
import { formatDuration, formatLoad, formatVolume, shortDate, weekdayLabel } from './units';
import { EXERCISE_BY_ID } from '../content/exercises';

export interface ShareLift {
  /** 动作名，直接显示 */
  name: string;
  /** 例如 "80 kg × 8" */
  detail: string;
  /** 用于排序，不显示 */
  weightGrams: number;
}

export interface ShareCardData {
  /** 训练标题，例如 "上肢 A · 水平推拉" */
  title: string;
  /** 例如 "10月26日 · 周一" */
  dateLabel: string;
  /** 例如 "12,340"（单位在渲染时加） */
  volumeValue: string;
  /** 例如 "42" */
  setsValue: string;
  /** 例如 "58:12"，无有效时长时为 null */
  durationValue: string | null;
  /** 最多 3 条主项，按重量从高到低 */
  lifts: ShareLift[];
  /** 已删除或无效时返回 null，调用方不该给分享入口 */
  valid: boolean;
}

/** 取一场训练里每个动作的最好一组。 */
function bestPerExercise(session: Session): Array<{ exerciseId: string; set: { loadGrams: number | null; reps: number | null } }> {
  const out: Array<{ exerciseId: string; set: { loadGrams: number | null; reps: number | null } }> = [];
  for (const ex of session.exercises) {
    let best: { loadGrams: number | null; reps: number | null } | null = null;
    let bestScore = -1;
    for (const set of ex.sets) {
      if (set.status !== 'completed' || set.kind !== 'work') continue;
      // 有重量的按 e1RM 比，自重的按次数比
      const score =
        set.loadGrams !== null && set.reps !== null && set.reps > 0
          ? (e1rm(set.loadGrams, set.reps) ?? 0)
          : (set.reps ?? 0);
      if (score > bestScore) {
        bestScore = score;
        best = { loadGrams: set.loadGrams, reps: set.reps };
      }
    }
    if (best) out.push({ exerciseId: ex.exerciseId, set: best });
  }
  return out;
}

/**
 * 构造卡片数据。
 *
 * @param session 训练场次
 * @param unit 显示单位；卡片跟随用户当前单位设置
 */
export function buildShareCardData(session: Session, unit: 'kg' | 'lb' = 'kg'): ShareCardData {
  const valid = isValidCompleted(session);
  const lifts = bestPerExercise(session)
    .map(({ exerciseId, set }) => {
      const def = EXERCISE_BY_ID.get(exerciseId);
      const name = def?.name ?? exerciseId;
      const detail =
        set.loadGrams !== null && set.reps !== null
          ? `${formatLoad(set.loadGrams, unit)} × ${set.reps}`
          : set.reps !== null
            ? `自重 × ${set.reps}`
            : '—';
      return { name, detail, weightGrams: set.loadGrams ?? 0 };
    })
    .sort((a, b) => b.weightGrams - a.weightGrams)
    .slice(0, 3);

  const durationSeconds =
    session.endedAt && session.startedAt
      ? Math.max(0, Math.round((new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 1000))
      : null;

  return {
    title: session.title,
    dateLabel: `${shortDate(session.businessDate)} · ${weekdayLabel(session.businessDate)}`,
    volumeValue: formatVolume(sessionVolumeGrams(session), unit),
    setsValue: String(completedWorkingSets(session)),
    // 少于 1 分钟的训练不值得显示时长，宁可不写也不显示 00:12
    durationValue: durationSeconds !== null && durationSeconds >= 60 ? formatDuration(durationSeconds) : null,
    lifts,
    valid,
  };
}
