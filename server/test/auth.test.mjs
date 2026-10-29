/**
 * 认证契约测试（CB-A02 / A13 / A22 / A24 的可自动化部分）。
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { createClock, createTestServer, login, request } from './helpers.mjs';

/** @type {Awaited<ReturnType<typeof createTestServer>> | null} */
let server = null;

afterEach(async () => {
  if (server) await server.close();
  server = null;
});

describe('发码', () => {
  it('响应不含验证码，且已注册与未注册邮箱完全一致', async () => {
    server = await createTestServer();
    const first = await request(server.url, '/api/cloud/v1/auth/code', {
      body: { email: 'known@example.com' },
    });
    const second = await request(server.url, '/api/cloud/v1/auth/code', {
      body: { email: 'unknown@example.com' },
    });

    assert.equal(first.status, 202);
    assert.equal(second.status, 202);
    assert.deepEqual(first.body, second.body);
    assert.equal(JSON.stringify(first.body).includes(server.mailer.last().code), false);
    assert.equal(server.mailer.sent.length, 2);
  });

  it('同一邮箱一分钟内重复请求不再发信，但外部响应不变', async () => {
    server = await createTestServer();
    const first = await request(server.url, '/api/cloud/v1/auth/code', {
      body: { email: 'burst@example.com' },
    });
    const second = await request(server.url, '/api/cloud/v1/auth/code', {
      body: { email: 'burst@example.com' },
    });
    assert.equal(first.status, 202);
    assert.deepEqual(first.body, second.body);
    assert.equal(server.mailer.sent.length, 1, '限流时不应重复发信');
  });

  it('非法邮箱与非法用途被拒', async () => {
    server = await createTestServer();
    const badEmail = await request(server.url, '/api/cloud/v1/auth/code', {
      body: { email: 'not-an-email' },
    });
    const badPurpose = await request(server.url, '/api/cloud/v1/auth/code', {
      body: { email: 'a@example.com', purpose: 'steal' },
    });
    assert.equal(badEmail.status, 422);
    assert.equal(badPurpose.status, 422);
  });
});

describe('验证码校验', () => {
  it('正确码一次成功，返回访问与刷新令牌', async () => {
    server = await createTestServer();
    await request(server.url, '/api/cloud/v1/auth/code', { body: { email: 'ok@example.com' } });
    const code = server.mailer.lastCode('ok@example.com');
    const verified = await request(server.url, '/api/cloud/v1/auth/verify', {
      body: { email: 'ok@example.com', code, deviceName: 'Pixel 8' },
    });

    assert.equal(verified.status, 200);
    assert.equal(verified.body.created, true);
    assert.match(verified.body.accessToken, /^v1\./);
    assert.ok(verified.body.refreshToken.length >= 32);
    assert.equal(verified.body.deviceName, 'Pixel 8');
    assert.equal(verified.body.recentAuthToken, undefined, '登录不应签发近期验证令牌');
  });

  it('同一个码不能复用', async () => {
    server = await createTestServer();
    await request(server.url, '/api/cloud/v1/auth/code', { body: { email: 'reuse@example.com' } });
    const code = server.mailer.lastCode('reuse@example.com');
    const first = await request(server.url, '/api/cloud/v1/auth/verify', {
      body: { email: 'reuse@example.com', code },
    });
    const second = await request(server.url, '/api/cloud/v1/auth/verify', {
      body: { email: 'reuse@example.com', code },
    });

    assert.equal(first.status, 200);
    assert.equal(second.status, 401);
    assert.equal(second.body.error.code, 'CODE_CONSUMED');
  });

  it('错误 5 次后挑战作废，正确码也进不去', async () => {
    server = await createTestServer();
    await request(server.url, '/api/cloud/v1/auth/code', { body: { email: 'brute@example.com' } });
    const code = server.mailer.lastCode('brute@example.com');
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 4; i += 1) {
      const attempt = await request(server.url, '/api/cloud/v1/auth/verify', {
        body: { email: 'brute@example.com', code: wrong },
      });
      assert.equal(attempt.status, 401);
      assert.equal(attempt.body.error.code, 'CODE_INVALID');
    }
    const fifth = await request(server.url, '/api/cloud/v1/auth/verify', {
      body: { email: 'brute@example.com', code: wrong },
    });
    assert.equal(fifth.status, 429);
    assert.equal(fifth.body.error.code, 'CODE_ATTEMPTS_EXCEEDED');

    const withCorrect = await request(server.url, '/api/cloud/v1/auth/verify', {
      body: { email: 'brute@example.com', code },
    });
    assert.equal(withCorrect.status, 401);
    assert.equal(withCorrect.body.error.code, 'CODE_CONSUMED');
  });

  it('过期码被拒', async () => {
    server = await createTestServer();
    await request(server.url, '/api/cloud/v1/auth/code', { body: { email: 'late@example.com' } });
    const code = server.mailer.lastCode('late@example.com');
    server.clock.advance(601_000);

    const verified = await request(server.url, '/api/cloud/v1/auth/verify', {
      body: { email: 'late@example.com', code },
    });
    assert.equal(verified.status, 401);
    assert.equal(verified.body.error.code, 'CODE_EXPIRED');
  });

  it('删除用途的码不能用于登录', async () => {
    server = await createTestServer();
    await request(server.url, '/api/cloud/v1/auth/code', {
      body: { email: 'purpose@example.com', purpose: 'delete_dataset' },
    });
    const code = server.mailer.lastCode('purpose@example.com', 'delete_dataset');
    const verified = await request(server.url, '/api/cloud/v1/auth/verify', {
      body: { email: 'purpose@example.com', code, purpose: 'login' },
    });
    assert.equal(verified.status, 401);
  });
});

