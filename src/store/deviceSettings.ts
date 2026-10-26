import { KEYS } from './storageKeys';

/**
 * 设备配置：只存本机、绝不上传、绝不进快照。
 *
 * 架构约束（02:27）：视图不直接访问存储。密钥属于设备私有数据，
 * 不能放进 AppState（AppState 会被物化进同步快照）。
 *
 * 存储位置：localStorage 独立键。IndexedDB 里放业务数据，
 * 这里放"这台设备怎么连服务端"。
 */

export interface SyncSettings {
  endpoint: string;
  token: string;
}

const KEY = KEYS.syncSettings;

const EMPTY: SyncSettings = { endpoint: '', token: '' };

export function loadSyncSettings(): SyncSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<SyncSettings>;
    return {
      endpoint: typeof parsed.endpoint === 'string' ? parsed.endpoint : '',
      token: typeof parsed.token === 'string' ? parsed.token : '',
    };
  } catch {
    return { ...EMPTY };
  }
}

export function saveSyncSettings(next: SyncSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ endpoint: next.endpoint.trim(), token: next.token.trim() }));
  } catch {
    // 存储不可用（隐私模式/配额满）时静默失败：同步配置丢失不影响本地记录
  }
}

export function clearSyncSettings(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 忽略 */
  }
}

/** 配置是否可用于发起同步。 */
export function isConfigured(s: SyncSettings): boolean {
  return s.endpoint.trim().length > 0 && s.token.trim().length > 0;
}

