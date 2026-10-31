/**
 * 真机验收：只验"只有在设备上才会暴露"的行为。
 *
 * 为什么不能只靠 CI：CI 跑的是桌面 Chromium + vite preview。
 * 真机不一样的地方：WebView 内核、安全区、触摸、系统通知、
 * 以及"这个 APK 里到底打进了哪一版前端"。
 *
 * 驱动方式：HyperOS 拒绝 adb shell input（INJECT_EVENTS），
 * uiautomator 也看不到 WebView 内部 DOM（整个应用是一个节点），
 * 所以只能走 CDP：
 *   adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>
 *   playwright chromium.connectOverCDP('http://127.0.0.1:9333')
 *
 * 用法：node scripts/android-accept.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PORT = Number(process.env.ANDROID_CDP_PORT ?? 9333);
const root = process.cwd();
const shotDir = join(root, 'shots', 'android-accept');
mkdirSync(shotDir, { recursive: true });

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

function adb(...args) {
  return execFileSync('adb', args, { encoding: 'utf8' }).trim();
}

async function main() {
  /*
   * 先重启应用再连。
   * WebView 的 devtools socket 名带进程号，进程一换旧 forward 就失效；
   * 上一次运行留下的连接也会占住 socket，导致 connectOverCDP 超时。
   */
  adb('shell', 'am', 'force-stop', 'app.lianji.fit');
  await new Promise((r) => setTimeout(r, 800));
  adb('shell', 'monkey', '-p', 'app.lianji.fit', '-c', 'android.intent.category.LAUNCHER', '1');
  await new Promise((r) => setTimeout(r, 4000));

  const appPid = adb('shell', 'pidof', 'app.lianji.fit');
  if (!appPid) throw new Error('应用没在运行，先启动它');
  try {
    adb('forward', '--remove-all');
  } catch {
    /* 没有可删的 forward */
  }
  adb('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${appPid}`);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] ?? (await ctx.waitForEvent('page'));
  await page.waitForTimeout(1200);

  /*
   * 截图走 adb screencap，不用 page.screenshot：
   * Android WebView 通过 CDP 截图会卡在 "waiting for fonts to load" 直到超时。
   */
  const shot = async (name) => {
    try {
      const png = execFileSync('adb', ['exec-out', 'screencap', '-p'], { encoding: 'buffer' });
      writeFileSync(join(shotDir, `${name}.png`), png);
    } catch {
      /* 截图失败不影响验收结论 */
    }
  };

  // ---------- A. 引导 ----------
  /*
   * 引导可能停在任意一步（脚本可能被上一次运行中断）。
   * 逐屏推进，不假设"一定在第一步"。
   */
  /*
   * 引导可能停在任意一步（脚本可能被上一次运行中断）。
   * 逐屏推进，不假设"一定在第一步"。
   */
  const hasOnb = await page.locator('.onb').count();
  record('启动后处于引导流程', hasOnb > 0, hasOnb ? '' : '已跳过（非首次安装）');
  for (let step = 0; step < 5; step += 1) {
    if ((await page.locator('.onb').count()) === 0) break;
    if (await page.getByRole('button', { name: '开始使用' }).count()) {
      await page.getByRole('button', { name: '开始使用' }).click();
      break;
    }
    if (await page.getByRole('button', { name: /知道了/ }).count()) {
      await page.getByRole('button', { name: /知道了/ }).click();
    } else if (await page.getByRole('button', { name: '下一步' }).count()) {
      await page.getByRole('button', { name: '下一步' }).click();
    } else {
      break;
    }
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1800);
  record('引导可走完', (await page.locator('.onb').count()) === 0);

  // ---------- B. 今日页 ----------
  await shot('02-today');
  const heroText = await page.locator('.hero').innerText().catch(() => '');
  record('今日页 hero 有内容', heroText.length > 4, heroText.split('\n')[0] ?? '');
  const tabbar = await page.locator('.tabbar').isVisible().catch(() => false);
  record('底部标签栏可见', tabbar);

  // ---------- C. 进入录制页 ----------
  const startBtn = page.getByRole('button', { name: /开始训练|自由训练/ }).first();
  const canStart = await startBtn.count();
  if (canStart) {
    await startBtn.click();
  } else {
    await page.locator('.day').first().click();
  }
  await page.waitForTimeout(2000);
  const inLive = await page.locator('.live').count();
  record('可进入录制页', inLive > 0);
  await shot('03-live');

  // ---------- D. 热身组 ----------
  const warmCount = await page.locator('.set--warmup').count();
  record('杠铃动作前有热身组', warmCount > 0, `${warmCount} 组`);

  // ---------- E. 杠铃片提示 ----------
  const plates = await page.locator('.live__plates').count();
  const plateText = plates ? (await page.locator('.live__plates').first().innerText()).trim() : '';
  record('显示每边杠铃片', plates > 0 && plateText.includes('每边'), plateText);

  // ---------- F. 工作组编号从 1 开始 ----------
  const firstWorkIdx = await page
    .locator('.set:not(.set--warmup) .set__idx')
    .first()
    .innerText()
    .catch(() => '');
  record('工作组编号从 1 开始', firstWorkIdx.trim() === '1', `实际「${firstWorkIdx.trim()}」`);
  await shot('04-warmup-and-plates');

  // ---------- G. 完成一组 → 休息计时 ----------
  const inputs = page.locator('.set:not(.set--warmup) .set__input');
  if ((await inputs.count()) >= 2) {
    await inputs.nth(0).fill('60');
    await inputs.nth(1).fill('8');
    await page.locator('.set:not(.set--warmup) .set__check').first().click();
    await page.waitForTimeout(1500);
  }
  const restVisible = await page.locator('.rest, .rest__time, [class*="rest"]').count();
  record('完成后出现休息计时', restVisible > 0);
  await shot('05-rest-timer');

  // ---------- H. 通知是否真的排进去了 ----------
  let notifLine = '';
  try {
    const dumpsys = adb('shell', 'dumpsys', 'notification', '--noredact');
    notifLine = (dumpsys.match(/app\.lianji\.fit[^\n]*/g) ?? []).slice(0, 1).join('');
  } catch {
    /* 某些 ROM 不给 dumpsys notification 权限 */
  }
  record(
    '系统里存在本应用的待触发通知',
    notifLine.length > 0,
    notifLine ? notifLine.slice(0, 80) : '未查到（可能已到点或权限限制）',
  );

  // ---------- I. 深色模式 ----------
  await page.evaluate(() => {
    localStorage.setItem('lianji.theme', 'dark');
  });
  await page.reload();
  await page.waitForTimeout(1800);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const rgb = (bg.match(/\d+/g) ?? []).map(Number);
  const isDark = rgb.length >= 3 && rgb[0] < 60 && rgb[1] < 60 && rgb[2] < 60;
  record('深色模式生效（body 背景变深）', isDark, bg);
  // 进度条填充在深色下不该与卡片同色
  const barFill = await page.evaluate(() => {
    const el = document.querySelector('.bar__fill');
    return el ? getComputedStyle(el).backgroundColor : '';
  });
  record('深色下进度条填充有颜色', Boolean(barFill) && barFill !== 'rgba(0, 0, 0, 0)', barFill);
  await shot('06-dark');

  // 还原浅色
  await page.evaluate(() => localStorage.setItem('lianji.theme', 'light'));
  await page.reload();
  await page.waitForTimeout(1500);

  // ---------- J. 动作双帧 ----------
  await page.locator('.tabbar').getByRole('button', { name: '训练' }).click();
  await page.waitForTimeout(800);
  await page.locator('.seg__item', { hasText: '动作库' }).click();
  await page.waitForTimeout(600);
  await page.locator('.picker__item, .lib__item, .day').first().click().catch(() => {});
  await page.waitForTimeout(800);
  const demoBtn = page.getByRole('button', { name: '要领' }).first();
  let framesChanged = false;
  if (await demoBtn.count()) {
    await demoBtn.click();
    await page.waitForTimeout(800);
    const src1 = await page.locator('.demo__figure img').getAttribute('src');
    await page.waitForTimeout(1100);
    const src2 = await page.locator('.demo__figure img').getAttribute('src');
    framesChanged = Boolean(src1 && src2 && src1 !== src2);
    record('动作示意图两帧在切换', framesChanged, framesChanged ? '已切换' : `${src1} → ${src2}`);
    await shot('07-demo-frames');
    await page.locator('.sheet__close, [aria-label="关闭"]').first().click().catch(() => {});
  } else {
    record('动作示意图两帧在切换', false, '没找到「要领」按钮');
  }

  // ---------- K. 教练页周报 / 肌群分布 ----------
  await page.locator('.tabbar').getByRole('button', { name: '教练' }).click();
  await page.waitForTimeout(900);
  const report = await page.locator('.wr').count();
  const muscle = await page.locator('.mb').count();
  record('教练页有本周小结', report > 0);
  record('教练页有部位分布', muscle > 0);
  await shot('08-coach');

  // ---------- 崩溃检测 ----------
  let crash = '';
  try {
    const log = adb('logcat', '-d', '-t', '300');
    crash = (log.match(/FATAL EXCEPTION[\s\S]{0,200}/) ?? [''])[0];
  } catch {
    /* ignore */
  }
  record('无崩溃日志', crash.length === 0, crash.slice(0, 100));

  await browser.close();

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n合计 ${pass}/${results.length} 通过`);
  console.log(`截图：shots/android-accept/`);
  if (pass !== results.length) process.exitCode = 1;
}

await main();

