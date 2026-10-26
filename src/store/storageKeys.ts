/**
 * 存储键集中管理 + 旧品牌数据迁移。
 *
 * 为什么集中：这些键散落在 6 个 store 里各写一遍字面量，
 * 改品牌时要逐个找，漏一个就变成"设置项突然被重置"这种诡异 bug。
 * 现在只有一个来源。
 *
 * 为什么需要迁移：应用此前叫「铁馆」，键前缀是 tieguan.*。
 * 直接换前缀等于让所有老用户的记录、密钥、主题设置凭空消失。
 * 下次启动时把旧键搬到新键，搬完保留旧键（不删，万一要回滚）。
 */

export const STORAGE_PREFIX = 'lianji';
const LEGACY_PREFIX = 'tieguan';

export const KEYS = {
  /** AppState 的 localStorage 回退副本 */
  state: `${STORAGE_PREFIX}.v2.state`,
  /** IndexedDB 库名 */
  db: STORAGE_PREFIX,
  aiSettings: `${STORAGE_PREFIX}.ai.settings`,
  syncSettings: `${STORAGE_PREFIX}.sync.settings`,
  syncState: `${STORAGE_PREFIX}.sync.state`,
  conflicts: `${STORAGE_PREFIX}.sync.conflicts`,
  theme: `${STORAGE_PREFIX}.theme`,
} as const;

/** 备份键带时间戳，单独生成。 */
export function backupKey(ts: number): string {
  return `${STORAGE_PREFIX}.backup.${ts}`;
}
export function syncBackupKey(ts: number): string {
  return `${STORAGE_PREFIX}.syncbackup.${ts}`;
}

/** 备份键的识别前缀，用于列出/清理。 */
export const BACKUP_PREFIX = `${STORAGE_PREFIX}.backup.`;
export const SYNC_BACKUP_PREFIX = `${STORAGE_PREFIX}.syncbackup.`;

interface KeyPair {
  from: string;
  to: string;
}

function legacyPairs(): KeyPair[] {
  return [
    { from: `${LEGACY_PREFIX}.v2.state`, to: KEYS.state },
    { from: `${LEGACY_PREFIX}.ai.settings`, to: KEYS.aiSettings },
    { from: `${LEGACY_PREFIX}.sync.settings`, to: KEYS.syncSettings },
    { from: `${LEGACY_PREFIX}.sync.state`, to: KEYS.syncState },
    { from: `${LEGACY_PREFIX}.sync.conflicts`, to: KEYS.conflicts },
    { from: `${LEGACY_PREFIX}.theme`, to: KEYS.theme },
  ];
}

/**
 * 把旧品牌前缀的键搬到新前缀。
 *
 * 规则：只在**新键不存在**时搬。新键已有值说明用户已经在用新版本，
 * 此时用旧值覆盖会把最近的改动退回去。
 *
 * 幂等：多次调用无副作用。
 * 安全：旧键保留不删。存储空间多一份副本的代价，远小于误删用户数据的代价。
 */
export function migrateLegacyStorage(): void {
  try {
    for (const { from, to } of legacyPairs()) {
      const oldValue = localStorage.getItem(from);
      if (oldValue === null) continue;
      if (localStorage.getItem(to) !== null) continue;
      localStorage.setItem(to, oldValue);
    }
    // 旧备份键也搬（带时间戳，逐个处理）
    const legacyBackup = `${LEGACY_PREFIX}.backup.`;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && (k.startsWith(legacyBackup) || k.startsWith(`${LEGACY_PREFIX}.syncbackup.`))) keys.push(k);
    }
    for (const k of keys) {
      const suffix = k.slice(LEGACY_PREFIX.length + 1); // backup.12345
      const to = `${STORAGE_PREFIX}.${suffix}`;
      if (localStorage.getItem(to) === null) {
        const v = localStorage.getItem(k);
        if (v !== null) localStorage.setItem(to, v);
      }
    }
  } catch {
    // 隐私模式/配额满：迁移失败不应阻断启动，用户会看到引导页而不是崩溃
  }
}

/** 旧 IndexedDB 库名，供 repository 做数据搬迁。 */
export const LEGACY_DB_NAME = LEGACY_PREFIX;
