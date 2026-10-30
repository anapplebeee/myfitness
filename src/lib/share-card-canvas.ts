/**
 * 分享卡片渲染与分享。
 *
 * 为什么用 canvas 而不是截图 DOM：截图需要 html2canvas 之类的重型依赖
 * （本项目刻意保持零 UI 依赖），而且 DOM 截图会把当前主题带进去——
 * 深色模式下分享出去的图在黑背景上，别人的聊天窗口里看着像坏图。
 * canvas 直接按固定品牌配色画，跨主题一致。
 *
 * 分享策略：
 *   1. 支持 Web Share Level 2（能分享文件）→ 调系统分享面板
 *   2. 否则退化为下载 PNG
 * 两条路都留，因为 Android WebView 与桌面浏览器的能力不同。
 */

import type { ShareCardData } from '../domain/share-card';

/** 卡片尺寸：3:4 竖图，微信/小红书/IG 都能直接发。 */
const W = 1080;
const H = 1440;

const COLORS = {
  paper: '#f2f0ea',
  card: '#ffffff',
  ink: '#111411',
  text: '#161a15',
  text2: '#5b6256',
  text3: '#8b9185',
  lime: '#c9f53f',
  limeInk: '#4f6b00',
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * 把卡片画到 canvas 上。
 *
 * 字体用系统中文字体栈：卡片里可能混着中文标题和拉丁数字，
 * 直接指定 "PingFang SC" 在 Windows 上没有，会退化成衬线体，很难看。
 */
export function drawShareCard(canvas: HTMLCanvasElement, data: ShareCardData): void {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 2D 画布');

  const font = (size: number, weight = 400): string =>
    `${weight} ${size}px "PingFang SC", "HarmonyOS Sans SC", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif`;

  // 背景
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, W, H);

  // 主卡片
  const pad = 64;
  roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 56);
  ctx.fillStyle = COLORS.card;
  ctx.fill();

  const left = pad + 72;
  let y = pad + 150;

  // 品牌
  ctx.fillStyle = COLORS.ink;
  roundRect(ctx, left, y - 74, 96, 96, 28);
  ctx.fill();
  ctx.fillStyle = COLORS.lime;
  ctx.font = font(52, 700);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('练', left + 48, y - 24);

  ctx.textAlign = 'left';
  ctx.fillStyle = COLORS.text;
  ctx.font = font(40, 700);
  ctx.fillText('练迹', left + 120, y - 26);

  // 日期
  y += 110;
  ctx.fillStyle = COLORS.text3;
  ctx.font = font(30);
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(data.dateLabel, left, y);

  // 标题
  y += 86;
  ctx.fillStyle = COLORS.text;
  ctx.font = font(64, 700);
  // 标题可能较长，超出时截断加省略号
  const maxTitleWidth = W - left * 2;
  let title = data.title;
  while (ctx.measureText(title).width > maxTitleWidth && title.length > 1) {
    title = title.slice(0, -1);
  }
  if (title !== data.title) title = `${title.slice(0, -1)}…`;
  ctx.fillText(title, left, y);

  // 三个核心数字
  y += 120;
  const stats: Array<{ label: string; value: string; unit: string }> = [
    /*
     * volumeValue 里已经带了单位（formatVolume 返回「12,340 kg」）。
     * 再追加一次会变成「kg kg」；lb 用户则是「lb kg」。
     */
    { label: '总容量', value: data.volumeValue, unit: '' },
    { label: '完成组数', value: data.setsValue, unit: '组' },
];
  if (data.durationValue) stats.push({ label: '训练时长', value: data.durationValue, unit: '' });

  /*
   * 每列等宽，数字必须缩放到列宽以内。
   *
   * 之前固定 76px，三列时 "12,340" 的宽度直接吃满整列，
   * 把后面的单位 "kg" 和下一列的 "18" 压在一起，像乱码。
   * 这里按列宽做 shrink-to-fit，最小 40px 保底可读。
   */
  const colW = (W - left * 2) / stats.length;
  const gutter = 24;
  const fitSize = (value: string, unitLabel: string, maxWidth: number): number => {
    let size = 76;
    for (; size >= 40; size -= 2) {
      ctx.font = font(size, 700);
      const wv = ctx.measureText(value).width;
      ctx.font = font(30);
      const wu = unitLabel ? ctx.measureText(unitLabel).width + 10 : 0;
      if (wv + wu <= maxWidth) break;
    }
    return size;
  };

  stats.forEach((s, i) => {
    const x = left + i * colW;
    const maxW = colW - gutter;
    ctx.fillStyle = COLORS.text3;
    ctx.font = font(28);
    ctx.fillText(s.label, x, y);

    const size = fitSize(s.value, s.unit, maxW);
    ctx.fillStyle = COLORS.text;
    ctx.font = font(size, 700);
    ctx.fillText(s.value, x, y + 92);
    if (s.unit) {
      const w = ctx.measureText(s.value).width;
      ctx.fillStyle = COLORS.text3;
      ctx.font = font(30);
      ctx.fillText(s.unit, x + w + 10, y + 92);
    }
  });

  // 统计块高度约 92（数值）+ 字号余量，留 200 再画下一节
  y += 200;

  /*
   * 垂直居中：把"标题 + 动作列表"整块在统计区下方与页脚上方之间居中。
   *
   * 之前从固定 y 往下排，只有 1–2 个动作时下面空出一大片，看起来像图没画完。
   *
   * 关键：小标题必须跟着列表一起下移。先画标题再算偏移的话，
   * 标题会留在原处、列表被推下去，中间出现一段莫名其妙的空档。
   */
  const footY = H - pad - 76;
  const rowH = 96;
  const labelY0 = y;
  const listStart = labelY0 + 24;
  const contentH = data.lifts.length * rowH + 40;
  const free = Math.max(0, footY - 80 - listStart - contentH);
  const shift = Math.min(free * 0.3, 96);

  y = labelY0 + shift;
  ctx.fillStyle = COLORS.text3;
  ctx.font = font(28);
  ctx.fillText('主要动作', left, y);

  y = listStart + shift;

  for (const lift of data.lifts) {
    y += rowH;
    roundRect(ctx, left, y - 52, W - left * 2, 80, 22);
    ctx.fillStyle = 'rgba(17, 20, 17, 0.04)';
    ctx.fill();

    ctx.fillStyle = COLORS.text;
    ctx.font = font(36, 600);
    ctx.fillText(lift.name, left + 28, y + 2);

    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.limeInk;
    ctx.font = font(36, 700);
    ctx.fillText(lift.detail, W - left - 28, y + 2);
    ctx.textAlign = 'left';
  }

  // 页脚
  ctx.fillStyle = COLORS.lime;
  roundRect(ctx, left, footY - 30, 72, 44, 12);
  ctx.fill();
  ctx.fillStyle = COLORS.ink;
  ctx.font = font(26, 700);
  ctx.textAlign = 'center';
  ctx.fillText('记录', left + 36, footY + 1);

  ctx.textAlign = 'left';
  ctx.fillStyle = COLORS.text3;
  ctx.font = font(26);
  ctx.fillText('每一次训练，都算数', left + 96, footY + 1);
}

/** 生成 PNG Blob。 */
export function renderShareCardBlob(data: ShareCardData): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    drawShareCard(canvas, data);
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('导出图片失败'));
    }, 'image/png');
  });
}

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled' | 'unsupported';

/**
 * 分享卡片。
 *
 * 返回结果而不是抛错：用户主动取消分享是正常行为，不该报"分享失败"。
 */
export async function shareCard(data: ShareCardData, fileName = 'lianji-workout.png'): Promise<ShareOutcome> {
  const blob = await renderShareCardBlob(data);
  const file = new File([blob], fileName, { type: 'image/png' });

  const nav = navigator as Navigator & {
    canShare?: (d: { files?: File[] }) => boolean;
    share?: (d: { files?: File[]; title?: string; text?: string }) => Promise<void>;
  };

  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: '训练记录', text: data.title });
      return 'shared';
    } catch (e) {
      // AbortError = 用户取消，不是失败
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // 其他错误继续走下载兜底
    }
  }

  if (typeof URL.createObjectURL !== 'function') return 'unsupported';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  // 延迟释放，立即释放会让部分浏览器下载到空文件
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}




