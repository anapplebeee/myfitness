// 验证训练结束时"本次计入周目标"的确认流程。
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

  // 干净状态
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:4173/#train' });
  await sleep(1600);
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

  // 开始一个训练日
  await evaluate(`(() => { document.querySelector('.day').click(); return 'OK'; })()`);
  await sleep(900);

  // 完成第一组
  await evaluate(`(() => {
    const inputs = [...document.querySelectorAll('.set__input')];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inputs[0], '100');
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(inputs[1], '5');
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.set .btn--lime').click();
    return 'OK';
  })()`);
  await sleep(700);

  // 结束训练 → 打开总结
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('结束训练'));
    if (b) b.click();
    return 'OK';
  })()`);
  await sleep(800);

  const sheet = await evaluate(`(() => ({
    creditRow: document.querySelector('.credit__text .h3')?.textContent?.trim() ?? null,
    hint: document.querySelector('.credit__text .tiny')?.textContent?.trim() ?? null,
    checked: document.querySelector('.credit__box')?.checked ?? null,
    hasSelect: !!document.querySelector('.credit__select'),
  }))()`);
  console.log('FINISH SHEET:', JSON.stringify(sheet));
  await shot('finish-credit');

  // 勾选后应出现项目下拉
  await evaluate(`(() => {
    const box = document.querySelector('.credit__box');
    box.click();
    return 'OK';
  })()`);
  await sleep(500);

  const afterCheck = await evaluate(`(() => {
    const sel = document.querySelector('.credit__select');
    return {
      hasSelect: !!sel,
      options: sel ? [...sel.options].map((o) => o.textContent.trim()) : [],
      value: sel ? sel.value : null,
    };
  })()`);
  console.log('AFTER CHECK:', JSON.stringify(afterCheck));
  await shot('finish-credit-checked');

  // 确认结束
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('确认结束'));
    if (b) b.click();
    return 'OK';
  })()`);
  await sleep(1200);

  // 回到周目标页确认完成数增加
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:4173/#plan' });
  await sleep(1500);
  const planAfter = await evaluate(`(() => ({
    value: document.querySelector('.goalcard__value')?.textContent?.replace(/\\s+/g,'') ?? null,
    narr: document.querySelector('.goalcard__narr')?.textContent?.trim() ?? null,
    stats: [...document.querySelectorAll('.goalcard__stats > div')].map((d) => d.textContent.replace(/\\s+/g,' ').trim()),
  }))()`);
  console.log('PLAN AFTER TRAINING:', JSON.stringify(planAfter));
  await shot('plan-after-training');

  console.log('DONE');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
