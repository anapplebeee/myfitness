/**
 * 数据集契约测试（CB-A04 / A06 / A09 / A14 / A25 的可自动化部分）。
 *
 * 重点不是"能存能取"，而是三条不能破的边界：
 * 条件不成立不许写、同键重试不许重复写、历史和归属不许越界。
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { snapshotHash } from '../domain/canonical.mjs';
import {
  createTestServer,
  getDataset,
  login,
  makeSnapshot,
  putDataset,
  request,
} from './helpers.mjs';

/** @type {Awaited<ReturnType<typeof createTestServer>> | null} */
let server = null;

afterEach(async () => {
  if (server) await server.close();
  server = null;
});

/** 初始化到 revision 1，返回 {auth, datasetId, etag}。 */
async function bootstrap(email = 'owner@example.com') {
  const auth = await login(server.url, server.mailer, email);
  const before = await getDataset(server.url, auth.accessToken);
  const datasetId = before.body.datasetId;
  const put = await putDataset(server.url, auth.accessToken, {
    snapshot: makeSnapshot(datasetId),
    etag: '*',
    idempotencyKey: 'key-init-0001',
    epoch: before.body.epoch,
  });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  return { auth, datasetId, etag: put.headers.etag };
}

describe('初始化与条件写', () => {
  it('未初始化可读，首次 If-None-Match: * 建立 revision 1', async () => {
    server = await createTestServer();
    const auth = await login(server.url, server.mailer, 'first@example.com');
    const before = await getDataset(server.url, auth.accessToken);

    assert.equal(before.body.status, 'never_initialized');
    assert.equal(before.body.revision, 0);
    assert.ok(before.body.datasetId);

    const snapshot = makeSnapshot(before.body.datasetId);
    const put = await putDataset(server.url, auth.accessToken, {
      snapshot,
      etag: '*',
      idempotencyKey: 'key-init-0001',
      epoch: before.body.epoch,
    });

    assert.equal(put.status, 200);
    assert.equal(put.body.status, 'active');
    assert.equal(put.body.revision, 1);
    assert.equal(put.body.datasetId, before.body.datasetId);
    // 服务端独立重算的哈希必须与本地规范化结果一致
    assert.equal(put.body.snapshotHash, snapshotHash(snapshot));
    assert.equal(put.headers.etag, `"ds:${put.body.datasetId}:e${put.body.epoch}:r1"`);
  });

  it('缺少条件头是 428，不是 412', async () => {
    server = await createTestServer();
    const auth = await login(server.url, server.mailer, 'nocond@example.com');
    const before = await getDataset(server.url, auth.accessToken);

    const put = await request(server.url, '/api/cloud/v1/dataset', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'Idempotency-Key': 'key-nocond-01',
      },
      body: { snapshot: makeSnapshot(before.body.datasetId) },
    });
    assert.equal(put.status, 428);
    assert.equal(put.body.error.code, 'CONDITION_REQUIRED');
  });

  it('缺少幂等键直接拒绝', async () => {
    server = await createTestServer();
    const auth = await login(server.url, server.mailer, 'nokey@example.com');
    const before = await getDataset(server.url, auth.accessToken);
    const put = await request(server.url, '/api/cloud/v1/dataset', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'If-None-Match': '*',
      },
      body: { snapshot: makeSnapshot(before.body.datasetId) },
    });
    assert.equal(put.status, 400);
    assert.equal(put.body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  });

  it('已有数据时 If-None-Match: * 返回 412', async () => {
    server = await createTestServer();
    const { auth, datasetId } = await bootstrap('exists@example.com');
    const again = await putDataset(server.url, auth.accessToken, {
      snapshot: makeSnapshot(datasetId),
      etag: '*',
      idempotencyKey: 'key-init-0002',
    });
    assert.equal(again.status, 412);
    assert.equal(again.body.error.code, 'DATASET_EXISTS');
  });

  it('旧 ETag 写入返回 412 且不改变当前版本', async () => {
    server = await createTestServer();
    const { auth, datasetId, etag } = await bootstrap('stale@example.com');

    const second = await putDataset(server.url, auth.accessToken, {
      snapshot: makeSnapshot(datasetId, { weeklyGoal: 5 }),
      etag,
      idempotencyKey: 'key-update-001',
    });
    assert.equal(second.status, 200);

    const stale = await putDataset(server.url, auth.accessToken, {
      snapshot: makeSnapshot(datasetId, { weeklyGoal: 6 }),
      etag,
      idempotencyKey: 'key-update-002',
    });
    assert.equal(stale.status, 412);
    assert.equal(stale.body.error.code, 'REVISION_CHANGED');

    const current = await getDataset(server.url, auth.accessToken);
    assert.equal(current.body.revision, 2);
    assert.equal(current.body.snapshot.records.weeklyGoal, 5);
  });

  it('代次不符返回 409，datasetId 不符返回 422', async () => {
    server = await createTestServer();
    const { auth, datasetId, etag } = await bootstrap('epoch@example.com');

    const badEpoch = await putDataset(server.url, auth.accessToken, {
      snapshot: makeSnapshot(datasetId, { weeklyGoal: 5 }),
      etag,
      idempotencyKey: 'key-epoch-0001',
      epoch: 99,
    });
    assert.equal(badEpoch.status, 409);
    assert.equal(badEpoch.body.error.code, 'EPOCH_MISMATCH');

    const badDataset = await putDataset(server.url, auth.accessToken, {
      snapshot: makeSnapshot('ds_someone_else', { weeklyGoal: 5 }),
      etag,
      idempotencyKey: 'key-dataset-001',
    });
    assert.equal(badDataset.status, 422);
    assert.equal(badDataset.body.error.code, 'DATASET_ID_MISMATCH');
  });

  it('不支持的 schemaVersion 返回 422 且本地数据不受影响', async () => {
    server = await createTestServer();
    const { auth, datasetId, etag } = await bootstrap('version@example.com');

    const future = makeSnapshot(datasetId);
    future.schemaVersion = 99;
    const put = await putDataset(server.url, auth.accessToken, {
      snapshot: future,
      etag,
      idempotencyKey: 'key-version-001',
    });
    assert.equal(put.status, 422);
    assert.equal(put.body.error.code, 'VERSION_UNSUPPORTED');

    const current = await getDataset(server.url, auth.accessToken);
    assert.equal(current.body.revision, 1, '被拒的写入不应推进版本');
  });

  it('超过体积上限返回 413', async () => {
    server = await createTestServer({ env: { CLOUD_MAX_SNAPSHOT_BYTES: '2048' } });
    const auth = await login(server.url, server.mailer, 'big@example.com');
    const before = await getDataset(server.url, auth.accessToken);
    const snapshot = makeSnapshot(before.body.datasetId, {
      customTemplates: [{ id: 'big', note: 'x'.repeat(4000) }],
    });

    const put = await putDataset(server.url, auth.accessToken, {
      snapshot,
      etag: '*',
      idempotencyKey: 'key-big-00001',
    });
    assert.equal(put.status, 413);
    assert.equal(put.body.error.code, 'SNAPSHOT_TOO_LARGE');
  });
});

