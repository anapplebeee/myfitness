// 验证 S7 同步：配置、测试连接、上传、拉取、冲突提示。
import { writeFile } from 'node:fs/promises';

const port = Number(process.env.CDP_PORT ?? 9228);
const base = `http://127.0.0.1:${port}`;
const APP = process.env.APP_URL ?? 'http://127.0.0.1:4173';
const SYNC_EP = process.env.SYNC_ENDPOINT ?? 'http://127.0.0.1:8788';

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
  await cdp.send('Network.enable');
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

  await cdp.send('Page.navigate', { url: `${APP}/#data` });
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

  // 检查同步面板存在
  const panel = await evaluate(`(() => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('把本机数据同步到你自己的服务器'));
    if (!card) return { found: false, cards: [...document.querySelectorAll('.card .label')].map((e) => e.textContent.trim()) };
    return {
      found: true,
      labels: [...card.querySelectorAll('.tiny')].map((e) => e.textContent.trim()),
      buttons: [...card.querySelectorAll('button')].map((b) => b.textContent.trim()),
    };
  })()`);
  console.log('PANEL:', JSON.stringify(panel));
  await shot('sync-panel');

  // 填写配置
  await evaluate(`(() => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('把本机数据同步到你自己的服务器'));
    const inputs = card.querySelectorAll('input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inputs[0], '${SYNC_EP}');
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(inputs[1], 'test-token-123');
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    return 'FILLED';
  })()`);
  await sleep(400);

  // 测试连接
  await evaluate(`(() => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('把本机数据同步到你自己的服务器'));
    const b = [...card.querySelectorAll('button')].find((x) => x.textContent.trim() === '测试连接');
    b.click();
    return 'CLICKED';
  })()`);
  await sleep(1500);
  const conn = await evaluate(`(() => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('把本机数据同步到你自己的服务器'));
    return card.querySelector('.syn__msg')?.textContent?.trim() ?? 'NO_MSG';
  })()`);
  console.log('CONNECT:', conn);

  // 立即同步
  await evaluate(`(() => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('把本机数据同步到你自己的服务器'));
    const b = [...card.querySelectorAll('button')].find((x) => x.textContent.trim() === '立即同步');
    b.click();
    return 'CLICKED';
  })()`);
  await sleep(3000);
  const sync1 = await evaluate(`(() => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('把本机数据同步到你自己的服务器'));
    return {
      msg: card.querySelector('.syn__msg')?.textContent?.trim() ?? 'NO_MSG',
      conflict: !!card.querySelector('.syn__conflict'),
    };
  })()`);
  console.log('SYNC 1:', JSON.stringify(sync1));
  await shot('sync-done');

  // 服务端确认
  const srvState = await (await fetch(`${SYNC_EP}/api/dataset`, {
    headers: { authorization: 'Bearer test-token-123' },
  })).json();
  console.log('SERVER:', JSON.stringify({
    datasetId: srvState.datasetId,
    sessions: srvState.records?.sessions?.length,
    weights: srvState.records?.weights?.length,
  }));

  // 再点一次：内容未变应跳过
  await evaluate(`(() => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('把本机数据同步到你自己的服务器'));
    [...card.querySelectorAll('button')].find((x) => x.textContent.trim() === '立即同步').click();
    return 'CLICKED';
  })()`);
  await sleep(2500);
  const sync2 = await evaluate(`(() => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('把本机数据同步到你自己的服务器'));
    return card.querySelector('.syn__msg')?.textContent?.trim() ?? 'NO_MSG';
  })()`);
  console.log('SYNC 2:', sync2);

  console.log('DONE');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
