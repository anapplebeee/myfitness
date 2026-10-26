/**
 * 主题偏好：浅色 / 深色 / 跟随系统。
 *
 * 与 deviceSettings、aiSettings 同源：这是**设备私有**数据，
 * 不进 AppState。理由和密钥一样——用户在一台机器上喜欢深色，
 * 不该因为这个偏好而让同步快照产生差异（那会造成假冲突），
 * 也不该出现在导出的 JSON 里。
 *
 * 实现要点：
 * - 偏好写 localStorage，键名独立
 * - 实际生效的主题由 resolveTheme() 决定（system 时读媒体查询）
 * - 监听系统主题变化，只在"跟随系统"模式下生效
 * - 同步更新 <meta name="theme-color">，否则 Android 状态栏配色会不跟
 */

export type ThemePref = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const KEY = 'tieguan.theme';

/** 与 tokens.css 里的 --paper 保持一致，用于状态栏取色。 */
const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: '#f2f0ea',
  dark: '#0d0f0c',
};

export function loadThemePref(): ThemePref {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    /* 隐私模式：回落默认 */
  }
  return 'system';
}

export function saveThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* 配额满：静默失败，本次会话仍然生效，只是下次回到默认 */
  }
}

/** system 模式下读系统偏好；显式选择时直接返回。 */
export function resolveTheme(pref: ThemePref, systemPrefersDark: boolean): ResolvedTheme {
  if (pref === 'light' || pref === 'dark') return pref;
  return systemPrefersDark ? 'dark' : 'light';
}

function systemPrefersDark(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false;
  } catch {
    return false;
  }
}

/**
 * 把主题写进 DOM。
 *
 * 显式 light/dark 时写 data-theme；system 时移除该属性，
 * 让 tokens.css 里的媒体查询兜底——这样即使脚本没跑，
 * 系统深色的用户也能看到深色界面（首屏不闪白）。
 */
export function applyTheme(pref: ThemePref): ResolvedTheme {
  const resolved = resolveTheme(pref, systemPrefersDark());
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  if (root) {
    if (pref === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', pref);
    root.style.colorScheme = resolved;
  }
  const meta = typeof document !== 'undefined' ? document.querySelector('meta[name="theme-color"]') : null;
  if (meta) meta.setAttribute('content', THEME_COLOR[resolved]);
  return resolved;
}

/**
 * 启动时初始化，并返回一个取消订阅函数。
 *
 * 只在"跟随系统"模式下响应系统变化：用户显式选了浅色，
 * 不该因为他晚上开了系统深色就被强行切换。
 */
export function initTheme(pref: ThemePref = loadThemePref()): () => void {
  applyTheme(pref);
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;

  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = (): void => {
    // 重新读偏好：用户可能在设置里改过
    if (loadThemePref() === 'system') applyTheme('system');
  };
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