describe('幂等', () => {
  it('同键同请求重放返回原结果，且不推进版本', async () => {
    server = await createTestServer();
    const { auth, datasetId, etag } = await bootstrap('idem@example.com');
    const snapshot = makeSnapshot(datasetId, { weeklyGoal: 5 });

    const first = await putDataset(server.url, auth.accessToken, {
      snapshot,
      etag,
      idempotencyKey: 'key-idem-0001',
    });
    // 模拟"服务端已提交、响应丢失"后的重试：客户端仍拿着旧 ETag
    const retry = await putDataset(server.url, auth.accessToken, {
      snapshot,
      etag,
      idempotencyKey: 'key-idem-0001',
    });

    assert.equal(first.status, 200);
    assert.equal(retry.status, 200);
    assert.equal(retry.headers['idempotent-replay'], 'true');
    assert.equal(retry.body.revision, first.body.revision);
    assert.equal(retry.headers.etag, first.headers.etag);

    const current = await getDataset(server.url, auth.accessToken);
    assert.equal(current.body.revision, 2);
  });

  it('同键异请求返回 409，不覆盖原结果', async () => {
    server = await createTestServer();
    const { auth, datasetId, etag } = await bootstrap('idem2@example.com');

    await putDataset(server.url, auth.accessToken, {
      snapshot: makeSnapshot(datasetId, { weeklyGoal: 5 }),
      etag,
      idempotencyKey: 'key-idem-0002',
    });
    const changed = await putDataset(server.url, auth.accessToken, {
      snapshot: makeSnapshot(datasetId, { weeklyGoal: 6 }),
      etag,
      idempotencyKey: 'key-idem-0002',
    });
    assert.equal(changed.status, 409);
    assert.equal(changed.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
  });

  it('幂等键按账号隔离，跨账号复用不返回他人结果', async () => {
    server = await createTestServer();
    const a = await bootstrap('idem-a@example.com');
    server.clock.advance(61_000);
    const b = await login(server.url, server.mailer, 'idem-b@example.com');
    const bBefore = await getDataset(server.url, b.accessToken);

    const collision = await putDataset(server.url, b.accessToken, {
      snapshot: makeSnapshot(bBefore.body.datasetId, { weeklyGoal: 2 }),
      etag: '*',
      idempotencyKey: 'key-idem-0001',
    });
    assert.equal(collision.status, 200, '别人的键不该影响本账号');
    assert.notEqual(collision.body.datasetId, a.datasetId);
    assert.notEqual(collision.headers['idempotent-replay'], 'true');
  });
});

describe('并发', () => {
  it('两个设备用同一 ETag 同时写，只有一个成功', async () => {
    server = await createTestServer();
    const { auth, datasetId, etag } = await bootstrap('race@example.com');

    const [first, second] = await Promise.all([
      putDataset(server.url, auth.accessToken, {
        snapshot: makeSnapshot(datasetId, { weeklyGoal: 5 }),
        etag,
        idempotencyKey: 'key-race-0001',
      }),
      putDataset(server.url, auth.accessToken, {
        snapshot: makeSnapshot(datasetId, { weeklyGoal: 6 }),
        etag,
        idempotencyKey: 'key-race-0002',
      }),
    ]);

    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [200, 412], '必须一成一败，不能两个都成功');

    const current = await getDataset(server.url, auth.accessToken);
    assert.equal(current.body.revision, 2);
    assert.ok([5, 6].includes(current.body.snapshot.records.weeklyGoal));
  });
});

