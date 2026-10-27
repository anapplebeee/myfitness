import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor 配置。
 *
 * webContentsDebuggingEnabled 只在 debug 构建开启：
 * 它允许通过 chrome://inspect 或 CDP 远程控制 WebView，
 * 是做真机自动化验证的必要条件，但**绝不能进 release 包**
 * （任何人都能连上设备读改应用内数据）。
 *
 * 判定依据：CAP_BUILD_TYPE=debug 时开启，默认关闭。
 * 打包 debug 时用：CAP_BUILD_TYPE=debug npx cap sync android
 */
const isDebug = process.env.CAP_BUILD_TYPE === 'debug';

const config: CapacitorConfig = {
  /*
   * 与 android/app/build.gradle 的 applicationId 保持一致。
   *
   * 品牌改名「练迹」后安装包 ID 也改为 app.lianji.fit。
   * 代价：已装旧包 com.tieguan.fit 的设备不能覆盖升级，需先导出再导入。
   */
  appId: 'app.lianji.fit',
  appName: '练迹',
  /*
   * Android 构建会把前端输出到独立的 dist-build-* 目录，
   * 通过 CAP_WEB_DIR 传进来；日常构建仍用 dist。
   */
  webDir: process.env.CAP_WEB_DIR ?? 'dist',
  android: {
    backgroundColor: '#F2F0EA',
    allowMixedContent: false,
    webContentsDebuggingEnabled: isDebug,
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;

