/**
 * 生命周期契约测试：清空、重新启用、替换、注销（CB-A11 / A12 / A13 / A21 / A24 / A25）。
 *
 * 这一组是"不可复活"的正面证据：
 * - 清空后旧代次与旧条件令牌都写不进去；
 * - 注销后旧会话立即失效，但原设备仍能用状态凭证查询有限状态；
 * - 同一邮箱重新注册得到新账号，旧数据不找回。
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

async function bootstrap(email = 'life@example.com') {
  const auth = await login(server.url, server.mailer, email);
  const before = await getDataset(server.url, auth.accessToken);
  const put = await putDataset(server.url, auth.accessToken, {
    snapshot: makeSnapshot(before.body.datasetId),
    etag: '*',
    idempotencyKey: 'key-init-0001',
    epoch: before.body.epoch,
  });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  return { auth, datasetId: put.body.datasetId, etag: put.headers.etag, epoch: put.body.epoch };
}

describe('清空云端', () => {
  it('缺少近期验证 → 403；成功后旧条件写无法复活数据', async () => {
    server = await createTestServer();
    const { auth, etag } = await bootstrap('wipe@example.com');

    const noRecent = await request(server.url, '/api/cloud/v1/dataset', {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'Idempotency-Key': 'key-wipe-0001',
        'If-Match': etag,
      },
    });
    assert.equal(noRecent.status, 403);

    server.clock.advance(61_000);
    const recent = await recentAuthToken(server.url, server.mailer, 'wipe@example.com', 'delete_dataset');
    const wiped = await request(server.url, '/api/cloud/v1/dataset', {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'Idempotency-Key': 'key-wipe-0001',
        'If-Match': etag,
        'X-Recent-Auth': recent,
      },
    });
    assert.equal(wiped.status, 202, JSON.stringify(wiped.body));
    assert.equal(wiped.body.status, 'deleted');
    assert.ok(wiped.body.deletionId);

    const after = await getDataset(server.url, auth.accessToken);
    assert.equal(after.body.status, 'deleted');
    assert.equal(after.body.snapshot, undefined, 'deleted 状态不得回任何快照内容');

    // 旧设备拿着旧 ETag 上传：必须被拒，且不能复活数据
    const resurrect = await putDataset(server.url, auth.accessToken, {
      snapshot: makeSnapshot('whatever'),
      etag,
      idempotencyKey: 'key-wipe-0002',
    });
    assert.equal(resurrect.status, 409);
    assert.ok(
      ['DATASET_DELETED', 'EPOCH_MISMATCH'].includes(resurrect.body.error.code),
      `实际错误码为 ${resurrect.body.error.code}`,
    );

    const stillDeleted = await getDataset(server.url, auth.accessToken);
    assert.equal(stillDeleted.body.status, 'deleted');
  });

  it('同键重试返回原结果，不重复推进代次', async () => {
    server = await createTestServer();
    const { auth, etag } = await bootstrap('wipe-retry@example.com');
    server.clock.advance(61_000);
    const recent = await recentAuthToken(server.url, server.mailer, 'wipe-retry@example.com', 'delete_dataset');

    const headers = {
      Authorization: `Bearer ${auth.accessToken}`,
      'Idempotency-Key': 'key-wipe-retry',
      'If-Match': etag,
      'X-Recent-Auth': recent,
    };
    const first = await request(server.url, '/api/cloud/v1/dataset', { method: 'DELETE', headers });
    const retry = await request(server.url, '/api/cloud/v1/dataset', { method: 'DELETE', headers });

    assert.equal(first.status, 202);
    assert.equal(retry.status, 202);
    assert.equal(retry.body.deletionId, first.body.deletionId);
    assert.equal(retry.body.epoch, first.body.epoch);
  });

  it('删除后可以用删除代次令牌重新启用（换 datasetId 与代次）', async () => {
    server = await createTestServer();
    const { auth, datasetId, etag, epoch } = await bootstrap('reinit@example.com');
    server.clock.advance(61_000);
    const recent = await recentAuthToken(server.url, server.mailer, 'reinit@example.com', 'delete_dataset');
    const wiped = await request(server.url, '/api/cloud/v1/dataset', {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'Idempotency-Key': 'key-reinit-001',
        'If-Match': etag,
        'X-Recent-Auth': recent,
      },
    });
    assert.equal(wiped.status, 202);
    const deletionEtag = wiped.body.etag;

    const staleToken = await request(server.url, '/api/cloud/v1/dataset/reinitialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'Idempotency-Key': 'key-reinit-002',
        'If-Match': '"del:e1:not-a-real-token"',
      },
      body: { snapshot: makeSnapshot('ignored') },
    });
    assert.equal(staleToken.status, 412);
    assert.equal(staleToken.body.error.code, 'DELETION_TOKEN_STALE');

    const revived = await request(server.url, '/api/cloud/v1/dataset/reinitialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'Idempotency-Key': 'key-reinit-003',
        'If-Match': deletionEtag,
      },
      body: { snapshot: makeSnapshot('client-side-id') },
    });
    assert.equal(revived.status, 201, JSON.stringify(revived.body));
    assert.notEqual(revived.body.datasetId, datasetId, '重新启用必须换 datasetId');
    assert.equal(revived.body.epoch, epoch + 2);
    assert.equal(revived.body.revision, 1);

    const current = await getDataset(server.url, auth.accessToken);
    assert.equal(current.body.status, 'active');
    assert.equal(current.body.datasetId, revived.body.datasetId);
  });
});

describe('替换云端', () => {
  it('替换换 datasetId 与代次，旧数据进历史版本', async () => {
    server = await createTestServer();
    const { auth, datasetId, etag, epoch } = await bootstrap('replace@example.com');
    const localSnapshot = makeSnapshot('local-only-id', { weeklyGoal: 6 });

    const replaced = await request(server.url, '/api/cloud/v1/dataset/replace', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'Idempotency-Key': 'key-replace-01',
        'If-Match': etag,
      },
      body: { snapshot: localSnapshot, epoch },
    });
    assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
    assert.notEqual(replaced.body.datasetId, datasetId);
    assert.equal(replaced.body.epoch, epoch + 1);
    assert.equal(replaced.body.previousDatasetId, datasetId);

    const current = await getDataset(server.url, auth.accessToken);
    assert.equal(current.body.datasetId, replaced.body.datasetId);
    assert.equal(current.body.snapshot.datasetId, replaced.body.datasetId, '服务端指派的数据集 id 应写回快照');

    const versions = await request(server.url, '/api/cloud/v1/dataset/versions', {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    assert.equal(versions.body.versions.length, 1);
    assert.equal(versions.body.versions[0].datasetId, datasetId, '旧数据集版本仍可恢复');
  });

  it('没有 If-Match 的替换被拒', async () => {
    server = await createTestServer();
    const { auth } = await bootstrap('replace2@example.com');
    const rejected = await request(server.url, '/api/cloud/v1/dataset/replace', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'Idempotency-Key': 'key-replace-02',
      },
      body: { snapshot: makeSnapshot('x') },
    });
    assert.equal(rejected.status, 428);
  });
});

describe('注销账号', () => {
  it('注销后旧会话立即失效，状态凭证只能查到有限状态', async () => {
    server = await createTestServer();
    const { auth } = await bootstrap('bye@example.com');
    server.clock.advance(61_000);
    const recent = await recentAuthToken(server.url, server.mailer, 'bye@example.com', 'delete_account');
    const statusToken = 'status-token-'.padEnd(48, 'x');

    const cancelled = await request(server.url, '/api/cloud/v1/account', {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'Idempotency-Key': 'key-bye-00001',
        'X-Recent-Auth': recent,
      },
      body: { statusToken },
    });
    assert.equal(cancelled.status, 202, JSON.stringify(cancelled.body));
    assert.equal(cancelled.body.status, 'accepted');

    const oldSession = await request(server.url, '/api/cloud/v1/dataset', {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    assert.equal(oldSession.status, 401, '旧会话必须在注销后立即失效');

    const status = await request(server.url, '/api/cloud/v1/account/deletion', {
      headers: { 'X-Status-Token': statusToken },
    });
    assert.equal(status.status, 200);
    assert.equal(status.body.status, 'completed');
    assert.equal(JSON.stringify(status.body).includes('@'), false, '状态查询不得回邮箱');

    const wrong = await request(server.url, '/api/cloud/v1/account/deletion', {
      headers: { 'X-Status-Token': 'nope'.padEnd(48, 'y') },
    });
    assert.equal(wrong.status, 404);
  });

  it('同一邮箱重新注册得到新账号，不找回旧数据', async () => {
    server = await createTestServer();
    const first = await bootstrap('again@example.com');
    server.clock.advance(61_000);
    const recent = await recentAuthToken(server.url, server.mailer, 'again@example.com', 'delete_account');
    await request(server.url, '/api/cloud/v1/account', {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${first.auth.accessToken}`,
        'Idempotency-Key': 'key-again-001',
        'X-Recent-Auth': recent,
      },
      body: { statusToken: 'status-token-'.padEnd(48, 'z') },
    });

    server.clock.advance(61_000);
    const second = await login(server.url, server.mailer, 'again@example.com');
    assert.equal(second.created, true);
    assert.notEqual(second.accountId, first.auth.accountId);

    const dataset = await getDataset(server.url, second.accessToken);
    assert.equal(dataset.body.status, 'never_initialized', '旧数据不得随重新注册回来');
  });

  it('注销使用登录用途的近期验证令牌会被拒', async () => {
    server = await createTestServer();
    const { auth } = await bootstrap('purpose2@example.com');
    server.clock.advance(61_000);
    const recent = await recentAuthToken(server.url, server.mailer, 'purpose2@example.com', 'delete_dataset');

    const rejected = await request(server.url, '/api/cloud/v1/account', {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'Idempotency-Key': 'key-purpose-1',
        'X-Recent-Auth': recent,
      },
      body: { statusToken: 'status-token-'.padEnd(48, 'q') },
    });
    assert.equal(rejected.status, 403);
  });
});
