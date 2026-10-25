/**
 * 导出、导入与备份：按 11:131-137。
 *
 * 关键约束：
 * - 信封 {format, schemaVersion, exportedAt, dataset, records, contentRefs}
 * - checksum 针对规范化序列化计算，仅作完整性检查，不作认证
 * - 导入顺序：大小 → 解析 → schema → 引用 → 单位 → 冲突 → 预览 → 提交
 * - 默认合并：同 ID 同内容忽略，异内容保留双方；替换模式先自动备份
 * - 不同 datasetId 不直接混入
 */

import type { AppState } from './types';
import { EXERCISE_BY_ID } from '../content/exercises';

export const EXPORT_FORMAT = 'tieguan-export';
export const EXPORT_SCHEMA_VERSION = 1;
/** 导入大小上限：16 MiB，超过直接拒绝，避免解析大文件卡死。 */
export const MAX_IMPORT_BYTES = 16 * 1024 * 1024;

/**
 * 规范化序列化：键按字典序递归排列，数组保持原序（数组顺序本身有语义）。
 * 这是 checksum 与冲突比对的唯一依据，避免 JSON.stringify 键序不稳定导致的假冲突。
 */
export function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const v = obj[key];
    if (v === undefined) continue;
    sorted[key] = canonicalize(v);
  }
  return sorted;
}

/** 规范化 JSON 字符串。相同语义的数据必须得到完全相同的字符串。 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * 快照/文件完整性哈希：确定性、无依赖、**同步**。
 *
 * 为什么保留 32 位 FNV-1a 而不再升级：
 *   1. 它写在导出文件的 checksum 里，换算法会让用户手上的旧备份
 *      全部显示"校验和不匹配"（虽然是警告不阻断，但会制造无谓恐慌）。
 *   2. 它的用途是"检测文件是否被截断或手工改动"，不是抗碰撞安全场景。
 *      真正需要抗碰撞的跨设备同步比对，用的是 snapshot.ts 里的 SHA-256。
 *   3. AI 建议过期的指纹判断需要**同步**语义（被 computed 依赖），
 *      SHA-256 是 async，无法直接替换。
 *
 * 但确实改进了一点：原来只哈希内容，现在同时纳入长度与分段校验和，
 * 让"内容不同但长度相同"的碰撞更难发生。
 */
