/** 本地持久化：固定快照、双副本新旧判定、失败可观察。 */
import type { AppState } from '../domain/types';

const DB_NAME = 'tieguan';
const DB_VERSION = 1;
const STORE = 'state';
const KEY = 'app';
const LS_KEY = 'tieguan.v2.state';
type StoredState = AppState & { __persistedAt?: number };
let lastStamp = 0;
let writeQueue: Promise<void> = Promise.resolve();

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB不可用'));
      return;
    }
    let settled = false;
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    const fail = (error: Error | DOMException | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error ?? new Error('IndexedDB打开失败'));
    };
    const timer = setTimeout(() => fail(new Error('IndexedDB打开超时')), 1500);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      if (settled) { req.result.close(); return; }
      settled = true;
      clearTimeout(timer);
      resolve(req.result);
    };
    req.onerror = () => fail(req.error);
    req.onblocked = () => fail(new Error('IndexedDB被其他页面阻塞'));
  });
}

async function idbGet(): Promise<StoredState | null> {
  const db = await openDb();
  try {
    return await new Promise<StoredState | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as StoredState | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error('读取失败'));
      tx.onabort = () => reject(tx.error ?? new Error('读取中断'));
    });
  } finally { db.close(); }
}

async function idbPut(snapshot: StoredState): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('写入失败'));
      tx.onabort = () => reject(tx.error ?? new Error('写入中断'));
      tx.objectStore(STORE).put(snapshot, KEY);
    });
  } finally { db.close(); }
}

export async function loadState(): Promise<AppState | null> {
  const results = await Promise.allSettled([
    idbGet(),
    Promise.resolve().then(() => {
      const raw = localStorage.getItem(LS_KEY);
      return raw === null ? null : JSON.parse(raw) as StoredState;
    }),
  ]);
  const candidates = results.flatMap((r) => r.status === 'fulfilled' && r.value !== null ? [r.value] : []);
  if (!candidates.length) {
    // 只有明确读到空库才能播种，读取错误不等于首次启动。
    if (results.some((r) => r.status === 'rejected') &&
        !(typeof indexedDB === 'undefined' && results[1]?.status === 'fulfilled')) {
      throw new Error('无法读取本地数据，原始数据未改动，请重试或恢复备份');
    }
    return null;
  }
  const stamp = (s: StoredState) => typeof s?.__persistedAt === 'number' ? s.__persistedAt : 0;
  const newest = candidates.sort((a, b) => stamp(b) - stamp(a))[0]!;
  lastStamp = Math.max(lastStamp, stamp(newest));
  // 设备副本版本不进入业务状态、导出或同步。
  const { __persistedAt: ignored, ...state } = newest;
  void ignored;
  return state as AppState;
}

export function saveState(state: AppState): Promise<void> {
  // JSON序列化同时去掉所有层级Vue Proxy，并在排队前冻结本次提交内容。
  let snapshot: StoredState;
  try {
    snapshot = JSON.parse(JSON.stringify(state)) as StoredState;
    lastStamp = Math.max(Date.now(), lastStamp + 1);
    snapshot.__persistedAt = lastStamp;
  } catch {
    return Promise.reject(new Error('本地数据无法序列化，尚未保存'));
  }
  const commit = async () => {
    const results = await Promise.allSettled([
      idbPut(snapshot),
      Promise.resolve().then(() => localStorage.setItem(LS_KEY, JSON.stringify(snapshot))),
    ]);
    if (results.every((r) => r.status === 'rejected')) {
      throw new Error('本地保存失败（存储不可用或空间已满），请重试或导出数据');
    }
  };
  const result = writeQueue.then(commit);
  writeQueue = result.catch(() => undefined);
  return result;
}

export function clearState(): void {
  try { localStorage.removeItem(LS_KEY); } catch { /* 兼容旧调用方 */ }
  void openDb().then((db) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = tx.onabort = () => db.close();
  }).catch(() => undefined);
}
