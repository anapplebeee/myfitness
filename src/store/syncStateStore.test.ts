import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearSyncState, hasSyncedBefore, loadSyncState, saveSyncState } from './syncStateStore';
import { INITIAL_SYNC_STATE } from '../domain/sync';

/**
 * 同步状态持久化回归（代码审查 #2）。
 *
 * 原缺陷：SyncPanel 每次进页面都重置 SyncState，导致
 * remoteRevision=0 → push 发 If-None-Match:* → 412；
 * 且 detectConflict 的 baseHash 恒 null、localDirty 恒 false，
 * 判定永远偏向 fast_forward，真实的本地改动被远端静默覆盖。
 */

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
  globalThis.localStorage = storage as unknown as Storage;
});

afterEach(() => {
  clearSyncState();
});

describe('同步状态持久化', () => {
  it('保存后能读回关键字段', () => {
    saveSyncState({
      ...INITIAL_SYNC_STATE,
      remoteRevision: 7,
      lastSyncedHash: 'abc123',
      generation: 12,
      ackedGeneration: 11,
    });
    const back = loadSyncState();
    expect(back.remoteRevision).toBe(7);
    expect(back.lastSyncedHash).toBe('abc123');
    expect(back.generation).toBe(12);
    expect(back.ackedGeneration).toBe(11);
  });

  it('存独立键，不污染 AppState 的键', () => {
    saveSyncState({ ...INITIAL_SYNC_STATE, remoteRevision: 3 });
    const keys = [...storage._map.keys()];
    expect(keys).toContain('lianji.sync.state');
    expect(keys.some((k) => k.includes('v2.state'))).toBe(false);
  });

  it('空存储时返回初始状态', () => {
    const s = loadSyncState();
    expect(s.remoteRevision).toBe(0);
    expect(s.lastSyncedHash).toBeNull();
  });

  it('存储损坏时回到初始值且不抛错', () => {
    storage.setItem('lianji.sync.state', '{broken');
    expect(() => loadSyncState()).not.toThrow();
    expect(loadSyncState().remoteRevision).toBe(0);
  });

  it('写入失败不抛错（隐私模式）', () => {
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
      removeItem: () => undefined,
      clear: () => undefined,
    } as unknown as Storage;
    expect(() => saveSyncState(INITIAL_SYNC_STATE)).not.toThrow();
  });

  it('瞬时状态不落盘（status/error 每次重置）', () => {
    saveSyncState({ ...INITIAL_SYNC_STATE, remoteRevision: 5, status: 'error', lastError: 'boom' });
    const back = loadSyncState();
    // 上次的错误不应跨会话保留，否则用户一进页面就看到旧错误
    expect(back.status).toBe('idle');
    expect(back.lastError).toBeNull();
    // 但 revision 这类关键状态必须保留
    expect(back.remoteRevision).toBe(5);
  });
});

describe('是否同步过', () => {
  it('从未同步过', () => {
    expect(hasSyncedBefore(INITIAL_SYNC_STATE)).toBe(false);
  });

  it('有 lastSyncedHash 算同步过', () => {
    expect(hasSyncedBefore({ ...INITIAL_SYNC_STATE, lastSyncedHash: 'x' })).toBe(true);
  });

  it('有 remoteRevision 算同步过', () => {
    expect(hasSyncedBefore({ ...INITIAL_SYNC_STATE, remoteRevision: 2 })).toBe(true);
  });

  it('有 ackedGeneration 算同步过', () => {
    expect(hasSyncedBefore({ ...INITIAL_SYNC_STATE, ackedGeneration: 3 })).toBe(true);
  });
});

