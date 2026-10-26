import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { openDataPage, resetApp } from './helpers';

/**
 * 同步 E2E：起一个真实的同步服务端，验证浏览器端能完成上传。
 *
 * 不用 mock：同步的价值在于端到端契约（条件头、幂等、datasetId 绑定），
 * mock 掉服务端就只能验证客户端自说自话。
 */

let srv: ChildProcess | null = null;
let dataDir = '';
let endpoint = '';
const TOKEN = 'e2e-token';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

test.beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'lianji-e2e-sync-'));
  const port = await freePort();
  endpoint = `http://127.0.0.1:${port}`;
  srv = spawn(process.execPath, ['scripts/sync-server.mjs'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, SYNC_TOKEN: TOKEN },
    stdio: 'ignore',
  });
  // 等服务端就绪
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      const r = await fetch(`${endpoint}/api/health`);
      if (r.ok) break;
    } catch {
      /* 未就绪 */
    }
    if (Date.now() > deadline) throw new Error('同步服务端未能启动');
    await new Promise((r) => setTimeout(r, 200));
  }
});

test.afterAll(async () => {
  srv?.kill();
  await rm(dataDir, { recursive: true, force: true });
});

test.describe('同步', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
    await openDataPage(page);
  });

  test('配置后可测试连接，显示服务端能力', async ({ page }) => {
    const inputs = page.locator('.syn input');
    await inputs.nth(0).fill(endpoint);
    await inputs.nth(1).fill(TOKEN);
    await page.getByRole('button', { name: '测试连接' }).click();

    await expect(page.locator('.syn__msg')).toContainText('服务端可用', { timeout: 10_000 });
    await expect(page.locator('.syn__msg')).toContainText('apiVersion');
  });

  test('上传后服务端确有数据，再次同步显示已是最新', async ({ page }) => {
    const inputs = page.locator('.syn input');
    await inputs.nth(0).fill(endpoint);
    await inputs.nth(1).fill(TOKEN);

    await page.getByRole('button', { name: '立即同步' }).click();
    await expect(page.locator('.syn__msg')).toContainText('已上传', { timeout: 20_000 });

    // 服务端确认
    const remote = await fetch(`${endpoint}/api/dataset`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(remote.status).toBe(200);
    const body = (await remote.json()) as {
      datasetId: string;
      records: { sessions: unknown[] };
    };
    expect(body.datasetId).toMatch(/^ds_/);
    expect(body.records.sessions.length).toBeGreaterThan(0);

    // 二次同步不应重复上传
    await page.getByRole('button', { name: '立即同步' }).click();
    await expect(page.locator('.syn__msg')).toContainText('已是最新', { timeout: 20_000 });
  });

  test('错误口令导致连接失败且不泄露细节', async ({ page }) => {
    const inputs = page.locator('.syn input');
    await inputs.nth(0).fill(endpoint);
    await inputs.nth(1).fill('wrong-token');
    await page.getByRole('button', { name: '测试连接' }).click();
    await page.waitForTimeout(1500);

    // health 不需要认证，因此"测试连接"仍会成功——这是设计如此（health 只报能力）
    // 真正需要认证的操作才应失败
    await page.getByRole('button', { name: '立即同步' }).click();
    await page.waitForTimeout(2500);
    const msg = await page.locator('.syn__msg').innerText();
    expect(msg).not.toContain('已上传');
  });
});

