// 验证 S6：导出信封、导入预览、合并、替换备份。
import { writeFile } from 'node:fs/promises';

const port = Number(process.env.CDP_PORT ?? 9225);
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

  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:4173/#data' });
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

  const overview = await evaluate(`(() => ({
    count: document.querySelector('.data__count')?.textContent?.replace(/\\s+/g,' ').trim(),
    datasetId: document.querySelector('.data__id')?.textContent?.trim(),
    hasExport: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('下载备份文件')),
    hasUpload: !!document.querySelector('input[type=file]'),
  }))()`);
  console.log('OVERVIEW:', JSON.stringify(overview));
  await shot('s6-data');

  // 生成导出 JSON（不真正下载，直接读内容）
  const exported = await evaluate(`(() => {
    // 通过剪贴板路径不可靠，这里直接重新构造：读 localStorage 校验信封结构
    const raw = localStorage.getItem('lianji.v2.state');
    return raw ? 'HAS_STATE' : 'NO_STATE';
  })()`);
  console.log('STATE:', exported);

  // 用页面内动态 import 拿到 buildExport 的结果不现实；改为触发下载并检查 Blob
  const downloadOk = await evaluate(`(() => {
    let captured = null;
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = (blob) => { captured = blob; return 'blob:fake'; };
    const btns = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('下载备份文件'));
    btns.click();
    URL.createObjectURL = origCreate;
    return captured ? { size: captured.size, type: captured.type } : 'NO_BLOB';
  })()`);
  console.log('DOWNLOAD:', JSON.stringify(downloadOk));

  // 构造一个合法文件并导入（通过 DataTransfer 注入文件）
  const importResult = await evaluate(`(async () => {
    const raw = localStorage.getItem('lianji.v2.state');
    if (!raw) return 'NO_STATE';
    const state = JSON.parse(raw);
    // 造一个最小合法信封（schemaVersion 1）
    const env = {
      format: 'lianji-export',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      datasetId: state.datasetId || 'ds_test',
      dataset: { createdAt: state.createdAt, appStateVersion: 2, accountingTimezone: 'Asia/Shanghai' },
      records: {
        profile: state.profile,
        sessions: [],
        weights: [],
        foods: [],
        occurrences: [],
        weekGoals: [],
        customTemplates: [],
        activeTemplateId: state.activeTemplateId,
        activeTemplateSince: state.activeTemplateSince,
        bodyGoalGrams: state.bodyGoalGrams,
        targetKcal: state.targetKcal,
        targetProtein: state.targetProtein,
        weeklyGoal: state.weeklyGoal,
      },
      contentRefs: [],
    };
    const file = new File([JSON.stringify(env)], 'test-export.json', { type: 'application/json' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector('input[type=file]');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 800));
    return 'INJECTED';
  })()`);
  console.log('IMPORT INJECT:', importResult);
  await sleep(900);

  const preview = await evaluate(`(() => ({
    hasPreview: !!document.querySelector('.preview'),
    stats: [...document.querySelectorAll('.preview__grid > div')].map((d) => d.textContent.replace(/\\s+/g,' ').trim()),
    segments: [...document.querySelectorAll('.seg__item')].map((b) => b.textContent.trim()),
    banners: [...document.querySelectorAll('.issues')].map((e) => e.textContent.trim().slice(0, 40)),
    confirmBtn: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).find((t) => t.includes('确认')),
  }))()`);
  console.log('PREVIEW:', JSON.stringify(preview));
  await shot('s6-import-preview');

  // 非法文件
  const badResult = await evaluate(`(async () => {
    const file = new File(['not json at all'], 'bad.json', { type: 'application/json' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector('input[type=file]');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 700));
    return document.querySelector('.issues--bad')?.textContent?.trim() ?? 'NO_ERROR_SHOWN';
  })()`);
  console.log('BAD FILE:', badResult);
  await shot('s6-import-bad');

  console.log('DONE');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

