/** 单位与格式化：领域统一用克与秒，界面按需换算。 */

export const KG_TO_LB = 2.2046226218;

export function kgFromGrams(grams: number): number {
  return Math.round((grams / 1000) * 10) / 10;
}

export function gramsFromDisplay(value: number, unit: 'kg' | 'lb'): number {
  const kg = unit === 'kg' ? value : value / KG_TO_LB;
  return Math.round(kg * 1000);
}

export function displayLoad(grams: number, unit: 'kg' | 'lb'): number {
  if (unit === 'kg') return kgFromGrams(grams);
  return Math.round((grams / 1000) * KG_TO_LB * 10) / 10;
}

export function formatLoad(grams: number, unit: 'kg' | 'lb'): string {
  const v = displayLoad(grams, unit);
  return `${Number.isInteger(v) ? v : v.toFixed(1)} ${unit}`;
}

export function formatVolume(grams: number, unit: 'kg' | 'lb'): string {
  const v = unit === 'kg' ? grams / 1000 : (grams / 1000) * KG_TO_LB;
  if (v >= 10000) return `${(v / 1000).toFixed(1)}k ${unit}`;
  return `${Math.round(v)} ${unit}`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function formatRest(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 业务日期按设备本地时区，格式 YYYY-MM-DD。 */
export function businessDate(at: Date = new Date()): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, '0');
  const d = String(at.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return businessDate(d);
}

export function parseBusinessDate(date: string): Date {
  return new Date(`${date}T12:00:00`);
}

/** 周一为一周开始，返回该周周一日期。 */
export function weekStartOf(date: string): string {
  const d = parseBusinessDate(date);
  const day = (d.getDay() + 6) % 7;
  return addDays(date, -day);
}

export function shortDate(date: string): string {
  const d = parseBusinessDate(date);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function weekdayLabel(date: string): string {
  const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return names[parseBusinessDate(date).getDay()] ?? '';
}
