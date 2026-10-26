/**
 * Android 构建验证：真正编译 APK 并校验产物。
 *
 * 与 check-android.mjs 的分工：
 * - check-android.mjs：静态配置检查（不需要 JDK/SDK）
 * - build-android.mjs：真编译 + 产物校验（需要 JDK + Android SDK）
 *
 * 历史教训：本项目曾长期把 Android 列在计划里，而 webDir 指向不存在的目录，
 * 从未成功构建过。静态检查能防配置错误，但只有真编译能证明"能出包"。
 *
 * 用法：node scripts/build-android.mjs
 */

import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const root = process.cwd();
const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

/** 找 JDK。 */
function findJavaHome() {
  if (process.env.JAVA_HOME && existsSync(join(process.env.JAVA_HOME, 'bin', 'java.exe'))) {
    return process.env.JAVA_HOME;
  }
  const candidates = [
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Microsoft\\jdk',
  ];
  for (const base of candidates) {
    if (!existsSync(base)) continue;
    for (const dir of readdirSync(base)) {
      const home = join(base, dir);
      if (existsSync(join(home, 'bin', 'java.exe'))) return home;
    }
  }
  return null;
}

/** 找 Android SDK。 */
function findSdkHome() {
  if (process.env.ANDROID_HOME && existsSync(process.env.ANDROID_HOME)) return process.env.ANDROID_HOME;
  if (process.env.ANDROID_SDK_ROOT && existsSync(process.env.ANDROID_SDK_ROOT)) {
    return process.env.ANDROID_SDK_ROOT;
  }
  const guess = join(homedir(), 'AppData', 'Local', 'Android', 'Sdk');
  return existsSync(guess) ? guess : null;
}

const javaHome = findJavaHome();
record('JDK 可用', Boolean(javaHome), javaHome ?? '未找到');
if (!javaHome) {
  console.log('\n缺少 JDK，无法编译。安装：winget install EclipseAdoptium.Temurin.21.JDK');
  process.exit(1);
}

const sdkHome = findSdkHome();
record('Android SDK 可用', Boolean(sdkHome), sdkHome ?? '未找到');
if (!sdkHome) {
  console.log('\n缺少 Android SDK。见 docs/19-android.md 的安装步骤。');
  process.exit(1);
}

// 组件
const platforms = existsSync(join(sdkHome, 'platforms')) ? readdirSync(join(sdkHome, 'platforms')) : [];
const buildTools = existsSync(join(sdkHome, 'build-tools')) ? readdirSync(join(sdkHome, 'build-tools')) : [];
record('SDK platform 已安装', platforms.length > 0, platforms.join(', '));
record('build-tools 已安装', buildTools.length > 0, buildTools.join(', '));

// local.properties
const localProps = join(root, 'android', 'local.properties');
record('android/local.properties 存在', existsSync(localProps));

// 环境
const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME: sdkHome,
  ANDROID_SDK_ROOT: sdkHome,
  PATH: `${join(javaHome, 'bin')};${join(sdkHome, 'platform-tools')};${process.env.PATH ?? ''}`,
};

// 先同步前端资产，确保 APK 里是最新产物
console.log('\n--- 同步前端资产 ---');
try {
  // Windows 上 .cmd 不能被 execFileSync 直接启动（EINVAL），必须走 shell
  execFileSync('npx', ['cap', 'sync', 'android'], {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: true,
  });
  record('cap sync 成功', true);
} catch (e) {
  record('cap sync 成功', false, String(e).slice(0, 120));
  process.exit(1);
}

