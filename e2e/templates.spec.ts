import { expect, test } from '@playwright/test';
import { goSeg, goTab, readState, resetApp } from './helpers';

/**
 * 模板编辑 E2E。
 *
 * 这条路径此前完全没有自动化覆盖，而它是"用户能不能改计划"的唯一入口。
 */
test.describe('模板编辑', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
    await goTab(page, '训练');
    await goSeg(page, '计划');
  });

  async function openEditor(page: import('@playwright/test').Page): Promise<void> {
    await page.getByRole('button', { name: '编辑' }).first().click();
    await page.waitForSelector('.editor', { timeout: 10_000 });
  }

  test('能打开编辑器并显示标题', async ({ page }) => {
    await openEditor(page);
    await expect(page.locator('.editor__title')).toBeVisible();
    // 应有"加一天"与保存按钮
    await expect(page.getByRole('button', { name: '加一天' })).toBeVisible();
  });

  test('空训练日不能保存（校验生效）', async ({ page }) => {
    await openEditor(page);
    await page.getByRole('button', { name: '加一天' }).click();
    await page.waitForTimeout(400);

    // 新加的天没有动作，保存按钮应被禁用
    const save = page.getByRole('button', { name: '保存为新版本' });
    await expect(save).toBeDisabled();
  });

  test('加一天并添加动作后保存，生成自建模板', async ({ page }) => {
    const before = await readState(page);
    const beforeCustom = ((before?.customTemplates as unknown[]) ?? []).length;

    await openEditor(page);
    const daysBefore = await page.locator('.editor .chip').count();
    await page.getByRole('button', { name: '加一天' }).click();
    await page.waitForTimeout(400);
    const daysAfter = await page.locator('.editor .chip').count();
    expect(daysAfter).toBeGreaterThan(daysBefore);

    // 新天必须至少有一个动作才能保存
    await page.getByRole('button', { name: '+ 添加动作' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.picker__item, .picker button').first().click();
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: '保存为新版本' }).click();
    await page.waitForTimeout(500);
    const confirm = page.getByRole('button', { name: '确认保存' });
    if (await confirm.count()) {
      await confirm.click();
      await page.waitForTimeout(900);
    }

    const after = await readState(page);
    const afterCustom = ((after?.customTemplates as unknown[]) ?? []).length;
    expect(afterCustom).toBeGreaterThan(beforeCustom);
  });

  test('取消编辑不写入', async ({ page }) => {
    const before = await readState(page);
    const beforeCustom = ((before?.customTemplates as unknown[]) ?? []).length;

    await openEditor(page);
    await page.getByRole('button', { name: '加一天' }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '取消' }).click();
    await page.waitForTimeout(600);

    const after = await readState(page);
    expect(((after?.customTemplates as unknown[]) ?? []).length).toBe(beforeCustom);
  });

  test('编辑器内可搜索并添加动作', async ({ page }) => {
    await openEditor(page);
    await page.getByRole('button', { name: '+ 添加动作' }).first().click();
    await page.waitForTimeout(500);

    const search = page.locator('input[type=search]').last();
    await expect(search).toBeVisible();
    await search.fill('深蹲');
    await page.waitForTimeout(400);

    // 出现匹配项
    const body = await page.locator('body').innerText();
    expect(body).toContain('深蹲');
  });
});

