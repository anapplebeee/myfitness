// 诊断：更正后容量为何不刷新。
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
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result.value;
  };

  // 读 localStorage 里的真实数据，直接算容量
  const calc = await evaluate(`(() => {
    const raw = localStorage.getItem('lianji.v2.state');
    if (!raw) return 'NO_STATE';
    const st = JSON.parse(raw);
    const s = st.sessions.find((x) => x.exercises && x.exercises.length);
    if (!s) return 'NO_SESSION';
    let vol = 0;
    let sets = 0;
    for (const ex of s.exercises) {
      for (const set of ex.sets) {
        if (set.kind === 'work' && set.status === 'completed' && set.loadGrams != null && set.reps != null) {
          vol += set.loadGrams * set.reps;
          sets += 1;
        }
      }
    }
    return { id: s.id, title: s.title, volKg: vol / 1000, sets, first: s.exercises[0].sets[0] };
  })()`);
  console.log('FROM STORAGE:', JSON.stringify(calc));

  const dom = await evaluate(`(() => ({
    stats: [...document.querySelectorAll('.detail__stats > div')].map((d) => d.textContent.replace(/\\s+/g,' ').trim()),
    firstSetText: document.querySelector('.detail .set__main')?.textContent?.replace(/\\s+/g,' ').trim(),
  }))()`);
  console.log('DOM:', JSON.stringify(dom));

  console.log('DONE');
  process.exit(0);
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });

