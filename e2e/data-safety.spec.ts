import { expect, test, type Page } from '@playwright/test';
import { goSeg, goTab, openDataPage, readState, resetApp } from './helpers';

async function idbState(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('lianji', 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const get = db.transaction('state', 'readonly').objectStore('state').get('app');
      get.onsuccess = () => { db.close(); resolve(get.result as Record<string, unknown> ?? null); };
      get.onerror = () => { db.close(); reject(get.error); };
    };
  }));
}

test('保存真实写入IndexedDB，移除LS副本后仍能恢复', async ({ page }) => {
  await resetApp(page);
  const before = await readState(page);
  expect((await idbState(page))?.datasetId).toBe(before?.datasetId);
  await page.evaluate(() => localStorage.removeItem('lianji.v2.state'));
  await page.reload();
  await expect(page.locator('.tabbar')).toBeVisible();
  expect((await idbState(page))?.datasetId).toBe(before?.datasetId);
  await expect(page.locator('.onb')).toHaveCount(0);
});

test('双存储写失败时录组不报成功，输入保留并可重试', async ({ page }) => {
  await resetApp(page);
  // 从今日页直接开始：训练页点过去的日卡片会先弹"补做/加练"，那是另一条路径
  await page.getByRole('button', { name: '开始训练' }).click();
  await expect(page.locator('.set__input').first()).toBeVisible({ timeout: 10_000 });
  await page.locator('.set__input').nth(0).fill('100');
  await page.locator('.set__input').nth(1).fill('5');
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    const tx = IDBDatabase.prototype.transaction;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'lianji.v2.state') throw new DOMException('full', 'QuotaExceededError');
      return set.call(this, key, value);
    };
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof tx>) {
      if (args[1] === 'readwrite') throw new DOMException('full', 'QuotaExceededError');
      return tx.apply(this, args);
    };
    Object.defineProperty(window, '__restorePersistence', { configurable: true, value: () => {
      Storage.prototype.setItem = set; IDBDatabase.prototype.transaction = tx;
    } });
  });
  await page.locator('.set__check').first().click();
  await expect(page.locator('.save-error')).toContainText('保存失败');
  await expect(page.locator('.set__input').first()).toHaveValue('100');
  await expect(page.locator('.toast', { hasText: '已保存本组' })).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { __restorePersistence: () => void }).__restorePersistence());
  await page.locator('.set__check').first().click();
  await expect(page.locator('.toast', { hasText: '已保存本组' })).toBeVisible();
  const stored = await idbState(page);
  const sessions = stored?.sessions as { status: string; exercises: { sets: { status: string; loadGrams: number }[] }[] }[];
  expect(sessions.find(s => s.status === 'active')?.exercises[0]?.sets[0]?.loadGrams).toBe(100000);
});

test('未来版本启动阻塞，原始记录不被种子覆盖', async ({ page }) => {
  await resetApp(page);
  const raw = await page.evaluate(async () => {
    const state = JSON.parse(localStorage.getItem('lianji.v2.state')!) as Record<string, unknown>;
    state.version = 999;
    const value = JSON.stringify(state);
    localStorage.setItem('lianji.v2.state', value);
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('lianji', 1);
      req.onsuccess = () => {
        const db = req.result, tx = db.transaction('state', 'readwrite');
        tx.objectStore('state').put(state, 'app');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
    return value;
  });
  await page.reload();
  await expect(page.locator('.boot-error')).toContainText('不支持的版本');
  await expect(page.locator('.tabbar')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('lianji.v2.state'))).toBe(raw);
  expect((await idbState(page))?.version).toBe(999);
});

async function configureSync(page: Page): Promise<void> {
  await openDataPage(page);
  await page.locator('.syn input').nth(0).fill('http://sync.test');
  await page.locator('.syn input').nth(1).fill('test-token');
}

test('首次连接已有远端必须选择，确认之前不覆盖本地', async ({ page }) => {
  await resetApp(page);
  const original = await readState(page);
  const keys = ['profile', 'sessions', 'weights', 'foods', 'occurrences', 'weekGoals', 'customTemplates',
    'bodyGoalGrams', 'targetKcal', 'targetProtein', 'weeklyGoal', 'activeTemplateId', 'activeTemplateSince'];
  const records = Object.fromEntries(keys.map(k => [k, original?.[k]]));
  records.profile = { ...records.profile as Record<string, unknown>, name: '远端选择后的名字' };
  const remote = { schemaVersion: 1, ruleVersion: 1, datasetId: original?.datasetId,
    createdAt: original?.createdAt, accountingTimezone: 'Asia/Shanghai', records };
  let puts = 0;
  await page.route('http://sync.test/api/**', async route => {
    if (route.request().method() === 'PUT') puts += 1;
    const health = route.request().url().endsWith('/health');
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { ETag: '"1"' },
      body: JSON.stringify(health ? { ok: true, apiVersion: 1 } : remote) });
  });
  await configureSync(page);
  await page.getByRole('button', { name: '立即同步' }).click();
  await expect(page.locator('.syn__conflict')).toBeVisible();
  expect((await readState(page))?.profile).toEqual(original?.profile);
  expect(puts).toBe(0);
  await page.getByRole('button', { name: '保留远端', exact: true }).click();
  await expect(page.locator('.syn__msg')).toContainText('已用远端版本');
  expect(((await idbState(page))?.profile as { name: string }).name).toBe('远端选择后的名字');
});

