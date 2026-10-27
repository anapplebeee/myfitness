import { expect, test } from '@playwright/test';
import { expectReady, goSeg, goTab, readState, resetApp } from './helpers';

/**
 * 营养目标估算的**点击级**测试。
 *
 * 为什么单独写这一组：
 *
 * `computeTargets` 有 20 多个单测，`bmr` 有 11 个，全绿；
 * 但"点一下按钮"这条路径从来没被跑过。结果是
 * profile.activity 存的是乘数（1.4），engine 却在找 1–5 的等级，
 * find 永远命中不到 —— 功能上线即报错，而所有单测都是绿的。
 *
 * 这就是接缝缺陷：零件各自有测试，零件之间的接线没有。
 * 这个文件的唯一职责就是把接线跑一遍。
 */

const FILLED_PROFILE = {
  heightCm: 176,
  sex: 'male',
  birthYear: 1996,
  activity: 1.5,
};

/** 把身体数据写全，否则估算按钮会（正确地）提示缺字段。 */
async function seedProfile(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async (profile) => {
    const raw = localStorage.getItem('lianji.v2.state');
    if (!raw) return;
    const state = JSON.parse(raw) as Record<string, unknown>;
    const p = state.profile as Record<string, unknown>;
    Object.assign(p, profile);
    localStorage.setItem('lianji.v2.state', JSON.stringify(state));
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('lianji', 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('state', 'readwrite');
        tx.objectStore('state').put(state, 'app');
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onabort = tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
      req.onerror = () => reject(req.error);
    });
  }, FILLED_PROFILE);
}

test.describe('营养目标估算', () => {
  test('点一下按钮就能算出目标并写入 state', async ({ page }) => {
    await resetApp(page);
    await seedProfile(page);
    await page.reload();
    await expectReady(page);

    await goTab(page, '我的');
    await goSeg(page, '身体');

    const btn = page.getByRole('button', { name: '按身体数据估算' });
    await expect(btn).toBeVisible();
    await btn.click();

    // 关键断言：不能出现"活动系数无效"
    await expect(page.getByText(/活动系数无效/)).toHaveCount(0);

    await expect
      .poll(async () => {
        const s = await readState(page);
        return s?.targetKcal ?? null;
      })
      .not.toBeNull();

    const state = await readState(page);
    const kcal = Number(state?.targetKcal);
    // 合理区间：BMR 约 1700，乘 1.5 得 TDEE 约 2600，减脂打个折也应在 1200 以上
    expect(kcal).toBeGreaterThan(1200);
    expect(kcal).toBeLessThan(5000);
    expect(Number(state?.targetProtein)).toBeGreaterThan(50);
  });

  test('身体数据不全时明确说缺什么，而不是报一个看不懂的错', async ({ page }) => {
    await resetApp(page);
    await page.evaluate(async () => {
      const raw = localStorage.getItem('lianji.v2.state');
      if (!raw) return;
      const state = JSON.parse(raw) as Record<string, unknown>;
      const p = state.profile as Record<string, unknown>;
      p.heightCm = null;
      p.birthYear = null;
      localStorage.setItem('lianji.v2.state', JSON.stringify(state));
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('lianji', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('state', 'readwrite');
          tx.objectStore('state').put(state, 'app');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
        req.onerror = () => reject(req.error);
      });
    });
    await page.reload();
    await expectReady(page);

    await goTab(page, '我的');
    await goSeg(page, '身体');
    await page.getByRole('button', { name: '按身体数据估算' }).click();

    await expect(page.getByText(/还缺.*身高/)).toBeVisible();
  });
});
