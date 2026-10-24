// 验证 S4：计时/距离/自重动作的录入控件与容量口径。
import { writeFile } from 'node:fs/promises';

const port = Number(process.env.CDP_PORT ?? 9226);
const base = `http://127.0.0.1:${port}`;

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

  // 进入动作库，检查模式是否影响展示
  const libCheck = await evaluate(`(() => {
    const seg = [...document.querySelectorAll('.seg__item')].find((b) => b.textContent.trim() === '动作库');
    seg.click();
    return 'OK';
  })()`);
  await sleep(600);
  console.log('LIB:', libCheck);

  // 开始空白训练，手动加一个计时动作
  await evaluate(`(() => {
    const seg = [...document.querySelectorAll('.seg__item')].find((b) => b.textContent.trim() === '计划');
    seg.click();
    return 'OK';
  })()`);
  await sleep(400);
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('空白训练'));
    b.click();
    return 'OK';
  })()`);
  await sleep(900);

  // 打开换动作/加动作面板，找平板支撑
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('.chip')].find((x) => x.textContent.includes('加动作'));
    if (b) b.click();
    return 'OK';
  })()`);
  await sleep(600);

  await evaluate(`(() => {
    const inp = document.querySelector('.sheet__panel input[type=search]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '平板');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return 'OK';
  })()`);
  await sleep(500);

  const picked = await evaluate(`(() => {
    const items = [...document.querySelectorAll('.picker__item')];
    const target = items.find((i) => i.textContent.includes('平板支撑'));
    if (!target) return { ok: false, available: items.map((i) => i.textContent.trim().split('\\n')[0]).slice(0, 5) };
    target.click();
    return { ok: true };
  })()`);
  console.log('PICK PLANK:', JSON.stringify(picked));
  await sleep(900);

  const plankInputs = await evaluate(`(() => {
    const inputs = [...document.querySelectorAll('.set__input')];
    return {
      count: inputs.length,
      ariaLabels: inputs.map((i) => i.getAttribute('aria-label')),
      units: [...document.querySelectorAll('.set__unit')].map((u) => u.textContent.trim()),
      hint: document.querySelector('.live__panel-head .tiny')?.textContent?.trim(),
    };
  })()`);
  console.log('PLANK INPUTS:', JSON.stringify(plankInputs));
  await shot('s4-plank-input');

  // 填时长 45 秒并完成
  await evaluate(`(() => {
    const input = document.querySelector('.set__input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '45');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return 'OK';
  })()`);
  await sleep(300);
  await evaluate(`(() => {
    const b = document.querySelector('.set .btn--lime');
    if (b) b.click();
    return 'OK';
  })()`);
  await sleep(900);

  const plankDone = await evaluate(`(() => ({
    completed: document.querySelectorAll('.set--completed').length,
    setText: document.querySelector('.set__done')?.textContent?.replace(/\\s+/g,' ').trim(),
    toast: document.querySelector('.toast')?.textContent?.trim(),
  }))()`);
  console.log('PLANK DONE:', JSON.stringify(plankDone));
  await shot('s4-plank-done');

  // 切到距离动作验证四输入
  // 用"换动作"切到距离类动作：按钮在横向滚动区末尾，需先滚动到可见
  await evaluate(`(() => {
    const chips = [...document.querySelectorAll('.live__exlist .chip')];
    const b = chips.find((x) => x.textContent.includes('换动作'));
    if (!b) return 'NO_BTN';
    b.scrollIntoView();
    b.click();
    return 'OK';
  })()`);
  await sleep(800);
  await evaluate(`(() => {
    const inp = document.querySelector('.sheet__panel input[type=search]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '快走');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return 'OK';
  })()`);
  await sleep(500);
  await evaluate(`(() => {
    const items = [...document.querySelectorAll('.picker__item')];
    const t = items.find((i) => i.textContent.includes('坡度快走'));
    if (!t) return 'NOT_FOUND';
    t.click();
    return 'OK';
  })()`);
  await sleep(900);

  const walkInputs = await evaluate(`(() => ({
    exercise: document.querySelector('.live__panel-head .h2')?.textContent?.trim(),
    count: document.querySelectorAll('.set__input').length,
    ariaLabels: [...document.querySelectorAll('.set__input')].map((i) => i.getAttribute('aria-label')),
    units: [...document.querySelectorAll('.set__unit')].map((u) => u.textContent.trim()),
  }))()`);
  console.log('WALK INPUTS:', JSON.stringify(walkInputs));
  await shot('s4-walk-input');

  console.log('DONE');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});





