import { describe, expect, it } from 'vitest';
import { trendGeometry } from './trend';

/** 从 path d 里抽出所有 y 坐标。 */
function ys(path: string): number[] {
  return [...path.matchAll(/[ML]([-\d.]+),([-\d.]+)/g)].map((m) => Number(m[2]));
}

describe('trendGeometry', () => {
  it('6 次同重量 → 水平线（不能出现"等高柱看起来像进步"）', () => {
    const g = trendGeometry([80, 80, 80, 80, 80, 80]);
    const y = ys(g.line);
    expect(g.flat).toBe(true);
    expect(y.length).toBe(6);
    // 所有点 y 相同 = 真·水平线
    expect(new Set(y.map((v) => v.toFixed(2))).size).toBe(1);
    expect(g.max - g.min).toBe(0);
  });

  it('上升序列：后面的点在上方（y 更小）', () => {
    const y = ys(trendGeometry([80, 80.5, 81]).line);
    expect(y[0] ?? NaN).toBeGreaterThan(y[y.length - 1] ?? NaN);
  });

  it('下降序列：后面的点在下方（y 更大）', () => {
    const y = ys(trendGeometry([81, 80.5, 80]).line);
    expect(y[0] ?? NaN).toBeLessThan(y[y.length - 1] ?? NaN);
  });

  it('返回真实 min/max，供 Y 轴标注（避免 1.2% 波动被误读成大起大落）', () => {
    const g = trendGeometry([80, 80.5, 81]);
    expect(g.min).toBe(80);
    expect(g.max).toBe(81);
  });

  it('最小值落底边、最大值落顶边', () => {
    const y = ys(trendGeometry([80, 80.5, 81], 280, 44, 5).line);
    expect(Math.max(...y)).toBeCloseTo(39, 1);
    expect(Math.min(...y)).toBeCloseTo(5, 1);
  });

  it('单点只有 M 命令；空序列返回空 path', () => {
    expect(trendGeometry([80]).line.startsWith('M')).toBe(true);
    expect(trendGeometry([]).line).toBe('');
    expect(trendGeometry([]).flat).toBe(true);
  });
});
