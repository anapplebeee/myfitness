import { expect, test } from '@playwright/test';
import { goSeg, goTab, readState, resetApp } from './helpers';

/**
 * 本轮用户反馈的回归用例。
 *
 * 这四条都曾经"看起来能用、实际状态错乱"，必须用真实点击锁住：
 * 1. 打开面板后按返回，应该关面板而不是换页面
 * 2. 鸡蛋这类食物按个数记录
 * 3. 周目标能看整月
 * 4. 练完之后周目标立刻 +1，且同一天不能重复开练
 */
test.describe('返回键与浮层', () => {
  test('返回键先关面板，路由不变', async ({ page }) => {
    await resetApp(page);
    await goTab(page, '周目标');
    await expect(page.locator('.week')).toBeVisible();

    await page.locator('.week .day').first().click();
    await expect(page.locator('.sheet')).toBeVisible();

    const before = await page.evaluate(() => location.hash);
    await page.evaluate(() => history.back());

    await expect(page.locator('.sheet')).toHaveCount(0);
    expect(await page.evaluate(() => location.hash)).toBe(before);
    await expect(page.locator('.week')).toBeVisible();
  });

  test('两层浮层时，返回只关最上层', async ({ page }) => {
    await resetApp(page);
    // 会话详情是全屏浮层，点某一组会再叠一层编辑面板
    await goTab(page, '训练');
    await page.locator('.seg__item', { hasText: '历史' }).click();
    await page.locator('.history__btn').first().click();
    await expect(page.locator('.detail')).toBeVisible();

    await page.locator('.detail .set').first().click();
    await expect(page.locator('.sheet')).toBeVisible();

    await page.evaluate(() => history.back());
    // 编辑面板关掉，详情仍在
    await expect(page.locator('.sheet')).toHaveCount(0);
    await expect(page.locator('.detail')).toBeVisible();

    // 再返回一次才退出详情
    await page.evaluate(() => history.back());
    await expect(page.locator('.detail')).toHaveCount(0);
  });
});

test.describe('饮食按个数', () => {
  test('鸡蛋按个记录，标签写清个数与克数', async ({ page }) => {
    await resetApp(page);
    await goTab(page, '饮食');

    await page.locator('.meal .btn', { hasText: '添加' }).first().click();
    await page.locator('.add__item', { hasText: '鸡蛋' }).first().click();

    await expect(page.locator('.unitseg')).toBeVisible();
    await expect(page.locator('.unitseg .seg__item').first()).toHaveText('按个');

    // 默认 1 个 → 点 + 变成 2 个
    await page.locator('.confirm__amount .icon-btn').last().click();
    await expect(page.locator('.confirm__hint')).toContainText('2个 ≈ 100g');

    await page.getByRole('button', { name: '记录' }).click();
    await expect(page.locator('.meal__item .h3', { hasText: '鸡蛋 2个（100g）' })).toBeVisible();
  });

  test('可以切回按克录入', async ({ page }) => {
    await resetApp(page);
    await goTab(page, '饮食');
    await page.locator('.meal .btn', { hasText: '添加' }).first().click();
    await page.locator('.add__item', { hasText: '鸡蛋' }).first().click();

    await page.locator('.unitseg .seg__item', { hasText: '按克' }).click();
    await expect(page.locator('.confirm__amount .small')).toHaveText('g');
    await expect(page.locator('.confirm__hint')).toHaveCount(0);
  });
});

test.describe('月历', () => {
  test('训练历史里有整月日历', async ({ page }) => {
    await resetApp(page);
    await goTab(page, '训练');
    await goSeg(page, '历史');

    await expect(page.locator('.mcal')).toBeVisible();
    const cells = await page.locator('.mcal__cell').count();
    expect(cells % 7).toBe(0);
    expect(cells).toBeGreaterThanOrEqual(28);

    // 点某天：有记录就打开记录，没记录给出提示（都不应该无反应）
    await page.locator('.mcal__cell').nth(10).click();
    await page.waitForTimeout(400);
    const opened = await page.locator('.detail').count();
    const toast = await page.locator('.toast').count();
    expect(opened + toast).toBeGreaterThan(0);
  });
});

