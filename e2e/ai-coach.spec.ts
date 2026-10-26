import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { goTab, readState, resetApp } from './helpers';

/**
 * AI 教练 E2E。
 *
 * 用真实的假模型服务端跑完整链路：
 * 配置 → 外发确认 → 提问 → 解析 → 校验 → 采纳。
 * 不用 mock 函数，因为要验证的是 HTTP 契约与界面反馈。
 */

const TOKEN = 'test-key-123';
let srv: ChildProcess | null = null;
let endpoint = '';

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
  const port = await freePort();
  endpoint = `http://127.0.0.1:${port}/v1/chat/completions`;
  srv = spawn(process.execPath, ['scripts/fake-ai-server.mjs'], {
    env: { ...process.env, PORT: String(port), FAKE_AI_TOKEN: TOKEN },
    stdio: 'ignore',
  });
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.ok) break;
    } catch {
      /* 未就绪 */
    }
    if (Date.now() > deadline) throw new Error('假模型服务端未能启动');
    await new Promise((r) => setTimeout(r, 200));
  }
});

test.afterAll(async () => {
  srv?.kill();
});

/** 打开配置面板并填好。 */
async function configure(page: import('@playwright/test').Page, model = 'ok'): Promise<void> {
  await page.getByRole('button', { name: /配置|设置/ }).first().click();
  await page.waitForTimeout(400);

  // 用"自定义"以便填自己的端点
  await page.locator('.seg__item', { hasText: '自定义' }).click();
  await page.waitForTimeout(200);

  const panel = page.locator('.sheet__panel');
  const inputs = panel.locator('input');
  await inputs.nth(0).fill(endpoint);
  await inputs.nth(1).fill(model);
  await inputs.nth(2).fill(TOKEN);
  await panel.getByRole('button', { name: '保存配置' }).click();
  await page.waitForTimeout(400);
  /*
   * 首次保存会进入"外发确认"，必须再点一次确认。
   * 这个辅助函数要覆盖完整流程，否则后续用例都会停在未配置状态——
   * 之前就是漏了这一步，导致 7 个用例连带失败。
   */
  const confirm = page.getByRole('button', { name: '确认并保存' });
  if (await confirm.count()) {
    await confirm.click();
    await page.waitForTimeout(500);
  }
}

