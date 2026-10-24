import { expect, test } from '@playwright/test';
import { completeOnboardingViaUi, expectReady, goSeg, goTab } from './helpers';

/**
 * 空状态 E2E。
 *
 * 针对产品评审 §4.1：没有记录时显示 "0 kg"、"0 次"、空列表，
 * 会让用户以为应用是坏的。空状态应给出下一步而不是数字。
 *
 * 这些用例需要"无数据"状态，所以不能调用 resetApp()。
 */
async function emptyStart(page: import('@playwright/test').Page): Promise<void> {
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
  await page.waitForSelector('.onb', { timeout: 10_000 });
  // 走引导并清空示例数据
  await page.getByRole('button', { name: '知道了，下一步' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '下一步' }).click();
  await page.waitForTimeout(300);
  const cb = page.locator('.onb__check');
  if (await cb.isChecked()) await cb.uncheck();
  await page.getByRole('button', { name: '开始使用' }).click();
  await expectReady(page);
}

test.describe('空状态', () => {
  test('教练页无记录时不显示 0 kg，给出引导', async ({ page }) => {
    await emptyStart(page);
    await goTab(page, '教练');

    await expect(page.locator('.coach__blank')).toBeVisible();
    await expect(page.getByText('还没有可比较的记录')).toBeVisible();

    // 关键：不应出现 0 kg 这种会让人以为坏了的数字
    const body = await page.locator('.coach').innerText();
    expect(body).not.toContain('0 kg');
    expect(body).not.toContain('0 场训练');
  });

  test('教练页空状态的按钮能跳到今日页', async ({ page }) => {
    await emptyStart(page);
    await goTab(page, '教练');
    await page.getByRole('button', { name: '去记第一组' }).click();
    await page.waitForTimeout(600);
    await expect(page.locator('.today')).toBeVisible();
  });

  test('历史页无记录时不显示 0 次与空列表', async ({ page }) => {
    await emptyStart(page);
    await goTab(page, '训练');
    await goSeg(page, '历史');

    await expect(page.locator('.history__blank')).toBeVisible();
    await expect(page.getByText('还没有训练记录')).toBeVisible();

    const body = await page.locator('.train').innerText();
    expect(body).not.toContain('0 次');
    expect(body).not.toContain('总容量');
  });

  test('历史页空状态的按钮能回到计划页', async ({ page }) => {
    await emptyStart(page);
    await goTab(page, '训练');
    await goSeg(page, '历史');
    await page.getByRole('button', { name: '去计划页开始' }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('.seg__item.is-on', { hasText: '计划' })).toBeVisible();
  });

  test('有数据时正常显示统计（空状态不误伤）', async ({ page }) => {
    // 保留示例数据走一遍引导
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
    await page.waitForSelector('.onb', { timeout: 10_000 });
    await completeOnboardingViaUi(page);

    await goTab(page, '教练');
    await expect(page.locator('.coach__blank')).toHaveCount(0);
    await expect(page.locator('.coach__hero')).toBeVisible();
  });
});
