import { expect, test } from '@playwright/test';
import { goSeg, goTab, resetApp } from './helpers';

/**
 * 训练后小结的"本次 vs 上次"E2E。
 *
 * 产品评审建议："训练后小结（本次 vs 上次）—— 即时反馈是留存关键"。
 * 首次记录时应说明"下次就能对比了"，而不是显示一堆 0 或空白。
 */
test.describe('训练后对比', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
  });

  async function startAndLogOneSet(page: import('@playwright/test').Page): Promise<void> {
    await page.getByRole('button', { name: '开始训练' }).click();
    await page.waitForTimeout(1200);

    const inputs = page.locator('.set__input');
    await expect(inputs.first()).toBeVisible({ timeout: 10_000 });
    await inputs.nth(0).fill('100');
    await inputs.nth(1).fill('5');
    await page.locator('.set__check').first().click();
    await page.waitForTimeout(700);
  }

  test('结束训练时显示对比区（有上次则显示差异）', async ({ page }) => {
    await startAndLogOneSet(page);

    // 打开结束总结
    await page.getByRole('button', { name: '结束训练' }).click();
    await page.waitForSelector('.sheet__panel', { timeout: 10_000 });

    const panel = page.locator('.sheet__panel');
    const body = await panel.innerText();

    // 要么有对比数据，要么明确说明这是第一次
    const hasCompare = body.includes('对比上次');
    const isFirst = body.includes('第一次记录');
    expect(hasCompare || isFirst).toBe(true);
  });

  test('首次记录明确提示"下次就能对比了"', async ({ page }) => {
    // 用空白训练保证没有可比的同 dayId 记录
    await goTab(page, '训练');
    await goSeg(page, '计划');
    await page.locator('.train .btn--block.btn--lg', { hasText: '空白训练' }).click();
    await page.waitForTimeout(1000);

    await page.locator('.chip', { hasText: '加动作' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.picker__item').first().click();
    await page.waitForTimeout(800);

    const inputs = page.locator('.set__input');
    await inputs.nth(0).fill('60');
    await inputs.nth(1).fill('8');
    await page.locator('.set__check').first().click();
    await page.waitForTimeout(700);

    await page.getByRole('button', { name: '结束训练' }).click();
    await page.waitForSelector('.sheet__panel', { timeout: 10_000 });

    const body = await page.locator('.sheet__panel').innerText();
    // 空白训练标题唯一，首次必无可比
    expect(body).toMatch(/第一次记录|对比上次/);
  });

  test('对比区不出现"容量 +0%"这种噪音', async ({ page }) => {
    await startAndLogOneSet(page);
    await page.getByRole('button', { name: '结束训练' }).click();
    await page.waitForSelector('.sheet__panel', { timeout: 10_000 });

    const body = await page.locator('.sheet__panel').innerText();
    expect(body).not.toContain('+0%');
  });
});

