const base='http://127.0.0.1:9230';
const APP='http://127.0.0.1:4182';
class Cdp{constructor(ws){this.ws=ws;this.id=0;this.p=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&this.p.has(m.id)){const{resolve,reject}=this.p.get(m.id);this.p.delete(m.id);m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result);}});}send(method,params={}){const id=++this.id;return new Promise((r,j)=>{this.p.set(id,{resolve:r,reject:j});this.ws.send(JSON.stringify({id,method,params}));});}static async connect(url){const ws=new WebSocket(url);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});return new Cdp(ws);}}
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const t=await (await fetch(`${base}/json/list`)).json();
const page=t.find(x=>x.type==='page');
const cdp=await Cdp.connect(page.webSocketDebuggerUrl);
await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
const ev=async(expr)=>{try{const r=await cdp.send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});return r.exceptionDetails?{err:r.exceptionDetails.text}:r.result.value;}catch(e){return{err:String(e).slice(0,100)};}};

await cdp.send('Page.navigate',{url:APP});
await sleep(2000);
await ev(`(async()=>{localStorage.clear();const dbs=await indexedDB.databases();await Promise.all(dbs.map(d=>new Promise(res=>{const q=indexedDB.deleteDatabase(d.name);q.onsuccess=q.onerror=q.onblocked=()=>res();})));return 1;})()`);
await cdp.send('Page.reload',{ignoreCache:true});
await sleep(2500);
console.log('online ready:', await ev(`!!document.querySelector('.tabbar')`));

await cdp.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
await sleep(300);
console.log('offline tabbar still there:', await ev(`!!document.querySelector('.tabbar')`));
console.log('start btn:', await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='开始训练');return b?'FOUND':'MISSING';})()`));
console.log('click:', await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='开始训练');if(!b)return 'NO';b.click();return 'OK';})()`));
await sleep(1200);
console.log('inputs:', await ev(`document.querySelectorAll('.set__input').length`));
console.log('live present:', await ev(`document.querySelectorAll('.live').length`));
console.log('body head:', await ev(`document.body.innerText.slice(0,120)`));

await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
process.exit(0);
