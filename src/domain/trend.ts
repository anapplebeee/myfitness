/**
 * 趋势折线的几何计算（纯函数）。
 *
 * 关键约束：按序列的真实 min/max 缩放，**不做**"归一化到最大值 + 最小高度兜底"。
 * 后者会让"6 次同重量"渲染成等高柱、"80 / 80.5 / 81"渲染成大起大落——
 * 停滞和进步长得一模一样，图在说谎（PM 深评 P0-1）。
 *
 * 全程等值时返回 flat，折线画在垂直中线，如实表达"没有变化"。
 */

export interface TrendGeometry {
  /** 折线 path d */
  line: string;
  /** 面积 path d（从折线闭合到底边） */
  area: string;
  /** 数据最小值，供 Y 轴标注 */
  min: number;
  /** 数据最大值，供 Y 轴标注 */
  max: number;
  /** 是否全程等值 */
  flat: boolean;
}

export function trendGeometry(series: number[], width = 280, height = 44, pad = 5): TrendGeometry {
  if (!series.length) {
    return { line: '', area: '', min: 0, max: 0, flat: true };
  }

  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min;
  const step = series.length > 1 ? (width - pad * 2) / (series.length - 1) : 0;

  const points = series.map((v, i) => {
    const x = pad + step * i;
    // span === 0 时没有"高低"可言，画在中线
    const y = span === 0 ? height / 2 : pad + (1 - (v - min) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p}`).join(' ');
  const bottom = (height - pad).toFixed(1);
  const area = `${line} L${(width - pad).toFixed(1)},${bottom} L${pad.toFixed(1)},${bottom} Z`;

  return { line, area, min, max, flat: span === 0 };
}