describe('历史版本', () => {
  it('更新前的快照进入历史，可读且归属校验严格', async () => {
    server = await createTestServer();
    const { auth, datasetId, etag } = await bootstrap('history@example.com');
    // bootstrap 已经把默认快照写成 revision 1，它会成为历史版本
    const v1 = makeSnapshot(datasetId);

    const second = await putDataset(server.url, auth.accessToken, {
      snapshot: makeSnapshot(datasetId, { weeklyGoal: 5 }),
      etag,
      idempotencyKey: 'key-hist-0001',
    });
    assert.equal(second.status, 200);

    const list = await request(server.url, '/api/cloud/v1/dataset/versions', {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    assert.equal(list.status, 200);
    assert.equal(list.body.versions.length, 1);
    const versionId = list.body.versions[0].versionId;
    assert.equal(list.body.versions[0].revision, 1);

    const content = await request(server.url, `/api/cloud/v1/dataset/versions/${versionId}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    assert.equal(content.status, 200);
    assert.equal(content.body.snapshot.records.weeklyGoal, 4);
    assert.equal(content.body.snapshotHash, snapshotHash(v1));
  });

  it('他人版本返回 404', async () => {
    server = await createTestServer();
    const a = await bootstrap('ver-a@example.com');
    await putDataset(server.url, a.auth.accessToken, {
      snapshot: makeSnapshot(a.datasetId, { weeklyGoal: 5 }),
      etag: a.etag,
      idempotencyKey: 'key-ver-a-001',
    });
    const list = await request(server.url, '/api/cloud/v1/dataset/versions', {
      headers: { Authorization: `Bearer ${a.auth.accessToken}` },
    });
    const versionId = list.body.versions[0].versionId;

    server.clock.advance(61_000);
    const b = await login(server.url, server.mailer, 'ver-b@example.com');
    const stolen = await request(server.url, `/api/cloud/v1/dataset/versions/${versionId}`, {
      headers: { Authorization: `Bearer ${b.accessToken}` },
    });
    assert.equal(stolen.status, 404);
  });

  it('最多保留 10 个此前版本，30 天后清空', async () => {
    server = await createTestServer();
    const { auth, datasetId, etag } = await bootstrap('retain@example.com');
    let currentEtag = etag;
    for (let i = 0; i < 12; i += 1) {
      const put = await putDataset(server.url, auth.accessToken, {
        snapshot: makeSnapshot(datasetId, { weeklyGoal: (i % 9) + 1, targetKcal: 2000 + i }),
        etag: currentEtag,
        idempotencyKey: `key-retain-${String(i).padStart(4, '0')}`,
      });
      assert.equal(put.status, 200, JSON.stringify(put.body));
      currentEtag = put.headers.etag;
    }

    const list = await request(server.url, '/api/cloud/v1/dataset/versions', {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    assert.equal(list.body.versions.length, 10, '当前版本不占配额，最多 10 个此前版本');

    server.clock.advanceDays(31);
    const relogin = await login(server.url, server.mailer, 'retain@example.com');
    const after = await request(server.url, '/api/cloud/v1/dataset/versions', {
      headers: { Authorization: `Bearer ${relogin.accessToken}` },
    });
    assert.equal(after.body.versions.length, 0, '超过 30 天的版本不再列出');
  });
});
