import { describe, expect, it } from 'vitest';
import { weightTrendHint, weightTrendTone } from './weight';

/**
 * 体重涨跌的评价规则。
 *
 * 核心不变量：**只有知道目标方向，才有资格说"涨好"还是"掉好"**。
 * 原实现默认所有人都在减脂，增肌的人涨 1 kg 会被标红。
 */

describe('没设目标体重', () => {
  it('涨了也不评价', () => {
    expect(weightTrendTone(1.2, 80, null)).toBe('neutral');
  });

  it('掉了也不评价', () => {
    expect(weightTrendTone(-1.2, 80, null)).toBe('neutral');
  });

  it('提示语说明为什么不做评价', () => {
    expect(weightTrendHint('neutral', null)).toContain('未设目标');
  });

  it('目标为 0 视为未设置', () => {
    expect(weightTrendTone(1.2, 80, 0)).toBe('neutral');
  });
});

describe('减脂（目标低于当前）', () => {
  it('掉秤是好事', () => {
    expect(weightTrendTone(-1.5, 80, 72)).toBe('good');
  });

  it('涨秤是反向', () => {
    expect(weightTrendTone(1.5, 80, 72)).toBe('bad');
  });

  it('轻微波动视为持平', () => {
    expect(weightTrendTone(0.05, 80, 72)).toBe('neutral');
    expect(weightTrendTone(-0.05, 80, 72)).toBe('neutral');
  });
});

describe('增肌（目标高于当前）', () => {
  it('涨秤是好事', () => {
    expect(weightTrendTone(1.5, 70, 78)).toBe('good');
  });

  it('掉秤是反向', () => {
    expect(weightTrendTone(-1.5, 70, 78)).toBe('bad');
  });

  it('增肌期涨了不该被标成负面（这就是原实现的 bug）', () => {
    expect(weightTrendTone(1.1, 70, 78)).not.toBe('bad');
  });
});

describe('持平', () => {
  it('变化很小时中性', () => {
    expect(weightTrendTone(0.02, 80, 72)).toBe('neutral');
  });

  it('持平提示语', () => {
    expect(weightTrendHint('neutral', 72)).toContain('持平');
  });
});

describe('提示语', () => {
  it('朝目标方向', () => {
    expect(weightTrendHint('good', 72)).toContain('朝目标');
  });

  it('与目标相反', () => {
    expect(weightTrendHint('bad', 72)).toContain('相反');
  });
});
