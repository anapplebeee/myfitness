// 验证 S2 模板编辑 + S3 历史更正/补录。
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
  const clickText = async (text, sel = 'button') => {
    const r = await evaluate(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(sel)})]
        .find((e) => e.textContent.replace(/\\s+/g, ' ').includes(${JSON.stringify(text)}));
      if (!el) return 'NOT_FOUND';
      el.click();
      return 'OK';
    })()`);
    if (r !== 'OK') throw new Error(`click ${text} -> ${r}`);
    await sleep(500);
  };

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

  // ---- S2 模板编辑 ----
  await clickText('编辑');
  await sleep(700);
  const editor = await evaluate(`(() => ({
    hasTitle: !!document.querySelector('.editor'),
    versionLabel: document.querySelector('.editor .label')?.textContent?.trim() ?? null,
    days: [...document.querySelectorAll('.days .chip')].map((c) => c.textContent.trim()),
    exCount: document.querySelectorAll('.ex').length,
    inputs: [...document.querySelectorAll('.ex__input')].map((i) => i.value),
  }))()`);
  console.log('EDITOR:', JSON.stringify(editor));
  await shot('s2-editor');

  // 改组数 3 → 5
  await evaluate(`(() => {
    const input = document.querySelectorAll('.ex__input')[0];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '5');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return 'OK';
  })()`);
  await sleep(400);
  const changed = await evaluate(`(() => ({
    saveLabel: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => t.includes('新版本'))[0] ?? null,
  }))()`);
  console.log('AFTER CHANGE:', JSON.stringify(changed));

  // 保存 → 应弹版本确认
  await clickText('保存为新版本');
  await sleep(700);
  const confirm = await evaluate(`(() => ({
    open: !!document.querySelector('.sheet__panel .h2'),
    title: document.querySelector('.sheet__panel .h2')?.textContent?.trim() ?? null,
    body: document.querySelector('.sheet__panel .small')?.textContent?.trim()?.slice(0, 60) ?? null,
  }))()`);
  console.log('VERSION DIALOG:', JSON.stringify(confirm));
  await shot('s2-version-dialog');

  await clickText('确认保存');
  await sleep(1200);
  const afterSave = await evaluate(`(() => ({
    editorGone: !document.querySelector('.editor'),
    versionChip: [...document.querySelectorAll('.chip')].map((c) => c.textContent.trim()).find((t) => /^v\\d+$/.test(t)) ?? null,
    toast: document.querySelector('.toast')?.textContent?.trim() ?? null,
  }))()`);
  console.log('AFTER SAVE:', JSON.stringify(afterSave));

  // ---- S3 历史更正 ----
  await clickText('历史');
  await sleep(700);
  await evaluate(`(() => {
    const row = document.querySelector('.history__btn');
    if (!row) return 'NO_ROW';
    row.click();
    return 'OK';
  })()`);
  await sleep(800);
  const detail = await evaluate(`(() => ({
    hasDetail: !!document.querySelector('.detail'),
    stats: [...document.querySelectorAll('.detail__stats > div')].map((d) => d.textContent.replace(/\\s+/g,' ').trim()),
    actions: [...document.querySelectorAll('.detail .btn--sm')].map((b) => b.textContent.trim()),
    setCount: document.querySelectorAll('.detail .set').length,
  }))()`);
  console.log('DETAIL:', JSON.stringify(detail));
  await shot('s3-detail');

  // 更正第一组
  await evaluate(`(() => {
    const s = document.querySelector('.detail .set');
    if (!s) return 'NO_SET';
    s.click();
    return 'OK';
  })()`);
  await sleep(600);
  await evaluate(`(() => {
    const inputs = document.querySelectorAll('.sheet__panel .input--lg');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inputs[0], '92.5');
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(inputs[1], '6');
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    return 'OK';
  })()`);
  await sleep(300);
  await clickText('保存更正');
  await sleep(900);
  const afterEdit = await evaluate(`(() => ({
    firstSet: document.querySelector('.detail .set__main')?.textContent?.replace(/\\s+/g,' ').trim() ?? null,
    editedChip: [...document.querySelectorAll('.detail .chip')].map((c) => c.textContent.trim()).includes('已更正'),
    toast: document.querySelector('.toast')?.textContent?.trim() ?? null,
  }))()`);
  console.log('AFTER EDIT:', JSON.stringify(afterEdit));
  await shot('s3-detail-edited');

  // 删除 → 墓碑
  await clickText('删除');
  await sleep(600);
  await clickText('确认删除');
  await sleep(900);
  const afterDelete = await evaluate(`(() => ({
    banner: document.querySelector('.detail__banner')?.textContent?.trim()?.slice(0, 30) ?? null,
    deletedChip: [...document.querySelectorAll('.detail .chip')].map((c) => c.textContent.trim()).includes('已删除'),
    canRestore: [...document.querySelectorAll('.detail .btn')].some((b) => b.textContent.includes('恢复')),
  }))()`);
  console.log('AFTER DELETE:', JSON.stringify(afterDelete));
  await shot('s3-tombstone');

  // ---- S3 补录 ----
  await evaluate(`(() => {
    const back = document.querySelector('button[aria-label="返回"]');
    if (!back) return 'NO_BACK';
    back.click();
    return 'OK';
  })()`);
  await sleep(800);
  await clickText('补录');
  await sleep(700);
  const backfill = await evaluate(`(() => ({
    open: !!document.querySelector('.sheet__panel .h2'),
    selfReported: !!document.querySelector('.credit__box'),
    picks: document.querySelectorAll('.pick-grid .chip').length,
  }))()`);
  console.log('BACKFILL:', JSON.stringify(backfill));
  await shot('s3-backfill');

  // 勾选自报并保存
  await evaluate(`(() => { document.querySelector('.credit__box').click(); return 'OK'; })()`);
  await sleep(400);
  await clickText('保存补录');
  await sleep(1000);
  const backfillDone = await evaluate(`(() => ({
    toast: document.querySelector('.toast')?.textContent?.trim() ?? null,
    selfReportedChips: [...document.querySelectorAll('.chip')].filter((c) => c.textContent.trim() === '自报').length,
  }))()`);
  console.log('BACKFILL DONE:', JSON.stringify(backfillDone));

  console.log('DONE');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});


