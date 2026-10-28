import { createApp } from 'vue';
import App from './App.vue';
import './styles/base.css';
import './styles/components.css';
import './styles/views.css';
import { initTheme } from './store/theme';
import { migrateLegacyStorage } from './store/storageKeys';

/*
 * 品牌从「铁馆」改为「练迹」，存储键前缀随之从 tieguan.* 换成 lianji.*。
 *
 * 迁移必须在读任何 store 之前跑：store 模块在导入时就会读 localStorage，
 * 晚一步就会读到空值、把人当成新用户、直接进引导页——老数据看起来"丢了"。
 * 所以这一行要在所有 store 导入之前执行。
 */
migrateLegacyStorage();

/*
 * 主题必须在挂载前应用。
 *
 * 放在这里而不是组件里，是为了避免首屏闪白：
 * 等 Vue 挂载完再切深色，用户会先看到一帧浅色。
 * initTheme 同步读完偏好并写 data-theme / color-scheme，
 * 浏览器第一次绘制就是正确颜色。
 */
initTheme();

createApp(App).mount('#app');

/*
 * PWA 离线：只在网页生产环境注册 Service Worker。
 * - 原生端不注册：assets 已在 APK 内，缓存反而可能让版本落后；
 * - 开发环境不注册：会与 HMR 抢资源。
 * 离线是增强项，注册失败不影响在线使用。
 */
if (
  import.meta.env.PROD &&
  'serviceWorker' in navigator &&
  !(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
