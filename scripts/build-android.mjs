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

import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const root = process.cwd();
/** Windows 上可执行文件带 .exe，POSIX 没有——原来写死 java.exe 导致 Linux CI 永远找不到 JDK。 */
const JAVA_BIN = process.platform === 'win32' ? 'java.exe' : 'java';

/*
 * 让 capacitor.config.ts 在本次同步时打开 WebView 调试（debug 包专用）。
 *
 * 必须设在 process.env 上：Windows 下 execFileSync 的 env 选项配合 shell:true
 * 并不总是传到 npx 那一层，实测会让 webContentsDebuggingEnabled 仍是 false，
 * 导致真机 CDP 自动化连不上 WebView。
 */
process.env.CAP_BUILD_TYPE = 'debug';
const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

/**
 * 在 GitHub Actions 里额外发一条 error 注解。
 *
 * 为什么需要：CI 失败时日志要登录才能看，而注解可以通过公开的 check-runs API 读到
 * （`/repos/{owner}/{repo}/check-runs/{id}/annotations`）。没有这条通道，
 * "在 Linux 上到底哪一步炸了"只能靠人肉贴日志。
 */
function emitError(title, detail = '') {
  const text = String(detail).replace(/\r/g, '').slice(0, 1500);
  if (process.env.GITHUB_ACTIONS === 'true') {
    const escaped = text.replace(/%/g, '%25').replace(/\n/g, '%0A').replace(/\r/g, '%0D');
    console.log(`::error title=${title}::${escaped}`);
  }
  console.error(`\n[${title}] ${text}`);
}

/**
 * 跑命令并把输出实时打到控制台，同时留最后 200 行。
 * 失败时用尾部内容发注解——只 inherit 的话，杀掉进程的那句真实报错就丢了。
 */
function runStreaming(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    const tail = [];
    const push = (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        tail.push(line);
        if (tail.length > 200) tail.shift();
      }
    };
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, tail }));
  });
}

/** 在一个"装着多个 JDK 的目录"里找第一个可用的。 */
function findJdkIn(base) {
  if (!existsSync(base)) return null;
  for (const dir of readdirSync(base)) {
    const home = join(base, dir);
    if (existsSync(join(home, 'bin', JAVA_BIN))) return home;
  }
  return null;
}

/**
 * 找 JDK。
 *
 * 判定标准必须是「JAVA_HOME/bin/java 存在」，不能写死 java.exe——Linux CI 上
 * 就是这一条把整条出包任务卡死的（setup-java 装好了 JDK，脚本却报"未找到"）。
 * 找不到时再从 PATH 上的 java 反推 JAVA_HOME，覆盖 CI 只把 java 放进 PATH 的情况。
 */
function findJavaHome() {
  const envHome = process.env.JAVA_HOME;
  if (envHome && existsSync(join(envHome, 'bin', JAVA_BIN))) return envHome;

  const candidates = [
    // 本项目自带的 Android 工具链（check-android 脚本安装的位置）
    join(homedir(), '.android-toolchain', 'jdk'),
    // POSIX：apt / actions/setup-java / 常见发行版布局
    '/usr/lib/jvm',
    '/usr/local/lib/jvm',
    '/opt/java',
    '/opt/jdk',
    // Windows
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Microsoft\\jdk',
  ];
  for (const base of candidates) {
    const found = findJdkIn(base);
    if (found) return found;
  }

  // Android Studio 自带的 JBR 本身就是 JDK 根目录，不再往下扫一层
  const jbr = 'C:\\Program Files\\Android\\Android Studio\\jbr';
  if (existsSync(join(jbr, 'bin', JAVA_BIN))) return jbr;

  // 最后一条：PATH 上的 java，realpath 后取 <home>/bin/java 的上一级
  try {
    const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['java'], {
      encoding: 'utf8',
    });
    const found = (probe.stdout ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && existsSync(line));
    if (found) {
      const home = dirname(dirname(realpathSync(found)));
      if (existsSync(join(home, 'bin', JAVA_BIN))) return home;
    }
  } catch {
    // 没有 java 就按未找到处理，下面会给平台对应的安装提示
  }
  return null;
}

/** 找 Android SDK。 */
function findSdkHome() {
  if (process.env.ANDROID_HOME && existsSync(process.env.ANDROID_HOME)) return process.env.ANDROID_HOME;
  if (process.env.ANDROID_SDK_ROOT && existsSync(process.env.ANDROID_SDK_ROOT)) {
    return process.env.ANDROID_SDK_ROOT;
  }
  // 本项目自带的工具链
  const toolchain = join(homedir(), '.android-toolchain', 'sdk');
  if (existsSync(toolchain)) return toolchain;
  // 常见系统位置（Linux CI / 手动安装）
  for (const base of [
    '/usr/local/lib/android/sdk',
    '/opt/android-sdk',
    '/usr/lib/android-sdk',
    join(homedir(), 'Android', 'Sdk'),
  ]) {
    if (existsSync(base)) return base;
  }
  const guess = join(homedir(), 'AppData', 'Local', 'Android', 'Sdk');
  if (existsSync(guess)) return guess;
  // 最后读 android/local.properties 的 sdk.dir（Windows 里冒号是转义的）
  const localProps = join(root, 'android', 'local.properties');
  if (existsSync(localProps)) {
    const line = readFileSync(localProps, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.trim().startsWith('sdk.dir='));
    if (line) {
      const dir = line
        .slice(line.indexOf('=') + 1)
        .trim()
        .replace(/\\:/g, ':')
        .replace(/\\\\/g, '\\');
      if (existsSync(dir)) return dir;
    }
  }
  return null;
}

