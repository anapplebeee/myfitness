import { expect, test } from '@playwright/test';
import { goTab, readState, resetApp } from './helpers';

/**
 * 目标设定 E2E。
 *
 * 产品评审指出"没有目标就没有坚持的理由"。此用例验证：
 * 1. 能设定三类目标
 * 2. 目标落库并带正确结构
 * 3. 进度显示不出现负数（减重方向的经典错误）
 * 4. 与当前差距过小的目标被拒绝
 */
test.describe('目标设定', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
    await goTab(page, '我的');
  });

  test('身体页显示目标面板（无目标时给引导）', async ({ page }) => {
    await expect(page.locator('.goals')).toBeVisible();
    await expect(page.getByText('还没有目标')).toBeVisible();
  });

  test('能打开目标设定面板并选择类型', async ({ page }) => {
    await page.getByRole('button', { name: '设定目标' }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('.sheet__panel')).toBeVisible();
    const seg = page.locator('.sheet__panel .seg__item');
    await expect(seg.filter({ hasText: '体重' })).toBeVisible();
    await expect(seg.filter({ hasText: '力量' })).toBeVisible();
    await expect(seg.filter({ hasText: '频率' })).toBeVisible();
  });

  test('设定体重目标后落库并显示进度', async ({ page }) => {
    await page.getByRole('button', { name: '设定目标' }).click();
    await page.waitForTimeout(500);

    const input = page.locator('.sheet__panel input[inputmode=decimal]').first();
    await input.fill('72');
    await page.getByRole('button', { name: '保存目标' }).click();
    await page.waitForTimeout(800);

    const state = await readState(page);
    const goals = (state?.goals as Array<Record<string, unknown>>) ?? [];
    expect(goals.length).toBeGreaterThan(0);
    expect(goals[0]!.kind).toBe('bodyweight');
    expect(goals[0]!.targetGrams).toBe(72000);

    // 面板关闭且进度可见
    await expect(page.locator('.sheet__panel')).toHaveCount(0);
    const body = await page.locator('.goals').innerText();
    expect(body).toContain('72');
  });

  test('设定频率目标', async ({ page }) => {
    await page.getByRole('button', { name: '设定目标' }).click();
    await page.waitForTimeout(500);
    await page.locator('.sheet__panel .seg__item', { hasText: '频率' }).click();
    await page.waitForTimeout(300);

    const input = page.locator('.sheet__panel input[inputmode=decimal]').first();
    await input.fill('4');
    await page.getByRole('button', { name: '保存目标' }).click();
    await page.waitForTimeout(800);

    const state = await readState(page);
    const goals = (state?.goals as Array<Record<string, unknown>>) ?? [];
    expect(goals.some((g) => g.kind === 'frequency' && g.perWeek === 4)).toBe(true);
  });

  test('与当前体重差距过小的目标被拒绝', async ({ page }) => {
    await page.getByRole('button', { name: '设定目标' }).click();
    await page.waitForTimeout(500);

    // 读实际最新体重，设一个只差 0.1kg 的目标（必然被拒）
    const state0 = await readState(page);
    const weights = (state0?.weights as Array<{ date: string; grams: number }>) ?? [];
    const latest = [...weights].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    expect(latest).toBeDefined();
    const near = (latest!.grams / 1000 + 0.1).toFixed(1);

    const input = page.locator('.sheet__panel input[inputmode=decimal]').first();
    await input.fill(near);
    await page.getByRole('button', { name: '保存目标' }).click();
    await page.waitForTimeout(800);

    // 应仍在面板中（未保存成功）
    await expect(page.locator('.sheet__panel')).toBeVisible();
    const state = await readState(page);
    expect(((state?.goals as unknown[]) ?? []).length).toBe(0);
  });

  test('进度百分比不出现负数', async ({ page }) => {
    await page.getByRole('button', { name: '设定目标' }).click();
    await page.waitForTimeout(500);
    const input = page.locator('.sheet__panel input[inputmode=decimal]').first();
    await input.fill('70');
    await page.getByRole('button', { name: '保存目标' }).click();
    await page.waitForTimeout(800);

    const foot = await page.locator('.goal__foot').first().innerText();
    const pct = Number(foot.replace(/[^0-9.]/g, ''));
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
  });

  test('可以删除目标', async ({ page }) => {
    await page.getByRole('button', { name: '设定目标' }).click();
    await page.waitForTimeout(500);
    const input = page.locator('.sheet__panel input[inputmode=decimal]').first();
    await input.fill('70');
    await page.getByRole('button', { name: '保存目标' }).click();
    await page.waitForTimeout(800);

    await page.locator('.goal__del').first().click();
    await page.waitForTimeout(600);

    const state = await readState(page);
    expect(((state?.goals as unknown[]) ?? []).length).toBe(0);
  });
});

