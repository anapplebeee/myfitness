/**
 * 校验 Android 打包链路是否处于"可构建"状态。
 *
 * 为什么需要这个脚本：本项目此前长期把 Android 列在计划里，
 * 但 capacitor.config.json 的 webDir 指向不存在的 www，
 * package.json 没有 Capacitor 依赖，assets/public 也不存在——
 * 链路完全断开却无人发现。
 *
 * 本脚本检查的是**配置与产物**，不代替真正的 gradle 构建。
 * 没有 JDK/Android SDK 的环境无法出 APK，这一点必须显式说明。
 *
 * 用法：node scripts/check-android.mjs
 */

import { readFile, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

const root = process.cwd();

// 1. 依赖
let pkg = {};
try {
  pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
} catch {
  check('package.json 可读', false);
}
const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
check('依赖含 @capacitor/core', Boolean(deps['@capacitor/core']), deps['@capacitor/core'] ?? '缺失');
check('依赖含 @capacitor/android', Boolean(deps['@capacitor/android']), deps['@capacitor/android'] ?? '缺失');
check('依赖含 @capacitor/cli', Boolean(deps['@capacitor/cli']), deps['@capacitor/cli'] ?? '缺失');

// 2. 配置
let cfg = null;
try {
  cfg = JSON.parse(await readFile(join(root, 'capacitor.config.json'), 'utf8'));
} catch {
  check('capacitor.config.json 可读', false);
}
if (cfg) {
  check('appId 已设置', Boolean(cfg.appId), cfg.appId ?? '');
  check('appName 已设置', Boolean(cfg.appName), cfg.appName ?? '');
  const webDir = cfg.webDir ?? '';
  const webDirExists = webDir ? await exists(join(root, webDir)) : false;
  check('webDir 指向存在的目录', webDirExists, `webDir=${webDir}`);
  // 历史缺陷：webDir 曾是 www，而构建产物在 dist
  check('webDir 与构建产物一致（dist）', webDir === 'dist', `实际 ${webDir}`);
  const bg = cfg.android?.backgroundColor ?? '';
  check('Android 背景色与设计系统一致', bg.toUpperCase() === '#F2F0EA', bg);
}

// 3. Web 产物已同步
const publicDir = join(root, 'android', 'app', 'src', 'main', 'assets', 'public');
const hasPublic = await exists(publicDir);
check('android assets/public 存在', hasPublic);
if (hasPublic) {
  const files = await readdir(publicDir).catch(() => []);
  check('assets/public/index.html 存在', files.includes('index.html'), `${files.length} 个文件`);
  const hasJs = files.some((f) => f.endsWith('.js'));
  check('assets/public 含打包后的 JS', hasJs);
}

// 4. Gradle 配置
const gradleProps = join(root, 'android', 'gradle', 'wrapper', 'gradle-wrapper.properties');
check('gradle wrapper 存在', await exists(gradleProps));
if (await exists(gradleProps)) {
  const props = await readFile(gradleProps, 'utf8');
  const m = /gradle-(\d+\.\d+(?:\.\d+)?)-all\.zip/.exec(props);
  check('gradle 版本可解析', Boolean(m), m ? m[1] : 'unknown');
}

const settingsGradle = join(root, 'android', 'capacitor.settings.gradle');
check('capacitor.settings.gradle 存在', await exists(settingsGradle));

const mainActivity = join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'tieguan', 'fit', 'MainActivity.java');
check('MainActivity 存在', await exists(mainActivity));
if (await exists(mainActivity)) {
  const src = await readFile(mainActivity, 'utf8');
  check('MainActivity 继承 BridgeActivity', src.includes('BridgeActivity'));
}

// 5. 构建工具链（只报告，不作为失败项）
const javaOk = await (async () => {
  try {
    const { execFile } = await import('node:child_process');
    return await new Promise((resolve) => {
      execFile('java', ['-version'], (err) => resolve(!err));
    });
  } catch {
    return false;
  }
})();
check('[环境] JDK 可用', javaOk, javaOk ? '' : '未安装：无法在本机编译 APK');
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? '';
check('[环境] Android SDK 已配置', Boolean(sdk), sdk || '未设置 ANDROID_HOME');

// 输出
const fail = checks.filter((c) => !c.ok && !c.name.startsWith('[环境]'));
const envWarn = checks.filter((c) => !c.ok && c.name.startsWith('[环境]'));

for (const c of checks) {
  const mark = c.ok ? 'PASS' : c.name.startsWith('[环境]') ? 'WARN' : 'FAIL';
  console.log(`${mark}  ${c.name}${c.detail ? '  — ' + c.detail : ''}`);
}

console.log('');
if (fail.length) {
  console.log(`配置检查失败 ${fail.length} 项`);
  process.exit(1);
}
console.log('配置检查全部通过（可执行 npx cap sync android）');
if (envWarn.length) {
  console.log(`环境缺失 ${envWarn.length} 项：无法在本机编译 APK，需安装 JDK 与 Android SDK`);
}
process.exit(0);