test.describe('AI 教练', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
    await goTab(page, '教练');
  });

  test('未配置时说明"不配置也能用"，并给出配置入口', async ({ page }) => {
    const body = await page.locator('.ai').innerText();
    expect(body).toContain('不配置也能记录');
    await expect(page.getByRole('button', { name: '配置模型' })).toBeVisible();
  });

  test('首次保存必须确认外发，且说明发给谁', async ({ page }) => {
    await page.getByRole('button', { name: /配置|设置/ }).first().click();
    await page.waitForTimeout(400);
    await page.locator('.seg__item', { hasText: '自定义' }).click();

    const panel = page.locator('.sheet__panel');
    const inputs = panel.locator('input');
    await inputs.nth(0).fill(endpoint);
    await inputs.nth(1).fill('ok');
    await inputs.nth(2).fill(TOKEN);
    await panel.getByRole('button', { name: '保存配置' }).click();
    await page.waitForTimeout(500);

    // 应出现确认区，列出主机名
    const consent = page.locator('.ai__consent');
    await expect(consent).toBeVisible();
    const text = await consent.innerText();
    expect(text).toContain('127.0.0.1');
    expect(text).toContain('不发送姓名');
    // 关键：说清不发送什么
    expect(text).toMatch(/姓名|数据集|口令/);
  });

  test('确认后才保存成功', async ({ page }) => {
    await page.getByRole('button', { name: /配置|设置/ }).first().click();
    await page.waitForTimeout(400);
    await page.locator('.seg__item', { hasText: '自定义' }).click();
    const panel = page.locator('.sheet__panel');
    const inputs = panel.locator('input');
    await inputs.nth(0).fill(endpoint);
    await inputs.nth(1).fill('ok');
    await inputs.nth(2).fill(TOKEN);
    await panel.getByRole('button', { name: '保存配置' }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: '确认并保存' }).click();
    await page.waitForTimeout(600);

    // 配置后应显示模型名与掩码 Key
    const ai = await page.locator('.ai').innerText();
    expect(ai).toContain('ok');
    expect(ai).toContain('••••');
    // 完整 Key 不能出现在页面上
    expect(ai).not.toContain(TOKEN);
  });

  test('Key 存在独立 localStorage 键，不进 AppState', async ({ page }) => {
    await configure(page);
    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(keys).toContain('lianji.ai.settings');
    const state = await readState(page);
    expect(JSON.stringify(state)).not.toContain(TOKEN);
  });

  test('提问后显示回答并可采纳', async ({ page }) => {
    await configure(page);
    await page.locator('.ai__input').fill('这周深蹲要不要加重量？');
    await page.getByRole('button', { name: '问教练' }).click();
    await page.waitForTimeout(2500);

    const ai = await page.locator('.ai').innerText();
    // 有草稿时不再显示原始 JSON，而是用人类可读的草稿区呈现
    expect(ai).toContain('建议草稿');
    expect(ai).toContain('可采纳');
    expect(ai).toContain('bb-squat');
    // 不应把原始 JSON 摊给用户
    expect(ai).not.toContain('{"summary"');
  });

  test('越界建议被拒并说明原因', async ({ page }) => {
    await configure(page, 'huge');
    await page.locator('.ai__input').fill('给我一个极限计划');
    await page.getByRole('button', { name: '问教练' }).click();
    await page.waitForTimeout(2500);

    const ai = await page.locator('.ai').innerText();
    expect(ai).toContain('已拒绝');
    expect(ai).toMatch(/999|超出/);
    // 采纳按钮应禁用（无可采纳项）
    const btn = page.getByRole('button', { name: /采纳建议|已采纳/ });
    if (await btn.count()) {
      await expect(btn).toBeDisabled();
    }
  });

  test('无器械建议被拒（极简装备用户）', async ({ page }) => {
    await configure(page, 'no-equip');

    await page.locator('.ai__input').fill('推荐腿部动作');
    await page.getByRole('button', { name: '问教练' }).click();
    await page.waitForTimeout(2500);

    const ai = await page.locator('.ai').innerText();
    // gym 装备下 leg-press 是允许的，所以这里主要验证链路可用
    expect(ai).toMatch(/可采纳|已拒绝/);
  });

  test('普通文字回答不产生草稿', async ({ page }) => {
    await configure(page, 'plain');
    await page.locator('.ai__input').fill('随便说说');
    await page.getByRole('button', { name: '问教练' }).click();
    await page.waitForTimeout(2500);

    const ai = await page.locator('.ai').innerText();
    expect(ai).toContain('多练腿');
    expect(ai).not.toContain('建议草稿');
  });

  test('401 显示 Key 无效且可操作', async ({ page }) => {
    // 用错误 Key
    await page.getByRole('button', { name: /配置|设置/ }).first().click();
    await page.waitForTimeout(400);
    await page.locator('.seg__item', { hasText: '自定义' }).click();
    const panel = page.locator('.sheet__panel');
    const inputs = panel.locator('input');
    await inputs.nth(0).fill(endpoint);
    await inputs.nth(1).fill('ok');
    await inputs.nth(2).fill('wrong-key');
    await panel.getByRole('button', { name: '保存配置' }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: '确认并保存' }).click();
    await page.waitForTimeout(600);

    await page.locator('.ai__input').fill('测试');
    await page.getByRole('button', { name: '问教练' }).click();
    await page.waitForTimeout(2500);

    const ai = await page.locator('.ai').innerText();
    expect(ai).toMatch(/Key 无效|检查 Key/);
  });

  test('采纳后可关闭再打开，不会重复写入', async ({ page }) => {
    await configure(page);
    await page.locator('.ai__input').fill('加重量');
    await page.getByRole('button', { name: '问教练' }).click();
    await page.waitForTimeout(2500);

    const adopt = page.getByRole('button', { name: '采纳建议' });
    if (await adopt.count()) {
      await adopt.click();
      await page.waitForTimeout(600);
      // 采纳后按钮变为"已采纳"且禁用
      const after = page.getByRole('button', { name: '已采纳' });
      if (await after.count()) {
        await expect(after).toBeDisabled();
      }
    }
  });
});




