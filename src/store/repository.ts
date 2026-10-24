/** 持久化端口：IndexedDB 优先，失败回落 localStorage。 */

import type { AppState } from '../domain/types';

const DB_NAME = 'tieguan';
const DB_VERSION = 1;
const STORE = 'state';
const KEY = 'app';
const LS_KEY = 'tieguan.v2.state';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB unavailable'));
      return;
    }
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error('indexedDB timeout'))), 1500);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () =>
      finish(() => {
        clearTimeout(timer);
        resolve(req.result);
      });
    req.onerror = () =>
      finish(() => {
        clearTimeout(timer);
        reject(req.error ?? new Error('indexedDB open failed'));
      });
    req.onblocked = () =>
      finish(() => {
        clearTimeout(timer);
        reject(new Error('indexedDB blocked'));
      });
  });
}

async function idbGet(): Promise<AppState | null> {
  const db = await openDb();
  try {
    return await new Promise<AppState | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as AppState | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error('read failed'));
    });
  } finally {
    db.close();
  }
}

async function idbPut(state: AppState): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(state, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('write aborted'));
    });
  } finally {
    db.close();
  }
}

function lsGet(): AppState | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AppState;
  } catch {
    return null;
  }
}

function lsPut(state: AppState): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    /* 配额不足时静默，由调用方决定提示 */
  }
}

export async function loadState(): Promise<AppState | null> {
  try {
    const fromIdb = await idbGet();
    if (fromIdb) return fromIdb;
  } catch {
    /* 回落到 localStorage */
  }
  return lsGet();
}

export async function saveState(state: AppState): Promise<void> {
  lsPut(state);
  try {
    await idbPut(state);
  } catch {
    /* localStorage 已兜底 */
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
  void openDb()
    .then((db) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      db.close();
    })
    .catch(() => undefined);
}
