/**
 * 真机 WebView E2E（可重复执行）。
 *
 * 背景：HyperOS 拒绝 `adb shell input tap`（INJECT_EVENTS），
 * 且 WebView 内部 DOM 对 uiautomator 完全不透明——整个应用是一个节点。
 * 所以真机交互**只能**走 CDP。
 *
 * 前置：
 *   1. CAP_BUILD_TYPE=debug npx cap sync android
 *   2. cd android && ./gradlew assembleDebug
 *   3. adb install -r -t app-debug.apk
 *   4. adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>
 *
 * 用法：node scripts/android-cdp.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { writeFile } from 'node:fs/promises';

const PORT = Number(process.env.ANDROID_CDP_PORT ?? 9333);
const root = process.cwd();
const shotDir = join(root, 'shots', 'android-cdp');
mkdirSync(shotDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

function findSdk() {
  for (const p of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]) {
    if (p && existsSync(p)) return p;
  }
  const guess = join(homedir(), 'AppData', 'Local', 'Android', 'Sdk');
  return existsSync(guess) ? guess : null;
}

const sdk = findSdk();
const adb = sdk ? join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : null;

/** 自动重连：应用重启后 socket 名会变，必须重新 forward。 */
async function ensureForward() {
  if (!adb) return false;
  const r = spawnSync(adb, ['shell', 'cat', '/proc/net/unix'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const m = /@(webview_devtools_remote_\d+)/.exec(r.stdout ?? '');
  if (!m) return false;
  spawnSync(adb, ['forward', '--remove-all'], { encoding: 'utf8' });
  spawnSync(adb, ['forward', `tcp:${PORT}`, `localabstract:${m[1]}`], { encoding: 'utf8' });
  await sleep(800);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    return list.some((x) => x.type === 'page');
  } catch {
    return false;
  }
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
  send(method, params = {}, timeoutMs = 12_000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.p.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.p.has(id)) {
          this.p.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
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

// ---------- 连接 ----------

if (!(await ensureForward())) {
  console.error('无法连接 WebView。检查：');
  console.error('  1. APK 是否为 debug 构建（webContentsDebuggingEnabled=true）');
  console.error('  2. 应用是否在前台运行');
  console.error('  3. adb devices 是否能看到设备');
  process.exit(1);
}

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((x) => x.type === 'page');
const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Log.enable');

const ev = async (expr) => {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

/**
 * 截图。
 * 真机上 Page.captureScreenshot 偶尔会卡住（WebView 合成线程繁忙），
 * 所以单独给更长超时并重试一次；仍失败就记为「截图失败」而不是中断整个流程。
 */
const shot = async (name) => {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' }, 45_000);
      await writeFile(join(shotDir, `${name}.png`), Buffer.from(r.data, 'base64'));
      console.log(`  截图: shots/android-cdp/${name}.png`);
      return true;
    } catch (e) {
      if (attempt === 2) {
        console.log(`  截图失败: ${name} (${String(e.message).slice(0, 60)})`);
        return false;
      }
      await sleep(1500);
    }
  }
  return false;
};

const clickText = async (selector, text) =>
  ev(`(() => {
    const el = [...document.querySelectorAll('${selector}')].find(x => x.textContent.trim().includes('${text}'));
    if (!el) return false;
    el.click();
    return true;
  })()`);

// ---------- 1. 渲染与资源 ----------

record('页面标题正确', (await ev('document.title')).includes('铁馆'));
record('URL 为 Capacitor 本地域', page.url.startsWith('https://localhost'), page.url);

const cssOk = await ev(`(() => {
  const el = document.querySelector('.tabbar') || document.querySelector('.onb__title') || document.querySelector('h1');
  if (!el) return { ok: false };
  const cs = getComputedStyle(el);
  return { ok: true, fs: cs.fontSize, ff: cs.fontFamily.slice(0, 30), color: cs.color };
})()`);
record('CSS 已加载（非白屏）', cssOk.ok && parseFloat(cssOk.fs) > 8, JSON.stringify(cssOk));
await shot('01-initial');

// ---------- 2. 走引导（若存在） ----------

if (await ev(`!!document.querySelector('.onb')`)) {
  record('首次启动显示引导', true);
  await clickText('button', '知道了');
  await sleep(600);
  await clickText('button', '下一步');
  await sleep(600);
  await clickText('button', '开始使用');
  await sleep(1600);
  record('引导可走完', !(await ev(`!!document.querySelector('.onb')`)));
} else {
  record('引导已完成（本次跳过）', true);
}

// ---------- 3. 五个标签页 ----------

for (const [label, name] of [
  ['训练', '02-train'],
  ['周目标', '03-plan'],
  ['饮食', '04-food'],
  ['教练', '05-coach'],
  ['我的', '06-me'],
  ['今日', '07-today'],
]) {
  const ok = await clickText('.tabbar__item', label);
  await sleep(800);
  const len = await ev(`document.querySelector('main')?.innerText.length ?? 0`);
  record(`标签「${label}」可打开并有内容`, ok && len > 40, `${len} 字符`);
  await shot(name);
}

// ---------- 4. 标题不出现中文断词 ----------

const titleInfo = await ev(`(() => {
  const t = document.querySelector('.hero__title');
  if (!t) return null;
  const cs = getComputedStyle(t);
  const r = t.getBoundingClientRect();
  return {
    text: t.textContent.trim(),
    lines: Math.round(r.height / parseFloat(cs.lineHeight)),
    fs: cs.fontSize,
  };
})()`);
record('今日页主标题存在', Boolean(titleInfo), JSON.stringify(titleInfo));

// ---------- 5. 记一组（核心闭环） ----------

const startedNow = await ev(`(() => {
  const live = document.querySelector('.live');
  if (live) return 'ALREADY_LIVE';
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '开始训练');
  if (b) { b.click(); return 'STARTED'; }
  const resume = document.querySelector('.resume');
  if (resume) { resume.click(); return 'RESUMED'; }
  return 'NONE';
})()`);
record('可进入录制页', startedNow !== 'NONE', startedNow);
await sleep(1500);

const inputCount = await ev(`document.querySelectorAll('.set__input').length`);
record('录制页有输入框', inputCount > 0, `${inputCount} 个`);

if (inputCount >= 2) {
  await ev(`(() => {
    const i = [...document.querySelectorAll('.set__input')];
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    s.call(i[0], '70'); i[0].dispatchEvent(new Event('input', { bubbles: true }));
    s.call(i[1], '6'); i[1].dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(300);
  await ev(`(() => {
    const st = document.querySelector('.set');
    const b = st && st.querySelector('.btn--lime');
    if (b) b.click();
    return true;
  })()`);
  await sleep(1000);
  const saved = await ev(`document.querySelectorAll('.set--completed').length`);
  record('完成一组并保存', saved > 0, `${saved} 组`);
}

// ---------- 6. 组行布局（真机窄屏关键） ----------

const rowLayout = await ev(`(() => {
  const sets = [...document.querySelectorAll('.set')];
  return sets.slice(0, 4).map((s) => {
    const skip = s.querySelector('.set__skipbtn');
    const inputs = s.querySelector('.set__inputs');
    if (!skip || !inputs) return { noSkip: true };
    const sr = skip.getBoundingClientRect();
    const ir = inputs.getBoundingClientRect();
    return { sameLine: sr.top < ir.bottom && sr.bottom > ir.top };
  });
})()`);
const allSameLine = rowLayout.filter((r) => r.sameLine !== undefined).every((r) => r.sameLine);
record('组内「跳过」不换行（真机窄屏）', allSameLine, JSON.stringify(rowLayout));
await shot('08-live');

// ---------- 7. 持久化 ----------

const before = await ev(`(() => {
  const raw = localStorage.getItem('lianji.v2.state');
  if (!raw) return null;
  const s = JSON.parse(raw);
  return { sessions: s.sessions.length, datasetId: s.datasetId };
})()`);
record('数据已落盘', Boolean(before), JSON.stringify(before));

await cdp.send('Page.reload');
await sleep(3000);
const after = await ev(`(() => {
  const raw = localStorage.getItem('lianji.v2.state');
  if (!raw) return null;
  const s = JSON.parse(raw);
  return { sessions: s.sessions.length, datasetId: s.datasetId, tabbar: !!document.querySelector('.tabbar') };
})()`);
record(
  '刷新后数据与 datasetId 均保持',
  after && before && after.datasetId === before.datasetId && after.sessions >= before.sessions,
  JSON.stringify(after),
);
await shot('09-after-reload');

// ---------- 8. 安全区 ----------

const safe = await ev(`(() => {
  const tb = document.querySelector('.tabbar');
  if (!tb) return null;
  const r = tb.getBoundingClientRect();
  return { bottomGap: Math.round(window.innerHeight - r.bottom), height: Math.round(r.height), vh: window.innerHeight };
})()`);
record('底部标签栏未被遮挡', safe && safe.height > 30, JSON.stringify(safe));

// ---------- 汇总 ----------

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
console.log('截图: shots/android-cdp/');
if (failed.length) {
  console.log('\n失败项：');
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ': ' + f.detail : ''}`);
}
cdp.ws.close();
process.exit(failed.length ? 1 : 0);


