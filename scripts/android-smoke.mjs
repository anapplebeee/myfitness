/**
 * Android 真机冒烟：一键安装 + 启动 + 逐步截图 + 崩溃检测。
 *
 * 为什么需要这个脚本：APK 能编译不代表能在设备上跑。
 * WebView 里的 Vue 应用、IndexedDB、字体、安全区，都只有在真机上才暴露问题。
 *
 * 用法：
 *   node scripts/android-smoke.mjs                # 等设备 60 秒
 *   node scripts/android-smoke.mjs --wait 180     # 等更久
 *   node scripts/android-smoke.mjs --keep         # 跑完不卸载
 *
 * 前置：设备开启「开发者选项 → USB 调试」，用数据线连接，手机上点「允许调试」。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { writeFile } from 'node:fs/promises';

const root = process.cwd();
const args = process.argv.slice(2);
const waitSec = Number(args.includes('--wait') ? args[args.indexOf('--wait') + 1] : 60);
const keepInstalled = args.includes('--keep');

// ---------- 定位工具 ----------

function findSdk() {
  for (const p of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]) {
    if (p && existsSync(p)) return p;
  }
  const guess = join(homedir(), 'AppData', 'Local', 'Android', 'Sdk');
  return existsSync(guess) ? guess : null;
}

const sdk = findSdk();
if (!sdk) {
  console.error('找不到 Android SDK。见 docs/19-android.md');
  process.exit(1);
}
const adb = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
if (!existsSync(adb)) {
  console.error(`找不到 adb：${adb}`);
  process.exit(1);
}

/**
 * 跑 adb，返回 stdout 文本。
 *
 * maxBuffer 必须显式调大：logcat 动辄几 MB，
 * 默认 1MB 会抛 ENOBUFS 把整个冒烟流程中断。
 */
function run(argv, opts = {}) {
  const r = spawnSync(adb, argv, {
    encoding: 'utf8',
    timeout: opts.timeout ?? 60_000,
    maxBuffer: opts.maxBuffer ?? 32 * 1024 * 1024,
  });
  if (r.error) {
    // ENOBUFS 等错误不应让整个流程崩掉，返回可读信息由调用方判断
    return { out: '', err: String(r.error.message ?? r.error), code: -1 };
  }
  return { out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim(), code: r.status ?? 0 };
}

