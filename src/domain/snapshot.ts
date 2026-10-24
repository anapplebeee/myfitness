/**
 * 同步快照：物化、规范化与哈希。契约见 docs/sync-contract.md。
 *
 * 与导出信封的区别：
 * - 导出给用户看，可以带人类可读的展开；
 * - 快照要跨设备比对，必须是确定性投影，任何非确定性都会造成假冲突。
 */

import type { AppState, Session } from './types';
import { canonicalJson } from './transfer';

/** 快照 schema 版本；破坏性变更才递增。 */
export const SNAPSHOT_SCHEMA_VERSION = 1;

export interface Snapshot {
  schemaVersion: number;
  ruleVersion: number;
  datasetId: string;
  createdAt: string;
  accountingTimezone: string;
  records: {
    profile: AppState['profile'];
    sessions: Session[];
    weights: AppState['weights'];
    foods: AppState['foods'];
    occurrences: AppState['occurrences'];
    weekGoals: AppState['weekGoals'];
    customTemplates: AppState['customTemplates'];
    bodyGoalGrams: number | null;
    targetKcal: number | null;
    targetProtein: number | null;
    weeklyGoal: number;
    activeTemplateId: string | null;
    activeTemplateSince: string | null;
  };
}

/** 按 id 字典序排序，保证两台设备物化结果一致。 */
function byId<T extends { id: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * 物化快照。
 * - 保留 tombstone（deletedAt 非空），不用"移除"表达删除
 * - 不写入任何派生值（容量/PR/周完成数）
 * - 缺省字段补 null 还是省略：这里统一补 undefined→省略，null 保留
 */
export function buildSnapshot(
  state: AppState,
  options: { ruleVersion: number; accountingTimezone: string },
): Snapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    ruleVersion: options.ruleVersion,
    datasetId: state.datasetId,
    createdAt: state.createdAt,
    accountingTimezone: options.accountingTimezone,
    records: {
      profile: state.profile,
      // 注意：不过滤 deletedAt，tombstone 必须随快照传播
      sessions: byId(state.sessions).map((s) => ({
        ...s,
        exercises: [...s.exercises]
          .sort((a, b) => a.order - b.order)
          .map((ex) => ({ ...ex, sets: [...ex.sets] })),
      })),
      weights: byId(state.weights),
      foods: byId(state.foods),
      occurrences: byId(state.occurrences),
      weekGoals: byId(state.weekGoals),
      customTemplates: byId(state.customTemplates),
      bodyGoalGrams: state.bodyGoalGrams,
      targetKcal: state.targetKcal,
      targetProtein: state.targetProtein,
      weeklyGoal: state.weeklyGoal,
      activeTemplateId: state.activeTemplateId,
      activeTemplateSince: state.activeTemplateSince,
    },
  };
}

/** 规范化字符串；哈希与比对都基于它。 */
export function snapshotCanonical(snapshot: Snapshot): string {
  return canonicalJson(snapshot);
}

/** UTF-8 字节数，用于与服务端公布的 maxSnapshotBytes 比对。 */
export function snapshotByteSize(snapshot: Snapshot): number {
  return new TextEncoder().encode(snapshotCanonical(snapshot)).length;
}

// ---------- SHA-256 ----------

/**
 * 同步场景必须用 SHA-256（跨设备比对需抗碰撞）。
 * 浏览器用 WebCrypto，Node/测试环境用 node:crypto。
 */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);

  const webCrypto = globalThis.crypto;
  if (webCrypto?.subtle) {
    const digest = await webCrypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // 测试环境回落：用纯 JS 实现，避免依赖 node:crypto 让浏览器构建失败
  return sha256Fallback(bytes);
}

/** 纯 JS SHA-256，仅在无 WebCrypto 时使用。 */
function sha256Fallback(bytes: Uint8Array): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const len = bytes.length;
  const bitLen = len * 8;
  const withOne = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  withOne.set(bytes);
  withOne[len] = 0x80;
  const view = new DataView(withOne.buffer);
  view.setUint32(withOne.length - 4, bitLen >>> 0, false);
  view.setUint32(withOne.length - 8, Math.floor(bitLen / 0x100000000), false);

  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let off = 0; off < withOne.length; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, '0')).join('');
}

export async function snapshotHash(snapshot: Snapshot): Promise<string> {
  return sha256Hex(snapshotCanonical(snapshot));
}

// ---------- 大小预检 ----------

export interface SizeCheck {
  ok: boolean;
  bytes: number;
  limit: number;
  message?: string;
}

/**
 * 超限不裁剪历史，只返回明确结果让上层提示并保留 pending（契约 §4.2）。
 */
export function checkSnapshotSize(snapshot: Snapshot, limitBytes: number): SizeCheck {
  const bytes = snapshotByteSize(snapshot);
  if (bytes <= limitBytes) return { ok: true, bytes, limit: limitBytes };
  return {
    ok: false,
    bytes,
    limit: limitBytes,
    message:
      `数据量 ${(bytes / 1024 / 1024).toFixed(1)} MiB 超出同步上限 ${(limitBytes / 1024 / 1024).toFixed(0)} MiB。` +
      '历史不会被裁剪；请先导出备份，或联系管理员调整上限。',
  };
}
