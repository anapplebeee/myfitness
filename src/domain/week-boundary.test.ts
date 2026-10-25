import { describe, expect, it } from 'vitest';
import { addDays, weekStartOf } from './units';
import { currentWeekStart, daysLeftInWeek, inWeek, weekRange } from './week';

// 探针：验证周计算的周日边界与跨月/跨年处理。

describe('补充 · weekStartOf 与 currentWeekStart 的周日处理', () => {
  it('周一', () => {
    expect(weekStartOf('2026-10-19')).toBe('2026-10-19');
  });
  it('周日应归到上一个周一', () => {
    expect(weekStartOf('2026-10-25')).toBe('2026-10-19');
  });
  it('周六', () => {
    expect(weekStartOf('2026-10-24')).toBe('2026-10-19');
  });

  it('currentWeekStart 周日', () => {
    // 2026-10-25 是周日
    expect(currentWeekStart(new Date('2026-10-25T12:00:00'))).toBe('2026-10-19');
  });
  it('currentWeekStart 周一', () => {
    expect(currentWeekStart(new Date('2026-10-19T12:00:00'))).toBe('2026-10-19');
  });
  it('currentWeekStart 周六', () => {
    expect(currentWeekStart(new Date('2026-10-24T12:00:00'))).toBe('2026-10-19');
  });
  it('currentWeekStart 跨月', () => {
    // 2026-11-01 是周日，应归到 2026-10-26
    expect(currentWeekStart(new Date('2026-11-01T12:00:00'))).toBe('2026-10-26');
  });
  it('currentWeekStart 跨年', () => {
    // 2027-01-01 是周五，周一为 2026-12-28
    expect(currentWeekStart(new Date('2027-01-01T12:00:00'))).toBe('2026-12-28');
  });
  it('addDays 跨年', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('addDays 负向跨月', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('补充 · daysLeftInWeek', () => {
  it('周一', () => {
    expect(daysLeftInWeek('2026-10-19', '2026-10-19')).toBe(7);
  });
  it('周六', () => {
    expect(daysLeftInWeek('2026-10-24', '2026-10-19')).toBe(2);
  });
  it('周日', () => {
    expect(daysLeftInWeek('2026-10-25', '2026-10-19')).toBe(1);
  });
  it('下周', () => {
    expect(daysLeftInWeek('2026-10-26', '2026-10-19')).toBe(0);
  });
  it('更远的未来', () => {
    expect(daysLeftInWeek('2026-11-05', '2026-10-19')).toBe(0);
  });
});

describe('补充 · weekRange 与 inWeek', () => {
  it('周一在范围内', () => {
    expect(inWeek('2026-10-19', '2026-10-19')).toBe(true);
  });
  it('周日仍在范围内', () => {
    expect(inWeek('2026-10-25', '2026-10-19')).toBe(true);
  });
  it('下周一不在范围内', () => {
    expect(inWeek('2026-10-26', '2026-10-19')).toBe(false);
  });
  it('上周日不在范围内', () => {
    expect(inWeek('2026-10-18', '2026-10-19')).toBe(false);
  });
  it('weekRange 为半开区间 [from, to)', () => {
    const r = weekRange('2026-10-19');
    expect(r).toEqual({ from: '2026-10-19', to: '2026-10-26' });
  });
});

