import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { seedState } from './seed';

const KEY = 'tieguan.v2.state';
function storage() {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null,
    setItem: vi.fn((k: string, v: string) => { map.set(k, v); }), removeItem: (k: string) => map.delete(k) };
}

/** 用structuredClone模拟浏览器IDB的克隆边界，不能让Vue代理悄悄通过。 */
function idb(initial: unknown = null) {
  let value = initial;
  const controls = { failWrites: false, captured: null as unknown };
  const db = {
    objectStoreNames: { contains: () => true }, close: vi.fn(),
    transaction: () => {
      const tx = {
        oncomplete: null as (() => void) | null, onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        objectStore: () => ({
          get: () => {
            const req = { result: value, onsuccess: null as (() => void) | null };
            queueMicrotask(() => req.onsuccess?.());
            return req;
          },
          put: (next: unknown) => {
            const clone: unknown = structuredClone(next);
            controls.captured = clone;
            queueMicrotask(() => {
              if (controls.failWrites) tx.onerror?.();
              else { value = clone; tx.oncomplete?.(); }
            });
          },
        }),
      };
      return tx;
    },
  };
  const factory = { open: () => {
    const req = { result: db, onsuccess: null as (() => void) | null };
    queueMicrotask(() => req.onsuccess?.());
    return req;
  } };
  return { factory: factory as unknown as IDBFactory, controls, read: () => value };
}

let ls: ReturnType<typeof storage>;
beforeEach(() => { vi.resetModules(); ls = storage(); vi.stubGlobal('localStorage', ls); vi.stubGlobal('indexedDB', undefined); });
afterEach(() => vi.unstubAllGlobals());

describe('保存回归 · AC-D01/D02/D03', () => {
  it('Vue嵌套代理写入IDB前变为固定普通快照', async () => {
    const db = idb(); vi.stubGlobal('indexedDB', db.factory);
    const { saveState } = await import('./repository');
    const state = reactive(seedState()); state.profile.name = '提交时的名字';
    const saved = saveState(state); state.profile.name = '之后修改';
    await saved;
    expect((db.read() as ReturnType<typeof seedState>).profile.name).toBe('提交时的名字');
  });
  it('只有IDB可写仍保存成功', async () => {
    const db = idb(); vi.stubGlobal('indexedDB', db.factory);
    ls.setItem.mockImplementation(() => { throw new Error('quota'); });
    const { saveState } = await import('./repository');
    await expect(saveState(seedState())).resolves.toBeUndefined();
    expect(db.read()).not.toBeNull();
  });
  it('只有localStorage可写可回退，两个均失败必须拒绝', async () => {
    const { saveState } = await import('./repository');
    await expect(saveState(seedState())).resolves.toBeUndefined();
    ls.setItem.mockImplementation(() => { throw new Error('quota'); });
    await expect(saveState(seedState())).rejects.toThrow('保存失败');
  });
  it('IDB旧、回退副本新时读取新副本', async () => {
    const old = seedState(); old.profile.name = '旧IDB';
    const db = idb(old); db.controls.failWrites = true; vi.stubGlobal('indexedDB', db.factory);
    const { saveState, loadState } = await import('./repository');
    const next = seedState(); next.profile.name = '新回退数据'; await saveState(next);
    expect((await loadState())?.profile.name).toBe('新回退数据');
  });
  it('LS旧、IDB新时读取IDB，设备元数据不进入业务状态', async () => {
    const old = seedState(); old.profile.name = '旧LS'; ls.map.set(KEY, JSON.stringify(old));
    const db = idb(); vi.stubGlobal('indexedDB', db.factory);
    ls.setItem.mockImplementation(() => { throw new Error('quota'); });
    const { saveState, loadState } = await import('./repository');
    const next = seedState(); next.profile.name = '新IDB'; await saveState(next);
    const loaded = await loadState();
    expect(loaded?.profile.name).toBe('新IDB'); expect(loaded).not.toHaveProperty('__persistedAt');
  });
  it('损坏文件和读取失败不是空数据集', async () => {
    ls.map.set(KEY, '{broken');
    const { loadState } = await import('./repository');
    await expect(loadState()).rejects.toThrow('无法读取');
  });
  it('失败后队列可继续，连续提交最终保留后一版', async () => {
    const { saveState, loadState } = await import('./repository');
    ls.setItem.mockImplementationOnce(() => { throw new Error('quota'); });
    await expect(saveState(seedState())).rejects.toThrow();
    const first = seedState(); first.profile.name = 'first';
    const last = seedState(); last.profile.name = 'last';
    await Promise.all([saveState(first), saveState(last)]);
    expect((await loadState())?.profile.name).toBe('last');
  });
});
