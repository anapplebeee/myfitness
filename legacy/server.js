#!/usr/bin/env node
/* server.js —— 铁馆自托管服务端（零依赖）
 *
 *   node server.js                 # http://0.0.0.0:8787
 *   PORT=9000 node server.js
 *
 * 做的事只有三件：
 *   1. 发静态文件（index.html / css / js / icons / sw.js）
 *   2. GET/PUT /api/state —— 整份状态读写，落在 ./data/state.json
 *   3. 写入前留最多 10 份时间戳备份，误操作可回滚
 *
 * 参考 openGym 的形态（数据在自己机器上、一份 JSON、一条命令起来），
 * 但那是 AGPL，这里只借结构，代码是新写的零依赖实现。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = 8 * 1024 * 1024;
const KEEP_BACKUPS = 10;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function baseHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
}

async function ensureDataDir() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
}

async function readState() {
  try {
    const raw = await fsp.readFile(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

/* 先写临时文件再 rename，避免半截文件 */
async function writeState(obj) {
  await ensureDataDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  try {
    await fsp.copyFile(STATE_FILE, path.join(DATA_DIR, 'state.' + stamp + '.json'));
  } catch (e) {
    /* 首次写入没有原文件，忽略 */
  }
  const tmp = STATE_FILE + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 1), 'utf8');
  await fsp.rename(tmp, STATE_FILE);
  await pruneBackups();
}

async function pruneBackups() {
  try {
    const files = (await fsp.readdir(DATA_DIR))
      .filter((f) => /^state\..+\.json$/.test(f))
      .sort();
    const extra = files.length - KEEP_BACKUPS;
    for (let i = 0; i < extra; i++) {
      await fsp.unlink(path.join(DATA_DIR, files[i])).catch(() => {});
    }
  } catch (e) {
    /* 备份清理失败不影响主流程 */
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('payload too large'), { code: 'TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const target = path.join(ROOT, rel);
  const norm = path.resolve(target);
  if (norm !== path.resolve(ROOT) && !norm.startsWith(path.resolve(ROOT) + path.sep)) {
    return json(res, 403, { error: 'forbidden' });
  }
  if (norm.includes(path.sep + 'data' + path.sep) || norm.endsWith(path.sep + 'server.js')) {
    return json(res, 404, { error: 'not found' });
  }
  try {
    const stat = await fsp.stat(norm);
    if (!stat.isFile()) throw Object.assign(new Error('not file'), { code: 'ENOENT' });
    const ext = path.extname(norm).toLowerCase();
    baseHeaders(res);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' || path.basename(norm) === 'sw.js' ? 'no-cache' : 'public, max-age=300',
    });
    fs.createReadStream(norm).pipe(res);
  } catch (e) {
    if (e.code === 'ENOENT') {
      /* 前端路由回落 */
      const idx = path.join(ROOT, 'index.html');
      try {
        const html = await fsp.readFile(idx);
        baseHeaders(res);
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Content-Length': html.length, 'Cache-Control': 'no-cache' });
        res.end(html);
        return;
      } catch (e2) {
        return json(res, 404, { error: 'not found' });
      }
    }
    json(res, 500, { error: 'read failed' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = url.pathname;

  if (pathname === '/api/health') {
    baseHeaders(res);
    return json(res, 200, { ok: true, app: 'tieguan', stateExists: !!(await readState().catch(() => null)) });
  }

  if (pathname === '/api/state') {
    baseHeaders(res);
    if (req.method === 'GET') {
      try {
        const data = await readState();
        if (!data) return json(res, 404, { error: 'no state yet' });
        return json(res, 200, data);
      } catch (e) {
        return json(res, 500, { error: 'read failed' });
      }
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      try {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return json(res, 400, { error: 'state must be a JSON object' });
        }
        await writeState(parsed);
        return json(res, 200, { ok: true, bytes: Buffer.byteLength(raw) });
      } catch (e) {
        if (e.code === 'TOO_LARGE') return json(res, 413, { error: 'payload too large' });
        return json(res, 400, { error: 'invalid json' });
      }
    }
    return json(res, 405, { error: 'method not allowed' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
  await serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  console.log('[铁馆] listening on http://' + HOST + ':' + PORT);
  console.log('[铁馆] 数据文件 ' + path.relative(ROOT, STATE_FILE) + '（写入前自动备份，最多保留 ' + KEEP_BACKUPS + ' 份）');
});
