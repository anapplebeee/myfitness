/**
 * 资深健身 App PM 视角的深度走查采集脚本（2026-10-27 第二轮）。
 *
 * 目的：不是验证"能不能用"，而是量化"用起来什么感觉"——
 * 逐页截图 + DOM 度量（字号档位、酸橙用量、对比度、触控区、溢出、页面长度）。
 *
 * 用法：node scripts/pm-deep-audit.mjs [baseUrl]
 * 依赖：本机 Edge（channel: msedge），不下载浏览器。
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const BASE = process.argv[2] ?? 'http://localhost:5180';
const OUT = 'shots/deep-audit-2026-10-27';
await mkdir(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[audit]', ...a);

/** 页面内度量：返回结构化数值，供报告引用。 */
const MEASURE = () => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return (
      r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity) > 0.05
    );
  };
  const parse = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
  };
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const la = lum(a);
    const lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.85) return c;
      n = n.parentElement;
    }
    const root = parse(getComputedStyle(document.body).backgroundColor);
    return root && root.a > 0.85 ? root : { r: 255, g: 255, b: 255, a: 1 };
  };
  const hex = (c) =>
    '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

  const textEls = [...document.querySelectorAll('body *')].filter(
    (el) => vis(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0),
  );

  const sizes = new Set();
  const weights = new Set();
  const lowContrast = [];

  for (const el of textEls) {
    const s = getComputedStyle(el);
    const fs = parseFloat(s.fontSize);
    const fw = parseInt(s.fontWeight, 10);
    sizes.add(Math.round(fs * 10) / 10);
    weights.add(fw);
    const fg = parse(s.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const cr = ratio(fg, bg);
    // WCAG AA：>=18.66px 或 >=24px 为大文本，阈值 3.0；其余 4.5
    const large = fs >= 24 || (fs >= 18.66 && fw >= 700);
    const need = large ? 3 : 4.5;
    if (cr < need) {
      const t = el.textContent.trim().slice(0, 26);
      if (t) lowContrast.push({ t, fs: Math.round(fs * 10) / 10, fw, cr: Math.round(cr * 100) / 100, fg: hex(fg), bg: hex(bg) });
    }
  }

  // 酸橙填充块（背景接近 #c9f53f）
  const lime = { r: 201, g: 245, b: 63 };
  const limeFills = [...document.querySelectorAll('body *')].filter((el) => {
    if (!vis(el)) return false;
    const c = parse(getComputedStyle(el).backgroundColor);
    if (!c || c.a < 0.5) return false;
    return Math.abs(c.r - lime.r) < 26 && Math.abs(c.g - lime.g) < 26 && Math.abs(c.b - lime.b) < 40;
  });

  // 触控区不足 44
  const tappable = [...document.querySelectorAll('button, a, [role="button"], input, select, textarea, label')].filter(vis);
  const smallTargets = tappable
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { t: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 22), w: Math.round(r.width), h: Math.round(r.height) };
    })
    .filter((x) => x.w < 44 || x.h < 44);

  // 横向溢出
  const docW = document.documentElement.clientWidth;
  const overflow = [...document.querySelectorAll('body *')]
    .filter((el) => vis(el) && el.getBoundingClientRect().right > docW + 1)
    .slice(0, 12)
    .map((el) => ({
      sel: el.className && typeof el.className === 'string' ? el.className.slice(0, 40) : el.tagName,
      right: Math.round(el.getBoundingClientRect().right),
    }));

  const topbar = document.querySelector('.topbar');
  const tabbar = document.querySelector('.tabbar');
  const hero = document.querySelector('.hero, .card--ink');

  return {
    vw: docW,
    vh: window.innerHeight,
    pageHeight: Math.round(document.documentElement.scrollHeight),
    screens: Math.round((document.documentElement.scrollHeight / window.innerHeight) * 10) / 10,
    topbarH: topbar ? Math.round(topbar.getBoundingClientRect().height) : null,
    tabbar: tabbar ? { w: Math.round(tabbar.getBoundingClientRect().width), h: Math.round(tabbar.getBoundingClientRect().height) } : null,
    heroH: hero ? Math.round(hero.getBoundingClientRect().height) : null,
    fontSizes: [...sizes].sort((a, b) => a - b),
    fontWeights: [...weights].sort((a, b) => a - b),
    lowContrast: lowContrast.slice(0, 14),
    lowContrastCount: lowContrast.length,
    limeFillCount: limeFills.length,
    limeFills: limeFills.slice(0, 8).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        cls: typeof el.className === 'string' ? el.className.slice(0, 34) : el.tagName,
        txt: (el.textContent || '').trim().slice(0, 16),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    }),
    smallTargetCount: smallTargets.length,
    smallTargets: smallTargets.slice(0, 10),
    overflow,
    textLen: document.body.innerText.replace(/\s+/g, ' ').length,
  };
};

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
page.on('console', (m) => {
  if (m.type() === 'error') log('console.error:', m.text().slice(0, 160));
});
page.on('pageerror', (e) => log('pageerror:', String(e).slice(0, 200)));