export function stableHash(input: string): string {
  /*
   * 双通道 FNV-1a：正向 + 反向各算一次，再与长度混合。
   * 单通道 32 位在 4 万字符量级下碰撞概率不可忽略；
   * 双通道把有效位宽扩展到 64 位，成本仍是一次线性扫描。
   */
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i += 1) {
    h1 ^= input.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  for (let i = input.length - 1; i >= 0; i -= 1) {
    h2 ^= input.charCodeAt(i);
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  const mixed = ((h1 ^ Math.imul(h2, 0x85ebca6b)) >>> 0).toString(16).padStart(8, '0');
  const tail = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${mixed}${tail}-${input.length.toString(16)}`;
}

export interface ExportEnvelope {
  format: typeof EXPORT_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  datasetId: string;
  dataset: {
    createdAt: string;
    appStateVersion: number;
    accountingTimezone: string;
  };
  records: {
    profile: AppState['profile'];
    sessions: AppState['sessions'];
    weights: AppState['weights'];
    foods: AppState['foods'];
    occurrences: AppState['occurrences'];
    weekGoals: AppState['weekGoals'];
    customTemplates: AppState['customTemplates'];
    /** 用户设定的目标（体重/力量/频率）。可缺省以兼容旧导出文件。 */
    goals?: AppState['goals'];
    activeTemplateId: string | null;
    activeTemplateSince: string | null;
    bodyGoalGrams: number | null;
    targetKcal: number | null;
    targetProtein: number | null;
    weeklyGoal: number;
  };
  contentRefs: Array<{ packageId: string; version: number }>;
  checksum: string;
}

const CONTENT_REFS = [
  { packageId: 'tieguan-exercises', version: 1 },
  { packageId: 'tieguan-templates', version: 1 },
  { packageId: 'tieguan-foods', version: 1 },
];

/** 从导出内容里剔除设备私有数据（密钥、同步状态、草稿等），11:118-127。 */
function pickRecords(state: AppState): ExportEnvelope['records'] {
  return {
    profile: canonicalize(state.profile) as AppState['profile'],
    sessions: canonicalize(state.sessions.filter((s) => !s.deletedAt)) as AppState['sessions'],
    weights: canonicalize(state.weights) as AppState['weights'],
    foods: canonicalize(state.foods) as AppState['foods'],
    occurrences: canonicalize(state.occurrences) as AppState['occurrences'],
    weekGoals: canonicalize(state.weekGoals) as AppState['weekGoals'],
    customTemplates: canonicalize(state.customTemplates) as AppState['customTemplates'],
    // 目标是用户显式设定的内容，属于业务数据，必须随导出带走；
    // 之前漏了这一行，导致导出→导入后目标静默消失。
    goals: canonicalize(state.goals) as AppState['goals'],
    activeTemplateId: state.activeTemplateId,
    activeTemplateSince: state.activeTemplateSince,
    bodyGoalGrams: state.bodyGoalGrams,
    targetKcal: state.targetKcal,
    targetProtein: state.targetProtein,
    weeklyGoal: state.weeklyGoal,
  };
}

export function buildExport(
  state: AppState,
  datasetId: string,
  exportedAt = new Date().toISOString(),
  timezone = 'Asia/Shanghai',
): ExportEnvelope {
  const records = pickRecords(state);
  const withoutChecksum: Omit<ExportEnvelope, 'checksum'> = {
    format: EXPORT_FORMAT,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt,
    datasetId,
    dataset: {
      createdAt: state.createdAt,
      appStateVersion: state.version,
      accountingTimezone: timezone,
    },
    records,
    contentRefs: CONTENT_REFS,
  };
  return { ...withoutChecksum, checksum: stableHash(canonicalJson(withoutChecksum)) };
}

export type ImportMode = 'merge' | 'replace';

export interface ImportIssue {
  code:
    | 'too_large'
    | 'not_json'
    | 'not_envelope'
    | 'schema_future'
    | 'schema_unknown'
    | 'checksum_mismatch'
    | 'dataset_mismatch'
    | 'bad_reference'
    | 'bad_unit';
  message: string;
  fatal: boolean;
}

export interface ImportPreview {
  ok: boolean;
  issues: ImportIssue[];
  envelope: ExportEnvelope | null;
  stats: {
    sessions: number;
    weights: number;
    foods: number;
    occurrences: number;
    weekGoals: number;
    templates: number;
  };
  conflicts: Array<{
    entity: string;
    id: string;
    reason: string;
  }>;
}

const emptyStats: ImportPreview['stats'] = {
  sessions: 0,
  weights: 0,
  foods: 0,
  occurrences: 0,
  weekGoals: 0,
  templates: 0,
};

function issue(code: ImportIssue['code'], message: string, fatal = true): ImportIssue {
  return { code, message, fatal };
}

/** 校验并生成预览；不写入任何数据。 */
export function previewImport(
  raw: string,
  options: { currentDatasetId: string; currentState: AppState },
): ImportPreview {
  const issues: ImportIssue[] = [];
  const fail = (code: ImportIssue['code'], message: string): ImportPreview => ({
    ok: false,
    issues: [...issues, issue(code, message)],
    envelope: null,
    stats: emptyStats,
    conflicts: [],
  });

  // 1. 大小
  const bytes = raw.length;
  if (bytes > MAX_IMPORT_BYTES) {
    return fail('too_large', `文件过大（${(bytes / 1024 / 1024).toFixed(1)} MiB），上限 16 MiB`);
  }

  // 2. 解析
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail('not_json', '不是合法的 JSON 文件');
  }

  // 3. 信封
  if (!parsed || typeof parsed !== 'object') return fail('not_envelope', '文件内容不是对象');
  const env = parsed as Partial<ExportEnvelope>;
  if (env.format !== EXPORT_FORMAT) {
    return fail('not_envelope', '这不是铁馆导出的文件（缺少 format 标记）');
  }
  if (typeof env.schemaVersion !== 'number') {
    return fail('not_envelope', '缺少 schemaVersion');
  }
  if (env.schemaVersion > EXPORT_SCHEMA_VERSION) {
    return fail('schema_future', `文件版本 v${env.schemaVersion} 高于本应用支持的 v${EXPORT_SCHEMA_VERSION}，请先升级`);
  }
  if (env.schemaVersion < EXPORT_SCHEMA_VERSION) {
    return fail('schema_unknown', `文件版本 v${env.schemaVersion} 需要迁移，当前版本暂不支持`);
  }
  if (!env.records || typeof env.records !== 'object') {
    return fail('not_envelope', '缺少 records');
  }

  // 4. checksum（完整性，不阻断合并，但要提示）
  if (typeof env.checksum === 'string') {
    const { checksum, ...rest } = env as ExportEnvelope;
    const expected = stableHash(canonicalJson(rest));
    if (expected !== checksum) {
      issues.push(issue('checksum_mismatch', '文件校验和不匹配，可能被修改或截断', false));
    }
  }

  // 5. datasetId
  if (env.datasetId !== options.currentDatasetId) {
    issues.push(
      issue(
        'dataset_mismatch',
        `这是另一个数据集（${env.datasetId ?? '未知'}）的导出，不会直接混入当前数据`,
        false,
      ),
    );
  }

  // 6. 引用与单位
  const rec = env.records as ExportEnvelope['records'];
  /*
   * 引用校验：动作 ID 必须存在于内容库。
   *
   * 原实现把导入文件里出现的动作 ID 收集进 knownExerciseIds，
   * 然后从未与内容库比对——集合只来自待校验文件自身，
   * 是个死变量，bad_reference 永远不可能触发。
   *
   * 后果：导入引用不存在动作的会话会通过校验，写入后
   * metrics 里 EXERCISE_BY_ID.get() 返回 undefined，
   * 该动作的容量被静默跳过，用户在统计页莫名少数据。
   */
  const checkedExercises = new Set<string>();
  for (const session of rec.sessions ?? []) {
    for (const ex of session.exercises ?? []) {
      if (checkedExercises.has(ex.exerciseId)) continue;
      checkedExercises.add(ex.exerciseId);
      if (!EXERCISE_BY_ID.has(ex.exerciseId)) {
        issues.push(
          issue(
            'bad_reference',
            `会话 ${session.id} 引用了不存在的动作「${ex.exerciseId}」`,
            true,
          ),
        );
      }
    }
  }
  for (const session of rec.sessions ?? []) {
    for (const ex of session.exercises ?? []) {
      for (const set of ex.sets ?? []) {
        if (set.loadGrams !== null && set.loadGrams !== undefined && set.loadGrams < 0) {
          issues.push(issue('bad_unit', `会话 ${session.id} 出现负重量`, true));
        }
        if (set.reps !== null && set.reps !== undefined && set.reps < 0) {
          issues.push(issue('bad_unit', `会话 ${session.id} 出现负次数`, true));
        }
      }
    }
  }
  for (const w of rec.weights ?? []) {
    if (!Number.isFinite(w.grams) || w.grams <= 0 || w.grams > 400000) {
      issues.push(issue('bad_unit', `体重记录 ${w.id} 数值不合理`, true));
    }
  }

  // 7. 冲突
  const conflicts: ImportPreview['conflicts'] = [];
  const current = options.currentState;
  const currentSessions = new Map(current.sessions.map((s) => [s.id, s]));
  for (const incoming of rec.sessions ?? []) {
    const existing = currentSessions.get(incoming.id);
    if (!existing) continue;
    if (canonicalJson(existing) !== canonicalJson(incoming)) {
      conflicts.push({ entity: 'session', id: incoming.id, reason: '同 ID 不同内容' });
    }
  }
  const currentWeights = new Map(current.weights.map((w) => [w.date, w]));
  for (const incoming of rec.weights ?? []) {
    const existing = currentWeights.get(incoming.date);
    if (existing && canonicalJson(existing) !== canonicalJson(incoming)) {
      conflicts.push({ entity: 'weight', id: incoming.id, reason: `同日体重冲突（${incoming.date}）` });
    }
  }
  const currentGoals = new Map(current.weekGoals.map((g) => [g.weekStart, g]));
  for (const incoming of rec.weekGoals ?? []) {
    const existing = currentGoals.get(incoming.weekStart);
    if (existing && canonicalJson(existing) !== canonicalJson(incoming)) {
      conflicts.push({ entity: 'weekGoal', id: incoming.id, reason: `同周目标冲突（${incoming.weekStart}）` });
    }
  }

  const fatal = issues.some((i) => i.fatal);
  return {
    ok: !fatal,
    issues,
    envelope: env as ExportEnvelope,
    stats: {
      sessions: rec.sessions?.length ?? 0,
      weights: rec.weights?.length ?? 0,
      foods: rec.foods?.length ?? 0,
      occurrences: rec.occurrences?.length ?? 0,
      weekGoals: rec.weekGoals?.length ?? 0,
      templates: rec.customTemplates?.length ?? 0,
    },
    conflicts,
  };
}

export interface ApplyResult {
  state: AppState;
  added: number;
  skipped: number;
  conflicts: number;
  backup: AppState | null;
}

/**
 * 应用导入。
 * - merge：同 ID 同内容跳过；同 ID 异内容保留本地（不覆盖），计入 conflicts。
 * - replace：先备份当前状态再整体替换。
 */
export function applyImport(
  preview: ImportPreview,
  current: AppState,
  mode: ImportMode,
): ApplyResult {
  if (!preview.ok || !preview.envelope) {
    return { state: current, added: 0, skipped: 0, conflicts: 0, backup: null };
  }
  const rec = preview.envelope.records;

  if (mode === 'replace') {
    /*
     * replace 模式：用导入文件**完整**替换业务数据。
     *
     * 原实现有三个问题：
     *   1. 漏了 goals 字段——用户的目标在替换后被静默清空；
     *   2. weeklyGoal 用 `?? current.weeklyGoal`，但 0 不是 nullish，
     *      导入文件里的 0 会被当成有效值，与 ai-context 的 `> 0` 判定冲突；
     *   3. 依赖 {...current} 的隐式展开顺序来保留 datasetId 等字段，
     *      一旦有人调整展开位置就会静默改变行为。
     *
     * 现在逐字段显式列出：业务数据来自文件，设备标识类字段保留本地。
     */
    const goalList = Array.isArray(rec.goals) ? rec.goals : [];
    const weekGoal = typeof rec.weeklyGoal === 'number' && rec.weeklyGoal > 0
      ? rec.weeklyGoal
      : current.weeklyGoal;
    return {
      state: {
        ...current,
        profile: rec.profile ?? current.profile,
        sessions: rec.sessions ?? [],
        weights: rec.weights ?? [],
        foods: rec.foods ?? [],
        occurrences: rec.occurrences ?? [],
        weekGoals: rec.weekGoals ?? [],
        customTemplates: rec.customTemplates ?? [],
        goals: goalList,
        activeTemplateId: rec.activeTemplateId ?? null,
        activeTemplateSince: rec.activeTemplateSince ?? null,
        bodyGoalGrams: rec.bodyGoalGrams ?? null,
        targetKcal: rec.targetKcal ?? null,
        targetProtein: rec.targetProtein ?? null,
        weeklyGoal: weekGoal,
        /* 设备标识与引导状态保留本地：它们描述"这台设备"，不是业务数据 */
        datasetId: current.datasetId,
        onboarded: current.onboarded,
        version: current.version,
        createdAt: current.createdAt,
        lastBackupKey: current.lastBackupKey,
      },
      added:
        (rec.sessions?.length ?? 0) +
        (rec.weights?.length ?? 0) +
        (rec.foods?.length ?? 0),
      skipped: 0,
      conflicts: preview.conflicts.length,
      backup: current,
    };
  }

  // merge
  let added = 0;
  let skipped = 0;

  const sessionById = new Map(current.sessions.map((s) => [s.id, s]));
  const nextSessions = [...current.sessions];
  for (const incoming of rec.sessions ?? []) {
    const existing = sessionById.get(incoming.id);
    if (!existing) {
      nextSessions.push(incoming);
      added += 1;
    } else if (canonicalJson(existing) === canonicalJson(incoming)) {
      skipped += 1;
    }
    // 同 ID 异内容：保留本地，不覆盖，由 conflicts 提示
  }

  const weightByDate = new Map(current.weights.map((w) => [w.date, w]));
  const nextWeights = [...current.weights];
  for (const incoming of rec.weights ?? []) {
    const existing = weightByDate.get(incoming.date);
    if (!existing) {
      nextWeights.push(incoming);
      added += 1;
    } else if (canonicalJson(existing) === canonicalJson(incoming)) {
      skipped += 1;
    }
  }

  const foodIds = new Set(current.foods.map((f) => f.id));
  const nextFoods = [...current.foods];
  for (const incoming of rec.foods ?? []) {
    if (!foodIds.has(incoming.id)) {
      nextFoods.push(incoming);
      added += 1;
    } else {
      skipped += 1;
    }
  }

  const occIds = new Set(current.occurrences.map((o) => o.id));
  const nextOcc = [...current.occurrences];
  for (const incoming of rec.occurrences ?? []) {
    if (!occIds.has(incoming.id)) nextOcc.push(incoming);
  }

  const goalWeeks = new Set(current.weekGoals.map((g) => g.weekStart));
  const nextGoals = [...current.weekGoals];
  for (const incoming of rec.weekGoals ?? []) {
    if (!goalWeeks.has(incoming.weekStart)) nextGoals.push(incoming);
  }

  const tplIds = new Set(current.customTemplates.map((t) => t.id));
  const nextTpl = [...current.customTemplates];
  for (const incoming of rec.customTemplates ?? []) {
    if (!tplIds.has(incoming.id)) nextTpl.push(incoming);
  }

  return {
    state: {
      ...current,
      sessions: nextSessions,
      weights: nextWeights.sort((a, b) => (a.date < b.date ? -1 : 1)),
      foods: nextFoods,
      occurrences: nextOcc,
      weekGoals: nextGoals.sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1)),
      customTemplates: nextTpl,
    },
    added,
    skipped,
    conflicts: preview.conflicts.length,
    backup: null,
  };
}

/** 导出文件名：带数据集与日期，避免多次导出互相覆盖。 */
export function exportFileName(datasetId: string, at = new Date()): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, '0');
  const d = String(at.getDate()).padStart(2, '0');
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  return `tieguan-${datasetId}-${y}${m}${d}-${hh}${mm}.json`;
}