test('已同步远端被删除后不复活，只有独立确认才可重建', async ({ page }) => {
  await resetApp(page);
  await page.evaluate(() => localStorage.setItem('lianji.sync.state', JSON.stringify({
    generation: 3, ackedGeneration: 3, remoteRevision: 7, lastSyncedHash: 'known-baseline', serviceEndpoint: 'http://sync.test',
  })));
  let puts = 0;
  await page.route('http://sync.test/api/**', async route => {
    const health = route.request().url().endsWith('/health');
    if (route.request().method() === 'PUT') {
      puts += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revision: 1 }) });
    } else await route.fulfill({ status: health ? 200 : 404, contentType: 'application/json',
      body: JSON.stringify(health ? { ok: true, apiVersion: 1 } : { error: { code: 'DATASET_EMPTY' } }) });
  });
  await configureSync(page);
  await page.getByRole('button', { name: '立即同步' }).click();
  await expect(page.locator('.syn__msg')).toContainText('已停止上传');
  expect(puts).toBe(0);
  await expect(page.getByRole('button', { name: '重新建立远端', exact: true })).toBeDisabled();
  await page.locator('.syn__cleared input').check();
  await page.getByRole('button', { name: '重新建立远端', exact: true }).click();
  await expect(page.locator('.syn__msg')).toContainText('已上传');
  expect(puts).toBe(1);
});

test('普通404不触发初始化上传', async ({ page }) => {
  await resetApp(page); let puts = 0;
  await page.route('http://sync.test/api/**', async route => {
    if (route.request().method() === 'PUT') puts += 1;
    const health = route.request().url().endsWith('/health');
    await route.fulfill({ status: health ? 200 : 404, contentType: 'application/json',
      body: JSON.stringify(health ? { ok: true, apiVersion: 1 } : { error: { code: 'NOT_FOUND' } }) });
  });
  await configureSync(page); await page.getByRole('button', { name: '立即同步' }).click();
  await expect(page.locator('.syn__msg')).toContainText('未知错误'); expect(puts).toBe(0);
});

test('编辑过的内置模板按新组数执行，复制的自建模板可启用', async ({ page }) => {
  await resetApp(page); await goTab(page, '训练');
  await page.getByRole('button', { name: '编辑', exact: true }).first().click();
  await page.locator('.editor .ex__input').first().fill('5');
  await page.getByRole('button', { name: '保存为新版本' }).click();
  await page.getByRole('button', { name: '确认保存' }).click();
  await expect(page.locator('.editor')).toHaveCount(0);
  await page.locator('.day').first().click();
  await expect(page.locator('.set__check')).toHaveCount(5);
  await page.evaluate(() => history.back());
  await expect(page.locator('.live')).toHaveCount(0);
  await page.getByRole('button', { name: '复制', exact: true }).first().click();
  await expect(page.locator('.editor')).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  const copy = page.locator('.tpl', { hasText: '副本' }).first();
  await copy.click();
  await expect(page.locator('.template__sub')).toBeVisible();
  await page.locator('.day').first().click();
  await expect(page.locator('.live')).toBeVisible();
  await expect.poll(async () => (await readState(page))?.activeTemplateId).toMatch(/^tpl_/);
});

test('上传期间新增本地变更，旧响应不能确认新generation', async ({ page }) => {
  await resetApp(page);
  let release: () => void = () => undefined;
  let entered: () => void = () => undefined;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('http://sync.test/api/**', async route => {
    if (route.request().method() === 'PUT') {
      entered(); await gate;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revision: 1 }) });
    } else {
      const health = route.request().url().endsWith('/health');
      await route.fulfill({ status: health ? 200 : 404, contentType: 'application/json',
        body: JSON.stringify(health ? { ok: true, apiVersion: 1 } : { error: { code: 'DATASET_EMPTY' } }) });
    }
  });
  await configureSync(page);
  await page.getByRole('button', { name: '立即同步' }).click();
  await waiting;
  await goTab(page, '我的'); await goSeg(page, '设置');
  // 设置段现在有两个数字输入（每周目标 + 饮水目标），必须按 max 区分
  await page.locator('.me input[type=number][max="7"]').fill('6');
  await page.locator('.me input[type=number][max="7"]').dispatchEvent('change');
  await expect.poll(async () => (await readState(page))?.weeklyGoal).toBe(6);
  release();
  await expect.poll(async () => page.evaluate(() => {
    const checkpoint = JSON.parse(localStorage.getItem('lianji.sync.state') ?? '{}') as { remoteRevision?: number };
    return checkpoint.remoteRevision;
  })).toBe(1);
  const checkpoint = await page.evaluate(() => JSON.parse(localStorage.getItem('lianji.sync.state')!) as { generation: number; ackedGeneration: number });
  expect(checkpoint.generation).toBeGreaterThan(checkpoint.ackedGeneration);
});



