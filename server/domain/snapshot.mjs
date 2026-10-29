/**
 * 快照校验。
 *
 * 只做"能不能安全存下来"的判断，不解释业务字段含义——业务规则版本由
 * `ruleVersion` 标识，服务端不猜语义（§4.1）。
 *
 * 拒绝顺序很重要：版本 → 体积 → 结构 → 哈希。
 * 先看版本可以把"未来客户端"与"坏数据"分开，客户端据此保留本地数据不降级。
 */
import { canonicalBytes, snapshotHash } from './canonical.mjs';
import { fail } from './errors.mjs';

/** 结构与规则版本白名单；新增版本必须先加测试向量再放开。 */
export const SUPPORTED_SCHEMA_VERSIONS = new Set([1]);
export const SUPPORTED_RULE_VERSIONS = new Set([1, 2]);
export const SUPPORTED_CANONICALIZATION_VERSIONS = new Set([1]);

/**
 * 体积与哈希：放在事务外先算，用来（1）提前 413、（2）算幂等请求哈希。
 * 结构校验在事务内做——体积检查是资源保护，结构检查是数据保护，次序不同。
 * @param {unknown} raw
 * @param {number} maxBytes
 */
export function measureSnapshot(raw, maxBytes) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw fail.invalid('SNAPSHOT_INVALID', '快照必须是 JSON 对象');
  }
  const bytes = canonicalBytes(raw);
  if (bytes > maxBytes) {
    throw fail.tooLarge(`快照 ${bytes} 字节，超过上限 ${maxBytes} 字节`);
  }
  return { bytes, hash: snapshotHash(raw) };
}


const ARRAY_FIELDS = [
  'sessions',
  'weights',
  'foods',
  'occurrences',
  'weekGoals',
  'customTemplates',
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 校验并返回归一化后的快照。
 *
 * @param {object} options
 * @param {unknown} options.raw 请求体里的 snapshot
 * @param {number} options.maxBytes 未压缩上限（字节，按规范化 UTF-8 计）
 * @param {string} [options.assignDatasetId] 服务端指派的数据集 id（初始化/replace/reinitialize）
 * @param {string} [options.expectDatasetId] 必须匹配的数据集 id
 * @param {Set<number>} [options.schemaVersions]
 * @param {Set<number>} [options.ruleVersions]
 * @returns {{ snapshot: Record<string, any>, hash: string, bytes: number, clientHashMismatch: boolean }}
 */
export function validateSnapshot(options) {
  const {
    raw,
    maxBytes,
    assignDatasetId,
    expectDatasetId,
    schemaVersions = SUPPORTED_SCHEMA_VERSIONS,
    ruleVersions = SUPPORTED_RULE_VERSIONS,
  } = options;

  if (!isPlainObject(raw)) {
    throw fail.invalid('SNAPSHOT_INVALID', '快照必须是 JSON 对象');
  }

  const schemaVersion = raw.schemaVersion;
  if (!Number.isInteger(schemaVersion)) {
    throw fail.unsupportedVersion('快照缺少整数 schemaVersion');
  }
  if (!schemaVersions.has(schemaVersion)) {
    throw fail.unsupportedVersion(`不支持的快照结构版本：${schemaVersion}`);
  }

  const ruleVersion = raw.ruleVersion;
  if (!Number.isInteger(ruleVersion)) {
    throw fail.unsupportedVersion('快照缺少整数 ruleVersion');
  }
  if (!ruleVersions.has(ruleVersion)) {
    throw fail.unsupportedVersion(`不支持的规则版本：${ruleVersion}`);
  }

  if (raw.canonicalizationVersion !== undefined) {
    if (!SUPPORTED_CANONICALIZATION_VERSIONS.has(raw.canonicalizationVersion)) {
      throw fail.unsupportedVersion(`不支持的规范化版本：${raw.canonicalizationVersion}`);
    }
  }

  if (raw.records === undefined || !isPlainObject(raw.records)) {
    throw fail.invalid('SNAPSHOT_INVALID', '快照缺少 records 对象');
  }

  for (const field of ARRAY_FIELDS) {
    const value = raw.records[field];
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      throw fail.invalid('SNAPSHOT_INVALID', `records.${field} 必须是数组`);
    }
  }

  /*
   * datasetId 归属：
   * - 初始化 / replace / reinitialize 由服务端指派，客户端提交值一律覆盖
   *   （这三条路径会换 datasetId，客户端持有的旧值必然过期）；
   * - 普通 PUT 必须与当前一致，否则就是把别人的数据集写进自己的记录。
   */
  const snapshot = { ...raw };
  if (assignDatasetId) {
    snapshot.datasetId = assignDatasetId;
  } else if (expectDatasetId && snapshot.datasetId !== expectDatasetId) {
    throw fail.invalid('DATASET_ID_MISMATCH', '快照的 datasetId 与服务端不一致');
  }

  const bytes = options.precomputed?.bytes ?? canonicalBytes(snapshot);
  if (bytes > maxBytes) {
    throw fail.tooLarge(`快照 ${bytes} 字节，超过上限 ${maxBytes} 字节`);
  }

  const hash = assignDatasetId ? snapshotHash(snapshot) : (options.precomputed?.hash ?? snapshotHash(snapshot));

  /*
   * 客户端哈希只作交叉校验：它可能算在"指派 datasetId 之前"，
   * 因此只有 datasetId 未被改写时才可能相等；不等不阻断，但要告知调用方，
   * 由路由决定记审计。
   */
  const clientHash = typeof raw.snapshotHash === 'string' ? raw.snapshotHash : null;
  const clientHashMismatch = Boolean(clientHash) && clientHash !== hash;

  return { snapshot, hash, bytes, clientHashMismatch };
}
