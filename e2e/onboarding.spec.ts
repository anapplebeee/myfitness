import { expect, test } from '@playwright/test';
import { completeOnboardingViaUi, expectReady, readState } from './helpers';

/**
 * 首次引导 E2E。
 *
 * 针对产品评审 §2.3 指出的问题：新用户打开就看到 42 场示例训练，
 * 会误以为是自己的数据。引导必须显式说明这一点。
 *
 * 注意这些用例**不能**调用 resetApp()，因为它会跳过引导。
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
}

test.describe('首次引导', () => {
  test('新用户会看到引导，而不是直接看到示例训练', async ({ page }) => {
    await freshStart(page);
    await expect(page.locator('.onb')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('你现在看到的是示例数据')).toBeVisible();
  });

  test('第一步明确说明种子数据不是用户自己的', async ({ page }) => {
    await freshStart(page);
    const text = await page.locator('.onb__demo').innerText();
    expect(text).toContain('示例数据');
    expect(text).toContain('不是你的数据');
  });

  test('可以选模板并设每周目标', async ({ page }) => {
    await freshStart(page);
    await completeOnboardingViaUi(page, { weeklyGoal: 4 });

    const state = await readState(page);
    expect(state?.onboarded).toBe(true);
    expect(state?.weeklyGoal).toBe(4);
    expect(state?.activeTemplateId).toBeTruthy();
  });

  test('取消保留示例数据后记录被清空', async ({ page }) => {
    await freshStart(page);
    await page.getByRole('button', { name: '知道了，下一步' }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '下一步' }).click();
    await page.waitForTimeout(300);

    const cb = page.locator('.onb__check');
    if (await cb.isChecked()) await cb.uncheck();
    await page.getByRole('button', { name: '开始使用' }).click();
    await expectReady(page);

    const state = await readState(page);
    expect((state?.sessions as unknown[]).length).toBe(0);
    expect((state?.weights as unknown[]).length).toBe(0);
    // datasetId 必须保留，否则同步会当成新数据集
    expect(String(state?.datasetId)).toMatch(/^ds_/);
  });

  test('默认保留示例数据（清空不是默认选项）', async ({ page }) => {
    await freshStart(page);
    // 什么都不改，直接走完
    await completeOnboardingViaUi(page, { weeklyGoal: 3 });

    const state = await readState(page);
    expect((state?.sessions as unknown[]).length).toBeGreaterThan(0);
    expect(state?.onboarded).toBe(true);
  });

  test('引导完成后不再出现', async ({ page }) => {
    await freshStart(page);
    await completeOnboardingViaUi(page);
    await page.reload();
    await expectReady(page);
    expect(await page.locator('.onb').count()).toBe(0);
  });
});

