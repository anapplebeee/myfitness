import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSyncSettings, isConfigured, loadSyncSettings, saveSyncSettings } from './deviceSettings';

/** 最小 localStorage 桩，node 环境没有。 */
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    _map: map,
  };
}

let storage: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  storage = fakeStorage();
  vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('设备配置：不污染业务状态', () => {
  it('默认空配置', () => {
    expect(loadSyncSettings()).toEqual({ endpoint: '', token: '' });
  });

  it('保存后可读回', () => {
    saveSyncSettings({ endpoint: 'http://a:1', token: 'tk' });
    expect(loadSyncSettings()).toEqual({ endpoint: 'http://a:1', token: 'tk' });
  });

  it('保存时去除首尾空白', () => {
    saveSyncSettings({ endpoint: '  http://a:1  ', token: ' tk ' });
    expect(loadSyncSettings()).toEqual({ endpoint: 'http://a:1', token: 'tk' });
  });

  it('使用独立键，不与业务状态混用', () => {
    saveSyncSettings({ endpoint: 'http://a:1', token: 'tk' });
    const keys = [...storage._map.keys()];
    expect(keys).toContain('lianji.sync.settings');
    expect(keys.some((k) => k.includes('v2.state'))).toBe(false);
  });

  it('清空后回到默认', () => {
    saveSyncSettings({ endpoint: 'http://a:1', token: 'tk' });
    clearSyncSettings();
    expect(loadSyncSettings()).toEqual({ endpoint: '', token: '' });
  });
});

describe('设备配置：损坏数据容错', () => {
  it('非法 JSON 返回默认值而非抛错', () => {
    storage.setItem('lianji.sync.settings', 'not json');
    expect(loadSyncSettings()).toEqual({ endpoint: '', token: '' });
  });

  it('字段类型错误时逐字段兜底', () => {
    storage.setItem('lianji.sync.settings', JSON.stringify({ endpoint: 123, token: null }));
    expect(loadSyncSettings()).toEqual({ endpoint: '', token: '' });
  });

  it('缺字段时补默认', () => {
    storage.setItem('lianji.sync.settings', JSON.stringify({ endpoint: 'http://a' }));
    expect(loadSyncSettings()).toEqual({ endpoint: 'http://a', token: '' });
  });

  it('存储写入失败不抛错（隐私模式）', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
      removeItem: () => undefined,
      clear: () => undefined,
    });
    expect(() => saveSyncSettings({ endpoint: 'a', token: 'b' })).not.toThrow();
  });
});

describe('配置可用性判定', () => {
  it('两项都填才算可用', () => {
    expect(isConfigured({ endpoint: 'http://a', token: 't' })).toBe(true);
    expect(isConfigured({ endpoint: '', token: 't' })).toBe(false);
    expect(isConfigured({ endpoint: 'http://a', token: '' })).toBe(false);
  });

  it('纯空白不算填写', () => {
    expect(isConfigured({ endpoint: '   ', token: 't' })).toBe(false);
  });
});

