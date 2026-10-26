/**
 * 深色模式目视检查。
 *
 * 自动测试只能验证"偏好存了、DOM 写了"，验不了"好不好看、有没有黑底黑字"。
 * 这个脚本把两种主题各页截图出来，人眼过一遍。
 *
 * 检查重点（人眼）：
 * - 有没有元素消失在背景里（黑底黑字、浅底浅字）
 * - 反色卡片（.card--ink）在深色下是否仍然成立
 * - 图表、进度环、日历格的边界是否还能分辨
 * - 主色酸橙是否刺眼
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const outDir = join(root, 'shots', 'theme');
mkdirSync(outDir, { recursive: true });

const BASE = process.env.PREVIEW_URL ?? 'http://127.0.0.1:4191';

const TABS = [
  ['今日', 'today'],
  ['训练', 'train'],
  ['计划', 'plan'],
  ['饮食', 'food'],
  ['教练', 'coach'],
  ['我的', 'me'],
];

// 本地开发用系统 Edge，CI 用 Playwright 自带 Chromium（与 playwright.config 一致）
const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL ?? 'msedge' });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
});
const page = await ctx.newPage();

/** 跳过引导：直接标记 onboarded，比点三步稳定。两个存储副本都要改。 */
async function skipOnboarding() {
  const onb = page.locator('.onb');
  if ((await onb.count()) === 0) return;
  await page.evaluate(async () => {
    const raw = localStorage.getItem('lianji.v2.state');
    if (!raw) return;
    const state = JSON.parse(raw);
    state.onboarded = true;
    localStorage.setItem('lianji.v2.state', JSON.stringify(state));
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('lianji', 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('state', 'readwrite');
        tx.objectStore('state').put(state, 'app');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
      };
      req.onerror = () => reject(req.error);
    });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
}

async function shot(theme) {
  // 先设偏好，再重载，确保首屏就是目标主题
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate((t) => {
    localStorage.setItem('lianji.theme', t);
  }, theme);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await skipOnboarding();

  const resolved = await page.evaluate(() => {
    const root = document.documentElement;
    return {
      dataTheme: root.getAttribute('data-theme'),
      colorScheme: root.style.colorScheme,
      paper: getComputedStyle(root).getPropertyValue('--paper').trim(),
      card: getComputedStyle(root).getPropertyValue('--card').trim(),
      text: getComputedStyle(root).getPropertyValue('--text').trim(),
      bodyBg: getComputedStyle(document.body).backgroundColor,
    };
  });
  console.log(`[${theme}]`, JSON.stringify(resolved));

  for (const [label, slug] of TABS) {
    const tab = page.locator('.tabbar__item', { hasText: label }).first();
    if ((await tab.count()) > 0) {
      await tab.click({ timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(700);
    }
    await page.screenshot({ path: join(outDir, `${theme}-${slug}.png`), fullPage: false });
  }
}

await shot('light');
await shot('dark');

await browser.close();
console.log(`\n截图已保存: shots/theme/`);



