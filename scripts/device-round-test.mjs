/**
 * 真机全面测试套件。
 *
 * 覆盖比冒烟更深：走完引导、五个标签页、核心训练闭环、
 * 目标设定、饮食记录、清理缓存、返回键、离线、持久化。
 *
 * 每步都截图，失败项记录具体原因，便于修复时定位。
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PORT = 9333;
const root = process.cwd();
const shotDir = join(root, 'shots', 'round-tests');
mkdirSync(shotDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function ok(name, detail = '') {
  results.push({ name, pass: true, detail });
  console.log(`PASS  ${name}${detail ? '  — ' + detail : ''}`);
}
function fail(name, detail = '') {
  results.push({ name, pass: false, detail });
  console.log(`FAIL  ${name}${detail ? '  — ' + detail : ''}`);
}

// ---------- adb ----------
const sdk = join(homedir(), 'AppData', 'Local', 'Android', 'Sdk');
const adb = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
function run(args, maxBuffer = 32 * 1024 * 1024) {
  const r = spawnSync(adb, args, { encoding: 'utf8', maxBuffer, timeout: 120_000 });
  return (r.stdout ?? '') + (r.stderr ?? '');
}

// ---------- CDP ----------
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
  send(method, params = {}, t = 15_000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.p.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.p.has(id)) {
          this.p.delete(id);
          reject(new Error('timeout ' + method));
        }
      }, t);
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

// 每步重连，避免应用重启后 socket 失效
async function connect() {
  for (let i = 0; i < 20; i += 1) {
    const sock = /@(webview_devtools_remote_\d+)/.exec(run(['shell', 'cat', '/proc/net/unix']))?.[1];
    if (sock) {
      run(['forward', '--remove-all']);
      run(['forward', `tcp:${PORT}`, `localabstract:${sock}`]);
      await sleep(600);
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        const page = list.find((x) => x.type === 'page');
        if (page) return await Cdp.connect(page.webSocketDebuggerUrl);
      } catch {
        /* retry */
      }
    }
    await sleep(1000);
  }
  throw new Error('无法连接 WebView');
}

let cdp = await connect();
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

const ev = async (expr) => {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, 20_000);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

const shot = async (name) => {
  for (let i = 0; i < 2; i += 1) {
    try {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' }, 40_000);
      writeFileSync(join(shotDir, `${name}.png`), Buffer.from(r.data, 'base64'));
      return true;
    } catch {
      await sleep(1200);
    }
  }
  console.log(`  (截图失败: ${name})`);
  return false;
};

const click = (sel, text) =>
  ev(`(() => {
    const els = [...document.querySelectorAll('${sel}')];
    const el = ${text ? `els.find(x => x.textContent.includes('${text}'))` : 'els[0]'};
    if (!el) return false;
    el.click();
    return true;
  })()`);

const has = (sel) => ev(`!!document.querySelector('${sel}')`);
const text = () => ev(`document.body.innerText`);

// ---------- 1. 从干净状态开始 ----------
console.log('\n=== 1. 清空并重启到引导 ===');
/*
 * 顺序很重要：必须在应用**运行中**清存储，再 force-stop。
 * 反过来会失败——应用被 kill 后 CDP 失效，清理代码根本不会执行，
 * 于是带着旧数据启动，永远进不了引导页（第一次跑就踩了这个坑）。
 */
const CLEANUP_JS = [
  '(async () => {',
  '  localStorage.clear();',
  '  const dbs = await indexedDB.databases();',
  '  await Promise.all(dbs.map((d) => new Promise((r) => {',
  '    const q = indexedDB.deleteDatabase(d.name);',
  '    q.onsuccess = q.onerror = q.onblocked = () => r();',
  '  })));',
  '  return 1;',
  '})()',
].join(String.fromCharCode(10));
await ev(CLEANUP_JS);
cdp.ws.close();
run(['shell', 'am', 'force-stop', 'com.tieguan.fit']);
await sleep(1500);
run(['shell', 'am', 'start', '-n', 'com.tieguan.fit/.MainActivity']);
await sleep(5000);
cdp = await connect();
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

(await has('.onb')) ? ok('启动进入引导页') : fail('启动进入引导页', await text().then((t) => t.slice(0, 60)));
await shot('01-onboarding');

// ---------- 2. 引导四步 ----------
console.log('\n=== 2. 引导流程 ===');
(await click('button', '知道了')) ? ok('步骤1 → 2') : fail('步骤1 → 2');
await sleep(700);
(await click('button', '下一步')) ? ok('步骤2 → 3') : fail('步骤2 → 3');
await sleep(700);

const step3Text = await text();
step3Text.includes('定个目标') ? ok('步骤3 含可选目标') : fail('步骤3 含可选目标');
await shot('02-onboarding-step3');

