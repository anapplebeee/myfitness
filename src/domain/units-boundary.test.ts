import { describe, expect, it } from 'vitest';
import { addDays, formatDuration, formatLoad, formatVolume, gramsFromDisplay, kgFromGrams, weekdayLabel } from './units';

describe('补充 · addDays DST 与远距离', () => {
  it('美国春时令跳跃（2026-03-08 美国）', () => {
    // 用 UTC 日期避免测试机时区干扰，验证 12:00 基准不跨天
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
  });
  it('连续 400 天不漂移', () => {
    let d = '2026-01-01';
    for (let i = 0; i < 400; i++) d = addDays(d, 1);
    expect(d).toBe('2027-02-05');
  });
  it('大跨度负向', () => {
    // 2025(365) + 2024(366, 闰) = 731 天到 2024-01-01；再 -31 到 2024-12-01
    // 2026-01-01 退 400 天：365 天到 2025-01-01，余 35 天退到 2024-11-27
    expect(addDays('2026-01-01', -400)).toBe('2024-11-27');
  });
  it('2月29日闰年', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
  });
  it('非闰年2月', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });
});

describe('补充 · 单位换算往返', () => {
  it('kg → grams → kg', () => {
    expect(kgFromGrams(gramsFromDisplay(62.5, 'kg'))).toBe(62.5);
  });
  it('lb → grams → lb 显示', () => {
    const g = gramsFromDisplay(135, 'lb');
    expect(formatLoad(g, 'lb')).toBe('135 lb');
  });
  it('kg 四舍五入到 0.1', () => {
    expect(kgFromGrams(12345)).toBe(12.3);
    expect(kgFromGrams(12350)).toBe(12.4);
    expect(kgFromGrams(12351)).toBe(12.4);
  });
  it('lb 显示四舍五入', () => {
    expect(formatLoad(100000, 'lb')).toBe('220.5 lb');
  });
});

describe('补充 · 格式化边界', () => {
  it('formatDuration 负值钳到 0', () => {
    expect(formatDuration(-5)).toBe('0:00');
  });
  it('formatDuration 小数向下取整', () => {
    expect(formatDuration(59.9)).toBe('0:59');
  });
  it('formatDuration 小时', () => {
    expect(formatDuration(3661)).toBe('1:01:01');
  });
  it('formatVolume 千位阈值', () => {
    expect(formatVolume(9999 * 1000, 'kg')).toBe('9999 kg');
    expect(formatVolume(10000 * 1000, 'kg')).toBe('10.0k kg');
  });
  it('formatLoad 整数不带小数', () => {
    expect(formatLoad(60000, 'kg')).toBe('60 kg');
  });
});

describe('补充 · 星期标签', () => {
  it('周日为索引0', () => {
    expect(weekdayLabel('2026-10-25')).toBe('周日');
  });
  it('周一为索引1', () => {
    expect(weekdayLabel('2026-10-19')).toBe('周一');
  });
});


