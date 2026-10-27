import { expect, test } from '@playwright/test';
import { expectReady, goSeg, goTab, readState, resetApp } from './helpers';

/**
 * 引导第四步（可选目标）+ 清理缓存。
 */

/**
 * 全新状态。
 *
 * 不能用 resetApp()：它会自动跳过引导，导致看不到引导流程。
 * 这是本项目早已记录的坑，这里必须自己清存储再 reload。
 */
async function freshStart(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    const dbs = await indexedDB.databases();
    await Promise.all(
      dbs.map(
        (d) =>
          new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(d.name!);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
          }),
      ),
    );
  });
  await page.reload();
  await expectReady(page);
}

test.describe('引导 · 可选目标', () => {
  test.beforeEach(async ({ page }) => {
    await freshStart(page);
  });

  /** 走到第三步。 */
  async function toLastStep(page: import('@playwright/test').Page): Promise<void> {
    await page.getByRole('button', { name: /知道了/ }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: '下一步' }).click();
    await page.waitForTimeout(400);
  }

  test('最后一步出现可选目标，且说明可跳过', async ({ page }) => {
    await toLastStep(page);
    const body = await page.locator('.onb').innerText();
    // 最后一步标题已改为「想练成什么样？」，不再是「定个目标」
    expect(body).toMatch(/想练成什么样|目标体重/);
    expect(body).toMatch(/跳过|之后可以|不填也能/);
  });

  test('填体重目标后保存到 goals', async ({ page }) => {
    await toLastStep(page);
    const inputs = page.locator('.onb__optional input');
    await inputs.nth(0).fill('72');
    await page.getByRole('button', { name: '开始使用' }).click();
    await page.waitForTimeout(1200);

    const state = await readState(page);
    const goals = (state?.goals as Array<Record<string, unknown>>) ?? [];
    const bw = goals.find((g) => g.kind === 'bodyweight');
    expect(bw).toBeDefined();
    expect(bw!.targetGrams).toBe(72000);
  });

  test('体重目标以当前最新体重为起点', async ({ page }) => {
    await toLastStep(page);
    await page.locator('.onb__optional input').nth(0).fill('72');
    await page.getByRole('button', { name: '开始使用' }).click();
    await page.waitForTimeout(1200);

    const state = await readState(page);
    const goals = (state?.goals as Array<Record<string, unknown>>) ?? [];
    const bw = goals.find((g) => g.kind === 'bodyweight');
    // 示例数据里有体重记录，起点不应为空
    expect(bw!.startGrams).not.toBeNull();
    expect(Number(bw!.startGrams)).toBeGreaterThan(0);
  });

  test('填力量目标后保存', async ({ page }) => {
    await toLastStep(page);
    const inputs = page.locator('.onb__optional input');
    await inputs.nth(1).fill('100');
    await page.getByRole('button', { name: '开始使用' }).click();
    await page.waitForTimeout(1200);

    const state = await readState(page);
    const goals = (state?.goals as Array<Record<string, unknown>>) ?? [];
    const st = goals.find((g) => g.kind === 'strength');
    expect(st).toBeDefined();
    expect(st!.targetGrams).toBe(100000);
  });

  test('完全跳过也能完成引导', async ({ page }) => {
    await toLastStep(page);
    await page.getByRole('button', { name: '开始使用' }).click();
    await page.waitForTimeout(1200);

    const state = await readState(page);
    expect(state?.onboarded).toBe(true);
    expect(((state?.goals as unknown[]) ?? []).length).toBe(0);
  });

  test('不填目标时不会被写入无效目标', async ({ page }) => {
    await toLastStep(page);
    await page.locator('.onb__optional input').nth(0).fill('0');
    await page.getByRole('button', { name: '开始使用' }).click();
    await page.waitForTimeout(1200);

    const state = await readState(page);
    const goals = (state?.goals as Array<Record<string, unknown>>) ?? [];
    expect(goals.some((g) => g.kind === 'bodyweight')).toBe(false);
  });

  /*
   * 回归（PM 评审 P0）：选"不保留示例数据"后 occurrences 被清空，
   * 但当时没有重新预建本周计划，周目标页显示"本周没有设定计划 0/0"，
   * 刷新一次才恢复——新用户第一条路径就断在最核心的功能上。
   */
  test('从零开始后本周计划立即存在，不用刷新', async ({ page }) => {
    // 勾选框在第二步（示例说明 → 每周几次），先走一步再取消
    await page.getByRole('button', { name: /知道了/ }).click();
    await page.waitForTimeout(400);
    await page.locator('.onb__check').uncheck();
    await page.getByRole('button', { name: '下一步' }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: '开始使用' }).click();
    await page.waitForTimeout(1500);

    const state = await readState(page);
    expect(((state?.sessions as unknown[]) ?? []).length).toBe(0);
    expect(((state?.occurrences as unknown[]) ?? []).length).toBeGreaterThan(0);
    expect(((state?.weekGoals as unknown[]) ?? []).length).toBeGreaterThan(0);

    await goTab(page, '周目标');
    await expect(page.locator('.goalcard__value')).toBeVisible();
    const text = (await page.locator('.goalcard__value').innerText()).replace(/\s/g, '');
    expect(Number(text.split('/')[1])).toBeGreaterThan(0);
  });
});

