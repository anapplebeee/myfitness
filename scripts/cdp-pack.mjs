// 验证内容包：动作库规模、搜索、授权展示。
import { writeFile } from 'node:fs/promises';

const port = Number(process.env.CDP_PORT ?? 9227);
const base = `http://127.0.0.1:${port}`;
const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:4180';

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
    return new Promise((resolve, reject) => {
      this.p.set(id, { resolve, reject });
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

  await cdp.send('Page.navigate', { url: `${appUrl}/#train` });
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

  // 动作库
  await evaluate(`(() => {
    const seg = [...document.querySelectorAll('.seg__item')].find((b) => b.textContent.trim() === '动作库');
    seg.click();
    return 'OK';
  })()`);
  await sleep(700);

  const lib = await evaluate(`(() => ({
    count: document.querySelectorAll('.lib__list .lib__row').length,
    firstNames: [...document.querySelectorAll('.lib__list .h3')].slice(0, 5).map((e) => e.textContent.trim()),
  }))()`);
  console.log('LIB:', JSON.stringify(lib));

  // 搜索扩展包动作
  const searchHit = await evaluate(`(() => {
    const inp = document.querySelector('input[type=search]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '哈克');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return 'OK';
  })()`);
  await sleep(600);
  const found = await evaluate(`(() => ({
    names: [...document.querySelectorAll('.lib__list .h3')].map((e) => e.textContent.trim()),
    count: document.querySelectorAll('.lib__list .lib__row').length,
  }))()`);
  console.log('SEARCH 哈克:', JSON.stringify(found), searchHit);
  await shot('pack-library');

  // 授权页
  await evaluate(`(() => {
    const b = document.querySelector('button[aria-label="返回"]');
    return 'NAV';
  })()`);
  await cdp.send('Page.navigate', { url: `${appUrl}/#me` });
  await sleep(1500);
  await evaluate(`(() => {
    const seg = [...document.querySelectorAll('.seg__item')].find((b) => b.textContent.trim() === '数据');
    if (seg) seg.click();
    return 'OK';
  })()`);
  await sleep(700);

  const lic = await evaluate(`(() => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('内容来源与授权'));
    if (!card) return { found: false };
    return {
      found: true,
      text: card.textContent.replace(/\\s+/g, ' ').trim().slice(0, 220),
      chips: [...card.querySelectorAll('.chip')].map((c) => c.textContent.trim()),
    };
  })()`);
  console.log('LICENSE CARD:', JSON.stringify(lic));
  await shot('pack-license');

  console.log('DONE');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
