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
  appId: 'com.tieguan.fit',
  appName: '铁馆',
  webDir: 'dist',
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
