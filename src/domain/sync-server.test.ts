/**
 * 服务端协议集成测试：逐条验证 docs/sync-contract.md §3 的顺序与状态码。
 *
 * 这些用例跑真实 HTTP，不用 mock，因为顺序错误只在真实请求序列下才暴露。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSyncServer, type SyncServer } from '../../scripts/sync-server.mjs';

let srv: SyncServer;
let base: string;
let dataDir: string;

/** 测试夹具：故意宽松，便于构造非法数据验证服务端校验。 */
type Loose = Record<string, any>;

function snapshot(overrides: Loose = {}): Loose {
  return {
    schemaVersion: 1,
    ruleVersion: 1,
    datasetId: 'ds_test',
    createdAt: '2026-01-01T00:00:00.000Z',
    accountingTimezone: 'Asia/Shanghai',
    records: {
      profile: { name: '' },
      sessions: [],
      weights: [],
      foods: [],
      occurrences: [],
      weekGoals: [],
      customTemplates: [],
    },
    ...overrides,
  };
}

type CallOptions = { body?: unknown; headers?: Record<string, string> };

async function call(method: string, path: string, { body, headers = {} }: CallOptions = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, headers: res.headers, json };
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'tieguan-sync-'));
  srv = createSyncServer({ dataDir, token: 'secret-token', maxSnapshotBytes: 1024 * 1024 });
  await srv.load();
  const addr = await srv.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await srv.close();
  await rm(dataDir, { recursive: true, force: true });
});

const AUTH = { authorization: 'Bearer secret-token' };

describe('AC-S01 · 协议语义：health 不泄露状态', () => {
  it('只返回 ok/apiVersion/maxSnapshotBytes', async () => {
    const r = await call('GET', '/api/health');
    expect(r.status).toBe(200);
    expect(Object.keys(r.json).sort()).toEqual(['apiVersion', 'maxSnapshotBytes', 'ok']);
    expect(JSON.stringify(r.json)).not.toContain('stateExists');
  });

  it('不需要认证', async () => {
    const r = await call('GET', '/api/health');
    expect(r.status).toBe(200);
  });
});

describe('AC-S01 · 协议语义：认证失败不自动建空数据集', () => {
  it('无 token 返回 401', async () => {
    const r = await call('GET', '/api/dataset');
    expect(r.status).toBe(401);
  });

  it('错误 token 返回 401', async () => {
    const r = await call('GET', '/api/dataset', { headers: { authorization: 'Bearer wrong' } });
    expect(r.status).toBe(401);
  });

  it('正确 token 通过', async () => {
    const r = await call('GET', '/api/dataset', { headers: AUTH });
    expect(r.status).toBe(404);
  });
});

