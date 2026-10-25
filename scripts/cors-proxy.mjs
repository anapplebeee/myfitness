/**
 * 最小 CORS 代理：证明"加上响应头就能通"。
 * 只用于本机联调，不进产品代码。
 */
import { createServer } from 'node:http';

const TARGET = 'http://127.0.0.1:7863';
const PORT = 7864;

const server = createServer(async (req, res) => {
  // 关键：这三行就是 CORS 的全部秘密
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let body = '';
  for await (const c of req) body += c;

  try {
    const upstream = await fetch(TARGET + req.url, {
      method: req.method,
      headers: {
        'Content-Type': req.headers['content-type'] ?? 'application/json',
        Authorization: req.headers.authorization ?? '',
      },
      body: req.method === 'POST' ? body : undefined,
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(text);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(e) }));
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`cors proxy on :${PORT} -> ${TARGET}`));
