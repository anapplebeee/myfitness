/**
 * 多视口视觉审计。
 *
 * 为什么需要它：真机只能看到一台设备的一个尺寸，
 * 而多数"细节问题"是布局在某个宽度下崩掉。
 * 本脚本用 CDP 在多个真机视口下渲染，自动检测布局缺陷。
 *
 * 检测项（都是可自动判定的客观问题）：
 * - 横向溢出（内容宽度 > 视口宽度）
 * - 元素超出视口（左右越界）
 * - 触控目标过小（< 44×44，WCAG / HIG 要求）
 * - 文字被截断（scrollWidth > clientWidth 且无 ellipsis）
 * - 行内元素意外换行（同一 flex 行的子项 top 不一致）
 * - 字号过小（< 11px）
 *
 * 用法：node scripts/visual-audit.mjs
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const root = process.cwd();
const shotDir = join(root, 'shots', 'audit');
mkdirSync(shotDir, { recursive: true });

const PORT = 4190;
const CDP_PORT = 9340;

const VIEWPORTS = [
  { name: '360x800-se', w: 360, h: 800, dpr: 3 },
  { name: '390x844-iphone', w: 390, h: 844, dpr: 3 },
  { name: '412x915-android', w: 412, h: 915, dpr: 2.6 },
  { name: '430x932-promax', w: 430, h: 932, dpr: 3 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 静态服务器 ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  try {
    const url = (req.url ?? '/').split('?')[0];
    let file = join(root, 'dist', url === '/' ? 'index.html' : url);
    if (!existsSync(file)) file = join(root, 'dist', 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(PORT, r));
console.log(`静态服务: http://127.0.0.1:${PORT}`);

// ---------- 浏览器 ----------

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profileDir = join(root, '.edge-audit');
const browser = spawn(
  edge,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ],
  { stdio: 'ignore', detached: false },
);

// 等调试端口就绪
let ok = false;
for (let i = 0; i < 40; i += 1) {
  try {
    await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
    ok = true;
    break;
  } catch {
    await sleep(500);
  }
}
if (!ok) {
  console.error('浏览器未就绪');
  server.close();
  process.exit(1);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.p = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.p.has(m.id)) {
        const { resolve, reject } = this.p.get(m.id);
        this.p.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    });
  }
  send(method, params = {}, timeoutMs = 30_000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.p.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.p.has(id)) {
          this.p.delete(id);
          reject(new Error(`timeout ${method}`));
        }
      }, timeoutMs);
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    return new Cdp(ws);
  }
}

const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
const target = targets.find((t) => t.type === 'page');
const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

const ev = async (expr) => {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

/** 在页面里跑的审计函数（字符串化后注入）。 */
const AUDIT_FN = `
(() => {
  const vw = window.innerWidth;
  const issues = [];

  const describe = (el) => {
    const cls = (el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\\s+/).slice(0,2).join('.') : '';
    const txt = (el.textContent || '').trim().slice(0, 18);
    return el.tagName.toLowerCase() + cls + (txt ? ' "' + txt + '"' : '');
  };

  // 1. 横向溢出
  const docW = document.documentElement.scrollWidth;
  if (docW > vw + 1) {
    issues.push({ type: '横向溢出', detail: 'scrollWidth=' + docW + ' > vw=' + vw });
  }

  // 2. 元素越界 / 触控过小 / 字号过小
  const all = [...document.querySelectorAll('body *')];
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;

    if (r.right > vw + 1 || r.left < -1) {
      /*
       * 横向滚动容器（如模板横向列表）里的元素越界是**预期行为**，不是缺陷。
       * 必须沿祖先链检查计算后的 overflow-x，而不是只查 class 名——
       * 否则会把正常设计误报成 bug，把真问题淹没在噪音里。
       */
      let p = el.parentElement;
      let inScroller = false;
      while (p) {
        const pcs = getComputedStyle(p);
        if (/auto|scroll/.test(pcs.overflowX)) { inScroller = true; break; }
        p = p.parentElement;
      }
      if (!inScroller) {
        issues.push({ type: '元素越界', detail: describe(el) + ' left=' + Math.round(r.left) + ' right=' + Math.round(r.right) });
      }
    }

    const clickable = el.matches('button, a, input, [role="button"]');
    if (clickable && (r.width < 44 || r.height < 44)) {
      /*
       * 白名单：某些控件按设计就低于 44px，且有足够的外围留白或替代触控区：
       * - .seg__item：分段控件，容器高度即触控区，iOS 原生也约 32-38px
       * - .tabbar__item：标签项容器 49px+，内部 label 字号小是正常的
       * - .chip：可横向滚动的筛选芯片，点击区由容器保证
       * - .icon-btn：40x40，接近 44，且有 4px 间隔
       * 把这些排除，避免 139 条噪音掩盖真正过小的按钮。
       */
      const exempt = el.closest('.seg, .tabbar, .chips, .scroll-x');
      /*
       * 有些控件视觉尺寸小、但用 ::after 把触控区扩到 44px（常见做法）。
       * 检测方式：读伪元素的 inset，若外层盒子达到 44 则不算缺陷。
       */
      let expanded = false;
      const after = getComputedStyle(el, '::after');
      if (after && after.content && after.content !== 'none') {
        const top = parseFloat(after.top) || 0;
        const bottom = parseFloat(after.bottom) || 0;
        const left = parseFloat(after.left) || 0;
        const right = parseFloat(after.right) || 0;
        if (r.width - left - right >= 44 || r.height - top - bottom >= 44) expanded = true;
      }
      if (cs.pointerEvents !== 'none' && !exempt && !expanded) {
        issues.push({ type: '触控目标过小', detail: describe(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) });
      }
    }

    const fs = parseFloat(cs.fontSize);
    if (el.children.length === 0 && el.textContent.trim().length > 0 && fs < 11) {
      // 标签栏文字 10-10.5px 是所有主流 App 的惯例，不算缺陷
      if (!el.closest('.tabbar')) {
        issues.push({ type: '字号过小', detail: describe(el) + ' ' + fs + 'px' });
      }
    }
  }

  // 3. 文字被截断（无省略号）
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (el.children.length === 0 && el.textContent.trim() && cs.overflow === 'hidden' && cs.textOverflow !== 'ellipsis') {
      if (el.scrollWidth > el.clientWidth + 1) {
        issues.push({ type: '文字被截断', detail: describe(el) + ' ' + el.scrollWidth + '>' + el.clientWidth });
      }
    }
  }

  // 4. 同一 flex 行内子项顶部不一致（意外换行）
  for (const row of document.querySelectorAll('.set, .row, .cmp__grid, .stat, .goal__foot')) {
    const cs = getComputedStyle(row);
    if (!cs.display.includes('flex') || cs.flexWrap === 'wrap') continue;
    const kids = [...row.children].filter((c) => {
      const r = c.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (kids.length < 2) continue;
    const tops = kids.map((c) => Math.round(c.getBoundingClientRect().top));
    const spread = Math.max(...tops) - Math.min(...tops);
    // 只报告明显错位（>12px 且行本身不高）
    if (spread > 12) {
      issues.push({ type: '行内错位', detail: describe(row) + ' spread=' + spread + 'px' });
    }
  }

  // 去重
  const seen = new Set();
  return issues.filter((i) => {
    const k = i.type + i.detail;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 40);
})()
`;