describe('会话', () => {
  it('刷新令牌轮换；旧令牌重放会撤销整个会话', async () => {
    server = await createTestServer();
    const auth = await login(server.url, server.mailer, 'rotate@example.com');

    const rotated = await request(server.url, '/api/cloud/v1/auth/refresh', {
      body: { refreshToken: auth.refreshToken },
    });
    assert.equal(rotated.status, 200);
    assert.notEqual(rotated.body.refreshToken, auth.refreshToken);

    // 轮换后旧访问令牌仍有效（15 分钟内）
    const stillOk = await request(server.url, '/api/cloud/v1/dataset', {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    assert.equal(stillOk.status, 200);

    const replay = await request(server.url, '/api/cloud/v1/auth/refresh', {
      body: { refreshToken: auth.refreshToken },
    });
    assert.equal(replay.status, 401);

    // 重放判定为泄露 → 会话整体失效
    const afterRevoke = await request(server.url, '/api/cloud/v1/dataset', {
      headers: { Authorization: `Bearer ${rotated.body.accessToken}` },
    });
    assert.equal(afterRevoke.status, 401);
  });

  it('退出登录后访问令牌立即失效', async () => {
    server = await createTestServer();
    const auth = await login(server.url, server.mailer, 'logout@example.com');

    const out = await request(server.url, '/api/cloud/v1/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    assert.equal(out.status, 204);

    const after = await request(server.url, '/api/cloud/v1/dataset', {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    assert.equal(after.status, 401);
  });

  it('撤销其他设备后该设备请求被拒，且看不到对方设备', async () => {
    server = await createTestServer();
    const phone = await login(server.url, server.mailer, 'multi@example.com', '手机');
    server.clock.advance(61_000);
    const tablet = await login(server.url, server.mailer, 'multi@example.com', '平板');

    const devices = await request(server.url, '/api/cloud/v1/devices', {
      headers: { Authorization: `Bearer ${phone.accessToken}` },
    });
    assert.equal(devices.status, 200);
    assert.equal(devices.body.devices.length, 2);
    assert.equal(devices.body.devices.filter((d) => d.current).length, 1);

    const revoke = await request(server.url, `/api/cloud/v1/devices/${tablet.sessionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${phone.accessToken}` },
    });
    assert.equal(revoke.status, 204);

    const tabletAfter = await request(server.url, '/api/cloud/v1/dataset', {
      headers: { Authorization: `Bearer ${tablet.accessToken}` },
    });
    assert.equal(tabletAfter.status, 401);

    // 不能撤销别人的设备：返回 404 而不是 403，避免探测 id 是否存在
    server.clock.advance(61_000);
    const other = await login(server.url, server.mailer, 'stranger@example.com', '别人的设备');
    const cross = await request(server.url, `/api/cloud/v1/devices/${other.sessionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${phone.accessToken}` },
    });
    assert.equal(cross.status, 404);
  });

  it('无令牌与伪造令牌都被拒', async () => {
    server = await createTestServer();
    const none = await request(server.url, '/api/cloud/v1/dataset');
    const forged = await request(server.url, '/api/cloud/v1/dataset', {
      headers: { Authorization: 'Bearer v1.eyJhaWQiOiJ4In0.deadbeef' },
    });
    assert.equal(none.status, 401);
    assert.equal(forged.status, 401);
  });
});

describe('时钟注入', () => {
  it('访问令牌 15 分钟后过期', async () => {
    const clock = createClock();
    server = await createTestServer({ clock });
    const auth = await login(server.url, server.mailer, 'expire@example.com');

    const before = await request(server.url, '/api/cloud/v1/dataset', {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    assert.equal(before.status, 200);

    clock.advance(16 * 60_000);
    const after = await request(server.url, '/api/cloud/v1/dataset', {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    assert.equal(after.status, 401);
  });
});
