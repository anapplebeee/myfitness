import { describe, expect, it } from 'vitest';
import {
  applyImport,
  buildExport,
  canonicalJson,
  canonicalize,
  exportFileName,
  previewImport,
  stableHash,
  EXPORT_FORMAT,
  MAX_IMPORT_BYTES,
} from './transfer';
import type { AppState, Session, SetRecord, WeightEntry } from './types';

function set(id: string): SetRecord {
  return {
    id,
    kind: 'work',
    status: 'completed',
    loadGrams: 100000,
    reps: 5,
    durationSeconds: null,
    distanceMeters: null,
    rpe: null,
    completedAt: '2026-10-20T10:00:00.000Z',
  };
}

function session(id: string, date = '2026-10-20'): Session {
  return {
    id,
    templateId: null,
    dayId: null,
    title: '训练',
    status: 'completed',
    startedAt: `${date}T19:00:00.000Z`,
    endedAt: `${date}T20:00:00.000Z`,
    businessDate: date,
    restEndsAt: null,
    note: '',
    exercises: [
      {
        id: `se_${id}`,
        exerciseId: 'bb-squat',
        order: 0,
        targetSets: 3,
        repMin: 5,
        repMax: 8,
        restSeconds: 120,
        incrementGrams: 2500,
        sets: [set(`s_${id}`)],
      },
    ],
  };
}

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    version: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    onboarded: true,
    datasetId: 'ds_test',
    lastBackupKey: null,
    profile: {
      name: '',
      experience: 'beginner',
      equipment: 'gym',
      weeklyTarget: 3,
      heightCm: 175,
      sex: 'male',
      birthYear: 1995,
      activity: 1.4,
      restrictions: [],
      allergies: [],
      restrictionsConfirmed: false,
    },
    activeTemplateId: 'full-3',
    activeTemplateSince: '2026-10-01',
    sessions: [],
    weights: [],
    foods: [],
    bodyGoalGrams: null,
    goals: [],
    targetKcal: null,
    targetProtein: null,
    weeklyGoal: 3,
    occurrences: [],
    weekGoals: [],
    customTemplates: [],
    ...overrides,
  };
}