const report = {};
const shot = async (name, opts = {}) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: !!opts.full });
};

const measure = async (name) => {
  const m = await page.evaluate(MEASURE);
  const txt = await page.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, 2600));
  report[name] = { ...m, text: txt };
  log(
    name,
    `h=${m.pageHeight}(${m.screens}屏) 字号${m.fontSizes.length}种 字重${m.fontWeights.length}种 酸橙${m.limeFillCount} 低对比${m.lowContrastCount} 小触点${m.smallTargetCount} 溢出${m.overflow.length}`,
  );
  return report[name];
};

const tapText = async (text, opts = {}) => {
  const loc = page.getByText(text, { exact: opts.exact ?? false }).first();
  await loc.click({ timeout: 5000 });
  await sleep(opts.wait ?? 450);
};

/** 关掉可能残留的浮层，避免遮挡底部导航导致点击被拦截。 */
const closeOverlay = async () => {
  for (let i = 0; i < 4; i++) {
    const blocked = await page.evaluate(() => {
      const tb = document.querySelector('.tabbar');
      if (!tb) return false;
      const r = tb.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !tb.contains(el);
    });
    if (!blocked) return;
    await page.keyboard.press('Escape');
    await sleep(250);
    const closeBtn = page.locator('[aria-label*="关闭"], .sheet__close, .modal__close, .panel__close').first();
    if (await closeBtn.count()) {
      await closeBtn.click({ timeout: 1500 }).catch(() => {});
      await sleep(300);
    }
    // 兜底：点遮罩再取消
    const cancel = page.getByText(/取消|关闭|以后再说/).first();
    if (await cancel.count()) {
      await cancel.click({ timeout: 1200 }).catch(() => {});
      await sleep(300);
    }
  }
};

const tab = async (label) => {
  await closeOverlay();
  await page.locator('.tabbar__item', { hasText: label }).first().click({ timeout: 8000 });
  await sleep(650);
};

// ── 0. 冷启动 → 引导 ─────────────────────────────────────────
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
await page.waitForSelector('.topbar', { timeout: 15000 });
const bootMs = Date.now() - t0;
log('boot', bootMs, 'ms');
await sleep(700);
await shot('01-onboarding');
const onb = await page.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, 1800));
report['01-onboarding'] = { bootMs, text: onb };

// 走完引导三步
await tapText('知道了，下一步');
await shot('02-onboarding-plan');
await page.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, 1800));
await tapText('下一步');
await shot('03-onboarding-goals');
await tapText('开始使用', { wait: 900 });
await shot('04-today-first');

// ── 1. 今日 ─────────────────────────────────────────────────
await measure('04-today-first');
await shot('04-today-full', { full: true });

// ── 2. 训练 ─────────────────────────────────────────────────
await tab('训练');
await measure('05-train-plan');
await shot('05-train-plan-full', { full: true });

// 训练页内的分栏（若存在）
const segs = await page.evaluate(() =>
  [...document.querySelectorAll('.segmented__item, .tabs__item, [role="tab"]')].map((e) => e.textContent.trim()),
);
report['05-train-plan'].segments = segs;
if (segs.length) {
  for (const s of segs.slice(0, 4)) {
    try {
      await page.locator('.segmented__item, .tabs__item, [role="tab"]', { hasText: s }).first().click();
      await sleep(550);
      const safe = s.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
      await measure(`05-train-${safe}`);
      await shot(`05-train-${safe}`, { full: true });
    } catch (e) {
      log('segment fail', s, String(e).slice(0, 80));
    }
  }
}

// ── 3. 周目标 ───────────────────────────────────────────────
await tab('周目标');
await measure('06-plan');
await shot('06-plan-full', { full: true });

// ── 4. 饮食 ─────────────────────────────────────────────────
await tab('饮食');
await measure('07-food');
await shot('07-food-full', { full: true });
// 尝试打开添加食物
try {
  const addBtn = page.getByText(/添加|记录|去记录|加一餐/).first();
  if (await addBtn.count()) {
    await addBtn.click({ timeout: 3000 });
    await sleep(700);
    await measure('07-food-add');
    await shot('07-food-add');
    await closeOverlay();
  }
} catch (e) {
  log('food add skipped', String(e).slice(0, 90));
  await closeOverlay();
}

