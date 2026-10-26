/**
 * 一键装到真机：安装 → 还原本地数据 → 启动。
 *
 * 为什么需要它：调试包换机器签名就变，覆盖安装会被系统拒绝，
 * 只能卸载重装——而卸载会清掉 WebView 里的全部训练数据。
 * 这里把"装之前先备份、装完再还原"固化成流程，避免每次手动折腾。
 *
 * 用法：
 *   node scripts/install-phone.mjs                       # 装最新 APK
 *   node scripts/install-phone.mjs --backup              # 先备份再装
 *   node scripts/install-phone.mjs --restore <tar>       # 装完还原指定备份
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const root = process.cwd();
const sdk = process.env.ANDROID_HOME ?? join(homedir(), '.android-toolchain', 'sdk');
const adb = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');

const args = process.argv.slice(2);
const wantBackup = args.includes('--backup');
const restoreAt = args.indexOf('--restore');
const restoreTar = restoreAt >= 0 ? args[restoreAt + 1] : null;

function run(bin, argv, options = {}) {
  return execFileSync(bin, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
}

/** 挑一个在线设备；多台时优先真机（emulator- 开头的排后面）。 */
function pickDevice() {
  const out = run(adb, ['devices']);
  const lines = out
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean);
  const online = lines.filter((l) => l.endsWith('\tdevice')).map((l) => l.split('\t')[0]);
  if (!online.length) {
    const offline = lines.filter((l) => l.includes('offline')).map((l) => l.split(/\s+/)[0]);
    if (offline.length) {
      console.error(`设备 ${offline.join(', ')} 处于 offline：请在手机上解锁并允许 USB 调试。`);
    } else {
      console.error('没有连接的设备：插好数据线、打开「USB 调试」与「USB 安装」。');
    }
    process.exit(1);
  }
  const phone = online.find((d) => !d.startsWith('emulator-'));
  return phone ?? online[0];
}

const serial = pickDevice();
const a = (...argv) => run(adb, ['-s', serial, ...argv]);

const apkDir = join(root, 'dist-apk');
const apk = existsSync(apkDir)
  ? readdirSync(apkDir)
      .filter((f) => f.endsWith('.apk'))
      .map((f) => join(apkDir, f))
      .sort()
      .pop()
  : null;
if (!apk) {
  console.error('dist-apk/ 下没有 APK，先跑 npm run android:build');
  process.exit(1);
}

const pkg = 'com.tieguan.fit';
console.log(`设备 ${serial}，安装 ${apk}`);

if (wantBackup) {
  const tar = join(root, `.phone-backup-${Date.now()}.tar`);
  console.log('→ 备份现有数据');
  try {
    const buf = execFileSync(
      adb,
      [
        '-s',
        serial,
        'exec-out',
        `run-as ${pkg} tar cf - 'app_webview/Default/Local Storage' 'app_webview/Default/IndexedDB' 'app_webview/Default/Session Storage' 2>/dev/null`,
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    const { writeFileSync } = await import('node:fs');
    writeFileSync(tar, buf);
    console.log(`  备份已保存：${tar}`);
  } catch {
    console.log('  备份跳过（应用未安装或不可调试）');
  }
}

console.log('→ 安装');
try {
  a('install', '-r', '-t', apk);
  console.log('  安装成功');
} catch (e) {
  const msg = String(e.stderr ?? e.message);
  if (msg.includes('USER_RESTRICTED')) {
    console.error('  被系统拒绝：请在「开发者选项」打开「USB 安装 / 通过 USB 安装应用」，并在弹窗点允许。');
  } else if (msg.includes('UPDATE_INCOMPATIBLE')) {
    console.error('  签名不一致：这台手机装的是旧签名的包。加 --backup 后手动卸载再装，或先导出数据。');
  } else {
    console.error('  安装失败：' + msg.slice(0, 200));
  }
  process.exit(1);
}

if (restoreTar) {
  console.log(`→ 还原数据 ${restoreTar}`);
  const { readFileSync } = await import('node:fs');
  const buf = readFileSync(restoreTar);
  execFileSync(adb, ['-s', serial, 'shell', `run-as ${pkg} tar xf -`], { input: buf });
  console.log('  已还原');
}

console.log('→ 启动');
a('shell', 'am', 'start', '-n', `${pkg}/.MainActivity`);
console.log('完成。');