const javaHome = findJavaHome();
record('JDK 可用', Boolean(javaHome), javaHome ?? '未找到');
if (!javaHome) {
  console.error(
    process.platform === 'win32'
      ? '\n缺少 JDK，无法编译。安装：winget install EclipseAdoptium.Temurin.21.JDK'
      : '\n缺少 JDK，无法编译。Ubuntu：sudo apt install -y openjdk-21-jdk；CI 用 actions/setup-java 并确认 JAVA_HOME 已导出',
  );
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
  /*
   * 让 capacitor.config.ts 打开 WebView 调试（webContentsDebuggingEnabled）。
   * 只有 debug 包需要：真机 CDP 自动化（scripts/android-cdp.mjs）依赖它，
   * 否则 WebView 不暴露 devtools socket，自动化完全连不上。
   */
  CAP_BUILD_TYPE: 'debug',
  JAVA_HOME: javaHome,
  ANDROID_HOME: sdkHome,
  ANDROID_SDK_ROOT: sdkHome,
  PATH: `${join(javaHome, 'bin')};${join(sdkHome, 'platform-tools')};${process.env.PATH ?? ''}`,
};

/*
 * 每次构建输出到独立目录。
 *
 * 两个原因：
 * 1) Vite 清空 dist/assets 会一次删除 80+ 个文件，触发环境的批量删除保护；
 * 2) 复用目录会让旧哈希文件被打进 APK，包体越来越大。
 * 独立目录 + 归档旧 public，两者都避免。
 */
const webOut = `dist-build-${Date.now().toString(36)}`;
process.env.CAP_WEB_DIR = webOut;
env.CAP_WEB_DIR = webOut;

// 先构建最新前端，避免把上一次的产物打进 APK
console.log('\n--- 构建前端 ---');
try {
  execFileSync('npm', ['run', 'build', '--', '--outDir', webOut], {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: true,
  });
  record('前端构建成功', true, webOut);
} catch (e) {
  record('前端构建成功', false, String(e).slice(0, 120));
  process.exit(1);
}

// 先同步前端资产，确保 APK 里是最新产物
console.log('\n--- 同步前端资产 ---');

/** Windows 下目录可能被杀软/索引器短暂占用，rename 会 EPERM；重试几次。 */
function archivePublic(publicDir) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const archive = join(root, `dist-old-android-${Date.now().toString(36)}-${attempt}`);
      renameSync(publicDir, archive);
      return archive;
    } catch {
      const end = Date.now() + 250;
      while (Date.now() < end) {
        /* 同步等待后重试 */
      }
    }
  }
  return null;
}

let archived = false;
try {
  /*
   * 把旧 public 改名归档，而不是删除：
   * 删除会触发批量删除保护；留在 assets 下又会被打进 APK。
   * 归档到项目根（已 gitignore），既有记录又不影响包体。
   */
  const publicDir = join(root, 'android', 'app', 'src', 'main', 'assets', 'public');
  if (existsSync(publicDir)) {
    const archive = archivePublic(publicDir);
    if (archive) {
      archived = true;
      record('旧 Android 资源已归档', true, archive.replace(`${root}\\`, ''));
    } else {
      // 重试仍被占用：不归档，靠 cap sync + 强制覆盖 + 哈希校验兜底
      record('旧资源归档失败（被占用），改用覆盖模式', true);
    }
  }
  // Windows 上 .cmd 不能被 execFileSync 直接启动（EINVAL），必须走 shell
  execFileSync('npx', ['cap', 'sync', 'android'], {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: true,
  });
  if (!archived) {
    // Capacitor 在 Windows 上可能不覆盖已存在的 assets 子目录：强制覆盖一遍
    cpSync(join(root, webOut), publicDir, { recursive: true, force: true });
  }
  record('cap sync 成功', true);
} catch (e) {
  record('cap sync 成功', false, String(e).slice(0, 120));
  process.exit(1);
}

// 同步结果校验：Android 里的入口哈希必须与本次构建一致，否则 APK 装的是旧前端
try {
  const entryHash = (html) => /assets\/index-([A-Za-z0-9_-]+)\.js/.exec(html)?.[1] ?? '';
  const distHash = entryHash(readFileSync(join(root, webOut, 'index.html'), 'utf8'));
  const appHash = entryHash(
    readFileSync(join(root, 'android', 'app', 'src', 'main', 'assets', 'public', 'index.html'), 'utf8'),
  );
  record(
    '前端资源已同步到 Android（哈希一致）',
    Boolean(distHash) && distHash === appHash,
    `${webOut}=${distHash || '?'} / android=${appHash || '?'}`,
  );
} catch (e) {
  record('前端资源已同步到 Android（哈希一致）', false, String(e).slice(0, 100));
}

