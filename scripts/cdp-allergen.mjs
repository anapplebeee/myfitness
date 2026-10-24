import { writeFile } from 'node:fs/promises';
const base = 'http://127.0.0.1:9229';
class Cdp {
  constructor(ws){this.ws=ws;this.id=0;this.p=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&this.p.has(m.id)){const{resolve,reject}=this.p.get(m.id);this.p.delete(m.id);m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result);}});}
  send(method,params={}){const id=++this.id;return new Promise((r,j)=>{this.p.set(id,{resolve:r,reject:j});this.ws.send(JSON.stringify({id,method,params}));});}
  static async connect(url){const ws=new WebSocket(url);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});return new Cdp(ws);}
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = await (await fetch(`${base}/json/list`)).json();
const page = t.find(x=>x.type==='page');
const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
const ev = async (expr) => { const r = await cdp.send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true}); if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0,300)); return r.result.value; };
const shot = async (n) => { const r = await cdp.send('Page.captureScreenshot',{format:'png'}); await writeFile(`shots/${n}.png`, Buffer.from(r.data,'base64')); console.log('saved', n); };

await cdp.send('Page.navigate',{url:'http://127.0.0.1:4181/'});
await sleep(3000);
await ev(`(async () => { localStorage.clear(); const dbs = await indexedDB.databases(); await Promise.all(dbs.map(d=>new Promise(res=>{const q=indexedDB.deleteDatabase(d.name); q.onsuccess=q.onerror=q.onblocked=()=>res();}))); return 1; })()`);
await cdp.send('Page.reload',{ignoreCache:true});
await sleep(2600);

// 我的 → 设置
await ev(`(() => { [...document.querySelectorAll('.tabbar__item')].find(b=>b.textContent.includes('我的')).click(); return 1; })()`);
await sleep(600);
await ev(`(() => { [...document.querySelectorAll('.seg__item')].find(b=>b.textContent.trim()==='设置').click(); return 1; })()`);
await sleep(600);
console.log('chips:', await ev(`document.querySelectorAll('.aller__chip').length`));
await shot('allergen-settings');

// 选奶并确认
await ev(`(() => { [...document.querySelectorAll('.aller__chip')].find(b=>b.textContent.trim()==='奶').click(); return 1; })()`);
await sleep(400);
await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('确认这些限制')); if(b) b.click(); return 1; })()`);
await sleep(500);
await shot('allergen-selected');

// 饮食页看过滤
await ev(`(() => { [...document.querySelectorAll('.tabbar__item')].find(b=>b.textContent.includes('饮食')).click(); return 1; })()`);
await sleep(800);
const addBtns = await ev(`[...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(t=>t.includes('添加'))`);
console.log('add buttons:', JSON.stringify(addBtns));
await shot('allergen-food');
process.exit(0);


