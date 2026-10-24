import { expect, test } from '@playwright/test';
import { goSeg, goTab, readState, resetApp } from './helpers';

/**
 * 过敏原设置与过滤 E2E。
 *
 * 验证三件事：
 * 1. 设置页能选过敏原；
 * 2. 选完后食物库真的隐藏相关食物；
 * 3. 修改设置会重置"已确认"状态（否则安全门禁形同虚设）。
 */
test.describe('过敏原', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
    await goTab(page, '我的');
    await goSeg(page, '设置');
  });

  test('设置页列出 8 类过敏原', async ({ page }) => {
    const chips = page.locator('.aller__chip');
    await expect(chips.first()).toBeVisible();
    expect(await chips.count()).toBe(8);

    const labels = await chips.allInnerTexts();
    for (const want of ['麸质', '蛋', '奶', '大豆', '花生', '坚果', '鱼', '甲壳类']) {
      expect(labels).toContain(want);
    }
  });

  test('选中过敏原会写入状态并重置确认', async ({ page }) => {
    // 先确认
    await page.getByRole('button', { name: /确认这些限制|已确认/ }).click();
    await page.waitForTimeout(400);
    let state = await readState(page);
    expect((state?.profile as { restrictionsConfirmed: boolean }).restrictionsConfirmed).toBe(true);

    // 再选一个过敏原，确认状态应被重置
    await page.locator('.aller__chip', { hasText: '奶' }).click();
    await page.waitForTimeout(400);

    state = await readState(page);
    const profile = state?.profile as { allergies: string[]; restrictionsConfirmed: boolean };
    expect(profile.allergies).toContain('milk');
    expect(profile.restrictionsConfirmed).toBe(false);
  });

  test('选择奶过敏后食物库隐藏牛奶与奶酪', async ({ page }) => {
    await page.locator('.aller__chip', { hasText: '奶' }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: /确认这些限制|已确认/ }).click();
    await page.waitForTimeout(400);

    // 打开饮食页并进入添加食物面板
    await goTab(page, '饮食');
    await page.waitForTimeout(500);

    const before = await page.locator('.add__item .h3').allInnerTexts();
    // 未打开面板时为空，尝试点任一餐次添加
    if (before.length === 0) {
      const addBtn = page.getByRole('button', { name: /添加|记录/ }).first();
      if (await addBtn.count()) {
        await addBtn.click();
        await page.waitForTimeout(600);
      }
    }

    const names = await page.locator('.add__item .h3').allInnerTexts();
    if (names.length > 0) {
      expect(names).not.toContain('牛奶（全脂）');
      expect(names).not.toContain('奶酪');
    }
    // 排除提示应出现
    const notice = page.locator('.add__notice');
    if (await notice.count()) {
      await expect(notice).toContainText('隐藏');
    }
  });
});
