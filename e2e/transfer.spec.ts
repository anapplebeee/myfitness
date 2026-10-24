import { expect, test } from '@playwright/test';
import { openDataPage, readState, resetApp } from './helpers';

/**
 * 导入导出 E2E。
 *
 * 重点验证两条曾经出过错的行为：
 * 1. 种子数据必须落盘，否则 datasetId 每次刷新都变，自己导出的备份会被判为"另一个数据集"；
 * 2. 非法文件必须被拒绝且不写入任何数据。
 */
test.describe('导入导出', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
    await openDataPage(page);
  });

  test('导出生成可解析的信封', async ({ page }) => {
    // 拦截 blob 下载，直接读内容
    const json = await page.evaluate(async () => {
      let captured: Blob | null = null;
      const orig = URL.createObjectURL;
      URL.createObjectURL = (b: Blob) => {
        captured = b;
        return 'blob:fake';
      };
      const btn = Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('下载备份文件'),
      ) as HTMLButtonElement | undefined;
      btn?.click();
      URL.createObjectURL = orig;
      return captured ? await (captured as Blob).text() : null;
    });

    expect(json).toBeTruthy();
    const env = JSON.parse(json as string);
    expect(env.format).toBe('tieguan-export');
    expect(env.schemaVersion).toBe(1);
    expect(env.datasetId).toMatch(/^ds_/);
    expect(env.checksum).toMatch(/^[a-f0-9-]+$/);
    expect(Array.isArray(env.records.sessions)).toBe(true);
    expect(env.records.sessions.length).toBeGreaterThan(0);
  });

  test('导出的 datasetId 与页面显示一致', async ({ page }) => {
    const state = await readState(page);
    const shown = await page.locator('.data__id').innerText();
    expect(shown).toContain(String(state?.datasetId));
  });

  test('非法文件被拒绝且不写入', async ({ page }) => {
    const before = await readState(page);
    const beforeCount = (before?.sessions as unknown[]).length;

    await page.setInputFiles('input[type=file]', {
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from('this is not json'),
    });
    await page.waitForTimeout(900);

    await expect(page.locator('.issues--bad')).toBeVisible();
    await expect(page.locator('.issues--bad')).toContainText('不是合法的 JSON');

    const after = await readState(page);
    expect((after?.sessions as unknown[]).length).toBe(beforeCount);
  });

  test('合法信封导入前显示预览，不直接写入', async ({ page }) => {
    const state = await readState(page);
    const beforeCount = (state?.sessions as unknown[]).length;

    const envelope = {
      format: 'tieguan-export',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      datasetId: state?.datasetId,
      dataset: { createdAt: state?.createdAt, appStateVersion: 2, accountingTimezone: 'Asia/Shanghai' },
      records: {
        profile: state?.profile,
        sessions: [],
        weights: [],
        foods: [],
        occurrences: [],
        weekGoals: [],
        customTemplates: [],
        activeTemplateId: state?.activeTemplateId,
        activeTemplateSince: state?.activeTemplateSince,
        bodyGoalGrams: null,
        targetKcal: null,
        targetProtein: null,
        weeklyGoal: 3,
      },
      contentRefs: [],
    };

    await page.setInputFiles('input[type=file]', {
      name: 'ok.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(envelope)),
    });
    await page.waitForTimeout(900);

    // 预览出现，但数据尚未变化（需要用户确认）
    await expect(page.locator('.preview')).toBeVisible();
    await expect(page.locator('.seg__item', { hasText: '合并' })).toBeVisible();
    await expect(page.locator('.seg__item', { hasText: '替换' })).toBeVisible();

    const mid = await readState(page);
    expect((mid?.sessions as unknown[]).length).toBe(beforeCount);
  });

  test('清空本机需要二次确认', async ({ page }) => {
    await page.getByRole('button', { name: '清空本机数据' }).click();
    await page.waitForTimeout(400);
    await expect(page.locator('.sheet__panel')).toBeVisible();
    await expect(page.getByText('确定删除本机数据？')).toBeVisible();
    // 取消后数据不变
    await page.getByRole('button', { name: '取消' }).click();
    await page.waitForTimeout(300);
    const state = await readState(page);
    expect((state?.sessions as unknown[]).length).toBeGreaterThan(0);
  });
});