describe('AC-I01 · canonical 序列化', () => {
  it('键按字典序排列，与书写顺序无关', () => {
    const a = { b: 2, a: 1 };
    const b = { a: 1, b: 2 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('嵌套对象同样排序', () => {
    const a = { z: { y: 1, x: 2 } };
    const b = { z: { x: 2, y: 1 } };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('数组保持原序（顺序有语义）', () => {
    expect(canonicalJson([3, 1, 2])).not.toBe(canonicalJson([1, 2, 3]));
  });

  it('忽略 undefined 字段', () => {
    const a = { x: 1, y: undefined };
    const b = { x: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('区分 null 与缺失', () => {
    expect(canonicalJson({ x: null })).not.toBe(canonicalJson({}));
  });

  it('原始值原样返回', () => {
    expect(canonicalize(5)).toBe(5);
    expect(canonicalize('a')).toBe('a');
    expect(canonicalize(null)).toBeNull();
  });
});

describe('AC-I01 · 完整性哈希', () => {
  it('相同输入得到相同哈希', () => {
    expect(stableHash('hello')).toBe(stableHash('hello'));
  });

  it('不同输入得到不同哈希', () => {
    expect(stableHash('hello')).not.toBe(stableHash('hellp'));
  });

  it('哈希含长度后缀，能发现截断', () => {
    const h = stableHash('abc');
    expect(h).toContain('-3');
  });
});

describe('AC-I01 · 导出信封', () => {
  it('信封字段完整', () => {
    const env = buildExport(state(), 'ds_test', '2026-10-24T12:00:00.000Z');
    expect(env.format).toBe(EXPORT_FORMAT);
    expect(env.schemaVersion).toBe(1);
    expect(env.datasetId).toBe('ds_test');
    expect(env.exportedAt).toBe('2026-10-24T12:00:00.000Z');
    expect(env.checksum).toBeTruthy();
  });

  it('不导出 tombstone 场次', () => {
    const deleted = { ...session('s2'), deletedAt: '2026-10-21T00:00:00.000Z' };
    const env = buildExport(state({ sessions: [session('s1'), deleted] }), 'ds_test');
    expect(env.records.sessions).toHaveLength(1);
    expect(env.records.sessions[0]!.id).toBe('s1');
  });

  it('checksum 对规范化内容计算，重排键不影响', () => {
    const a = buildExport(state(), 'ds_test', '2026-10-24T12:00:00.000Z');
    const b = buildExport(state(), 'ds_test', '2026-10-24T12:00:00.000Z');
    expect(a.checksum).toBe(b.checksum);
  });

  it('内容变化导致 checksum 变化', () => {
    const a = buildExport(state(), 'ds_test', '2026-10-24T12:00:00.000Z');
    const b = buildExport(state({ sessions: [session('s1')] }), 'ds_test', '2026-10-24T12:00:00.000Z');
    expect(a.checksum).not.toBe(b.checksum);
  });
});

describe('AC-I02 · 导入校验与预览', () => {
  const base = () => buildExport(state({ sessions: [session('s1')] }), 'ds_test', '2026-10-24T12:00:00.000Z');

  it('合法文件通过', () => {
    const p = previewImport(JSON.stringify(base()), { currentDatasetId: 'ds_test', currentState: state() });
    expect(p.ok).toBe(true);
    expect(p.stats.sessions).toBe(1);
    expect(p.issues).toHaveLength(0);
  });

  it('非 JSON 被拒', () => {
    const p = previewImport('not json', { currentDatasetId: 'ds_test', currentState: state() });
    expect(p.ok).toBe(false);
    expect(p.issues[0]!.code).toBe('not_json');
  });

  it('缺 format 被拒', () => {
    const p = previewImport(JSON.stringify({ schemaVersion: 1 }), {
      currentDatasetId: 'ds_test',
      currentState: state(),
    });
    expect(p.ok).toBe(false);
    expect(p.issues[0]!.code).toBe('not_envelope');
  });

  it('未来版本被拒且提示升级', () => {
    const env = { ...base(), schemaVersion: 99 };
    const p = previewImport(JSON.stringify(env), { currentDatasetId: 'ds_test', currentState: state() });
    expect(p.ok).toBe(false);
    expect(p.issues[0]!.code).toBe('schema_future');
  });

  it('过大文件被拒', () => {
    const big = 'x'.repeat(MAX_IMPORT_BYTES + 1);
    const p = previewImport(big, { currentDatasetId: 'ds_test', currentState: state() });
    expect(p.ok).toBe(false);
    expect(p.issues[0]!.code).toBe('too_large');
  });

  it('checksum 不匹配只警告不阻断', () => {
    const env = { ...base(), checksum: 'deadbeef-0' };
    const p = previewImport(JSON.stringify(env), { currentDatasetId: 'ds_test', currentState: state() });
    expect(p.ok).toBe(true);
    expect(p.issues.some((i) => i.code === 'checksum_mismatch' && !i.fatal)).toBe(true);
  });

  it('不同 datasetId 只警告不阻断', () => {
    const p = previewImport(JSON.stringify(base()), { currentDatasetId: 'ds_other', currentState: state() });
    expect(p.ok).toBe(true);
    expect(p.issues.some((i) => i.code === 'dataset_mismatch')).toBe(true);
  });

  it('负重量被拒', () => {
    const env = buildExport(state({ sessions: [session('s1')] }), 'ds_test');
    const bad = JSON.parse(JSON.stringify(env)) as typeof env;
    bad.records.sessions[0]!.exercises[0]!.sets[0]!.loadGrams = -5;
    const p = previewImport(JSON.stringify(bad), { currentDatasetId: 'ds_test', currentState: state() });
    expect(p.ok).toBe(false);
    expect(p.issues.some((i) => i.code === 'bad_unit')).toBe(true);
  });

  it('体重数值不合理被拒', () => {
    const env = buildExport(state({ weights: [{ id: 'w1', date: '2026-10-20', grams: 999999 }] }), 'ds_test');
    const p = previewImport(JSON.stringify(env), { currentDatasetId: 'ds_test', currentState: state() });
    expect(p.ok).toBe(false);
    expect(p.issues.some((i) => i.code === 'bad_unit')).toBe(true);
  });

  it('同 ID 异内容列为冲突', () => {
    const incoming = session('s1');
    incoming.note = '改过';
    const env = buildExport(state({ sessions: [incoming] }), 'ds_test');
    const p = previewImport(JSON.stringify(env), {
      currentDatasetId: 'ds_test',
      currentState: state({ sessions: [session('s1')] }),
    });
    expect(p.conflicts).toHaveLength(1);
    expect(p.conflicts[0]!.entity).toBe('session');
  });

  it('同日体重冲突被识别', () => {
    const env = buildExport(
      state({ weights: [{ id: 'w2', date: '2026-10-20', grams: 80000 }] }),
      'ds_test',
    );
    const p = previewImport(JSON.stringify(env), {
      currentDatasetId: 'ds_test',
      currentState: state({ weights: [{ id: 'w1', date: '2026-10-20', grams: 79000 }] }),
    });
    expect(p.conflicts.some((c) => c.entity === 'weight')).toBe(true);
  });

  it('同周目标冲突被识别', () => {
    const goalA = { id: 'g1', weekStart: '2026-10-19', originalPlannedCount: 3, minimumTarget: 3, adjustments: [] };
    const goalB = { ...goalA, id: 'g2', minimumTarget: 2 };
    const env = buildExport(state({ weekGoals: [goalB] }), 'ds_test');
    const p = previewImport(JSON.stringify(env), {
      currentDatasetId: 'ds_test',
      currentState: state({ weekGoals: [goalA] }),
    });
    expect(p.conflicts.some((c) => c.entity === 'weekGoal')).toBe(true);
  });
});

describe('AC-I03 · 合并导入', () => {
  it('新记录被追加', () => {
    const env = buildExport(state({ sessions: [session('s1'), session('s2', '2026-10-21')] }), 'ds_test');
    const p = previewImport(JSON.stringify(env), { currentDatasetId: 'ds_test', currentState: state() });
    const r = applyImport(p, state(), 'merge');
    expect(r.added).toBe(2);
    expect(r.state.sessions).toHaveLength(2);
  });

  it('同 ID 同内容被跳过', () => {
    const env = buildExport(state({ sessions: [session('s1')] }), 'ds_test');
    const p = previewImport(JSON.stringify(env), {
      currentDatasetId: 'ds_test',
      currentState: state({ sessions: [session('s1')] }),
    });
    const r = applyImport(p, state({ sessions: [session('s1')] }), 'merge');
    expect(r.added).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.state.sessions).toHaveLength(1);
  });

  it('同 ID 异内容保留本地不覆盖', () => {
    const incoming = session('s1');
    incoming.note = '导入版';
    const local = session('s1');
    local.note = '本地版';
    const env = buildExport(state({ sessions: [incoming] }), 'ds_test');
    const p = previewImport(JSON.stringify(env), {
      currentDatasetId: 'ds_test',
      currentState: state({ sessions: [local] }),
    });
    const r = applyImport(p, state({ sessions: [local] }), 'merge');
    expect(r.state.sessions[0]!.note).toBe('本地版');
    expect(r.conflicts).toBe(1);
  });

  it('体重按日期去重', () => {
    const w: WeightEntry = { id: 'w2', date: '2026-10-20', grams: 80000 };
    const env = buildExport(state({ weights: [w] }), 'ds_test');
    const local: WeightEntry = { id: 'w1', date: '2026-10-20', grams: 79000 };
    const p = previewImport(JSON.stringify(env), {
      currentDatasetId: 'ds_test',
      currentState: state({ weights: [local] }),
    });
    const r = applyImport(p, state({ weights: [local] }), 'merge');
    expect(r.state.weights).toHaveLength(1);
    expect(r.state.weights[0]!.grams).toBe(79000);
  });
});

describe('AC-I04 · 替换导入与备份', () => {
  it('替换后是文件内容，并返回备份', () => {
    const local = state({ sessions: [session('old')] });
    const env = buildExport(state({ sessions: [session('new1')] }), 'ds_test');
    const p = previewImport(JSON.stringify(env), { currentDatasetId: 'ds_test', currentState: local });
    const r = applyImport(p, local, 'replace');
    expect(r.state.sessions).toHaveLength(1);
    expect(r.state.sessions[0]!.id).toBe('new1');
    expect(r.backup?.sessions[0]!.id).toBe('old');
  });

  it('校验失败时不做任何修改', () => {
    const local = state({ sessions: [session('keep')] });
    const p = previewImport('{}', { currentDatasetId: 'ds_test', currentState: local });
    const r = applyImport(p, local, 'replace');
    expect(r.state.sessions).toHaveLength(1);
    expect(r.backup).toBeNull();
  });
});

describe('AC-I01 · 导出文件名', () => {
  it('含数据集与时间戳', () => {
    const name = exportFileName('ds_abc', new Date(2026, 9, 24, 20, 5));
    expect(name).toBe('lianji-ds_abc-20261024-2005.json');
  });
});


