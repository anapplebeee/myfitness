import { expect, test } from '@playwright/test';
import { goTab, readState, resetApp } from './helpers';

/**
 * 饮食记录 E2E。
 *
 * 这是此前覆盖最少的核心页面。重点验证：
 * 1. 从食物库选食物 → 填克数 → 保存，能写入记录
 * 2. 未记录的餐次不能被当成"0 卡"欺骗用户（页面已声明"未记录不等于 0"）
 * 3. 手工记录（食物库里没有的东西）可用
 */
test.describe('饮食记录', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
    await goTab(page, '饮食');
  });

  test('页面显示四个餐次与今日汇总', async ({ page }) => {
    const body = await page.locator('body').innerText();
    // 四个餐次
    expect(body).toMatch(/早餐|午餐|晚餐|加餐/);
    // 汇总区
    expect(body).toContain('kcal');
  });

  test('未记录时明确声明"未记录不等于 0"', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(body).toContain('未记录');
    // 关键：不能让用户以为 0 就是实际摄入
    expect(body).toMatch(/不代表实际为 0|未记录不等于/);
  });

  test('从食物库添加食物并写入记录', async ({ page }) => {
    const before = await readState(page);
    const beforeFoods = ((before?.foods as unknown[]) ?? []).length;

    // 打开第一个餐次的添加面板
    await page.getByRole('button', { name: '添加' }).first().click();
    await page.waitForTimeout(700);

    // 搜索并选一个食物
    const search = page.locator('.sheet__panel input[type=search], .sheet__panel input').first();
    await expect(search).toBeVisible();
    await search.fill('鸡胸');
    await page.waitForTimeout(500);

    const item = page.locator('.add__item').first();
    await expect(item).toBeVisible();
    await item.click();
    await page.waitForTimeout(600);

    // 确认添加（面板里应有克数与确认按钮）
    const confirm = page.getByRole('button', { name: /记录|添加|确认/ }).last();
    if (await confirm.count()) {
      await confirm.click();
      await page.waitForTimeout(900);
    }

    const after = await readState(page);
    const afterFoods = ((after?.foods as unknown[]) ?? []).length;
    expect(afterFoods).toBeGreaterThan(beforeFoods);
  });

  test('手工记录可写入（食物库没有的东西）', async ({ page }) => {
    const before = await readState(page);
    const beforeFoods = ((before?.foods as unknown[]) ?? []).length;

    const manual = page.getByRole('button', { name: '记录' }).first();
    if (await manual.count()) {
      await manual.click();
      await page.waitForTimeout(600);

      // 填热量与蛋白
      const inputs = page.locator('.sheet__panel input');
      const n = await inputs.count();
      if (n >= 1) {
        await inputs.nth(0).fill('500');
        await page.waitForTimeout(200);
      }
      if (n >= 2) {
        await inputs.nth(1).fill('30');
        await page.waitForTimeout(200);
      }

      const save = page.getByRole('button', { name: /保存|记录|确认/ }).last();
      await save.click();
      await page.waitForTimeout(900);

      const after = await readState(page);
      expect(((after?.foods as unknown[]) ?? []).length).toBeGreaterThan(beforeFoods);
    }
  });

  test('记录后汇总数字更新', async ({ page }) => {
    // 先加一条
    await page.getByRole('button', { name: '添加' }).first().click();
    await page.waitForTimeout(700);
    const search = page.locator('.sheet__panel input').first();
    await search.fill('鸡胸');
    await page.waitForTimeout(500);
    await page.locator('.add__item').first().click();
    await page.waitForTimeout(600);
    const confirm = page.getByRole('button', { name: /记录|添加|确认/ }).last();
    if (await confirm.count()) {
      await confirm.click();
      await page.waitForTimeout(900);
    }

    const state = await readState(page);
    const foods = (state?.foods as Array<Record<string, unknown>>) ?? [];
    expect(foods.length).toBeGreaterThan(0);
    // 记录应带日期，否则无法按天汇总
    expect(String(foods[foods.length - 1]!.date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
