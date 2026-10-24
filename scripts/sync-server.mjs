/**
 * 同步服务端：apiVersion=1，契约见 docs/sync-contract.md。
 *
 * 设计要点（顺序极易写错，逐条对应契约 §3）：
 * 1. 认证 → 2. 幂等键 → 3. 幂等查找（必须在条件校验之前）
 * → 4. JSON → 5. schema → 6. 大小 → 7. datasetId 绑定
 * → 8. 条件头 → 9. 单事务提交
 */

import { createServer } from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';

const API_VERSION = 1;
const DEFAULT_MAX_SNAPSHOT = 32 * 1024 * 1024;
const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 规范化序列化：键排序、数组保序，与服务端客户端必须一致。 */
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out = {};
  for (const k of Object.keys(value).sort()) {
    if (value[k] === undefined) continue;
    out[k] = canonicalize(value[k]);
  }
  return out;
}

function canonicalJson(v) {
  return JSON.stringify(canonicalize(v));
}

function sha256(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

export function createSyncServer(options = {}) {
  const dataDir = options.dataDir ?? join(process.cwd(), 'data');
  const token = options.token ?? null;
  const maxSnapshotBytes = options.maxSnapshotBytes ?? DEFAULT_MAX_SNAPSHOT;
  const now = options.now ?? (() => Date.now());

  /** 单数据集状态。 */
  const store = {
    datasetId: null,
    revision: 0,
    snapshot: null,
    snapshotHash: null,
    updatedAt: null,
  };
  /** 幂等表：key → 记录。 */
  const idempotency = new Map();

  const stateFile = join(dataDir, 'dataset.json');
  const backupFile = join(dataDir, 'backup.json');

  async function load() {
    try {
      const raw = await readFile(stateFile, 'utf8');
      const parsed = JSON.parse(raw);
      Object.assign(store, parsed.store ?? {});
      for (const rec of parsed.idempotency ?? []) idempotency.set(rec.key, rec);
    } catch {
      // 首次启动无状态文件
    }
  }

  async function persist() {
    await mkdir(dataDir, { recursive: true });
    const body = JSON.stringify({
      store,
      idempotency: [...idempotency.values()].filter((r) => now() - r.createdAt < IDEMPOTENCY_TTL_MS),
    });
    const tmp = stateFile + '.tmp';
    await writeFile(tmp, body, 'utf8');
    await rename(tmp, stateFile);
  }

  function send(res, status, body, headers = {}) {
    const payload = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-api-version': String(API_VERSION),
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'ETag, X-Api-Version',
      ...headers,
    });
    res.end(payload);
  }

  function error(res, status, code, message, headers = {}) {
    send(res, status, { error: { code, message } }, headers);
  }

  function authorized(req) {
    if (!token) return true; // 未配置口令时开放（仅限本机/局域网自用）
    const header = req.headers.authorization ?? '';
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (!m) return false;
    const given = Buffer.from(m[1]);
    const expected = Buffer.from(token);
    if (given.length !== expected.length) return false;
    return timingSafeEqual(given, expected);
  }

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxSnapshotBytes * 2) {
        throw Object.assign(new Error('too large'), { code: 'too_large' });
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  /** 引用完整性：只做结构级检查，不重建业务。 */
  function validateSnapshot(snap) {
    if (!snap || typeof snap !== 'object') return 'snapshot 必须是对象';
    if (typeof snap.schemaVersion !== 'number') return '缺少 schemaVersion';
    if (typeof snap.datasetId !== 'string' || !snap.datasetId) return '缺少 datasetId';
    if (!snap.records || typeof snap.records !== 'object') return '缺少 records';
    const r = snap.records;
    for (const key of ['sessions', 'weights', 'foods', 'occurrences', 'weekGoals', 'customTemplates']) {
      if (!Array.isArray(r[key])) return `records.${key} 必须是数组`;
    }
    const seen = new Set();
    for (const s of r.sessions) {
      if (!s.id) return '会话缺少 id';
      if (seen.has(s.id)) return `会话 id 重复：${s.id}`;
      seen.add(s.id);
      if (!Array.isArray(s.exercises)) return `会话 ${s.id} 的 exercises 必须是数组`;
      for (const ex of s.exercises) {
        for (const st of ex.sets ?? []) {
          if (st.loadGrams != null && st.loadGrams < 0) return `会话 ${s.id} 出现负重量`;
          if (st.reps != null && st.reps < 0) return `会话 ${s.id} 出现负次数`;
        }
      }
    }
    return null;
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS',
        'access-control-allow-headers': 'Authorization, If-Match, If-None-Match, Idempotency-Key, Content-Type',
        'access-control-max-age': '600',
        'access-control-expose-headers': 'ETag, X-Api-Version',
      });
      res.end();
      return;
    }

    try {
      // ---- health：不泄露任何状态细节 ----
      if (path === '/api/health' && method === 'GET') {
        send(res, 200, {
          ok: true,
          apiVersion: API_VERSION,
          maxSnapshotBytes,
        });
        return;
      }

      if (!authorized(req)) {
        error(res, 401, 'UNAUTHORIZED', '需要有效的 Bearer token');
        return;
      }

      // ---- GET ----
      if (path === '/api/dataset' && method === 'GET') {
        if (!store.snapshot) {
          error(res, 404, 'DATASET_EMPTY', '服务端还没有数据');
          return;
        }
        const etag = `"${store.revision}"`;
        const inm = req.headers['if-none-match'];
        if (inm && inm === etag) {
          res.writeHead(304, {
            etag,
            'cache-control': 'no-store',
            'x-api-version': String(API_VERSION),
            'access-control-allow-origin': '*',
            'access-control-expose-headers': 'ETag, X-Api-Version',
          });
          res.end();
          return;
        }
        send(res, 200, store.snapshot, { etag });
        return;
      }

      // ---- PUT ----
      if (path === '/api/dataset' && method === 'PUT') {
        const key = req.headers['idempotency-key'];
        if (!key) {
          error(res, 428, 'IDEMPOTENCY_KEY_REQUIRED', '缺少 Idempotency-Key');
          return;
        }

        const rawBody = await readBody(req).catch((e) => {
          error(res, 413, 'PAYLOAD_TOO_LARGE', '请求体过大');
          return null;
        });
        if (rawBody === null) return;

        const requestHash = sha256(canonicalJson({ method, path, body: rawBody }));

        // 幂等查找必须早于条件校验：客户端超时重试时 If-Match 仍是旧 revision，
        // 若先校验条件会误报 412，而它自己的写其实已经成功。
        const existing = idempotency.get(key);
        if (existing) {
          if (now() - existing.createdAt > IDEMPOTENCY_TTL_MS) {
            idempotency.delete(key);
          } else if (existing.requestHash === requestHash) {
            send(res, existing.responseStatus, {
              revision: existing.responseRevision,
              snapshotHash: existing.snapshotHash,
              idempotent: true,
            });
            return;
          } else {
            error(res, 409, 'IDEMPOTENCY_CONFLICT', '同一幂等键用于了不同请求');
            return;
          }
        }

        let snap;
        try {
          snap = JSON.parse(rawBody);
        } catch {
          error(res, 400, 'INVALID_JSON', '请求体不是合法 JSON');
          return;
        }

        const schemaIssue = validateSnapshot(snap);
        if (schemaIssue) {
          error(res, 422, 'SCHEMA_INVALID', schemaIssue);
          return;
        }

        const bytes = Buffer.byteLength(rawBody, 'utf8');
        if (bytes > maxSnapshotBytes) {
          error(res, 413, 'PAYLOAD_TOO_LARGE', `快照 ${bytes} 字节超过上限 ${maxSnapshotBytes}`);
          return;
        }

        if (store.datasetId && snap.datasetId !== store.datasetId) {
          error(res, 409, 'DATASET_MISMATCH', 'datasetId 与服务端已绑定值不一致');
          return;
        }

        const ifMatch = req.headers['if-match'];
        const ifNoneMatch = req.headers['if-none-match'];
        if (!ifMatch && !ifNoneMatch) {
          error(res, 428, 'PRECONDITION_REQUIRED', '需要 If-Match 或 If-None-Match');
          return;
        }
        if (ifNoneMatch === '*') {
          if (store.snapshot) {
            error(res, 412, 'PRECONDITION_FAILED', '服务端已有数据', { etag: `"${store.revision}"` });
            return;
          }
        } else if (ifMatch) {
          const expected = ifMatch.replace(/^W\//, '');
          if (expected !== `"${store.revision}"`) {
            error(res, 412, 'PRECONDITION_FAILED', 'revision 不匹配', { etag: `"${store.revision}"` });
            return;
          }
        }

        // 单事务：备份 → 写快照 → revision+1 → 写幂等
        if (store.snapshot) {
          await mkdir(dataDir, { recursive: true });
          await writeFile(
            backupFile,
            JSON.stringify({ revision: store.revision, snapshot: store.snapshot, at: new Date(now()).toISOString() }),
            'utf8',
          );
        }

        const nextRevision = store.revision + 1;
        const hash = sha256(canonicalJson(snap));
        store.datasetId = snap.datasetId;
        store.snapshot = snap;
        store.snapshotHash = hash;
        store.revision = nextRevision;
        store.updatedAt = new Date(now()).toISOString();

        const record = {
          key,
          requestHash,
          responseStatus: 200,
          responseRevision: nextRevision,
          snapshotHash: hash,
          createdAt: now(),
        };
        idempotency.set(key, record);
        await persist();

        send(res, 200, { revision: nextRevision, snapshotHash: hash }, { etag: `"${nextRevision}"` });
        return;
      }

      // ---- DELETE ----
      if (path === '/api/dataset' && method === 'DELETE') {
        const key = req.headers['idempotency-key'];
        if (!key) {
          error(res, 428, 'IDEMPOTENCY_KEY_REQUIRED', '缺少 Idempotency-Key');
          return;
        }
        const existing = idempotency.get(key);
        if (existing && existing.responseStatus === 204) {
          res.writeHead(204, { 'access-control-allow-origin': '*' });
          res.end();
          return;
        }
        const ifMatch = req.headers['if-match'];
        if (!ifMatch) {
          error(res, 428, 'PRECONDITION_REQUIRED', '需要 If-Match');
          return;
        }
        if (ifMatch.replace(/^W\//, '') !== `"${store.revision}"`) {
          error(res, 412, 'PRECONDITION_FAILED', 'revision 不匹配');
          return;
        }
        if (store.snapshot) {
          await mkdir(dataDir, { recursive: true });
          await writeFile(
            backupFile,
            JSON.stringify({ revision: store.revision, snapshot: store.snapshot, at: new Date(now()).toISOString() }),
            'utf8',
          );
        }
        store.datasetId = null;
        store.snapshot = null;
        store.snapshotHash = null;
        store.revision = 0;
        store.updatedAt = new Date(now()).toISOString();
        idempotency.set(key, {
          key,
          requestHash: sha256(canonicalJson({ method, path })),
          responseStatus: 204,
          responseRevision: 0,
          snapshotHash: null,
          createdAt: now(),
        });
        await persist();
        res.writeHead(204, { 'access-control-allow-origin': '*' });
        res.end();
        return;
      }

      error(res, 404, 'NOT_FOUND', '未知路径');
    } catch (e) {
      error(res, 500, 'INTERNAL', e instanceof Error ? e.message : '内部错误');
    }
  });

  return {
    server,
    load,
    state: store,
    listen(port, host = '127.0.0.1') {
      return new Promise((resolve) => {
        server.listen(port, host, () => resolve(server.address()));
      });
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
    /** 测试用：清空内存状态。 */
    reset() {
      store.datasetId = null;
      store.revision = 0;
      store.snapshot = null;
      store.snapshotHash = null;
      store.updatedAt = null;
      idempotency.clear();
    },
  };
}

const isMain = process.argv[1] && process.argv[1].endsWith('sync-server.mjs');
if (isMain) {
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? '127.0.0.1';
  const srv = createSyncServer({
    dataDir: process.env.DATA_DIR ?? './data',
    token: process.env.SYNC_TOKEN ?? null,
    maxSnapshotBytes: process.env.MAX_SNAPSHOT_BYTES ? Number(process.env.MAX_SNAPSHOT_BYTES) : undefined,
  });
  await srv.load();
  const addr = await srv.listen(port, host);
  console.log(`sync server on http://${host}:${addr.port}  apiVersion=${API_VERSION}`);
  console.log(`dataset bound: ${srv.state.datasetId ?? '(none)'}  revision=${srv.state.revision}`);
  void randomUUID;
}
