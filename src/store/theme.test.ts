import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, loadThemePref, resolveTheme, saveThemePref } from './theme';

/**
 * 主题偏好。
 *
 * 这里的测试重点是**不变量**而不是像素：
 * 偏好存取、system 解析、以及"显式选择不被系统覆盖"这条规则。
 * 真实配色靠视觉审计与真机截图检查，单测不假装能验证颜色好不好看。
 */

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    _map: map,
  };
}

let storage: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  storage = memoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('偏好存取', () => {
  it('默认跟随系统', () => {
    expect(loadThemePref()).toBe('system');
  });

  it('存了深色能读回', () => {
    saveThemePref('dark');
    expect(loadThemePref()).toBe('dark');
  });

  it('存了浅色能读回', () => {
    saveThemePref('light');
    expect(loadThemePref()).toBe('light');
  });

  it('存储里是垃圾值时回到 system，不崩溃', () => {
    storage.setItem('tieguan.theme', 'rainbow');
    expect(loadThemePref()).toBe('system');
  });

  it('写入失败不抛错（隐私模式）', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceeded');
        },
        removeItem: () => undefined,
        clear: () => undefined,
      },
      configurable: true,
      writable: true,
    });
    expect(() => saveThemePref('dark')).not.toThrow();
  });

  it('存独立键，不碰 AppState', () => {
    saveThemePref('dark');
    const keys = [...storage._map.keys()];
    expect(keys).toContain('tieguan.theme');
    expect(keys.some((k) => k.includes('v2.state'))).toBe(false);
  });
});

describe('resolveTheme', () => {
  it('显式浅色时忽略系统深色', () => {
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('显式深色时忽略系统浅色', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('system 跟随系统深色', () => {
    expect(resolveTheme('system', true)).toBe('dark');
  });

  it('system 跟随系统浅色', () => {
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('applyTheme 写 DOM', () => {
  function fakeDoc() {
    const attrs = new Map<string, string>();
    const meta = { _content: '', setAttribute: (_k: string, v: string) => void (meta._content = v) };
    const root = {
      _attrs: attrs,
      style: { colorScheme: '' },
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      removeAttribute: (k: string) => void attrs.delete(k),
    };
    const doc = {
      documentElement: root,
      querySelector: (sel: string) => (sel.includes('theme-color') ? meta : null),
    };
    return { doc, root, meta };
  }

  it('显式深色写 data-theme=dark 并更新 theme-color', () => {
    const { doc, root, meta } = fakeDoc();
    Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true });
    const resolved = applyTheme('dark');
    expect(resolved).toBe('dark');
    expect(root._attrs.get('data-theme')).toBe('dark');
    expect(meta._content).toBe('#0d0f0c');
  });

  it('显式浅色写 data-theme=light', () => {
    const { doc, root, meta } = fakeDoc();
    Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true });
    applyTheme('light');
    expect(root._attrs.get('data-theme')).toBe('light');
    expect(meta._content).toBe('#f2f0ea');
  });

  it('system 模式移除 data-theme，交给媒体查询兜底', () => {
    const { doc, root } = fakeDoc();
    Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true });
    // 没有 matchMedia 时按浅色处理
    applyTheme('system');
    expect(root._attrs.has('data-theme')).toBe(false);
  });
});
