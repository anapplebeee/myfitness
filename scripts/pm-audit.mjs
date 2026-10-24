/**
 * 产品经理视角实测：量核心任务的实际体验，不看代码看行为。
 *
 * 关键指标来自 00:24「快速记下一组 → 可靠保留本次训练 → 看见历史进步」。
 */
import { writeFile } from 'node:fs/promises';

const base = 'http://127.0.0.1:9230';
const APP = 'http://127.0.0.1:4182';

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
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((r, j) => {
      this.p.set(id, { resolve: r, reject: j });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((r, j) => {
      ws.addEventListener('open', r, { once: true });
      ws.addEventListener('error', j, { once: true });
    });
    return new Cdp(ws);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const t = await (await fetch(`${base}/json/list`)).json();
const page = t.find((x) => x.type === 'page');
const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
const ev = async (expr) => {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
};
const shot = async (n) => {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(`shots/pm-${n}.png`, Buffer.from(r.data, 'base64'));
};

const result = {};

// ---- 冷启动耗时 ----
const t0 = Date.now();
await cdp.send('Page.navigate', { url: APP });
await sleep(1200);
await ev(`(async () => { localStorage.clear(); const dbs = await indexedDB.databases(); await Promise.all(dbs.map(d=>new Promise(res=>{const q=indexedDB.deleteDatabase(d.name); q.onsuccess=q.onerror=q.onblocked=()=>res();}))); return 1; })()`);
const t1 = Date.now();
await cdp.send('Page.reload', { ignoreCache: true });
// 轮询直到 tabbar 出现
let ready = 0;
for (let i = 0; i < 60; i++) {
  const ok = await ev(`!!document.querySelector('.tabbar')`);
  if (ok) { ready = Date.now(); break; }
  await sleep(100);
}
result.coldStartMs = ready ? ready - t1 : null;

// ---- 从首页到记完一组：点击次数与耗时 ----
const t2 = Date.now();
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='开始训练'); b.click(); return 1; })()`);
await sleep(1200);
result.inputsAfterStart = await ev(`document.querySelectorAll('.set__input').length`);

// 填第一组
await ev(`(() => {
  const inputs = [...document.querySelectorAll('.set__input')];
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  setter.call(inputs[0], '80'); inputs[0].dispatchEvent(new Event('input',{bubbles:true}));
  setter.call(inputs[1], '8'); inputs[1].dispatchEvent(new Event('input',{bubbles:true}));
  return 1;
})()`);
await sleep(200);
await ev(`(() => { const s=document.querySelector('.set'); const b=s.querySelector('.btn--lime'); b.click(); return 1; })()`);
await sleep(800);
result.firstSetMs = Date.now() - t2;
result.savedCount = await ev(`document.querySelectorAll('.set--completed').length`);
await shot('train');

// ---- 关键：录入后能否看见进步 ----
await ev(`(() => { const b=document.querySelector('.live__back, .icon-btn'); if(b) b.click(); return 1; })()`);
await sleep(600);
// 若仍在训练页，点返回
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='返回'); if(b) b.click(); return 1; })()`);
await sleep(600);

// 今日页是否反映刚练的一组
await ev(`(() => { const b=[...document.querySelectorAll('.tabbar__item')].find(x=>x.textContent.includes('今日')); b.click(); return 1; })()`);
await sleep(700);
result.todayShowsDone = await ev(`document.body.innerText.includes('本周') || document.body.innerText.includes('已完成')`);
result.todayRing = await ev(`document.querySelector('.ring__num')?.textContent?.trim() ?? null`);
await shot('today');

// ---- 历史能否看到这次训练 ----
await ev(`(() => { const b=[...document.querySelectorAll('.tabbar__item')].find(x=>x.textContent.includes('训练')); b.click(); return 1; })()`);
await sleep(500);
await ev(`(() => { const b=[...document.querySelectorAll('.seg__item')].find(x=>x.textContent.trim()==='历史'); b.click(); return 1; })()`);
await sleep(700);
result.historyCount = await ev(`document.querySelectorAll('.hist__item, .history__item, .train__list > *').length`);
result.historyText = await ev(`document.body.innerText.slice(0, 300)`);
await shot('history');

// ---- 教练页是否真的"智能" ----
await ev(`(() => { const b=[...document.querySelectorAll('.tabbar__item')].find(x=>x.textContent.includes('教练')); b.click(); return 1; })()`);
await sleep(800);
result.coachText = await ev(`document.body.innerText.slice(0, 400)`);
await shot('coach');

// ---- 断网是否仍可记录（核心承诺）----
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
await ev(`(() => { const b=[...document.querySelectorAll('.tabbar__item')].find(x=>x.textContent.includes('今日')); b.click(); return 1; })()`);
await sleep(600);
const offlineOk = await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='开始训练'); if(!b) return 'NO_BUTTON'; b.click(); return 'CLICKED'; })()`);
await sleep(1000);
result.offlineStart = offlineOk;
result.offlineInputs = await ev(`document.querySelectorAll('.set__input').length`);
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

console.log(JSON.stringify(result, null, 2));
process.exit(0);
