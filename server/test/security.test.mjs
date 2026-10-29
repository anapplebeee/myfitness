/**
 * 安全边界测试（CB-A03 / A18 / A22 的可自动化部分）。
 *
 * 这组用例只问一个问题：能不能通过"改客户端提交的东西"拿到不属于自己的数据。
 * 答案必须一律是否。
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  createTestServer,
  getDataset,
  login,
  makeSnapshot,
  putDataset,
  recentAuthToken,
  request,
} from './helpers.mjs';

/** @type {Awaited<ReturnType<typeof createTestServer>> | null} */
let server = null;

afterEach(async () => {
  if (server) await server.close();
  server = null;
});

async function bootstrap(email) {
  const auth = await login(server.url, server.mailer, email);
  const before = await getDataset(server.url, auth.accessToken);
  const put = await putDataset(server.url, auth.accessToken, {
    snapshot: makeSnapshot(before.body.datasetId, { weeklyGoal: 7 }),
    etag: '*',
    idempotencyKey: 'key-init-0001',
    epoch: before.body.epoch,
  });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  return { auth, datasetId: put.body.datasetId, etag: put.headers.etag };
}

describe('账号隔离', () => {
  it('提交伪造的 accountId 不会改变数据归属', async () => {
    server = await createTestServer();
    const a = await bootstrap('iso-a@example.com');
    server.clock.advance(61_000);
    const b = await login(server.url, server.mailer, 'iso-b@example.com');
    const bBefore = await getDataset(server.url, b.accessToken);

    const put = await request(server.url, '/api/cloud/v1/dataset', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${b.accessToken}`,
        'Idempotency-Key': 'key-iso-00001',
        'If-None-Match': '*',
      },
      body: {
        // 客户端提交的任何身份字段都不作为授权依据
        accountId: a.auth.accountId,
        datasetId: a.datasetId,
        snapshot: makeSnapshot(bBefore.body.datasetId, { weeklyGoal: 2 }),
      },
    });
    assert.equal(put.status, 200);
    assert.notEqual(put.body.datasetId, a.datasetId);

    // A 的数据没被写脏
    const aCurrent = await getDataset(server.url, a.auth.accessToken);
    assert.equal(aCurrent.body.snapshot.records.weeklyGoal, 7);
    assert.equal(aCurrent.body.revision, 1);
  });

  it('两个账号各看各的数据集，互不泄漏', async () => {
    server = await createTestServer();
    const a = await bootstrap('view-a@example.com');
    server.clock.advance(61_000);
    const b = await bootstrap('view-b@example.com');

    const aView = await getDataset(server.url, a.auth.accessToken);
    const bView = await getDataset(server.url, b.auth.accessToken);
    assert.notEqual(aView.body.datasetId, bView.body.datasetId);
    assert.equal(JSON.stringify(aView.body).includes(b.datasetId), false);
  });

  it('无权访问时返回 401 而不是暴露他人是否存在', async () => {
    server = await createTestServer();
    await bootstrap('hidden@example.com');
    const anonymous = await request(server.url, '/api/cloud/v1/dataset');
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.body.error.message.includes('数据集'), false);
  });
});

describe('敏感信息不外泄', () => {
  it('响应头 no-store，且错误体只有 code/message/requestId', async () => {
    server = await createTestServer();
    const auth = await login(server.url, server.mailer, 'headers@example.com');

    const ok = await getDataset(server.url, auth.accessToken);
    assert.equal(ok.headers['cache-control'], 'no-store');

    const bad = await request(server.url, '/api/cloud/v1/dataset');
    assert.deepEqual(Object.keys(bad.body.error).sort(), ['code', 'message', 'requestId']);
    assert.equal(bad.headers['cache-control'], 'no-store');
  });

  it('审计里没有邮箱明文与验证码', async () => {
    server = await createTestServer();
    await bootstrap('audit@example.com');
    const code = server.mailer.last().code;
    const audit = JSON.stringify(server.store.debugState().audit);

    assert.ok(audit.length > 0);
    assert.equal(audit.includes('audit@example.com'), false);
    assert.equal(audit.includes(code), false);
    assert.equal(audit.includes('@'), false);
  });

  it('近期验证令牌只能用一次', async () => {
    server = await createTestServer();
    const auth = await login(server.url, server.mailer, 'once@example.com');
    const before = await getDataset(server.url, auth.accessToken);
    const put = await putDataset(server.url, auth.accessToken, {
      snapshot: makeSnapshot(before.body.datasetId),
      etag: '*',
      idempotencyKey: 'key-once-0001',
    });
    server.clock.advance(61_000);
    const recent = await recentAuthToken(server.url, server.mailer, 'once@example.com', 'delete_dataset');
    const headers = {
      Authorization: `Bearer ${auth.accessToken}`,
      'Idempotency-Key': 'key-once-0002',
      'If-Match': put.headers.etag,
      'X-Recent-Auth': recent,
    };
    const first = await request(server.url, '/api/cloud/v1/dataset', { method: 'DELETE', headers });
    assert.equal(first.status, 202);

    // 第二次用同一个验证令牌：幂等键不同，不能被当作重放放过
    const second = await request(server.url, '/api/cloud/v1/dataset', {
      method: 'DELETE',
      headers: { ...headers, 'Idempotency-Key': 'key-once-0003' },
    });
    assert.equal(second.status, 409, '已清空的数据集只回 409，不会二次消费验证令牌');
  });
});

describe('协议边界', () => {
  it('未知路径 404，已知路径错方法 405 且带 Allow', async () => {
    server = await createTestServer();
    const missing = await request(server.url, '/api/cloud/v1/nope');
    assert.equal(missing.status, 404);

    const wrongMethod = await request(server.url, '/api/cloud/v1/dataset', { method: 'POST' });
    assert.equal(wrongMethod.status, 405);
    assert.match(wrongMethod.headers.allow, /GET/);
  });

  it('非法 JSON 返回 400', async () => {
    server = await createTestServer();
    const auth = await login(server.url, server.mailer, 'json@example.com');
    const bad = await request(server.url, '/api/cloud/v1/dataset', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'Idempotency-Key': 'key-json-0001',
        'If-None-Match': '*',
      },
      raw: '{"snapshot": ',
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'INVALID_JSON');
  });

  it('请求体超过封装上限在读取阶段就被拒', async () => {
    server = await createTestServer({ env: { CLOUD_MAX_BODY_BYTES: '4096' } });
    const auth = await login(server.url, server.mailer, 'body@example.com');
    const huge = `{"snapshot":{"padding":"${'x'.repeat(8000)}"}}`;
    const rejected = await request(server.url, '/api/cloud/v1/dataset', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'Idempotency-Key': 'key-body-0001',
        'If-None-Match': '*',
      },
      raw: huge,
    });
    assert.equal(rejected.status, 413);
  });

  it('幂等键过短被拒', async () => {
    server = await createTestServer();
    const auth = await login(server.url, server.mailer, 'shortkey@example.com');
    const before = await getDataset(server.url, auth.accessToken);
    const put = await putDataset(server.url, auth.accessToken, {
      snapshot: makeSnapshot(before.body.datasetId),
      etag: '*',
      idempotencyKey: 'short',
    });
    assert.equal(put.status, 422);
    assert.equal(put.body.error.code, 'IDEMPOTENCY_KEY_INVALID');
  });

  it('健康检查不需要登录且不含数据', async () => {
    server = await createTestServer();
    const health = await request(server.url, '/api/cloud/v1/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.status, 'ok');
    assert.equal(JSON.stringify(health.body).includes('@'), false);
  });
});
