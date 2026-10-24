import { describe, expect, it } from 'vitest';
import {
  addDays,
  businessDate,
  displayLoad,
  formatDuration,
  formatLoad,
  formatVolume,
  gramsFromDisplay,
  shortDate,
  weekStartOf,
  weekdayLabel,
} from './units';

describe('AC-T05 · 重量单位换算', () => {
  it('kg 与克往返一致', () => {
    expect(gramsFromDisplay(100, 'kg')).toBe(100000);
    expect(displayLoad(100000, 'kg')).toBe(100);
  });

  it('lb 换算按 2.2046 系数', () => {
    expect(gramsFromDisplay(220.46, 'lb')).toBe(99999);
    expect(displayLoad(100000, 'lb')).toBe(220.5);
  });

  it('格式化保留一位小数且不补零', () => {
    expect(formatLoad(100000, 'kg')).toBe('100 kg');
    expect(formatLoad(102500, 'kg')).toBe('102.5 kg');
  });

  it('超过 10k 才用 k 简写，以下显示整数', () => {
    expect(formatVolume(12000000, 'kg')).toBe('12.0k kg');
    expect(formatVolume(1200000, 'kg')).toBe('1200 kg');
    expect(formatVolume(500000, 'kg')).toBe('500 kg');
  });
});

describe('时长格式', () => {
  it('一小时以内显示分秒', () => {
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(0)).toBe('0:00');
  });

  it('超过一小时显示时分秒', () => {
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  it('负数按 0 处理', () => {
    expect(formatDuration(-10)).toBe('0:00');
  });
});

describe('AC-W09 · 业务日期与周首', () => {
  it('addDays 跨月正确', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('跨年正确', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('weekStartOf 返回周一', () => {
    expect(weekStartOf('2026-10-24')).toBe('2026-10-19');
    expect(weekStartOf('2026-10-19')).toBe('2026-10-19');
    expect(weekStartOf('2026-10-25')).toBe('2026-10-19');
  });

  it('businessDate 使用本地时区日期', () => {
    expect(businessDate(new Date(2026, 9, 24, 23, 30))).toBe('2026-10-24');
    expect(businessDate(new Date(2026, 9, 24, 0, 10))).toBe('2026-10-24');
  });

  it('中文日期与星期标签', () => {
    expect(shortDate('2026-10-24')).toBe('10月24日');
    expect(weekdayLabel('2026-10-24')).toBe('周六');
    expect(weekdayLabel('2026-10-19')).toBe('周一');
  });
});