// 填两个目标
const filled = await ev(`(() => {
  const inputs = [...document.querySelectorAll('.onb__optional input')];
  if (inputs.length < 2) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(inputs[0], '72'); inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
  setter.call(inputs[1], '100'); inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
filled ? ok('填写体重与力量目标') : fail('填写体重与力量目标');
await sleep(300);

(await click('button', '开始使用')) ? ok('完成引导') : fail('完成引导');
await sleep(2000);
(await has('.tabbar')) ? ok('进入主界面') : fail('进入主界面');
await shot('03-after-onboarding');

// 验证目标落库
const goalsOk = await ev(`(() => {
  const raw = localStorage.getItem('tieguan.v2.state');
  if (!raw) return { ok: false };
  const s = JSON.parse(raw);
  return { ok: true, goals: (s.goals || []).map(g => g.kind) };
})()`);
goalsOk.ok && goalsOk.goals?.includes('bodyweight') && goalsOk.goals?.includes('strength')
  ? ok('两个目标已保存', JSON.stringify(goalsOk.goals))
  : fail('两个目标已保存', JSON.stringify(goalsOk));

// ---------- 3. 五个标签页 ----------
console.log('\n=== 3. 标签页 ===');
for (const [label, name] of [
  ['今日', '04-today'],
  ['训练', '05-train'],
  ['周目标', '06-plan'],
  ['饮食', '07-food'],
  ['教练', '08-coach'],
  ['我的', '09-me'],
]) {
  const clicked = await click('.tabbar__item', label);
  await sleep(900);
  const len = await ev(`document.querySelector('main')?.innerText.length ?? 0`);
  clicked && len > 40 ? ok(`标签「${label}」`, `${len} 字符`) : fail(`标签「${label}」`, `${len} 字符`);
  await shot(name);
}

// ---------- 4. 核心闭环：记一组 ----------
console.log('\n=== 4. 记一组训练 ===');
await click('.tabbar__item', '今日');
await sleep(800);
const started = await click('button', '开始训练');
started ? ok('点击开始训练') : fail('点击开始训练');
await sleep(1800);

const inputs = await ev(`document.querySelectorAll('.set__input').length`);
inputs > 0 ? ok('录制页有输入框', `${inputs} 个`) : fail('录制页有输入框');

const setFilled = await ev(`(() => {
  const i = [...document.querySelectorAll('.set__input')];
  if (i.length < 2) return false;
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  s.call(i[0], '80'); i[0].dispatchEvent(new Event('input', { bubbles: true }));
  s.call(i[1], '8'); i[1].dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
setFilled ? ok('填入 80kg × 8') : fail('填入 80kg × 8');
await sleep(400);

(await click('.set__check')) ? ok('点勾选完成') : fail('点勾选完成');
await sleep(1200);
const saved = await ev(`document.querySelectorAll('.set--completed').length`);
saved > 0 ? ok('本组已保存', `${saved} 组`) : fail('本组已保存');
await shot('10-set-done');

// 「上次」列是否显示
const prevCol = await ev(`(() => {
  const el = document.querySelector('.set__prev');
  return el ? el.textContent.trim() : null;
})()`);
prevCol ? ok('显示「上次」参照', prevCol) : fail('显示「上次」参照');

// ---------- 5. 结束训练 + 小结 ----------
console.log('\n=== 5. 结束训练 ===');
(await click('button', '结束训练')) ? ok('点结束训练') : fail('点结束训练');
await sleep(1500);
(await has('.sheet__panel')) ? ok('出现结束小结') : fail('出现结束小结');
await shot('11-summary');

const summaryText = await text();
summaryText.includes('对比上次') || summaryText.includes('第一次记录')
  ? ok('小结含对比信息')
  : fail('小结含对比信息');

const confirmed = await ev(`(() => {
  const b = [...document.querySelectorAll('.sheet__panel button')].find(x => /确认|完成结束|保存/.test(x.textContent));
  if (!b) return false;
  b.click();
  return true;
})()`);
confirmed ? ok('确认结束') : fail('确认结束');
await sleep(2000);

// ---------- 6. 刷新后持久化 ----------
console.log('\n=== 6. 持久化 ===');
const before = await ev(`(() => {
  const s = JSON.parse(localStorage.getItem('tieguan.v2.state'));
  return { sessions: s.sessions.length, datasetId: s.datasetId, goals: (s.goals||[]).length };
})()`);
await cdp.send('Page.reload');
await sleep(3500);
const after = await ev(`(() => {
  const raw = localStorage.getItem('tieguan.v2.state');
  if (!raw) return null;
  const s = JSON.parse(raw);
  return { sessions: s.sessions.length, datasetId: s.datasetId, goals: (s.goals||[]).length, tabbar: !!document.querySelector('.tabbar') };
})()`);
after && after.datasetId === before.datasetId && after.sessions >= before.sessions
  ? ok('刷新后数据与 datasetId 保持', JSON.stringify(after))
  : fail('刷新后数据保持', `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
await shot('12-after-reload');

// ---------- 7. 饮食记录 ----------
console.log('\n=== 7. 饮食 ===');
await click('.tabbar__item', '饮食');
await sleep(900);
const foodBefore = await ev(`JSON.parse(localStorage.getItem('tieguan.v2.state')).foods.length`);
(await click('button', '添加')) ? ok('打开添加面板') : fail('打开添加面板');
await sleep(900);

const foodPicked = await ev(`(() => {
  const item = document.querySelector('.add__item');
  if (!item) return false;
  item.click();
  return true;
})()`);
if (foodPicked) {
  await sleep(900);
  const confirmed2 = await ev(`(() => {
    const b = [...document.querySelectorAll('.sheet__panel button')].find(x => /记录|添加|确认/.test(x.textContent));
    if (!b) return false;
    b.click();
    return true;
  })()`);
  await sleep(1200);
  const foodAfter = await ev(`JSON.parse(localStorage.getItem('tieguan.v2.state')).foods.length`);
  foodAfter > foodBefore ? ok('饮食记录已写入', `${foodBefore} → ${foodAfter}`) : fail('饮食记录已写入', `${foodBefore} → ${foodAfter}`);
} else {
  fail('打开添加面板', '面板内无食物项');
}
await shot('13-food');

// ---------- 8. 清理缓存 ----------
console.log('\n=== 8. 清理缓存 ===');
await click('.tabbar__item', '我的');
await sleep(800);
await ev(`(() => { const b=[...document.querySelectorAll('.seg__item')].find(x=>x.textContent.includes('设置')); if(b)b.click(); return 1; })()`);
await sleep(800);
(await has('.cache')) ? ok('设置页有清理缓存卡片') : fail('设置页有清理缓存卡片');
await shot('14-cache-card');

const dataBefore = await ev(`JSON.parse(localStorage.getItem('tieguan.v2.state')).sessions.length`);
await ev(`(async () => { const c = await caches.open('round-test'); await c.put('/x', new Response('y')); return 1; })()`);
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('清理缓存')); if(b)b.click(); return 1; })()`);
await sleep(3500);
cdp.ws.close();
cdp = await connect();
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
const dataAfter = await ev(`JSON.parse(localStorage.getItem('tieguan.v2.state')).sessions.length`);
const cacheLeft = await ev(`(async () => (await caches.keys()).length)()`);
dataAfter === dataBefore ? ok('清缓存后数据未丢', `${dataAfter} 场`) : fail('清缓存后数据未丢', `${dataBefore} → ${dataAfter}`);
cacheLeft === 0 ? ok('缓存已清空') : fail('缓存已清空', `剩 ${cacheLeft}`);
const urlNow = await ev(`location.href`);
urlNow.includes('_r=') ? ok('强制刷新生效') : fail('强制刷新生效', urlNow);
await shot('15-after-cache-clear');

// ---------- 9. 返回键 ----------
console.log('\n=== 9. 返回键 ===');
await click('.tabbar__item', '训练');
await sleep(900);
run(['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
await sleep(1500);
const stillAlive = run(['shell', 'pidof', 'com.tieguan.fit']).trim();
stillAlive ? ok('按返回键应用未被直接杀死', `pid=${stillAlive}`) : fail('按返回键应用被杀死');

// ---------- 10. 控制台错误 ----------
console.log('\n=== 10. 运行时错误 ===');
const logcat = run(['logcat', '-d', '-v', 'brief', '-s', 'AndroidRuntime:E', 'Capacitor/Console:V', 'Capacitor:E']);
const fatals = logcat.split('\n').filter((l) => /FATAL|AndroidRuntime.*E\//.test(l));
fatals.length === 0 ? ok('无 Java 崩溃') : fail('无 Java 崩溃', fatals.slice(0, 2).join(' | ').slice(0, 150));

const appErrors = logcat
  .split('\n')
  .filter((l) => /Console.*(Error|error)|Uncaught/.test(l))
  .slice(0, 3);
appErrors.length === 0 ? ok('无应用级 JS 错误') : fail('无应用级 JS 错误', appErrors.join(' | ').slice(0, 150));

// ---------- 汇总 ----------
const failed = results.filter((r) => !r.pass);
console.log(`\n${'='.repeat(50)}`);
console.log(`总计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
if (failed.length) {
  console.log('\n失败明细：');
  for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? ': ' + f.detail : ''}`);
}
writeFileSync(join(shotDir, 'results.json'), JSON.stringify(results, null, 2));
console.log(`\n截图与结果: shots/round-tests/`);

cdp.ws.close();
process.exit(failed.length ? 1 : 0);

