import { expect, type Page } from '@playwright/test';

/**
 * 测试辅助。
 *
 * 每个用例都从**干净存储**开始：清 IndexedDB + localStorage 后重载。
 * 种子数据会在首次加载时写入，因此 datasetId 每次不同——测试不应依赖它。
 */
export async function resetApp(page: Page): Promise<void> {
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
  await expectReady(page);
  await skipOnboarding(page);
}

/**
 * 跳过首次引导。
 *
 * 引导是真实产品行为，但 E2E 关注的是引导之后的主路径；
 * 直接写入 onboarded 状态比点击三步更快也更稳定。
 * 需要测引导本身的用例，用 completeOnboardingViaUi()。
 */
export async function skipOnboarding(page: Page): Promise<void> {
  const onb = page.locator('.onb');
  if (await onb.count()) {
    await page.evaluate(async () => {
      const raw = localStorage.getItem('lianji.v2.state');
      if (!raw) return;
      const state = JSON.parse(raw) as Record<string, unknown>;
      state.onboarded = true;
      localStorage.setItem('lianji.v2.state', JSON.stringify(state));
      // IDB已真实启用，测试前置状态必须更新两个副本，不能只改回退存储。
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('lianji', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('state', 'readwrite');
          tx.objectStore('state').put(state, 'app');
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
        };
        req.onerror = () => reject(req.error);
      });
    });
    await page.reload();
    await expectReady(page);
  }
}

/** 通过界面走完引导（测引导本身时用）。 */
export async function completeOnboardingViaUi(
  page: Page,
  opts: { weeklyGoal?: number; keepDemo?: boolean } = {},
): Promise<void> {
  await expect(page.locator('.onb')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: '知道了，下一步' }).click();
  await page.waitForTimeout(300);

  /*
   * 第二步是「每周练几次」，它同时决定用哪套计划——
   * 引导里不再单独问「选哪套模板」。
   */
  if (opts.weeklyGoal) {
    await page.locator('.onb__goal', { hasText: new RegExp(`^${opts.weeklyGoal}\\s*次/周$`) }).first().click();
  }
  if (opts.keepDemo === false) {
    // 示例数据是两张选择卡：点"从空白开始"即清空
    await page.locator('.onb__choice', { hasText: '从空白开始' }).click();
  }

  await page.getByRole('button', { name: '下一步' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '开始使用' }).click();
  await expectReady(page);
}

/** 等待应用真正可用（不是仅 DOM 加载）。 */
export async function expectReady(page: Page): Promise<void> {
  await page.waitForSelector('.tabbar', { timeout: 15_000 });
  // 种子数据异步落盘，等它稳定再断言
  await page.waitForTimeout(400);
}

/** 切换底部标签。 */
export async function goTab(page: Page, label: string): Promise<void> {
  await page.locator('.tabbar button', { hasText: label }).first().click();
  await page.waitForTimeout(350);
}

/** 切换页内分段控件（如 计划/动作库/历史）。 */
export async function goSeg(page: Page, label: string): Promise<void> {
  await page.locator('.seg__item', { hasText: label }).first().click();
  await page.waitForTimeout(300);
}

/** 读取 localStorage 中的应用状态快照。 */
export async function readState(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('lianji.v2.state');
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  });
}

/**
 * 打开数据管理页（导出/导入/同步/清空）。
 *
 * 注意：DataView 是一个独立路由，不是"我的"里的分段。
 * 需要先切到"数据"分段，再点"导出、导入与备份"按钮。
 */
export async function openDataPage(page: Page): Promise<void> {
  await goTab(page, '我的');
  await goSeg(page, '数据');
  await page.getByRole('button', { name: '导出、导入与备份' }).click();
  await page.waitForTimeout(500);
  await expectDataPage(page);
}

export async function expectDataPage(page: Page): Promise<void> {
  await page.waitForSelector('.data__count', { timeout: 10_000 });
}




