/**
 * 规范化序列化与哈希。
 *
 * 必须与服务端契约一致（docs/sync-contract.md §1.3）：
 * 对象递归按 key 字典序重建、数组保持原序、undefined 省略、null 保留、
 * 无空白，数字用 ECMAScript JSON.stringify 表示。
 *
 * 服务端**独立重算**哈希，不信任客户端提交值——这是"两端同字节"的验证点，
 * 也是拒绝损坏/篡改快照的唯一依据。
 */
import { createHash } from 'node:crypto';

/**
 * 递归排序对象键。
 * @param {unknown} value
 * @returns {unknown}
 */
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = /** @type {Record<string, unknown>} */ (value);
  /** @type {Record<string, unknown>} */
  const sorted = {};
  for (const key of Object.keys(obj).sort()) {
    const v = obj[key];
    if (v === undefined) continue;
    sorted[key] = canonicalize(v);
  }
  return sorted;
}

/**
 * 规范化 JSON 字符串。相同语义的数据必须得到完全相同的字符串。
 * @param {unknown} value
 */
export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

/**
 * 规范化后的 UTF-8 字节数——容量上限按这个口径计（§6 补充量化门槛）。
 * @param {unknown} value
 */
export function canonicalBytes(value) {
  return Buffer.byteLength(canonicalJson(value), 'utf8');
}

/** @param {string} input */
export function sha256Hex(input) {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * 快照哈希：对规范化 JSON 取 SHA-256，小写 hex。
 * @param {unknown} snapshot
 */
export function snapshotHash(snapshot) {
  return sha256Hex(canonicalJson(snapshot));
}

/**
 * 稳定指纹（用于幂等请求哈希等内部比对）。
 * 输入可以是任意 JSON 值，输出 64 位 hex。
 * @param {unknown} value
 */
export function fingerprint(value) {
  return sha256Hex(canonicalJson(value));
}
