// 验证更正后容量与统计是否重新计算。
import { writeFile } from 'node:fs/promises';

const port = Number(process.env.CDP_PORT ?? 9224);
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
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(`shots/${name}.png`, Buffer.from(r.data, 'base64'));
    console.log(`saved ${name}`);
  };

  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:4173/#train' });
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

  // 进入历史 → 第一条
  await evaluate(`(() => {
    const seg = [...document.querySelectorAll('.seg__item')].find((b) => b.textContent.trim() === '历史');
    seg.click();
    return 'OK';
  })()`);
  await sleep(700);
  await evaluate(`(() => { document.querySelector('.history__btn').click(); return 'OK'; })()`);
  await sleep(900);

  const before = await evaluate(`(() => ({
    volume: document.querySelectorAll('.detail__stats > div')[1]?.textContent?.replace(/\\s+/g,' ').trim(),
    sets: document.querySelectorAll('.detail .set').length,
  }))()`);
  console.log('BEFORE:', JSON.stringify(before));

  // 选一个正式工作组（跳过热身）再改，才能验证容量重算
  await evaluate(`(() => {
    const sets = [...document.querySelectorAll('.detail .set')];
    // 第一组可能是热身，取第二个已完成组
    const target = sets[1] ?? sets[0];
    target.click();
    return 'OK';
  })()`);
  await sleep(500);
  await evaluate(`(() => {
    const inputs = document.querySelectorAll('.sheet__panel .input--lg');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inputs[0], '200');
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(inputs[1], '10');
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    return 'OK';
  })()`);
  await sleep(300);
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('保存更正'));
    b.click();
    return 'OK';
  })()`);
  await sleep(1000);

  const after = await evaluate(`(() => ({
    volume: document.querySelectorAll('.detail__stats > div')[1]?.textContent?.replace(/\\s+/g,' ').trim(),
    firstSet: document.querySelector('.detail .set__main')?.textContent?.replace(/\\s+/g,' ').trim(),
  }))()`);
  console.log('AFTER:', JSON.stringify(after));
  await shot('s3-volume-recalc');

  // 返回，看历史汇总是否也变了
  await evaluate(`(() => {
    const b = document.querySelector('button[aria-label="返回"]');
    b.click();
    return 'OK';
  })()`);
  await sleep(900);
  const summary = await evaluate(`(() => ({
    total: [...document.querySelectorAll('.history__summary .stat__value')].map((e) => e.textContent.trim()),
  }))()`);
  console.log('HISTORY SUMMARY:', JSON.stringify(summary));

  console.log('DONE');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

