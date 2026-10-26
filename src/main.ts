import { createApp } from 'vue';
import App from './App.vue';
import './styles/base.css';
import './styles/components.css';
import './styles/views.css';
import { initTheme } from './store/theme';

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
