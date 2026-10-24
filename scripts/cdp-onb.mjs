import { writeFile } from 'node:fs/promises';
const base='http://127.0.0.1:9230';
const APP='http://127.0.0.1:4182';
class Cdp{constructor(ws){this.ws=ws;this.id=0;this.p=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&this.p.has(m.id)){const{resolve,reject}=this.p.get(m.id);this.p.delete(m.id);m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result);}});}send(method,params={}){const id=++this.id;return new Promise((r,j)=>{this.p.set(id,{resolve:r,reject:j});this.ws.send(JSON.stringify({id,method,params}));});}static async connect(url){const ws=new WebSocket(url);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});return new Cdp(ws);}}
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const t=await (await fetch(`${base}/json/list`)).json();
const page=t.find(x=>x.type==='page');
const cdp=await Cdp.connect(page.webSocketDebuggerUrl);
await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
const ev=async(e)=>{const r=await cdp.send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});return r.exceptionDetails?null:r.result.value;};
const shot=async(n)=>{const r=await cdp.send('Page.captureScreenshot',{format:'png'});await writeFile(`shots/pm-${n}.png`,Buffer.from(r.data,'base64'));console.log('saved',n);};

await cdp.send('Page.navigate',{url:APP});
await sleep(2000);
await ev(`(async()=>{localStorage.clear();const dbs=await indexedDB.databases();await Promise.all(dbs.map(d=>new Promise(res=>{const q=indexedDB.deleteDatabase(d.name);q.onsuccess=q.onerror=q.onblocked=()=>res();})));return 1;})()`);
await cdp.send('Page.reload',{ignoreCache:true});
await sleep(2800);
await shot('onb-1');
await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('知道了'));if(b)b.click();return 1;})()`);
await sleep(500);
await shot('onb-2');
await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='下一步');if(b)b.click();return 1;})()`);
await sleep(500);
await shot('onb-3');
process.exit(0);
