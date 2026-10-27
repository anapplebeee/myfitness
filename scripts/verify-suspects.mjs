/**
 * 定向验证三个可疑点（2026-10-27 深度评审用）：
 *  A. "从零开始"后，今日页与饮食页的营养目标是否同源（同一事实两个数？）
 *  B. 训练页的模板横滑卡是否造成整页横向滚动（真溢出 vs 容器内滚动）
 *  C. 滚到页面底部，最后一个元素是否被固定 tab bar 遮挡
 */
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://localhost:5180';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.topbar', { timeout: 15000 });
await sleep(800);

const out = {};

// ── A. 走"从零开始"分支 ─────────────────────────────
await page.getByText('知道了，下一步').first().click();
await sleep(400);
// 取消"保留示例数据"的勾选（若存在）
const cleared = await page.evaluate(() => {
  const boxes = [...document.querySelectorAll('input[type="checkbox"]')];
  const hit = boxes.find((b) => {
    const wrap = b.closest('label, .check, .switch') ?? b.parentElement;
    return /示例|演示|保留/.test(wrap?.textContent ?? '');
  });
  if (hit) {
    if (hit.checked) hit.click();
    return { found: true, checked: hit.checked };
  }
  return { found: false, count: boxes.length };
});
out.keepDemoToggle = cleared;
await sleep(300);
await page.getByText('下一步').first().click();
await sleep(400);
await page.getByText('开始使用').first().click();
await sleep(1200);

out.afterOnboarding = await page.evaluate(() => {
  const st = JSON.parse(localStorage.getItem('lianji.state.v1') ?? '{}');
  return {
    sessions: st.sessions?.length ?? null,
    foods: st.foods?.length ?? null,
    targetKcal: st.targetKcal ?? null,
    targetProtein: st.targetProtein ?? null,
    occurrences: st.occurrences?.length ?? null,
    weekGoals: st.weekGoals?.length ?? null,
  };
});

out.todayPage = await page.evaluate(() => {
  const t = document.body.innerText;
  const m = t.match(/(\d+)\s*\/\s*(\d+)\s*kcal/);
  return { kcalLine: m ? m[0] : null, hasFood: /今天吃了什么/.test(t), head: t.slice(0, 220) };
});

// 跳饮食页
await page.locator('.tabbar__item', { hasText: '饮食' }).first().click();
await sleep(700);
out.foodPage = await page.evaluate(() => {
  const t = document.body.innerText;
  const m = t.match(/(\d+)\s*\/\s*(\d+)\s*kcal/);
  const p = t.match(/(\d+)\s*\/\s*(\d+)\s*g/);
  return { kcalLine: m ? m[0] : null, proteinLine: p ? p[0] : null, head: t.slice(0, 220) };
});

// 今日页的热量展示（同一事实对照）
await page.locator('.tabbar__item', { hasText: '今日' }).first().click();
await sleep(700);
out.todayFoodCard = await page.evaluate(() => {
  const t = document.body.innerText;
  const idx = t.indexOf('热量');
  const idx2 = t.indexOf('kcal');
  return {
    around: idx >= 0 ? t.slice(idx, idx + 60) : t.slice(Math.max(0, idx2 - 40), idx2 + 40),
    kcalHits: [...t.matchAll(/(\d+)\s*(?:\/\s*(\d+))?\s*kcal/g)].map((x) => x[0]),
  };
});

// ── B. 训练页横向滚动 ────────────────────────────────
await page.locator('.tabbar__item', { hasText: '训练' }).first().click();
await sleep(800);
out.horizontalScroll = await page.evaluate(() => {
  const de = document.documentElement;
  const wrap = document.querySelector('.tpl-wrap');
  return {
    docScrollWidth: de.scrollWidth,
    docClientWidth: de.clientWidth,
    bodyOverflowX: getComputedStyle(document.body).overflowX,
    tplWrapScrollWidth: wrap?.scrollWidth ?? null,
    tplWrapClientWidth: wrap?.clientWidth ?? null,
    tplWrapOverflowX: wrap ? getComputedStyle(wrap).overflowX : null,
  };
});

// ── C. 滚到底部是否被 tab bar 遮挡 ───────────────────
const bottomCheck = async (label) => {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await sleep(600);
  return page.evaluate((l) => {
    const tb = document.querySelector('.tabbar');
    if (!tb) return { label: l, tabbar: null };
    const tr = tb.getBoundingClientRect();
    // 找到视口内、位于 tabbar 区域下方的最后一段文字元素
    const texts = [...document.querySelectorAll('p, h1, h2, h3, span, button')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > tr.top && r.top < tr.bottom && el.textContent.trim();
    });
    return {
      label: l,
      tabbarTop: Math.round(tr.top),
      innerPaddingBottom: getComputedStyle(document.querySelector('.shell__inner')).paddingBottom,
      covered: texts.slice(0, 5).map((el) => ({ t: el.textContent.trim().slice(0, 20), top: Math.round(el.getBoundingClientRect().top) })),
    };
  }, label);
};
out.bottomTrain = await bottomCheck('train');
await page.locator('.tabbar__item', { hasText: '饮食' }).first().click();
await sleep(700);
out.bottomFood = await bottomCheck('food');
await page.locator('.tabbar__item', { hasText: '教练' }).first().click();
await sleep(700);
out.bottomCoach = await bottomCheck('coach');

console.log(JSON.stringify(out, null, 2));
await browser.close();
