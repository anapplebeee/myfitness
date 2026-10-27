import { describe, expect, it } from 'vitest';
import { DEFAULT_WATER_GOAL_ML, waterProgress, waterText, waterTotal } from './water';
import type { WaterEntry } from './types';

const entry = (date: string, ml: number): WaterEntry => ({
  id: `${date}-${ml}`,
  date,
  ml,
  createdAt: `${date}T08:00:00.000Z`,
});

describe('waterTotal', () => {
  it('只统计当天，跨天不混', () => {
    const list = [entry('2026-10-27', 300), entry('2026-10-27', 500), entry('2026-10-26', 900)];
    expect(waterTotal(list, '2026-10-27')).toBe(800);
    expect(waterTotal(list, '2026-10-26')).toBe(900);
  });

  it('缺省字段按空数组处理（旧数据没有 water）', () => {
    expect(waterTotal(undefined, '2026-10-27')).toBe(0);
  });

  it('负数被忽略', () => {
    expect(waterTotal([entry('2026-10-27', -500)], '2026-10-27')).toBe(0);
  });
});

describe('waterProgress', () => {
  it('未设目标返回 null，不编假进度', () => {
    expect(waterProgress(800, null)).toBeNull();
    expect(waterProgress(800, 0)).toBeNull();
  });

  it('封顶 100%，允许超额但进度条不溢出', () => {
    expect(waterProgress(1000, DEFAULT_WATER_GOAL_ML)).toBe(50);
    expect(waterProgress(3000, DEFAULT_WATER_GOAL_ML)).toBe(100);
  });
});

describe('waterText', () => {
  it('未达标说还差多少，达标说超出多少', () => {
    expect(waterText(1200, 2000)).toBe('还差 800 ml');
    expect(waterText(2400, 2000)).toBe('已达标，超出 400 ml');
  });

  it('未设目标只报总量', () => {
    expect(waterText(1200, null)).toBe('1200 ml');
  });
});