test.describe('清理缓存', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
    await goTab(page, '我的');
    await goSeg(page, '设置');
  });

  test('设置页有清理缓存，并说明不删数据', async ({ page }) => {
    const card = page.locator('.cache');
    await expect(card).toBeVisible();
    const text = await card.innerText();
    expect(text).toMatch(/不会删除/);
    expect(text).toMatch(/训练|记录/);
  });

  test('清理缓存后业务数据仍在', async ({ page }) => {
    const before = await readState(page);
    const beforeCount = ((before?.sessions as unknown[]) ?? []).length;
    expect(beforeCount).toBeGreaterThan(0);

    // 造一个假缓存，确认真的被清
    await page.evaluate(async () => {
      const c = await caches.open('e2e-fake-v1');
      await c.put('/x', new Response('y'));
    });

    await Promise.all([
      page.waitForNavigation({ timeout: 15_000 }).catch(() => null),
      page.getByRole('button', { name: /清理缓存并重新加载/ }).click(),
    ]);
    await page.waitForTimeout(2000);

    const after = await readState(page);
    expect(((after?.sessions as unknown[]) ?? []).length).toBe(beforeCount);
    // 缓存应被清空
    const names = await page.evaluate(async () => (await caches.keys()).length);
    expect(names).toBe(0);
  });

  test('重新加载后带时间戳参数（绕过 HTTP 缓存）', async ({ page }) => {
    await Promise.all([
      page.waitForNavigation({ timeout: 15_000 }).catch(() => null),
      page.getByRole('button', { name: /清理缓存并重新加载/ }).click(),
    ]);
    await page.waitForTimeout(1500);
    expect(page.url()).toContain('_r=');
  });

  test('清理缓存不影响 AI Key', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem(
        'lianji.ai.settings',
        JSON.stringify({ provider: 'deepseek', endpoint: 'https://x', model: 'm', apiKey: 'sk-keep', egressConfirmed: true, confirmedEndpoint: 'https://x' }),
      );
    });
    await Promise.all([
      page.waitForNavigation({ timeout: 15_000 }).catch(() => null),
      page.getByRole('button', { name: /清理缓存并重新加载/ }).click(),
    ]);
    await page.waitForTimeout(1500);

    const key = await page.evaluate(() => {
      const raw = localStorage.getItem('lianji.ai.settings');
      return raw ? JSON.parse(raw).apiKey : null;
    });
    expect(key).toBe('sk-keep');
  });
});


