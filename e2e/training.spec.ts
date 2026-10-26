import { expect, test } from '@playwright/test';
import { expectReady, goSeg, goTab, readState, resetApp } from './helpers';

/**
 * 训练主路径 E2E。
 *
 * 覆盖的是"打开应用就能记一组"这条最核心链路——
 * 之前这条链路上出现过两次致命缺陷（模板场次无输入框、空白训练无输入框），
 * 因此必须有自动化回归。
 */
test.describe('训练主路径', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
  });

  test('首屏可用，今日页展示周目标', async ({ page }) => {
    await expect(page.locator('.tabbar')).toBeVisible();
    await expect(page.locator('.hero')).toBeVisible();
    await expect(page.locator('.hero__title')).toBeVisible();
    // 本周节奏区块存在
    await expect(page.locator('.week')).toBeVisible();
    await expect(page.getByRole('button', { name: '开始训练' })).toBeVisible();
  });

  test('从今日页开始训练并能记录一组', async ({ page }) => {
    // 必须按文字选：今日页同时有"开始训练"与"空白训练"两个大按钮
    await page.getByRole('button', { name: '开始训练' }).click();
    await page.waitForTimeout(1200);

    // 进入录制页：应至少有一个数值输入框（历史缺陷：0 个）
    const inputs = page.locator('.set__input');
    await expect(inputs.first()).toBeVisible({ timeout: 10_000 });
    expect(await inputs.count()).toBeGreaterThan(0);

    // 填入第一组数据
    const first = inputs.first();
    await first.fill('100');
    const reps = page.locator('.set__input').nth(1);
    await reps.fill('5');

    // 完成后应出现"已保存"标记
    await page.locator('.set__check').first().click();
    await page.waitForTimeout(700);
    await expect(page.getByText('已保存').first()).toBeVisible();
  });

  test('空白训练可添加动作并录入（计时类）', async ({ page }) => {
    await goTab(page, '训练');
    await goSeg(page, '计划');

    // 今日页也有同名按钮，必须限定作用域到 .train
    // 按钮已降级为描边（不再是 btn--lg），这里只按作用域 + 文字定位
  const blank = page.locator('.train .btn--block', { hasText: '空白训练' });
    await expect(blank).toBeVisible();
    await blank.click();
    await page.waitForTimeout(1000);

    // 打开动作选择
    await page.locator('.chip', { hasText: '加动作' }).first().click();
    await page.waitForTimeout(500);

    // 搜索"平板"——验证面板支持搜索（历史缺陷：只列前 24 个选不到）
    const search = page.locator('.sheet__panel input[type=search]');
    await expect(search).toBeVisible();
    await search.fill('平板');
    await page.waitForTimeout(400);

    const item = page.locator('.picker__item').first();
    await expect(item).toBeVisible();
    await expect(item).toContainText('平板支撑');
    await item.click();
    await page.waitForTimeout(700);

    // 计时动作应该只有"秒"输入，没有重量框
    const labels = await page.locator('.set__input').evaluateAll((els) =>
      els.map((e) => e.getAttribute('aria-label')),
    );
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((l) => l?.includes('时长'))).toBe(true);

    // 填入 45 秒并完成
    await page.locator('.set__input').first().fill('45');
    await page.locator('.set__check').first().click();
    await page.waitForTimeout(700);
    await expect(page.getByText('0:45').first()).toBeVisible();
  });

  test('动作选择面板可搜到排在后面的动作', async ({ page }) => {
    await goTab(page, '训练');
    await goSeg(page, '计划');
    await page.locator('.train .btn--block', { hasText: '空白训练' }).click();
    await page.waitForTimeout(1000);
    await page.locator('.chip', { hasText: '加动作' }).first().click();
    await page.waitForTimeout(600);

    // "哈克"来自扩展动作包，在全部动作中排名靠后
    const search = page.locator('.sheet__panel input[type=search]');
    await search.fill('哈克');
    await page.waitForTimeout(400);
    await expect(page.locator('.picker__item').first()).toContainText('哈克');
  });
});

test.describe('数据持久化', () => {
  test('刷新后训练记录仍在', async ({ page }) => {
    await resetApp(page);
    const before = await readState(page);
    const beforeCount = (before?.sessions as unknown[] | undefined)?.length ?? 0;
    expect(beforeCount).toBeGreaterThan(0);

    await page.reload();
    await expectReady(page);

    const after = await readState(page);
    const afterCount = (after?.sessions as unknown[] | undefined)?.length ?? 0;
    expect(afterCount).toBe(beforeCount);
    // datasetId 必须稳定，否则同步会误判为另一个数据集
    expect(after?.datasetId).toBe(before?.datasetId);
  });
});




