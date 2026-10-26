/**
 * 同步状态持久化。
 *
 * 为什么必须持久化（这是数据安全问题，不是体验问题）：
 *
 * SyncPanel 原来每次进入页面都把 SyncState 重置为 INITIAL_SYNC_STATE，
 * 于是 remoteRevision = 0、lastSyncedHash = null、generation = 0。后果：
 *
 *   1. pushSnapshot 看到 remoteRevision = 0，会发 `If-None-Match: *`，
 *      而远端已有数据 → 服务端返回 412，用户看到"远端已被其他设备更新"。
 *   2. detectConflict 的 baseHash 恒为 null、localDirty 恒为 false，
 *      判定永远偏向 fast_forward → **真实的本地改动被远端静默覆盖**。
 *      用户练了一个月，点一次同步，数据被三个月前的远端版本替换。
 *
 * 存储位置：设备私有，独立 localStorage 键。
 * SyncState 含"这台设备同步到哪了"，不属于业务数据，绝不进 AppState/快照。
 */

import { INITIAL_SYNC_STATE, type SyncState } from '../domain/sync';

const KEY = 'tieguan.sync.state';

/** 只持久化"跨会话有意义"的字段；瞬时状态（busy/error）不进存储。 */
const PERSISTED = [
  'generation',
  'ackedGeneration',
  'remoteRevision',
  'lastSyncedHash',
  'inflightKey',
  'inflightGeneration',
  'maxSnapshotBytes',
  'serviceEndpoint',
  'inflightHash',
] as const;

type PersistedKey = (typeof PERSISTED)[number];

export function loadSyncState(): SyncState {
  const base: SyncState = { ...INITIAL_SYNC_STATE };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<Record<PersistedKey, unknown>>;
    return {
      ...base,
      generation: typeof p.generation === 'number' ? p.generation : base.generation,
      ackedGeneration: typeof p.ackedGeneration === 'number' ? p.ackedGeneration : base.ackedGeneration,
      remoteRevision: typeof p.remoteRevision === 'number' ? p.remoteRevision : base.remoteRevision,
      lastSyncedHash: typeof p.lastSyncedHash === 'string' ? p.lastSyncedHash : null,
      inflightKey: typeof p.inflightKey === 'string' ? p.inflightKey : null,
      inflightGeneration: typeof p.inflightGeneration === 'number' ? p.inflightGeneration : null,
      maxSnapshotBytes: typeof p.maxSnapshotBytes === 'number' && p.maxSnapshotBytes > 0 ? p.maxSnapshotBytes : base.maxSnapshotBytes,
      serviceEndpoint: typeof p.serviceEndpoint === 'string' ? p.serviceEndpoint : undefined,
      inflightHash: typeof p.inflightHash === 'string' ? p.inflightHash : null,
    };
  } catch {
    // 存储损坏时回到初始值：最坏情况是多一次 412，不会丢数据
    return base;
  }
}

export function saveSyncState(s: SyncState): boolean {
  try {
    const out: Partial<Record<PersistedKey, unknown>> = {};
    for (const k of PERSISTED) out[k] = s[k];
    localStorage.setItem(KEY, JSON.stringify(out));
    return true;
  } catch {
    // 配额满/隐私模式：静默失败。下次同步会重新走 412 分支，不会丢数据。
    return false;
  }
}

export function clearSyncState(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 忽略 */
  }
}

/**
 * 判断"这台设备是否同步过"。
 *
 * 用途：remoteRevision === 0 且从未同步过，才是真正的首次同步；
 * 已同步过但 remoteRevision 为 0 说明远端被清空，两者处理不同。
 */
export function hasSyncedBefore(s: SyncState): boolean {
  return s.lastSyncedHash !== null || s.remoteRevision > 0 || s.ackedGeneration > 0;
}
