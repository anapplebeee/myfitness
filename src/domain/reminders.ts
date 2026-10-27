/**
 * 本地提醒的时间计算（纯函数）。
 *
 * 这里只算"什么时候该提醒"，不碰通知通道：
 * 原生端交给 Capacitor Local Notifications，网页端交给系统通知 + 前台计时。
 */

import type { ReminderSettings } from './types';

export const DEFAULT_REMINDERS: ReminderSettings = {
  workoutEnabled: true,
  workoutTime: '19:00',
  waterEnabled: true,
  waterIntervalMin: 120,
  waterStart: '09:00',
  waterEnd: '21:00',
};

export function validTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** 间隔限制在 30–360 分钟，避免用户填 0 造成死循环或 1 分钟骚扰。 */
export function clampInterval(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_REMINDERS.waterIntervalMin;
  return Math.min(360, Math.max(30, Math.round(value)));
}

/** 把可能残缺的持久化数据补成完整设置。 */
export function normalizeReminders(input?: Partial<ReminderSettings> | null): ReminderSettings {
  const base = { ...DEFAULT_REMINDERS, ...(input ?? {}) };
  return {
    workoutEnabled: Boolean(base.workoutEnabled),
    workoutTime: validTime(base.workoutTime) ? base.workoutTime : DEFAULT_REMINDERS.workoutTime,
    waterEnabled: Boolean(base.waterEnabled),
    waterIntervalMin: clampInterval(base.waterIntervalMin),
    waterStart: validTime(base.waterStart) ? base.waterStart : DEFAULT_REMINDERS.waterStart,
    waterEnd: validTime(base.waterEnd) ? base.waterEnd : DEFAULT_REMINDERS.waterEnd,
  };
}

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function toHhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** [start, end] 内每 interval 分钟一次的时刻（含 start，不超过 end）。 */
export function waterTimes(settings: ReminderSettings): string[] {
  const start = minutesOf(settings.waterStart);
  const end = minutesOf(settings.waterEnd);
  const step = clampInterval(settings.waterIntervalMin);
  if (end < start) return [];
  const out: string[] = [];
  for (let t = start; t <= end; t += step) out.push(toHhmm(t));
  return out;
}

/** 从 now 起下一个喝水提醒；当天已过完返回 null。 */
export function nextWaterAt(now: Date, settings: ReminderSettings): Date | null {
  if (!settings.waterEnabled) return null;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const next = waterTimes(settings).find((t) => minutesOf(t) > nowMin);
  if (!next) return null;
  const at = new Date(now);
  at.setHours(Math.floor(minutesOf(next) / 60), minutesOf(next) % 60, 0, 0);
  return at;
}

/** 下一次训练提醒：今天的时刻还没过就是今天，否则明天。 */
export function nextWorkoutAt(now: Date, settings: ReminderSettings): Date | null {
  if (!settings.workoutEnabled) return null;
  const minutes = minutesOf(settings.workoutTime);
  const at = new Date(now);
  at.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at;
}
