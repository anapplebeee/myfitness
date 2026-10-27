import { expect, test, type Page } from '@playwright/test';
import { expectReady, goTab, readState, resetApp } from './helpers';

/**
 * PM 评审（2026-10-27）「数据诚实」三条 + 训练中顶栏。
 *
 * 对应条目：
 * - §3.7 饮食目标 2350/165 写死且无 UI 可改
 * - §3.2 空状态仍显示 0 与默认目标
 * - §3.12 训练中全局顶栏占 70px
 */

/** 全新状态：清空两个副本后重载，保留引导（不能用 resetApp，它会跳过引导）。 */
async function freshStart(page: Page): Promise<void> {
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
  await expect(page.locator('.onb')).toBeVisible({ timeout: 10_000 });
}

test.describe('饮食目标 · 不再用默认值伪装用户数据', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
  });

  test('新用户没有目标，饮食页显示未设置而不是 2350', async ({ page }) => {
    const state = await readState(page);
    expect(state?.targetKcal).toBeNull();
    expect(state?.targetProtein).toBeNull();

    await goTab(page, '饮食');
    const card = page.locator('.nutrition');
    const text = await card.innerText();
    expect(text).toContain('还没设目标');
    expect(text).not.toContain('2350');
    // 没有目标就不画进度环，避免"0%"被读成没达标
    await expect(card.locator('.ring')).toHaveCount(0);
  });

  test('在「我的 → 身体」设置后，饮食页按目标显示', async ({ page }) => {
    await goTab(page, '我的');
    const inputs = page.locator('.bodydata__grid--nutrition input');
    await inputs.nth(0).fill('2000');
    await inputs.nth(0).blur();
    await inputs.nth(1).fill('120');
    await inputs.nth(1).blur();
    await page.waitForTimeout(500);

    const state = await readState(page);
    expect(state?.targetKcal).toBe(2000);
    expect(state?.targetProtein).toBe(120);

    await goTab(page, '饮食');
    const text = await page.locator('.nutrition').innerText();
    expect(text).toContain('/ 2000 kcal');
    expect(text).toContain('/ 120 g');
  });

  test('清除目标后回到未设置，不回落默认值', async ({ page }) => {
    await goTab(page, '我的');
    const inputs = page.locator('.bodydata__grid--nutrition input');
    await inputs.nth(0).fill('2000');
    await inputs.nth(0).blur();
    await page.getByRole('button', { name: '清除' }).click();
    await page.waitForTimeout(400);

    const state = await readState(page);
    expect(state?.targetKcal).toBeNull();
    expect(state?.targetProtein).toBeNull();
  });
});

test.describe('今日空状态 · 不显示 0 与默认目标', () => {
  test('从零开始后显示引导卡，而不是累计 0 次', async ({ page }) => {
    await freshStart(page);
    // 第二步取消"保留示例数据"，即真正的从零开始
    await page.getByRole('button', { name: /知道了/ }).click();
    await page.waitForTimeout(300);
    await page.locator('.onb__check').uncheck();
    await page.getByRole('button', { name: '下一步' }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '开始使用' }).click();
    await expectReady(page);

    const today = page.locator('.today');
    await expect(today.locator('.empty-guide')).toBeVisible();
    await expect(today.locator('.quick')).toHaveCount(0);
    await expect(today.locator('.nutrition')).toHaveCount(0);

    const text = await today.innerText();
    expect(text).not.toContain('累计训练');
    expect(text).toContain('先记一笔');
  });
});

test.describe('训练中 · 让位给这一组', () => {
  test('录制页不显示全局顶栏', async ({ page }) => {
    await resetApp(page);
    await page.getByRole('button', { name: '开始训练' }).click();
    await expect(page.locator('.live')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.topbar')).toHaveCount(0);
  });
});