test.describe('训练完成与周目标联动', () => {
  test('结束训练后周目标 +1，当天不能重复开练', async ({ page }) => {
    await resetApp(page);

    await goTab(page, '周目标');
    const beforeText = (await page.locator('.goalcard__value').innerText()).replace(/\s/g, '');
    const before = Number(beforeText.split('/')[0]);
    expect(Number.isFinite(before)).toBe(true);

    // 从"今天"的那张训练日卡片开始，保证会话绑定到今天的计划项
    await goTab(page, '训练');
    const todayCard = page.locator('.day', { has: page.locator('.chip', { hasText: '今天' }) });
    test.skip((await todayCard.count()) === 0, '今天没有计划项（休息日），跳过联动用例');
    await todayCard.first().click();

    const inputs = page.locator('.set__input');
    await expect(inputs.first()).toBeVisible({ timeout: 10_000 });
    await inputs.first().fill('100');
    await page.locator('.set__input').nth(1).fill('5');
    await page.locator('.set__check').first().click();
    await page.waitForTimeout(500);

    await page.locator('.live__finish').click();
    /*
     * 只完成 1 组属于"部分完成"，按新契约默认不勾"计入周目标"。
     * 这条用例验证的是"用户显式确认后周目标 +1"，所以这里主动勾上；
     * 默认不勾的行为由同文件的"部分完成"用例单独覆盖。
     */
    const credit = page.locator('.credit__box');
    if (!(await credit.isChecked())) await credit.check();
    await expect(credit).toBeChecked();
    await page.getByRole('button', { name: '确认结束' }).click();
    await page.waitForTimeout(800);

    // 训练页当天卡片变成已完成
    await goTab(page, '训练');
    const doneCard = page.locator('.day', { has: page.locator('.chip', { hasText: '已完成' }) });
    await expect(doneCard.first()).toBeVisible();

    // 周目标确实 +1
    await goTab(page, '周目标');
    const afterText = (await page.locator('.goalcard__value').innerText()).replace(/\s/g, '');
    const after = Number(afterText.split('/')[0]);
    expect(after).toBe(before + 1);

    // 再点已完成的那张卡，打开的是记录，而不是又开一场
    await goTab(page, '训练');
    await doneCard.first().click();
    await expect(page.locator('.detail')).toBeVisible();
    await expect(page.locator('.live')).toHaveCount(0);
    // 记录里能看到"已计入"以及对应的计划项
    await expect(page.locator('.creditcard')).toContainText('已计入');
  });
});

/**
 * 第二轮 PM 评审（2026-10-27）的 P0 回归。
 */
test.describe('记录可信度', () => {
  test('补录后立刻能在历史里看到', async ({ page }) => {
    await resetApp(page);
    await goTab(page, '训练');
    await goSeg(page, '历史');

    const beforeText = await page.locator('.history__summary .stat__value').first().innerText();
    const before = Number(beforeText.replace(/[^\d]/g, ''));

    await page.getByRole('button', { name: '补录' }).click();
    await expect(page.locator('.sheet')).toBeVisible();
    await page.locator('.sheet input[type=date]').fill('2026-10-25');
    await page.locator('.sheet input[placeholder="3"]').fill('3');
    await page.locator('.sheet input[placeholder="8"]').fill('8');
    await page.locator('.sheet input[placeholder="选填"]').fill('60');
    await page.locator('.sheet .pick-grid .chip', { hasText: '杠铃深蹲' }).first().click();
    await page.getByRole('button', { name: '保存补录' }).click();
    await page.waitForTimeout(1000);

    const state = await readState(page);
    const sessions = (state?.sessions as Array<Record<string, unknown>>) ?? [];
    expect(sessions.length).toBeGreaterThan(0);

    await goSeg(page, '历史');
    const afterText = await page.locator('.history__summary .stat__value').first().innerText();
    const after = Number(afterText.replace(/[^\d]/g, ''));
    expect(after).toBe(before + 1);
    await expect(page.locator('.history__list')).toContainText('补录训练');
  });

  test('只完成少量组不算练完，且默认不计入周目标', async ({ page }) => {
    await resetApp(page);
    await goTab(page, '周目标');
    const beforeText = (await page.locator('.goalcard__value').innerText()).replace(/\s/g, '');
    const before = Number(beforeText.split('/')[0]);

    await goTab(page, '训练');
    const todayCard = page.locator('.day', { has: page.locator('.chip', { hasText: '今天' }) });
    await todayCard.first().click();
    await page.waitForTimeout(1200);

    // 只完成一组
    await page.locator('.set__input').first().fill('100');
    await page.locator('.set__input').nth(1).fill('5');
    await page.locator('.set__check').first().click();
    await page.waitForTimeout(600);

    await page.locator('.live__finish').click();
    await page.waitForTimeout(600);
    // 部分完成：默认不勾"计入周目标"
    await expect(page.locator('.credit__box')).not.toBeChecked();
    await expect(page.locator('.sheet__panel')).toContainText('默认不计入周目标');
    await page.getByRole('button', { name: '确认结束' }).click();
    await page.waitForTimeout(1200);

    await goTab(page, '今日');
    await expect(page.locator('.hero__title')).toContainText('一半');

    await goTab(page, '周目标');
    const afterText = (await page.locator('.goalcard__value').innerText()).replace(/\s/g, '');
    expect(Number(afterText.split('/')[0])).toBe(before);
  });

  test('放弃训练需要二次确认', async ({ page }) => {
    await resetApp(page);
    await goTab(page, '训练');
    const todayCard = page.locator('.day', { has: page.locator('.chip', { hasText: '今天' }) });
    await todayCard.first().click();
    await page.waitForTimeout(1200);

    await page.getByRole('button', { name: '放弃' }).click();
    await expect(page.locator('.sheet__panel')).toContainText('丢掉这场训练');
    await page.getByRole('button', { name: '继续练' }).click();
    await page.waitForTimeout(400);
    // 仍在训练页，没有丢
    await expect(page.locator('.live')).toBeVisible();

    await page.getByRole('button', { name: '放弃' }).click();
    await page.getByRole('button', { name: '确认放弃' }).click();
    await page.waitForTimeout(800);
    await expect(page.locator('.live')).toHaveCount(0);
  });
});