// 编译
console.log('\n--- gradle assembleDebug ---');
/*
 * POSIX 上用 `sh gradlew` 而不是 `./gradlew`：
 * 仓库里的 gradlew 是以 100644 提交的（Windows 上创建的仓库没有执行位），
 * Linux CI 检出后直接执行会 EACCES，整个出包任务就红。
 * 同时已在 git 索引里补了 +x，两层保险。
 */
const gradlewCommand = process.platform === 'win32' ? 'gradlew.bat' : 'sh';
const gradlewArgs =
  process.platform === 'win32'
    ? ['assembleDebug', '--no-daemon']
    : ['gradlew', 'assembleDebug', '--no-daemon'];
{
  const { code, tail } = await runStreaming(gradlewCommand, gradlewArgs, {
    cwd: join(root, 'android'),
    env,
    shell: process.platform === 'win32',
  });
  if (code !== 0) {
    record('gradle assembleDebug 成功', false, tail.slice(-4).join(' | ').slice(0, 200));
    emitError(`gradle assembleDebug 失败（exit ${code}）`, tail.slice(-40).join('\n'));
    process.exit(1);
  }
  record('gradle assembleDebug 成功', true);
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
// build-tools 里 Windows 是 aapt.exe，POSIX 无后缀
const aaptName = process.platform === 'win32' ? 'aapt.exe' : 'aapt';
const aapt = join(sdkHome, 'build-tools', buildTools[buildTools.length - 1], aaptName);
if (existsSync(aapt)) {
  try {
    const listing = execFileSync(aapt, ['list', apkPath], { encoding: 'utf8' });
    record('APK 含前端 index.html', listing.includes('assets/public/index.html'));
    record('APK 含打包后 JS', /assets\/public\/assets\/index-.*\.js/.test(listing));
    record('APK 含 manifest', listing.includes('AndroidManifest.xml'));

    const badging = execFileSync(aapt, ['dump', 'badging', apkPath], { encoding: 'utf8' });
    const pkg = /package: name='([^']+)'/.exec(badging)?.[1];
    // 包名跟随品牌改为 app.lianji.fit（v1.2 起）；旧包不能覆盖，升级需导出再导入
    record('包名为 app.lianji.fit', pkg === 'app.lianji.fit', pkg ?? '');
    const label = /application-label:'([^']+)'/.exec(badging)?.[1];
    // 应用已从「铁馆」改名「练迹」，这里跟随当前品牌名
    record('应用名为 练迹', label === '练迹', label ?? '');
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
     *
     * 证书 CN 仍是旧品牌 TieGuan：这是**故意保留**的。换新 keystore 会让
     * 已安装旧包的设备无法覆盖升级（必须卸载 → 数据丢失）。
     * 如果未来要做品牌证书迁移，必须走 Play App Signing 的密钥轮换，
     * 不能直接换 keystore。
     */
    // Windows 是 apksigner.bat，POSIX 是无后缀的 apksigner
    const apksignerName = process.platform === 'win32' ? 'apksigner.bat' : 'apksigner';
    const apksigner = join(sdkHome, 'build-tools', buildTools[buildTools.length - 1], apksignerName);
    if (existsSync(apksigner)) {
      try {
        const certs = execFileSync(apksigner, ['verify', '--print-certs', apkPath], {
          encoding: 'utf8',
          env,
          // Windows 上 .bat 不能直接被 execFileSync 启动（EINVAL），必须走 shell
          shell: process.platform === 'win32',
        });
        const dn = /certificate DN: (.+)/.exec(certs)?.[1]?.trim() ?? '';
        record(
          '使用固定签名（可覆盖升级）',
          dn.includes('CN=TieGuan') || dn.includes('CN=LianJi'),
          dn || '未读取到证书',
        );
      } catch (e) {
        record('使用固定签名（可覆盖升级）', false, String(e).slice(0, 100));
      }
    }
  } catch (e) {
    record('aapt 校验', false, String(e).slice(0, 100));
  }
} else {
  record('aapt 可用', false, `未找到 build-tools/${aaptName}`);
}

// 复制到 dist-apk/：文件名带日期与版本，便于发给测试同事（该目录的 apk 已 gitignore）
try {
  const distDir = join(root, 'dist-apk');
  mkdirSync(distDir, { recursive: true });
  const gradle = readFileSync(join(root, 'android', 'app', 'build.gradle'), 'utf8');
  const versionName = /versionName\s+"([^"]+)"/.exec(gradle)?.[1] ?? 'dev';
  const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const outName = `lianji-debug-${dateTag}-v${versionName}.apk`;
  copyFileSync(apkPath, join(distDir, outName));
  record('APK 已复制到 dist-apk', true, outName);
} catch (e) {
  record('APK 已复制到 dist-apk', false, String(e).slice(0, 100));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
console.log(`APK: ${apkPath}`);
if (failed.length) process.exit(1);




