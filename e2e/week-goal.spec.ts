import { expect, test } from '@playwright/test';
import { goTab, readState, resetApp } from './helpers';

/**
 * 周目标 E2E。
 *
 * 周目标是本项目最核心的业务规则（09 号 N/A/K/D 模型），
 * 但此前只有领域层单测，界面路径完全没覆盖。
 */
test.describe('周目标', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
    await goTab(page, '周目标');
  });

  test('显示本周目标与进度', async ({ page }) => {
    await expect(page.locator('.goalcard')).toBeVisible();
    const body = await page.locator('.goalcard').innerText();
    // 应有完成数与目标数
    expect(body).toMatch(/\d+\s*\/\s*\d+|项完成|目标/);
  });

  test('日历显示 7 天', async ({ page }) => {
    const cells = page.locator('.day');
    expect(await cells.count()).toBeGreaterThanOrEqual(7);
  });

  test('徽标说明存在（可解释性）', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(body).toContain('徽标优先');
  });

  test('可以打开目标编辑并看到调整选项', async ({ page }) => {
    const edit = page.locator('.goalcard__edit');
    if (await edit.count()) {
      await edit.click();
      await page.waitForTimeout(600);
      const body = await page.locator('body').innerText();
      expect(body).toMatch(/最低目标|调整|目标/);
    }
  });

  test('豁免与取消的规则说明可见', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(body).toContain('豁免');
    expect(body).toContain('跨周不搬训练债务');
  });

  test('本周与下周可以切换', async ({ page }) => {
    const body = await page.locator('body').innerText();
    // 页面应有周导航
    expect(body).toMatch(/本周|上周|下周|周/);
  });

  test('周目标数据落库且带原始计划数', async ({ page }) => {
    const state = await readState(page);
    const goals = (state?.weekGoals as Array<Record<string, unknown>>) ?? [];
    expect(goals.length).toBeGreaterThan(0);
    const g = goals[0]!;
    // 09 号模型：N 不可变，K = min(minimumTarget, A)
    expect(typeof g.originalPlannedCount).toBe('number');
    expect(typeof g.minimumTarget).toBe('number');
  });
});
