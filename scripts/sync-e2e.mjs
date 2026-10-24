/**
 * 同步端到端验证：真实 HTTP 服务端 + 真实客户端函数。
 * 验证契约顺序、幂等重试、冲突检测的实际行为。
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSyncServer } from './sync-server.mjs';

// 直接复用前端的领域函数（用 tsx 不可用，这里用最小重实现对齐 canonical 规则）
import { createHash } from 'node:crypto';

function canonicalize(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(canonicalize);
  const out = {};
  for (const k of Object.keys(v).sort()) {
    if (v[k] === undefined) continue;
    out[k] = canonicalize(v[k]);
  }
  return out;
}

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), 'tieguan-e2e-'));
  const srv = createSyncServer({ dataDir, token: 'tk', maxSnapshotBytes: 512 * 1024 });
  await srv.load();
  const addr = await srv.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}`;
  const AUTH = { authorization: 'Bearer tk', 'content-type': 'application/json' };

  const results = [];
  const check = (name, cond, detail = '') => {
    results.push({ name, pass: !!cond, detail });
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  };

  const snap = (n) => ({
    schemaVersion: 1,
    ruleVersion: 1,
    datasetId: 'ds_e2e',
    createdAt: '2026-01-01T00:00:00.000Z',
    accountingTimezone: 'Asia/Shanghai',
    records: {
      profile: { name: '' },
      sessions: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, exercises: [] })),
      weights: [],
      foods: [],
      occurrences: [],
      weekGoals: [],
      customTemplates: [],
    },
  });

  async function put(body, headers) {
    const res = await fetch(`${base}/api/dataset`, {
      method: 'PUT',
      headers: { ...AUTH, ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null, etag: res.headers.get('etag') };
  }

  // 1. 首次上传
  const k1 = randomUUID();
  const r1 = await put(snap(2), { 'if-none-match': '*', 'idempotency-key': k1 });
  check('首次上传成功 revision=1', r1.status === 200 && r1.json.revision === 1, `status=${r1.status}`);

  // 2. 幂等重试（模拟响应丢失）
  const r2 = await put(snap(2), { 'if-none-match': '*', 'idempotency-key': k1 });
  check('同键重试返回原结果且不重复写', r2.status === 200 && r2.json.revision === 1 && r2.json.idempotent === true, `revision=${r2.json.revision}`);

  // 3. 条件写：用旧 revision
  const r3 = await put(snap(3), { 'if-match': '"1"', 'idempotency-key': randomUUID() });
  check('If-Match=1 可更新到 revision=2', r3.status === 200 && r3.json.revision === 2);

  const r4 = await put(snap(4), { 'if-match': '"1"', 'idempotency-key': randomUUID() });
  check('过期 If-Match 返回 412', r4.status === 412, `status=${r4.status}`);

  // 4. 哈希一致性：客户端与服务端对同一快照算出相同 hash
  const clientHash = createHash('sha256').update(JSON.stringify(canonicalize(snap(3)))).digest('hex');
  check('客户端与服务端 hash 一致', clientHash === r3.json.snapshotHash, `${clientHash.slice(0, 12)} vs ${r3.json.snapshotHash?.slice(0, 12)}`);

  // 5. datasetId 绑定
  const other = { ...snap(1), datasetId: 'ds_other' };
  const r5 = await put(other, { 'if-match': '"2"', 'idempotency-key': randomUUID() });
  check('跨数据集推送被拒 409', r5.status === 409 && r5.json.error.code === 'DATASET_MISMATCH', `code=${r5.json.error?.code}`);

  // 6. 条件读
  const g1 = await fetch(`${base}/api/dataset`, { headers: AUTH });
  const etag = g1.headers.get('etag');
  check('GET 返回 ETag', etag === '"2"', `etag=${etag}`);
  const g2 = await fetch(`${base}/api/dataset`, { headers: { ...AUTH, 'if-none-match': etag } });
  check('条件读 304', g2.status === 304);

  // 7. 大小限制
  const big = snap(1);
  big.records.foods = Array.from({ length: 3000 }, (_, i) => ({ id: `f${i}`, label: 'x'.repeat(200) }));
  const r7 = await put(big, { 'if-match': '"2"', 'idempotency-key': randomUUID() });
  check('超限返回 413', r7.status === 413, `status=${r7.status}`);

  // 8. 健康检查不泄露
  const h = await fetch(`${base}/api/health`);
  const hj = await h.json();
  check('health 只有 3 个字段', Object.keys(hj).sort().join(',') === 'apiVersion,maxSnapshotBytes,ok', Object.keys(hj).join(','));

  // 9. 删除后重新上传
  const d1 = await fetch(`${base}/api/dataset`, {
    method: 'DELETE',
    headers: { ...AUTH, 'if-match': '"2"', 'idempotency-key': randomUUID() },
  });
  check('DELETE 返回 204', d1.status === 204);
  const k9 = randomUUID();
  const r9 = await put(snap(1), { 'if-none-match': '*', 'idempotency-key': k9 });
  check('删除后重新上传成功 revision=1', r9.status === 200 && r9.json.revision === 1);

  // 10. 持久化：重启后仍在
  await srv.close();
  const srv2 = createSyncServer({ dataDir, token: 'tk' });
  await srv2.load();
  check('重启后数据仍在', srv2.state.datasetId === 'ds_e2e' && srv2.state.revision === 1, `rev=${srv2.state.revision}`);
  await srv2.close();

  await rm(dataDir, { recursive: true, force: true });

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E FAILED:', e);
  process.exit(1);
});
