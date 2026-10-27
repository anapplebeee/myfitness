import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REMINDERS,
  clampInterval,
  nextWaterAt,
  nextWorkoutAt,
  normalizeReminders,
  validTime,
  waterTimes,
} from './reminders';

describe('validTime', () => {
  it('只接受 HH:mm', () => {
    expect(validTime('09:00')).toBe(true);
    expect(validTime('23:59')).toBe(true);
    expect(validTime('24:00')).toBe(false);
    expect(validTime('9:00')).toBe(false);
    expect(validTime('09:60')).toBe(false);
  });
});

describe('clampInterval', () => {
  it('夹在 30–360 分钟', () => {
    expect(clampInterval(0)).toBe(30);
    expect(clampInterval(5)).toBe(30);
    expect(clampInterval(90)).toBe(90);
    expect(clampInterval(9999)).toBe(360);
    expect(clampInterval(Number.NaN)).toBe(DEFAULT_REMINDERS.waterIntervalMin);
  });
});

describe('waterTimes', () => {
  it('09:00–21:00 每 120 分钟 → 7 个时刻', () => {
    expect(waterTimes(DEFAULT_REMINDERS)).toEqual([
      '09:00',
      '11:00',
      '13:00',
      '15:00',
      '17:00',
      '19:00',
      '21:00',
    ]);
  });

  it('结束早于开始 → 空（配置错误不产生提醒）', () => {
    expect(waterTimes({ ...DEFAULT_REMINDERS, waterStart: '21:00', waterEnd: '09:00' })).toEqual([]);
  });
});

describe('nextWaterAt', () => {
  const at = (h: number, m: number) => new Date(2026, 9, 27, h, m, 0, 0);

  it('08:00 → 下一次是 09:00', () => {
    const next = nextWaterAt(at(8, 0), DEFAULT_REMINDERS);
    expect(next?.getHours()).toBe(9);
    expect(next?.getMinutes()).toBe(0);
  });

  it('10:30 → 下一次是 11:00', () => {
    const next = nextWaterAt(at(10, 30), DEFAULT_REMINDERS);
    expect(next?.getHours()).toBe(11);
  });

  it('21:30 → 今天没有了，返回 null', () => {
    expect(nextWaterAt(at(21, 30), DEFAULT_REMINDERS)).toBeNull();
  });

  it('关闭喝水提醒 → null', () => {
    expect(nextWaterAt(at(8, 0), { ...DEFAULT_REMINDERS, waterEnabled: false })).toBeNull();
  });
});

describe('nextWorkoutAt', () => {
  const at = (h: number, m: number) => new Date(2026, 9, 27, h, m, 0, 0);

  it('18:00 → 今天 19:00', () => {
    const next = nextWorkoutAt(at(18, 0), DEFAULT_REMINDERS);
    expect(next?.getDate()).toBe(27);
    expect(next?.getHours()).toBe(19);
  });

  it('20:00 → 明天 19:00', () => {
    const next = nextWorkoutAt(at(20, 0), DEFAULT_REMINDERS);
    expect(next?.getDate()).toBe(28);
    expect(next?.getHours()).toBe(19);
  });

  it('关闭训练提醒 → null', () => {
    expect(nextWorkoutAt(at(18, 0), { ...DEFAULT_REMINDERS, workoutEnabled: false })).toBeNull();
  });
});

describe('normalizeReminders', () => {
  it('缺失/非法字段回落到默认值', () => {
    const s = normalizeReminders({ workoutTime: '99:99', waterIntervalMin: 0 });
    expect(s.workoutTime).toBe(DEFAULT_REMINDERS.workoutTime);
    expect(s.waterIntervalMin).toBe(30);
  });

  it('空输入得到完整默认设置', () => {
    expect(normalizeReminders(null)).toEqual(DEFAULT_REMINDERS);
  });
});
