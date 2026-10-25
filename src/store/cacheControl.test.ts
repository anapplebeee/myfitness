import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCacheAndReload, clearCaches, forceReload, listCacheNames } from './cacheControl';

/** 造一个假的 Cache Storage。 */
function fakeCaches(names: string[]) {
  const store = new Set(names);
  return {
    keys: async () => [...store],
    delete: async (n: string) => store.delete(n),
    _store: store,
  };
}

let reloaded: string[] = [];

beforeEach(() => {
  reloaded = [];
  globalThis.window = {
    location: {
      href: 'http://localhost/app',
      replace: (u: string) => void reloaded.push(u),
      reload: () => void reloaded.push('reload'),
    },
  } as unknown as Window & typeof globalThis;
  // Node 22 里 navigator 是只读 getter，必须用 defineProperty 覆盖
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('缓存清理 · 只清静态缓存', () => {
  it('列出缓存名称', async () => {
    globalThis.caches = fakeCaches(['v1', 'v2']) as unknown as CacheStorage;
    expect(await listCacheNames()).toEqual(['v1', 'v2']);
  });

  it('清空所有缓存并返回数量', async () => {
    const c = fakeCaches(['v1', 'v2', 'v3']);
    globalThis.caches = c as unknown as CacheStorage;
    const r = await clearCaches();
    expect(r.cachesCleared).toBe(3);
    expect(c._store.size).toBe(0);
  });

  it('环境不支持 caches 时不抛错', async () => {
    // @ts-expect-error 故意删除
    delete globalThis.caches;
    const r = await clearCaches();
    expect(r.cachesCleared).toBe(0);
    expect(r.warnings).toEqual([]);
  });

  it('caches.keys 抛错时给出警告而不是崩溃', async () => {
    globalThis.caches = {
      keys: async () => {
        throw new Error('SecurityError');
      },
      delete: async () => true,
    } as unknown as CacheStorage;
    const r = await clearCaches();
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('单个缓存删除失败时继续处理其他缓存', async () => {
    let first = true;
    globalThis.caches = {
      keys: async () => ['a', 'b'],
      delete: async () => {
        if (first) {
          first = false;
          throw new Error('locked');
        }
        return true;
      },
    } as unknown as CacheStorage;
    const r = await clearCaches();
    expect(r.cachesCleared).toBe(1);
    expect(r.warnings.length).toBe(1);
  });
});

describe('缓存清理 · 绝不碰业务数据', () => {
  it('不调用 localStorage.clear', async () => {
    const clear = vi.fn();
    globalThis.localStorage = { clear, removeItem: vi.fn(), getItem: vi.fn(), setItem: vi.fn(), key: vi.fn(), length: 0 } as unknown as Storage;
    globalThis.caches = fakeCaches(['v1']) as unknown as CacheStorage;
    await clearCaches();
    expect(clear).not.toHaveBeenCalled();
  });

  it('不调用 indexedDB.deleteDatabase', async () => {
    const del = vi.fn();
    globalThis.indexedDB = { deleteDatabase: del } as unknown as IDBFactory;
    globalThis.caches = fakeCaches(['v1']) as unknown as CacheStorage;
    await clearCaches();
    expect(del).not.toHaveBeenCalled();
  });
});

describe('缓存清理 · 强制刷新', () => {
  it('加时间戳参数绕过 HTTP 缓存', () => {
    forceReload();
    expect(reloaded[0]).toContain('_r=');
  });

  it('用 replace 而不是 href（不污染历史）', () => {
    forceReload();
    expect(reloaded.length).toBe(1);
    expect(reloaded[0]).not.toBe('reload');
  });

  it('URL 异常时回落到 reload', () => {
    globalThis.window = {
      location: {
        get href() {
          throw new Error('bad');
        },
        replace: () => undefined,
        reload: () => void reloaded.push('reload'),
      },
    } as unknown as Window & typeof globalThis;
    expect(() => forceReload()).not.toThrow();
  });
});

describe('缓存清理 · 组合操作', () => {
  it('清完后发起刷新', async () => {
    globalThis.caches = fakeCaches(['v1']) as unknown as CacheStorage;
    const r = await clearCacheAndReload();
    expect(r.cachesCleared).toBe(1);
    expect(r.reloadRequested).toBe(true);
    expect(reloaded.length).toBe(1);
  });

  it('有警告时不刷新（避免用户以为已修好）', async () => {
    globalThis.caches = {
      keys: async () => ['a'],
      delete: async () => {
        throw new Error('locked');
      },
    } as unknown as CacheStorage;
    const r = await clearCacheAndReload();
    expect(r.reloadRequested).toBe(false);
    expect(reloaded.length).toBe(0);
  });
});