// 编译
console.log('\n--- gradle assembleDebug ---');
const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
try {
  execFileSync(gradlew, ['assembleDebug', '--no-daemon'], {
    cwd: join(root, 'android'),
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  record('gradle assembleDebug 成功', true);
} catch (e) {
  record('gradle assembleDebug 成功', false, String(e).slice(0, 120));
  process.exit(1);
}

// 产物校验
const apkDir = join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug');
const apks = existsSync(apkDir) ? readdirSync(apkDir).filter((f) => f.endsWith('.apk')) : [];
record('APK 文件已生成', apks.length > 0, apks.join(', '));
if (!apks.length) process.exit(1);

const apkPath = join(apkDir, apks[0]);
const sizeMb = statSync(apkPath).size / 1024 / 1024;
record('APK 大小合理', sizeMb > 1 && sizeMb < 50, `${sizeMb.toFixed(2)} MB`);

// 用 aapt 校验 APK 内容
const aapt = join(sdkHome, 'build-tools', buildTools[buildTools.length - 1], 'aapt.exe');
if (existsSync(aapt)) {
  try {
    const listing = execFileSync(aapt, ['list', apkPath], { encoding: 'utf8' });
    record('APK 含前端 index.html', listing.includes('assets/public/index.html'));
    record('APK 含打包后 JS', /assets\/public\/assets\/index-.*\.js/.test(listing));
    record('APK 含 manifest', listing.includes('AndroidManifest.xml'));

    const badging = execFileSync(aapt, ['dump', 'badging', apkPath], { encoding: 'utf8' });
    const pkg = /package: name='([^']+)'/.exec(badging)?.[1];
    record('包名为 com.tieguan.fit', pkg === 'com.tieguan.fit', pkg ?? '');
    const label = /application-label:'([^']+)'/.exec(badging)?.[1];
    record('应用名为 铁馆', label === '铁馆', label ?? '');
    const target = /targetSdkVersion:'(\d+)'/.exec(badging)?.[1];
    record('targetSdk >= 34', Number(target) >= 34, `targetSdk=${target}`);
    const min = /sdkVersion:'(\d+)'/.exec(badging)?.[1];
    record('minSdk 合理（>= 23）', Number(min) >= 23, `minSdk=${min}`);

    // AC-C09：备份必须排除业务数据与口令
    const tree = execFileSync(aapt, ['dump', 'xmltree', apkPath, 'AndroidManifest.xml'], { encoding: 'utf8' });
    const allowBackup = /android:allowBackup\(0x[0-9a-f]+\)=\(type 0x12\)0x([01])/i.exec(tree)?.[1];
    record('allowBackup 为 false（AC-C09）', allowBackup === '0', `allowBackup=${allowBackup ?? 'absent'}`);
    record('备份排除规则已配置', tree.includes('fullBackupContent') && tree.includes('dataExtractionRules'));

    /*
     * 固定签名：测试包也必须用 android/tieguan-release.keystore 签。
     * 用默认 debug keystore 的话，换一台机器签名就变，覆盖安装会被系统拒绝
     * （INSTALL_FAILED_UPDATE_INCOMPATIBLE），只能卸载重装、数据全丢。
     */
    const apksigner = join(sdkHome, 'build-tools', buildTools[buildTools.length - 1], 'apksigner.bat');
    if (existsSync(apksigner)) {
      try {
        const certs = execFileSync(apksigner, ['verify', '--print-certs', apkPath], {
          encoding: 'utf8',
          env,
          // Windows 上 .bat 不能直接被 execFileSync 启动（EINVAL），必须走 shell
          shell: process.platform === 'win32',
        });
        const dn = /certificate DN: (.+)/.exec(certs)?.[1]?.trim() ?? '';
        record('使用固定签名（可覆盖升级）', dn.includes('CN=TieGuan'), dn || '未读取到证书');
      } catch (e) {
        record('使用固定签名（可覆盖升级）', false, String(e).slice(0, 100));
      }
    }
  } catch (e) {
    record('aapt 校验', false, String(e).slice(0, 100));
  }
} else {
  record('aapt 可用', false, '未找到 build-tools/aapt.exe');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
console.log(`APK: ${apkPath}`);
if (failed.length) process.exit(1);



