/**
 * 前端缓存清理。
 *
 * 解决的问题：应用更新后，用户有时仍看到旧界面——
 * 浏览器把旧的 index.html / JS 缓存住了，而 HTML 里引用的
 * 还是旧哈希的资源名。
 *
 * 这里要清的"缓存"包含三层，误清任何一层都会丢数据：
 *   1. Cache Storage（Service Worker 缓存）—— 可以清，属于静态资源
 *   2. HTTP 缓存 —— 通过强制重新请求 HTML 绕过
 *   3. localStorage / IndexedDB —— **不能动**，那是用户的训练记录
 *
 * 所以这个模块只做 1 和 2，并且不碰任何业务数据。
 * "清空本机数据"是另一个功能，两者必须区分开。
 */

export interface CacheClearResult {
  /** 清掉了几份 Cache Storage */
  cachesCleared: number;
  /** 是否成功发起了强制刷新 */
  reloadRequested: boolean;
  /** 清理过程中的问题（不阻断） */
  warnings: string[];
}

/**
 * 列出当前站点所有的 Cache Storage 名称。
 * 用于在界面上告诉用户"将要清理什么"，而不是盲清。
 */
export async function listCacheNames(): Promise<string[]> {
  try {
    if (typeof caches === 'undefined') return [];
    const names = await caches.keys();
    return names;
  } catch {
    return [];
  }
}

/**
 * 清空本站所有 Cache Storage。
 *
 * 只删 caches.keys() 里的项，不触碰 IndexedDB 与 localStorage——
 * 这是本模块最重要的边界。
 */
export async function clearCaches(): Promise<CacheClearResult> {
  const warnings: string[] = [];
  let cleared = 0;

  try {
    if (typeof caches !== 'undefined') {
      const names = await caches.keys();
      for (const name of names) {
        try {
          const ok = await caches.delete(name);
          if (ok) cleared += 1;
        } catch (e) {
          warnings.push(`缓存 ${name} 删除失败：${String(e).slice(0, 60)}`);
        }
      }
    }
  } catch (e) {
    warnings.push(`无法读取缓存列表：${String(e).slice(0, 60)}`);
  }

  // 注销残留的 Service Worker 注册（旧版本遗留）
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const reg of regs) {
        try {
          await reg.unregister();
        } catch {
          warnings.push('Service Worker 注销失败');
        }
      }
    }
  } catch {
    // 某些环境不支持，忽略
  }

  return { cachesCleared: cleared, reloadRequested: false, warnings };
}

/**
 * 强制重新拉取页面。
 *
 * 用 location.replace 加时间戳参数绕过 HTTP 缓存。
 * 用 replace 而不是 href：不在历史里留下一条，用户按返回不会回到旧页。
 */
export function forceReload(): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('_r', String(Date.now()));
    window.location.replace(url.toString());
  } catch {
    window.location.reload();
  }
}

/** 清缓存并刷新。给界面用的一步操作。 */
export async function clearCacheAndReload(): Promise<CacheClearResult> {
  const r = await clearCaches();
  if (r.warnings.length === 0) {
    forceReload();
    return { ...r, reloadRequested: true };
  }
  return r;
}
