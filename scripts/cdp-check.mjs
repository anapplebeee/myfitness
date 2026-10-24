// 用 CDP 驱动 Edge：真实点击、填写、截图，验证交互页。
import { writeFile } from 'node:fs/promises';

const port = Number(process.env.CDP_PORT ?? 9222);
const base = `http://127.0.0.1:${port}`;

async function listTargets() {
  const res = await fetch(`${base}/json/list`);
  return res.json();
}

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
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    return new Cdp(ws);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const targets = await listTargets();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(`shots/${name}.png`, Buffer.from(r.data, 'base64'));
    console.log(`saved shots/${name}.png`);
  };

  const clickText = async (text, selector = 'button') => {
    const ok = await evaluate(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = els.find((e) => e.textContent.replace(/\\s+/g, ' ').trim().includes(${JSON.stringify(text)}));
      if (!el) return 'NOT_FOUND';
      el.click();
      return 'OK';
    })()`);
    if (ok !== 'OK') throw new Error(`clickText failed: ${text} -> ${ok}`);
    await sleep(450);
  };

  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:4173/#train' });
  await sleep(1800);

  // 清空上一轮遗留的本地数据，保证从干净状态验证
  await evaluate(`(async () => {
    localStorage.clear();
    const dbs = await indexedDB.databases();
    await Promise.all(dbs.map((d) => new Promise((res) => {
      const req = indexedDB.deleteDatabase(d.name);
      req.onsuccess = req.onerror = req.onblocked = () => res();
    })));
    return 'CLEARED';
  })()`);
  // 必须硬重载，否则内存中的旧会话仍在
  await cdp.send('Page.reload', { ignoreCache: true });
  await sleep(2500);

  // 进入训练首页 → 记录计划页状态
  await shot('train');

  // 点第一个训练日，进入直播训练页
  const started = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('.day')];
    if (!btns.length) return 'NO_DAY';
    btns[0].click();
    return 'OK';
  })()`);
  console.log('start day:', started);
  await sleep(900);
  await shot('live-empty');

  // 确认直播页存在输入框
  const info = await evaluate(`(() => ({
    title: document.querySelector('.live__title .h3')?.textContent ?? null,
    chips: [...document.querySelectorAll('.live__exlist .chip')].map((c) => c.textContent.trim()),
    inputs: document.querySelectorAll('.set__input').length,
  }))()`);
  console.log('live info:', JSON.stringify(info));

  // 填写第一组：重量 100，次数 5
  const filled = await evaluate(`(() => {
    const inputs = [...document.querySelectorAll('.set__input')];
    if (inputs.length < 2) return 'NO_INPUT';
    const setValue = (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setValue(inputs[0], '100');
    setValue(inputs[1], '5');
    return 'OK';
  })()`);
  console.log('fill:', filled);
  await sleep(300);
  await shot('live-typing');

  // 点完成
  const done = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.set .btn--lime')][0];
    if (!btn) return 'NO_BTN';
    btn.click();
    return 'OK';
  })()`);
  console.log('complete set:', done);
  await sleep(900);
  await shot('live-rest');

  const after = await evaluate(`(() => ({
    completed: document.querySelectorAll('.set--completed').length,
    restVisible: !!document.querySelector('.rest'),
    restText: document.querySelector('.rest__time')?.textContent ?? null,
  }))()`);
  console.log('after complete:', JSON.stringify(after));

  // 打开换动作面板
  await clickText('换动作', '.chip');
  await sleep(500);
  await shot('live-picker');

  const picker = await evaluate(`document.querySelectorAll('.picker__item').length`);
  console.log('picker items:', picker);

  console.log('DONE');
  process.exit(0);
}

main().catch((err) => {
  console.error('CDP FAILED:', err.message);
  process.exit(1);
});
