const port = 9225;
const base = `http://127.0.0.1:${port}`;
class Cdp {
  constructor(ws){this.ws=ws;this.id=0;this.p=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&this.p.has(m.id)){const{resolve,reject}=this.p.get(m.id);this.p.delete(m.id);m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result);}});}
  send(method,params={}){const id=++this.id;return new Promise((resolve,reject)=>{this.p.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}
  static async connect(url){const ws=new WebSocket(url);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});return new Cdp(ws);}
}
const t = await (await fetch(`${base}/json/list`)).json();
const page = t.find(x=>x.type==='page');
const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
const r = await cdp.send('Runtime.evaluate',{expression:`(() => ({
  lsKeys: Object.keys(localStorage),
  lsLen: localStorage.length,
  dbs: 'checking'
}))()`,returnByValue:true});
console.log(JSON.stringify(r.result.value));
const r2 = await cdp.send('Runtime.evaluate',{expression:`(async () => {
  const dbs = await indexedDB.databases();
  return dbs.map(d => d.name);
})()`,awaitPromise:true,returnByValue:true});
console.log('IDB:', JSON.stringify(r2.result.value));
process.exit(0);
