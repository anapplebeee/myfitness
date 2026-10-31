/** 本地持久化：固定快照、双副本新旧判定、失败可观察。 */
import type { AppState } from '../domain/types';
import { KEYS, LEGACY_DB_NAME } from './storageKeys';

const DB_NAME = KEYS.db;
const DB_VERSION = 1;
const STORE = 'state';
const KEY = 'app';
const LS_KEY = KEYS.state;
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

/**
 * 从旧品牌（铁馆）的 IndexedDB 库读取一次。
 *
 * 只负责**读**，不负责写：是否迁移由 loadState 在确认新库为空后才决定。
 * 原实现在这里读到就无条件 idbPut 到新库，导致新版本已经写入的记录
 * 被旧库覆盖（实测：先读到 NEW，新库随后被写成 OLD，第二次读取退回旧数据）。
 *
 * 只在旧库确实存在时读取，避免 open() 顺手创建一个空库。
 */
async function idbGetLegacy(): Promise<StoredState | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const dbs = await indexedDB.databases?.();
    if (dbs && !dbs.some((d) => d.name === LEGACY_DB_NAME)) return null;
  } catch {
    // databases() 不支持时只能尝试打开，下面的 open 对不存在的库会建空库，
    // 但读出来是 null，不会造成误判。
  }
  return await new Promise<StoredState | null>((resolve) => {
    const req = indexedDB.open(LEGACY_DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction(STORE, 'readonly');
        const get = tx.objectStore(STORE).get(KEY);
        get.onsuccess = () => {
          db.close();
          resolve((get.result as StoredState | undefined) ?? null);
        };
        get.onerror = () => {
          db.close();
          resolve(null);
        };
      } catch {
        db.close();
        resolve(null);
      }
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

/**
 * 是否应该把旧库搬进新库。
 *
 * 新库已有任何数据时**绝不迁移**——旧库只可能比新库旧，
 * 搬过去等于用旧记录覆盖用户在新版本里的真实数据。
 * 读取新库失败时也不迁移（可能是临时错误，不能据此判断"新库为空"）。
 */
export function shouldMigrateLegacy(hasNewData: boolean, readFailed: boolean): boolean {
  if (hasNewData) return false;
  if (readFailed) return false;
  return true;
}

function readLocalStorage(): StoredState | null {
  const raw = localStorage.getItem(LS_KEY);
  return raw === null ? null : (JSON.parse(raw) as StoredState);
}

function newestOf(candidates: StoredState[]): AppState {
  const stamp = (s: StoredState) => (typeof s?.__persistedAt === 'number' ? s.__persistedAt : 0);
  const newest = candidates.sort((a, b) => stamp(b) - stamp(a))[0]!;
  lastStamp = Math.max(lastStamp, stamp(newest));
  // 设备副本版本不进入业务状态、导出或同步。
  const { __persistedAt: ignored, ...state } = newest;
  void ignored;
  return state as AppState;
}

export async function loadState(): Promise<AppState | null> {
  const [idbResult, lsResult] = await Promise.allSettled([
    idbGet(),
    Promise.resolve().then(readLocalStorage),
  ]);

  const fresh: StoredState[] = [];
  if (idbResult.status === 'fulfilled' && idbResult.value) fresh.push(idbResult.value);
  if (lsResult.status === 'fulfilled' && lsResult.value) fresh.push(lsResult.value);

  const readFailed = idbResult.status === 'rejected' || lsResult.status === 'rejected';
  // 只有明确读到空库才能播种，读取错误不等于首次启动。
  const idbUnavailable = typeof indexedDB === 'undefined' && lsResult.status === 'fulfilled';

  if (fresh.length) {
    /*
     * 升级场景：新 IDB 还是空的，但新 localStorage 可能已经被
     * migrateLegacyStorage 用**旧 localStorage 副本**填过了。
     *
     * 旧版本的 saveState 对 IDB 与 localStorage 是分别写入的，
     * localStorage 配额满时 IDB 仍会更新 —— 那份旧 IDB 才是最新的。
     * 只信新 LS 会把升级前最后一段训练记录丢掉。
     *
     * 所以新 IDB 为空时，把旧 IDB 也作为一个候选，按 __persistedAt 取最新。
     */
    const newIdbEmpty = !(idbResult.status === 'fulfilled' && idbResult.value);
    if (newIdbEmpty) {
      const legacy = await idbGetLegacy().catch(() => null);
      if (legacy) fresh.push(legacy);
    }
    return newestOf(fresh);
  }

  if (readFailed && !idbUnavailable) {
    throw new Error('无法读取本地数据，原始数据未改动，请重试或恢复备份');
  }

  if (!shouldMigrateLegacy(false, readFailed)) return null;

  const legacy = await idbGetLegacy();
  if (!legacy) return null;

  /*
   * 新库确认为空时才搬旧库，并保留旧库原样（不删除）：
   * 迁移是单向的 NEW ← OLD，失败也不影响用户随后从旧版本再导出。
   */
  try {
    await idbPut(legacy);
  } catch {
    // 写入失败不影响本次读取，下次启动会再试
  }
  return newestOf([legacy]);
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

