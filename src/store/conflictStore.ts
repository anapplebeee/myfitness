/**
 * 冲突副本存储。
 *
 * 契约要求（sync-contract §2、AC-S03）：冲突时三方都要留档，
 * 让用户能事后取回被覆盖的那一版。此前 makeConflictCopy 只有构造，
 * 没有持久化、没有 UI，等于没实现。
 *
 * 存放位置：设备本地（localStorage），不进快照——
 * 冲突副本是本机调试/恢复用的，不应再次同步出去。
 */

import { KEYS } from './storageKeys';
import type { Snapshot } from '../domain/snapshot';

const KEY = KEYS.conflicts;
const MAX_KEPT = 5;

export interface StoredConflict {
  id: string;
  createdAt: string;
  remoteRevision: number;
  /** 远端版本的快照（可能被本地覆盖） */
  remoteSnapshot: Snapshot;
  /** 当时本地版本的快照 */
  localSnapshot: Snapshot;
  /** 用户最终选择了哪一方 */
  resolution: 'kept_local' | 'kept_remote' | 'unresolved';
}

interface ConflictStore {
  items: StoredConflict[];
}

function read(): ConflictStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { items: [] };
    const parsed = JSON.parse(raw) as ConflictStore;
    return { items: Array.isArray(parsed.items) ? parsed.items : [] };
  } catch {
    return { items: [] };
  }
}

function write(store: ConflictStore): void {
  try {
    // 只保留最近若干条，避免把存储撑爆
    const trimmed = [...store.items]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, MAX_KEPT);
    localStorage.setItem(KEY, JSON.stringify({ items: trimmed }));
  } catch {
    // 存储满时静默失败：冲突副本不应阻断用户继续操作
  }
}

export function saveConflict(item: StoredConflict): void {
  const store = read();
  store.items = store.items.filter((x) => x.id !== item.id);
  store.items.push(item);
  write(store);
}

export function listConflicts(): StoredConflict[] {
  return [...read().items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function latestConflict(): StoredConflict | null {
  return listConflicts()[0] ?? null;
}

export function markResolved(id: string, resolution: StoredConflict['resolution']): void {
  const store = read();
  const hit = store.items.find((x) => x.id === id);
  if (hit) hit.resolution = resolution;
  write(store);
}

export function clearConflicts(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 忽略 */
  }
}

/** 从本地版本恢复：把某份冲突副本的某一侧取回。 */
export function conflictSnapshot(item: StoredConflict, side: 'local' | 'remote'): Snapshot {
  return side === 'local' ? item.localSnapshot : item.remoteSnapshot;
}