describe('AC-S01 · 显式初始化：必须带条件头与幂等键', () => {
  it('空库 GET 返回 404 DATASET_EMPTY', async () => {
    const r = await call('GET', '/api/dataset', { headers: AUTH });
    expect(r.status).toBe(404);
    expect(r.json.error.code).toBe('DATASET_EMPTY');
  });

  it('缺条件头返回 428', async () => {
    const r = await call('PUT', '/api/dataset', {
      body: snapshot(),
      headers: { ...AUTH, 'idempotency-key': randomUUID() },
    });
    expect(r.status).toBe(428);
    expect(r.json.error.code).toBe('PRECONDITION_REQUIRED');
  });

  it('缺幂等键返回 428', async () => {
    const r = await call('PUT', '/api/dataset', {
      body: snapshot(),
      headers: { ...AUTH, 'if-none-match': '*' },
    });
    expect(r.status).toBe(428);
    expect(r.json.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('If-None-Match:* 首次成功并返回 revision=1', async () => {
    const r = await call('PUT', '/api/dataset', {
      body: snapshot(),
      headers: { ...AUTH, 'if-none-match': '*', 'idempotency-key': randomUUID() },
    });
    expect(r.status).toBe(200);
    expect(r.json.revision).toBe(1);
    expect(r.json.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(r.headers.get('etag')).toBe('"1"');
  });
});

describe('AC-S03 · 条件写：一方成功一方 412', () => {
  async function putFirst() {
    return call('PUT', '/api/dataset', {
      body: snapshot(),
      headers: { ...AUTH, 'if-none-match': '*', 'idempotency-key': randomUUID() },
    });
  }

  it('已有数据时 If-None-Match:* 返回 412', async () => {
    await putFirst();
    const r = await call('PUT', '/api/dataset', {
      body: snapshot(),
      headers: { ...AUTH, 'if-none-match': '*', 'idempotency-key': randomUUID() },
    });
    expect(r.status).toBe(412);
  });

  it('If-Match 匹配可更新，revision 递增', async () => {
    await putFirst();
    const r = await call('PUT', '/api/dataset', {
      body: snapshot({ ruleVersion: 2 }),
      headers: { ...AUTH, 'if-match': '"1"', 'idempotency-key': randomUUID() },
    });
    expect(r.status).toBe(200);
    expect(r.json.revision).toBe(2);
  });

  it('If-Match 不匹配返回 412 且不改数据', async () => {
    await putFirst();
    const r = await call('PUT', '/api/dataset', {
      body: snapshot({ ruleVersion: 9 }),
      headers: { ...AUTH, 'if-match': '"99"', 'idempotency-key': randomUUID() },
    });
    expect(r.status).toBe(412);
    const g = await call('GET', '/api/dataset', { headers: AUTH });
    expect(g.json.ruleVersion).toBe(1);
  });
});

describe('AC-S06 · 幂等：同键同请求、异内容 409', () => {
  it('同键同请求重试返回原结果，不重复写', async () => {
    const key = randomUUID();
    const body = snapshot();
    const a = await call('PUT', '/api/dataset', {
      body,
      headers: { ...AUTH, 'if-none-match': '*', 'idempotency-key': key },
    });
    expect(a.status).toBe(200);
    expect(a.json.revision).toBe(1);

    const b = await call('PUT', '/api/dataset', {
      body,
      headers: { ...AUTH, 'if-none-match': '*', 'idempotency-key': key },
    });
    expect(b.status).toBe(200);
    expect(b.json.revision).toBe(1);
    expect(b.json.idempotent).toBe(true);
  });

  it('关键：超时重试（同键但 If-Match 已过期）仍返回成功而非 412', async () => {
    const key = randomUUID();
    const body = snapshot();
    await call('PUT', '/api/dataset', {
      body,
      headers: { ...AUTH, 'if-none-match': '*', 'idempotency-key': key },
    });
    // 模拟：客户端没收到响应，用它记忆中的旧条件重试
    const retry = await call('PUT', '/api/dataset', {
      body,
      headers: { ...AUTH, 'if-none-match': '*', 'idempotency-key': key },
    });
    expect(retry.status).toBe(200);
    expect(retry.json.idempotent).toBe(true);
  });

  it('同键异内容返回 409', async () => {
    const key = randomUUID();
    await call('PUT', '/api/dataset', {
      body: snapshot(),
      headers: { ...AUTH, 'if-none-match': '*', 'idempotency-key': key },
    });
    const r = await call('PUT', '/api/dataset', {
      body: snapshot({ ruleVersion: 7 }),
      headers: { ...AUTH, 'if-match': '"1"', 'idempotency-key': key },
    });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });
});

describe('AC-S01 · 数据集绑定：跨集不串写', () => {
  it('不同 datasetId 返回 409 DATASET_MISMATCH', async () => {
    await call('PUT', '/api/dataset', {
      body: snapshot({ datasetId: 'ds_a' }),
      headers: { ...AUTH, 'if-none-match': '*', 'idempotency-key': randomUUID() },
    });
    const r = await call('PUT', '/api/dataset', {
      body: snapshot({ datasetId: 'ds_b' }),
      headers: { ...AUTH, 'if-match': '"1"', 'idempotency-key': randomUUID() },
    });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('DATASET_MISMATCH');
  });

  it('绑定后 GET 仍可读', async () => {
    await call('PUT', '/api/dataset', {
      body: snapshot({ datasetId: 'ds_a' }),
      headers: { ...AUTH, 'if-none-match': '*', 'idempotency-key': randomUUID() },
    });
    const g = await call('GET', '/api/dataset', { headers: AUTH });
    expect(g.json.datasetId).toBe('ds_a');
  });
});

describe('AC-S09 · 校验、超限 413 且不覆盖', () => {
  it('非法 JSON 返回 400', async () => {
    const r = await call('PUT', '/api/dataset', {
      body: 'not json',
      headers: { ...AUTH, 'if-none-match': '*', 'idempotency-key': randomUUID() },
    });
    expect(r.status).toBe(400);
  });

  it('缺 schemaVersion 返回 422', async () => {
    const bad = snapshot();
    delete (bad as Loose).schemaVersion;
    const r = await call('PUT', '/api/dataset', {
      body: bad,
      headers: { ...AUTH, 'if-none-match': '*', 'idempotency-key': randomUUID() },
    });
    expect(r.status).toBe(422);
  });

  it('会话 id 重复返回 422', async () => {
    const bad = snapshot();
    bad.records.sessions = [{ id: 's1', exercises: [] }, { id: 's1', exercises: [] }];
    const r = await call('PUT', '/api/dataset', {
      body: bad,
      headers: { ...AUTH, 'if-none-match': '*', 'idempotency-key': randomUUID() },
    });
    expect(r.status).toBe(422);
    expect(r.json.error.message).toContain('重复');
  });

  it('负重量返回 422', async () => {
    const bad = snapshot();
    bad.records.sessions = [
      { id: 's1', exercises: [{ sets: [{ loadGrams: -1 }] }] },
    ];
    const r = await call('PUT', '/api/dataset', {
      body: bad,
      headers: { ...AUTH, 'if-none-match': '*', 'idempotency-key': randomUUID() },
    });
    expect(r.status).toBe(422);
  });

  it('超限返回 413', async () => {
    const big = snapshot();
    big.records.foods = Array.from({ length: 5000 }, (_, i) => ({ id: 'f' + i, label: 'x'.repeat(200) }));
    const r = await call('PUT', '/api/dataset', {
      body: big,
      headers: { ...AUTH, 'if-none-match': '*', 'idempotency-key': randomUUID() },
    });
    expect(r.status).toBe(413);
  });
});

describe('AC-S01 · 条件读、CORS、no-store', () => {
  it('ETag 与 If-None-Match 一致返回 304', async () => {
    await call('PUT', '/api/dataset', {
      body: snapshot(),
      headers: { ...AUTH, 'if-none-match': '*', 'idempotency-key': randomUUID() },
    });
    const g = await call('GET', '/api/dataset', { headers: AUTH });
    const etag = g.headers.get('etag') ?? '';
    expect(etag).toBe('"1"');
    const again = await call('GET', '/api/dataset', { headers: { ...AUTH, 'if-none-match': etag } });
    expect(again.status).toBe(304);
  });

  it('Expose-Headers 含 ETag（否则浏览器读不到）', async () => {
    await call('PUT', '/api/dataset', {
      body: snapshot(),
      headers: { ...AUTH, 'if-none-match': '*', 'idempotency-key': randomUUID() },
    });
    const g = await call('GET', '/api/dataset', { headers: AUTH });
    const expose = g.headers.get('access-control-expose-headers') ?? '';
    expect(expose.toLowerCase()).toContain('etag');
  });

  it('OPTIONS 预检返回 204 并允许所需头', async () => {
    const r = await fetch(base + '/api/dataset', { method: 'OPTIONS' });
    expect(r.status).toBe(204);
    const allow = r.headers.get('access-control-allow-headers') ?? '';
    expect(allow.toLowerCase()).toContain('if-match');
    expect(allow.toLowerCase()).toContain('idempotency-key');
  });

  it('响应带 no-store', async () => {
    const g = await call('GET', '/api/dataset', { headers: AUTH });
    expect(g.headers.get('cache-control')).toBe('no-store');
  });
});

describe('AC-S08 · 删除远端：条件写、清空、可重传', () => {
  it('DELETE 需要 If-Match，缺失返回 428', async () => {
    await call('PUT', '/api/dataset', {
      body: snapshot(),
      headers: { ...AUTH, 'if-none-match': '*', 'idempotency-key': randomUUID() },
    });
    const r = await call('DELETE', '/api/dataset', {
      headers: { ...AUTH, 'idempotency-key': randomUUID() },
    });
    expect(r.status).toBe(428);
  });

  it('条件不符返回 412', async () => {
    await call('PUT', '/api/dataset', {
      body: snapshot(),
      headers: { ...AUTH, 'if-none-match': '*', 'idempotency-key': randomUUID() },
    });
    const r = await call('DELETE', '/api/dataset', {
      headers: { ...AUTH, 'if-match': '"9"', 'idempotency-key': randomUUID() },
    });
    expect(r.status).toBe(412);
  });

  it('成功删除返回 204，之后 GET 404', async () => {
    await call('PUT', '/api/dataset', {
      body: snapshot(),
      headers: { ...AUTH, 'if-none-match': '*', 'idempotency-key': randomUUID() },
    });
    const r = await call('DELETE', '/api/dataset', {
      headers: { ...AUTH, 'if-match': '"1"', 'idempotency-key': randomUUID() },
    });
    expect(r.status).toBe(204);
    const g = await call('GET', '/api/dataset', { headers: AUTH });
    expect(g.status).toBe(404);
  });

  it('删除后可用 If-None-Match:* 重新上传（有意设计）', async () => {
    await call('PUT', '/api/dataset', {
      body: snapshot(),
      headers: { ...AUTH, 'if-none-match': '*', 'idempotency-key': randomUUID() },
    });
    await call('DELETE', '/api/dataset', {
      headers: { ...AUTH, 'if-match': '"1"', 'idempotency-key': randomUUID() },
    });
    const r = await call('PUT', '/api/dataset', {
      body: snapshot(),
      headers: { ...AUTH, 'if-none-match': '*', 'idempotency-key': randomUUID() },
    });
    expect(r.status).toBe(200);
    expect(r.json.revision).toBe(1);
  });

  it('同幂等键重复 DELETE 返回 204', async () => {
    const key = randomUUID();
    await call('PUT', '/api/dataset', {
      body: snapshot(),
      headers: { ...AUTH, 'if-none-match': '*', 'idempotency-key': randomUUID() },
    });
    const a = await call('DELETE', '/api/dataset', {
      headers: { ...AUTH, 'if-match': '"1"', 'idempotency-key': key },
    });
    expect(a.status).toBe(204);
    const b = await call('DELETE', '/api/dataset', {
      headers: { ...AUTH, 'if-match': '"1"', 'idempotency-key': key },
    });
    expect(b.status).toBe(204);
  });
});

describe('持久化', () => {
  it('重启后数据仍在', async () => {
    await call('PUT', '/api/dataset', {
      body: snapshot({ datasetId: 'ds_persist' }),
      headers: { ...AUTH, 'if-none-match': '*', 'idempotency-key': randomUUID() },
    });
    const port = new URL(base).port;
    await srv.close();

    const srv2 = createSyncServer({ dataDir, token: 'secret-token' });
    await srv2.load();
    expect(srv2.state.datasetId).toBe('ds_persist');
    expect(srv2.state.revision).toBe(1);
    await srv2.close();
    void port;
  });
});




