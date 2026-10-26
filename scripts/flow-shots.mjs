/**
 * 引导流程与圆形修复的目视检查。
 *
 * 这类问题（椭圆、重复提问、布局错位）单测和类型检查都看不见，
 * 必须真的渲染出来看。
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const outDir = join(process.cwd(), 'shots', 'flow');
mkdirSync(outDir, { recursive: true });
const BASE = process.env.PREVIEW_URL ?? 'http://127.0.0.1:4191';

const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL ?? 'msedge' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
await page.goto(BASE, { waitUntil: 'networkidle' });

// 清空，从引导开始
await page.evaluate(async () => {
  localStorage.clear();
  const dbs = await indexedDB.databases();
  await Promise.all(dbs.map((d) => new Promise((r) => {
    const q = indexedDB.deleteDatabase(d.name);
    q.onsuccess = q.onerror = q.onblocked = () => r();
  })));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// 第 1 步 → 第 2 步（频率 + 计划预览）
await page.getByRole('button', { name: /知道了/ }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: join(outDir, 'onb-freq.png') });

// 选 2 次，确认计划预览跟着变
await page.getByRole('button', { name: /^2\s*次\/周$/ }).click().catch(async () => {
  await page.locator('.onb__goal').first().click();
});
await page.waitForTimeout(500);
await page.screenshot({ path: join(outDir, 'onb-freq-2.png') });
const plan2 = await page.locator('.onb__plan .h3').innerText();

// 选 4 次
await page.locator('.onb__goal').nth(2).click();
await page.waitForTimeout(400);
const plan4 = await page.locator('.onb__plan .h3').innerText();
console.log('选 2 次 →', plan2);
console.log('选 4 次 →', plan4);

// 走完引导，量一下圆
await page.getByRole('button', { name: '下一步' }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: join(outDir, 'onb-goal.png') });
await page.getByRole('button', { name: '开始使用' }).click();
await page.waitForTimeout(1500);

const ring = await page.evaluate(() => {
  const el = document.querySelector('.ring');
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { w: Math.round(b.width), h: Math.round(b.height) };
});
console.log('ring 尺寸:', JSON.stringify(ring));
await page.screenshot({ path: join(outDir, 'today.png') });

await browser.close();
console.log('截图: shots/flow/');
