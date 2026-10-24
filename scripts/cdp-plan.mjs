// 验证周目标页：目标卡、日历状态、豁免/顺延操作、训练结束计入周目标。
import { writeFile } from 'node:fs/promises';

const port = Number(process.env.CDP_PORT ?? 9223);
const base = `http://127.0.0.1:${port}`;

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const targets = await (await fetch(`${base}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const evaluate = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(`shots/${name}.png`, Buffer.from(r.data, 'base64'));
    console.log(`saved ${name}`);
  };

  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:4173/#plan' });
  await sleep(1800);
  await evaluate(`(async () => {
    localStorage.clear();
    const dbs = await indexedDB.databases();
    await Promise.all(dbs.map((d) => new Promise((res) => {
      const req = indexedDB.deleteDatabase(d.name);
      req.onsuccess = req.onerror = req.onblocked = () => res();
    })));
    return 'CLEARED';
  })()`);
  await cdp.send('Page.reload', { ignoreCache: true });
  await sleep(2600);

  const goalInfo = await evaluate(`(() => ({
    title: document.querySelector('.goalcard__value')?.textContent?.replace(/\\s+/g,'') ?? null,
    narr: document.querySelector('.goalcard__narr')?.textContent?.trim() ?? null,
    status: document.querySelector('.goalcard__badge .chip')?.textContent?.trim() ?? null,
    stats: [...document.querySelectorAll('.goalcard__stats > div')].map((d) => d.textContent.replace(/\\s+/g,' ').trim()),
    days: [...document.querySelectorAll('.day')].map((d) => ({
      label: d.querySelector('.day__label')?.textContent?.trim(),
      badge: d.querySelector('.day__badge')?.textContent?.trim(),
    })),
    items: document.querySelectorAll('.item').length,
  }))()`);
  console.log('GOAL:', JSON.stringify(goalInfo));
  await shot('plan');

  // 打开第一项操作面板
  const opened = await evaluate(`(() => {
    const list = [...document.querySelectorAll('.item')];
    const it = list.find((el) => el.textContent.includes('未完成')) ?? list[0];
    if (!it) return 'NO_ITEM';
    it.click();
    return 'OK';
  })()`);
  await sleep(600);
  const sheet = await evaluate(`(() => ({
    title: document.querySelector('.sheet__panel .h2')?.textContent?.trim() ?? null,
    acts: [...document.querySelectorAll('.act__title')].map((a) => a.textContent.trim()),
    reasons: [...document.querySelectorAll('.reasons .chip')].map((c) => c.textContent.trim()),
  }))()`);
  console.log('SHEET:', JSON.stringify(sheet), 'opened:', opened);
  await shot('plan-actions');

  // 执行豁免：选"出差"后点豁免
  await evaluate(`(() => {
    const chips = [...document.querySelectorAll('.reasons .chip')];
    const c = chips.find((x) => x.textContent.includes('出差'));
    if (c) c.click();
    return 'OK';
  })()`);
  await sleep(250);
  await evaluate(`(() => {
    const act = [...document.querySelectorAll('.act')].find((a) => a.textContent.includes('豁免'));
    if (act) act.click();
    return 'OK';
  })()`);
  await sleep(900);

  const afterExcuse = await evaluate(`(() => ({
    narr: document.querySelector('.goalcard__narr')?.textContent?.trim() ?? null,
    note: document.querySelector('.plan__note')?.textContent?.trim() ?? null,
    excusedDays: [...document.querySelectorAll('.day.is-excused')].length,
    toast: document.querySelector('.toast')?.textContent?.trim() ?? null,
  }))()`);
  console.log('AFTER EXCUSE:', JSON.stringify(afterExcuse));
  await shot('plan-after-excuse');

  // 打开目标编辑器
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('调整最低目标'));
    if (b) b.click();
    return 'OK';
  })()`);
  await sleep(600);
  const editor = await evaluate(`(() => ({
    open: !!document.querySelector('.sheet__panel .input--lg'),
    max: document.querySelector('.input--lg')?.getAttribute('max') ?? null,
  }))()`);
  console.log('EDITOR:', JSON.stringify(editor));
  await shot('plan-target');

  console.log('DONE');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

