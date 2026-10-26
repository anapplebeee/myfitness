import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KEYS, backupKey, migrateLegacyStorage, syncBackupKey } from './storageKeys';

/**
 * 旧品牌存储键迁移。
 *
 * 这是数据安全路径：改品牌时把 tieguan.* 换成 lianji.*，
 * 迁移写错 = 老用户打开应用看到空白，以为记录全没了。
 */

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
    _map: map,
  };
}

let storage: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  storage = memoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
});

afterEach(() => {
  storage.clear();
});

describe('键名定义', () => {
  it('全部使用 lianji 前缀', () => {
    expect(KEYS.state.startsWith('lianji.')).toBe(true);
    expect(KEYS.aiSettings.startsWith('lianji.')).toBe(true);
    expect(KEYS.syncSettings.startsWith('lianji.')).toBe(true);
    expect(KEYS.syncState.startsWith('lianji.')).toBe(true);
    expect(KEYS.conflicts.startsWith('lianji.')).toBe(true);
    expect(KEYS.theme.startsWith('lianji.')).toBe(true);
  });

  it('键之间互不相同', () => {
    const vs = [KEYS.state, KEYS.aiSettings, KEYS.syncSettings, KEYS.syncState, KEYS.conflicts, KEYS.theme];
    expect(new Set(vs).size).toBe(vs.length);
  });

  it('备份键带时间戳且可区分', () => {
    expect(backupKey(1000)).toBe('lianji.backup.1000');
    expect(syncBackupKey(2000)).toBe('lianji.syncbackup.2000');
  });
});

describe('迁移旧键', () => {
  it('把旧 state 搬到新键', () => {
    storage.setItem('tieguan.v2.state', '{"version":2}');
    migrateLegacyStorage();
    expect(storage.getItem('lianji.v2.state')).toBe('{"version":2}');
  });

  it('把旧密钥设置搬到新键', () => {
    storage.setItem('tieguan.ai.settings', '{"apiKey":"sk-x"}');
    migrateLegacyStorage();
    expect(storage.getItem('lianji.ai.settings')).toBe('{"apiKey":"sk-x"}');
  });

  it('把旧主题偏好搬到新键', () => {
    storage.setItem('tieguan.theme', 'dark');
    migrateLegacyStorage();
    expect(storage.getItem('lianji.theme')).toBe('dark');
  });

  it('把旧同步设置搬到新键', () => {
    storage.setItem('tieguan.sync.settings', '{"endpoint":"https://x"}');
    migrateLegacyStorage();
    expect(storage.getItem('lianji.sync.settings')).toBe('{"endpoint":"https://x"}');
  });

  it('新键已存在时不被旧值覆盖', () => {
    storage.setItem('tieguan.v2.state', '{"old":true}');
    storage.setItem('lianji.v2.state', '{"new":true}');
    migrateLegacyStorage();
    // 覆盖会使用户最近的改动倒退
    expect(storage.getItem('lianji.v2.state')).toBe('{"new":true}');
  });

  it('没有旧键时什么都不做', () => {
    migrateLegacyStorage();
    expect(storage.length).toBe(0);
  });

  it('幂等：连续调用两次结果一致', () => {
    storage.setItem('tieguan.v2.state', '{"a":1}');
    migrateLegacyStorage();
    const first = storage.getItem('lianji.v2.state');
    migrateLegacyStorage();
    expect(storage.getItem('lianji.v2.state')).toBe(first);
  });

  it('保留旧键不删，便于回滚', () => {
    storage.setItem('tieguan.v2.state', '{"a":1}');
    migrateLegacyStorage();
    expect(storage.getItem('tieguan.v2.state')).toBe('{"a":1}');
  });

  it('迁移备份键', () => {
    storage.setItem('tieguan.backup.123', '{"s":1}');
    migrateLegacyStorage();
    expect(storage.getItem('lianji.backup.123')).toBe('{"s":1}');
  });

  it('存储抛错时不崩溃', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => {
          throw new Error('SecurityError');
        },
        setItem: () => undefined,
        removeItem: () => undefined,
        clear: () => undefined,
        key: () => null,
        length: 0,
      },
      configurable: true,
      writable: true,
    });
    expect(() => migrateLegacyStorage()).not.toThrow();
  });
});