// ── 5. 教练 ─────────────────────────────────────────────────
await tab('教练');
await measure('08-coach');
await shot('08-coach-full', { full: true });
// 教练页长，分段截图
const coachH = report['08-coach'].pageHeight;
for (let i = 1; i <= Math.min(4, Math.ceil(coachH / 844) - 1); i++) {
  await page.evaluate((y) => window.scrollTo(0, y), i * 760);
  await sleep(380);
  await shot(`08-coach-scroll${i}`);
}
await page.evaluate(() => window.scrollTo(0, 0));

// ── 6. 我的 ─────────────────────────────────────────────────
await tab('我的');
await measure('09-me');
await shot('09-me-full', { full: true });

// ── 7. 数据与备份 ───────────────────────────────────────────
await tab('今日');
await page.locator('.chip', { hasText: '本地存储' }).first().click();
await sleep(700);
await measure('10-data');
await shot('10-data-full', { full: true });

// ── 8. 走一遍训练现场 ───────────────────────────────────────
await tab('今日');
const started = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /开始训练|继续这场|开始/.test(x.textContent));
  if (b) {
    b.click();
    return b.textContent.trim();
  }
  return null;
});
log('start workout ->', started);
await sleep(1200);
await measure('11-live');
await shot('11-live');

// 尝试记录一组：填第一个重量/次数输入，点完成
const recorded = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('.set__input, input[type="number"]')];
  if (!inputs.length) return 'NO_INPUT';
  inputs.forEach((el, i) => {
    const v = i % 2 === 0 ? '60' : '8';
    el.focus();
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  });
  return `FILLED ${inputs.length}`;
});
log('fill ->', recorded);
await sleep(400);
await shot('11-live-filled');
const doneBtn = await page.evaluate(() => {
  const b = document.querySelector('.set__check');
  if (b) {
    b.click();
    return b.getAttribute('aria-label');
  }
  return null;
});
log('complete set ->', doneBtn);
await sleep(900);
await measure('12-live-after-set');
await shot('12-live-after-set');

// 结束训练
const finished = await page.evaluate(() => {
  const b = document.querySelector('.live__finish');
  if (b) {
    b.click();
    return true;
  }
  return false;
});
log('finish ->', finished);
await sleep(1000);
await measure('13-finish-panel');
await shot('13-finish-panel');

// 确认结束
const confirmed = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '确认结束');
  if (b) {
    b.click();
    return true;
  }
  return false;
});
log('confirm finish ->', confirmed);
await sleep(1400);
await measure('14-after-finish');
await shot('14-after-finish');

// ── 9. 深色主题复核 ─────────────────────────────────────────
// 回到干净页面再切主题（训练浮层会挡住底部导航）
await page.goto(`${BASE}#today`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.tabbar', { timeout: 10000 });
await sleep(900);
const dark = await page.evaluate(() => {
  const root = document.documentElement;
  root.setAttribute('data-theme', 'dark');
  localStorage.setItem('lianji.theme', 'dark');
  return root.getAttribute('data-theme');
});
log('theme ->', dark);
await sleep(600);
for (const [label, name] of [
  ['今日', '15-dark-today'],
  ['训练', '16-dark-train'],
  ['饮食', '17-dark-food'],
  ['教练', '18-dark-coach'],
]) {
  await tab(label);
  await measure(name);
  await shot(name);
}
await page.evaluate(() => {
  document.documentElement.removeAttribute('data-theme');
  localStorage.removeItem('lianji.theme');
});

// ── 10. 360 窄屏复核 ────────────────────────────────────────
await page.setViewportSize({ width: 360, height: 800 });
await sleep(600);
await tab('今日');
await measure('19-w360-today');
await shot('19-w360-today', { full: true });
await tab('训练');
await measure('20-w360-train');
await shot('20-w360-train', { full: true });

// ── 11. 桌面 1024 ───────────────────────────────────────────
await page.setViewportSize({ width: 1024, height: 800 });
await sleep(600);
await tab('今日');
await measure('21-w1024-today');
await shot('21-w1024-today');
await tab('教练');
await measure('22-w1024-coach');
await shot('22-w1024-coach');

await writeFile(`${OUT}/metrics.json`, JSON.stringify(report, null, 2), 'utf8');
log('done ->', `${OUT}/metrics.json`);
await browser.close();