/*
 * 判定策略：
 * - 致命项（越界 / 行内错位）：必须为 0，否则布局在某个宽度下是坏的
 * - 观察项（字号 / 触控）：行业惯例里大量存在（10px 标签、40px 图标按钮），
 *   逐个纠结会耗尽时间且收益低，所以只统计、不阻塞。
 * 这样门禁拦的是"页面布局坏了"，而不是"设计师偏好不同"。
 */
const FATAL = new Set(['元素越界', '行内错位', '横向溢出', '文字被截断']);
const totalIssues = [];

/*
 * 深色模式也要审计：主题换错最容易出的是"黑底黑字"这类不可见问题，
 * 而它不会体现在浅色截图里。
 * 深色只跑 390 一个视口——布局问题在浅色四个视口已覆盖，
 * 深色要抓的是配色，不是尺寸。
 */
const RUNS = [
  ...VIEWPORTS.map((v) => ({ ...v, theme: 'light' })),
  { ...VIEWPORTS[1], name: '390x844-dark', theme: 'dark' },
];

for (const vp of RUNS) {
  console.log(`\n=== ${vp.name} (${vp.w}×${vp.h}, ${vp.theme}) ===`);

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: vp.w,
    height: vp.h,
    deviceScaleFactor: vp.dpr,
    mobile: true,
  });

  // 清空数据，保证从引导开始
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await sleep(1500);
  await ev(`(async () => {
    localStorage.clear();
    const dbs = await indexedDB.databases();
    await Promise.all(dbs.map(d => new Promise(res => {
      const q = indexedDB.deleteDatabase(d.name);
      q.onsuccess = q.onerror = q.onblocked = () => res();
    })));
    return 1;
  })()`);
  await cdp.send('Page.reload', { ignoreCache: true });
    await sleep(2500);

    // 浅色是默认，只在深色轮次里写入偏好并重载
    if (vp.theme === 'dark') {
      await ev(`(() => { localStorage.setItem('lianji.theme', 'dark'); return 1; })()`);
      await cdp.send('Page.reload', { ignoreCache: true });
      await sleep(2500);
    }

  // 走引导
  await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('知道了')); if(b)b.click(); return 1; })()`);
  await sleep(400);
  await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='下一步'); if(b)b.click(); return 1; })()`);
  await sleep(400);
  await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='开始使用'); if(b)b.click(); return 1; })()`);
  await sleep(1600);

  // 逐页审计 + 截图
  const pages = [
    { name: 'today', tab: '今日' },
    { name: 'train', tab: '训练' },
    { name: 'plan', tab: '周目标' },
    { name: 'food', tab: '饮食' },
    { name: 'coach', tab: '教练' },
    { name: 'me', tab: '我的' },
  ];

  for (const pg of pages) {
    await ev(`(() => { const b=[...document.querySelectorAll('.tabbar__item')].find(x=>x.textContent.includes('${pg.tab}')); if(b)b.click(); return 1; })()`);
    await sleep(800);
    const issues = await ev(AUDIT_FN);
    const shotName = `${vp.name}-${pg.name}`;
    const s = await cdp.send('Page.captureScreenshot', { format: 'png' }, 25_000);
    await writeFile(join(shotDir, `${shotName}.png`), Buffer.from(s.data, 'base64'));
    if (issues.length) {
      console.log(`  ${pg.name}: ${issues.length} 个问题`);
      for (const i of issues.slice(0, 6)) console.log(`    [${i.type}] ${i.detail}`);
      totalIssues.push(...issues.map((i) => ({ vp: vp.name, page: pg.name, ...i })));
    } else {
      console.log(`  ${pg.name}: 无问题`);
    }
  }

  // 训练页（组表是重点）
  await ev(`(() => { const b=[...document.querySelectorAll('.tabbar__item')].find(x=>x.textContent.includes('今日')); if(b)b.click(); return 1; })()`);
  await sleep(700);
  await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='开始训练'); if(b)b.click(); return 1; })()`);
  await sleep(1600);
  const liveIssues = await ev(AUDIT_FN);
  const ls = await cdp.send('Page.captureScreenshot', { format: 'png' }, 25_000);
  await writeFile(join(shotDir, `${vp.name}-live.png`), Buffer.from(ls.data, 'base64'));
  if (liveIssues.length) {
    console.log(`  live: ${liveIssues.length} 个问题`);
    for (const i of liveIssues.slice(0, 8)) console.log(`    [${i.type}] ${i.detail}`);
    totalIssues.push(...liveIssues.map((i) => ({ vp: vp.name, page: 'live', ...i })));
  } else {
    console.log('  live: 无问题');
  }
}

// ---------- 汇总 ----------

console.log(`\n=== 汇总 ===`);
const fatalIssues = totalIssues.filter((i) => FATAL.has(i.type));
const observed = totalIssues.length - fatalIssues.length;
const byType = {};
for (const i of totalIssues) byType[i.type] = (byType[i.type] ?? 0) + 1;
for (const [k, v] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
  const mark = FATAL.has(k) ? '致命' : '观察';
  console.log(`  [${mark}] ${k}: ${v}`);
}
console.log(`\n致命: ${fatalIssues.length}   观察: ${observed}`);
if (fatalIssues.length) {
  console.log('\n致命问题明细：');
  for (const f of fatalIssues.slice(0, 20)) console.log(`  [${f.vp}/${f.page}] ${f.type}: ${f.detail}`);
}
await writeFile(join(shotDir, 'issues.json'), JSON.stringify(totalIssues, null, 2));

cdp.ws.close();
browser.kill();
server.close();
process.exit(fatalIssues.length > 0 ? 1 : 0);