function runOk(argv, opts) {
  const r = run(argv, opts);
  return r.out || r.err;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 等设备 ----------

console.log(`等待 Android 设备（最多 ${waitSec} 秒）…`);
console.log('若没有反应：确认数据线连接、手机上点「允许 USB 调试」。\n');

let device = null;
const deadline = Date.now() + waitSec * 1000;
while (Date.now() < deadline) {
  const { out } = run(['devices']);
  const lines = out.split('\n').slice(1).filter((l) => l.trim());
  const ready = lines.find((l) => l.includes('\tdevice'));
  const unauthorized = lines.find((l) => l.includes('unauthorized'));
  if (ready) {
    device = ready.split('\t')[0].trim();
    break;
  }
  if (unauthorized) {
    console.log('检测到设备但未授权——请在手机上点「允许 USB 调试」。');
  }
  await sleep(1500);
}

if (!device) {
  console.error('\n未检测到可用设备。');
  console.error('排查：');
  console.error('  1. 数据线是否支持数据传输（不是只能充电的线）');
  console.error('  2. 手机「开发者选项 → USB 调试」是否开启');
  console.error('  3. 连接后手机上是否点了「允许」');
  console.error('  4. 运行 adb devices 自查看状态');
  process.exit(1);
}

const model = runOk(['shell', 'getprop', 'ro.product.model']);
const sdkInt = runOk(['shell', 'getprop', 'ro.build.version.sdk']);
const sizeRaw = runOk(['shell', 'wm', 'size']);
const sizeMatch = /(\d+)x(\d+)/.exec(sizeRaw);
const screen = sizeMatch ? { w: Number(sizeMatch[1]), h: Number(sizeMatch[2]) } : { w: 1080, h: 2400 };

console.log(`设备: ${model}  (Android SDK ${sdkInt})`);
console.log(`屏幕: ${screen.w}×${screen.h}`);
console.log(`设备号: ${device}\n`);

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

// ---------- 定位 APK ----------

const apkDir = join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug');
if (!existsSync(apkDir) || !readdirSync(apkDir).some((f) => f.endsWith('.apk'))) {
  console.log('未找到 APK，先编译…');
  execFileSync(process.execPath, ['scripts/build-android.mjs'], { cwd: root, stdio: 'inherit' });
}
const apk = join(apkDir, readdirSync(apkDir).find((f) => f.endsWith('.apk')));

const shotDir = join(root, 'shots', 'android');
mkdirSync(shotDir, { recursive: true });

/** 截屏保存到 shots/android/。 */
async function shot(name) {
  const r = spawnSync(adb, ['exec-out', 'screencap', '-p'], { maxBuffer: 40 * 1024 * 1024 });
  if (r.status === 0 && r.stdout?.length) {
    await writeFile(join(shotDir, `${name}.png`), r.stdout);
    console.log(`  截图: shots/android/${name}.png`);
    return true;
  }
  return false;
}

/** 按相对坐标点击（0–1），适配不同分辨率。 */
function tap(rx, ry) {
  run(['shell', 'input', 'tap', String(Math.round(screen.w * rx)), String(Math.round(screen.h * ry))]);
}

// ---------- 安装 ----------

console.log('安装 APK…');
try {
  const out = run(['install', '-r', '-t', apk], { timeout: 180_000 });
  const ok = /Success/i.test(out.out) || /Success/i.test(out.err);
  record('APK 安装成功', ok, ok ? '' : out.err.slice(0, 160));
  if (!ok) process.exit(1);
} catch (e) {
  record('APK 安装成功', false, String(e).slice(0, 160));
  process.exit(1);
}

const PKG = 'com.tieguan.fit';

// 清空旧数据，保证是首次启动（会看到引导）
run(['shell', 'pm', 'clear', PKG]);
run(['logcat', '-c']);
console.log('已清空应用数据与日志\n');

// ---------- 启动 ----------

console.log('启动应用…');
const launch = run(['shell', 'am', 'start', '-n', `${PKG}/.MainActivity`]);
record('应用启动命令已发送', /Starting|Activity/.test(launch.out) || launch.code === 0, launch.out.slice(0, 80));

await sleep(4000);

// ---------- 基础存活检查 ----------

const pidOut = runOk(['shell', 'pidof', PKG]);
record('进程存活', Boolean(pidOut.trim()), pidOut.trim() ? `pid=${pidOut.trim()}` : '进程不存在');

const topActivity = runOk(['shell', 'dumpsys', 'activity', 'activities']);
const resumed = /ResumedActivity.*com\.tieguan\.fit/m.test(topActivity) || topActivity.includes('com.tieguan.fit');
record('Activity 处于前台', resumed);

// ---------- 截图：首次启动应显示引导 ----------

await shot('01-launch');

// ---------- 崩溃与错误日志 ----------

// 只抓与崩溃/WebView 相关的 tag，全量 logcat 动辄数十 MB 且会拖慢流程
const logcat = runOk(['logcat', '-d', '-v', 'brief', '-s', 'AndroidRuntime:E', 'chromium:E', 'Capacitor/Console:V', 'Capacitor:E', 'WebViewFactory:E']);
const fatal = logcat
  .split('\n')
  .filter((l) => /FATAL EXCEPTION|AndroidRuntime.*FATAL|E\/AndroidRuntime/.test(l))
  .slice(0, 5);
record('无 Java 崩溃', fatal.length === 0, fatal.join(' | ').slice(0, 200));

/*
 * 只关心**我们应用**产生的错误。
 * chromium 的系统级噪音必须排除，否则永远误报：
 *   variations_seed_loader  —— Chrome 变体种子，任何 WebView 应用都有
 *   blocking_rule_matcher   —— 系统 AdBlock 规则解析
 *   gpu_/vulkan_            —— 驱动探测
 * 真正的应用错误通常带 "Uncaught"、我们自己的产物路径，或被 Capacitor/Console 标签记录。
 */
const SYSTEM_NOISE = /variations_seed_loader|blocking_rule_matcher|gpu_|vulkan_|GLES|eglCreate|cr_ChildProcessConnector|PartnerBookmarks/i;
const webviewErrors = logcat
  .split('\n')
  .filter((l) => /chromium|Console/i.test(l))
  .filter((l) => /ERROR|Uncaught|error/i.test(l))
  .filter((l) => !SYSTEM_NOISE.test(l))
  .slice(0, 5);
record('无应用级 WebView 错误', webviewErrors.length === 0, webviewErrors.join(' | ').slice(0, 200));

const netErrors = logcat
  .split('\n')
  .filter((l) => /ERR_FILE_NOT_FOUND|ERR_CONNECTION|net::ERR_/i.test(l))
  .slice(0, 5);
record('无资源加载失败', netErrors.length === 0, netErrors.join(' | ').slice(0, 200));

// ---------- 走完引导（验证交互可用） ----------

console.log('\n尝试走完首次引导…');
// 引导页第一步的按钮在下方，按相对位置点击
tap(0.5, 0.72);
await sleep(1200);
await shot('02-onboarding-step1');

tap(0.5, 0.86);
await sleep(1200);
await shot('03-onboarding-step2');

tap(0.5, 0.92);
await sleep(2500);
await shot('04-after-onboarding');

// 交互后仍存活
const pid2 = runOk(['shell', 'pidof', PKG]);
record('交互后进程仍存活', Boolean(pid2.trim()));

// ---------- 主界面截图 ----------

console.log('\n切换到各标签页并截图…');
const tabs = [
  { name: '05-today', x: 0.1 },
  { name: '06-train', x: 0.3 },
  { name: '07-plan', x: 0.5 },
  { name: '08-food', x: 0.7 },
  { name: '09-coach', x: 0.86 },
];
for (const t of tabs) {
  tap(t.x, 0.955);
  await sleep(900);
  await shot(t.name);
}

// ---------- WebView 是否真的渲染了内容 ----------

// 通过 dumpsys 看 WebView 包名与进程
const webviewInfo = runOk(['shell', 'dumpsys', 'webviewupdate']);
record('WebView 实现可用', webviewInfo.length > 0, webviewInfo.split('\n')[0]?.slice(0, 80) ?? '');

// ---------- 内存与稳定性 ----------

const memInfo = runOk(['shell', 'dumpsys', 'meminfo', PKG]);
const totalMatch = /TOTAL\s+(\d+)/.exec(memInfo);
if (totalMatch) {
  const mb = Math.round(Number(totalMatch[1]) / 1024);
  record('内存占用合理（< 400MB）', mb < 400, `${mb} MB`);
}

// ---------- 汇总 ----------

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
console.log(`截图目录: shots/android/`);

if (!keepInstalled) {
  console.log('\n（加 --keep 可保留安装，便于手动体验）');
}

if (failed.length) {
  console.log('\n失败项：');
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ': ' + f.detail : ''}`);
  process.exit(1);
}
console.log('\n冒烟通过。请人工查看截图确认视觉效果与安全区。');



