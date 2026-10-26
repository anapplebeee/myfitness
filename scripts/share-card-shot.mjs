/**
 * 分享卡片渲染检查。
 *
 * 把卡片真画出来存成 PNG，人眼过一遍：
 * 有没有文字重叠、超出边界、留白失衡、字号跳变。
 * 单测只验数据投影，验不了排版。
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const outDir = join(root, 'shots', 'share');
mkdirSync(outDir, { recursive: true });
const BASE = process.env.PREVIEW_URL ?? 'http://127.0.0.1:4191';

const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL ?? 'msedge' });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
await page.goto(BASE, { waitUntil: 'networkidle' });

// 直接在页面上下文里构造数据并绘制，绕过 UI，专注验证渲染
const dataUrl = await page.evaluate(async () => {
  const mod = await import('/src/lib/share-card-canvas.ts');
  const data = {
    title: '上肢 A · 水平推拉',
    dateLabel: '10月26日 · 周一',
    volumeValue: '12,340',
    setsValue: '18',
    durationValue: '58:12',
    lifts: [
      { name: '杠铃深蹲', detail: '110 kg × 3', weightGrams: 110000 },
      { name: '杠铃卧推', detail: '80 kg × 8', weightGrams: 80000 },
      { name: '杠铃划船', detail: '70 kg × 8', weightGrams: 70000 },
    ],
    valid: true,
  };
  const canvas = document.createElement('canvas');
  mod.drawShareCard(canvas, data);
  return canvas.toDataURL('image/png');
});

const base64 = dataUrl.split(',')[1];
writeFileSync(join(outDir, 'card.png'), Buffer.from(base64, 'base64'));
console.log('已生成 shots/share/card.png');

// 长标题与无时长的情况也要看
const dataUrl2 = await page.evaluate(async () => {
  const mod = await import('/src/lib/share-card-canvas.ts');
  const data = {
    title: '下肢 B · 髋主导 · 硬拉变式与单腿稳定训练',
    dateLabel: '11月2日 · 周日',
    volumeValue: '8,900',
    setsValue: '12',
    durationValue: null,
    lifts: [{ name: '罗马尼亚硬拉', detail: '自重 × 15', weightGrams: 0 }],
    valid: true,
  };
  const canvas = document.createElement('canvas');
  mod.drawShareCard(canvas, data);
  return canvas.toDataURL('image/png');
});
writeFileSync(join(outDir, 'card-long.png'), Buffer.from(dataUrl2.split(',')[1], 'base64'));
console.log('已生成 shots/share/card-long.png');

await browser.close();
