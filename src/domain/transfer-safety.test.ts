/**
 * 导入路径的数据安全测试。
 *
 * 覆盖三个 CRITICAL：
 * - C1  replace 模式自动备份指针被覆盖丢失（在 store 层验证）
 * - C2  merge（默认模式）不处理 goals，导入后目标静默消失
 * - C2b replace 导入旧版导出（无 goals 字段）会清空本地 goals
 * 以及 H1（merge 不去重文件内部重复项）。
 *
 * 注意：applyImport 要求 preview.ok。构造合法信封必须用 buildExport
 * 生成真实 checksum，否则会被 checksum_mismatch 拦下。
 */

import { describe, expect, it } from 'vitest';
import { applyImport, buildExport, previewImport } from './transfer';
import type { AppState, FoodEntry, Session, WeightEntry } from './types';
import type { Goal } from './goals';
import type { PlannedOccurrence, WeekGoal } from './week';

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    version: 2, createdAt: '2026-01-01T00:00:00.000Z', onboarded: true, datasetId: 'ds_local',
    lastBackupKey: null,
    profile: {
      name: '', experience: 'beginner', equipment: 'gym', weeklyTarget: 3,
      heightCm: 175, sex: 'male', birthYear: 1995, activity: 1.4,
      restrictions: [], allergies: [], restrictionsConfirmed: false,
    },
    activeTemplateId: null, activeTemplateSince: null,
    sessions: [], weights: [], foods: [], bodyGoalGrams: null, goals: [],
    targetKcal: null, targetProtein: null, weeklyGoal: 3,
    occurrences: [], weekGoals: [], customTemplates: [],
    ...overrides,
  };
}

const strengthGoal: Goal = {
  kind: 'strength', exerciseId: 'bb-squat', targetGrams: 100000, targetDate: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

/** 用 buildExport 生成带合法 checksum 的信封。 */
function legalEnvelope(source: AppState, datasetId = 'ds_local'): string {
  return JSON.stringify(buildExport(source, datasetId));
}

/** 手工构造带合法 checksum 的信封（用于构造 buildExport 无法表达的形态）。 */
function legalEnvelopeRaw(records: Record<string, unknown>, datasetId = 'ds_local'): string {
  // 用同一份 records 生成探测状态，保证 checksum 与实际内容匹配
  const probe = state({ ...(records as Partial<AppState>) });
  const built = JSON.parse(JSON.stringify(buildExport(probe, datasetId))) as Record<string, unknown>;
  // 只替换 records 与 datasetId，其余信封字段沿用探测值，checksum 保持有效
  return JSON.stringify({
    ...built,
    datasetId,
    records,
  });
}

function previewOf(raw: string, current: AppState) {
  return previewImport(raw, { currentDatasetId: current.datasetId, currentState: current });
}

describe('CRITICAL · merge 模式必须保留 goals', () => {
  it('本地 goals 在 merge 后不丢失', () => {
    const current = state({ goals: [strengthGoal] });
    const raw = legalEnvelope(state());
    const r = applyImport(previewOf(raw, current), current, 'merge');
    expect(r.state.goals).toEqual([strengthGoal]);
  });

  it('文件带来的新 goals 应追加', () => {
    const current = state({ goals: [] });
    const raw = legalEnvelope(state({ goals: [strengthGoal] }));
    const r = applyImport(previewOf(raw, current), current, 'merge');
    expect(r.state.goals).toContainEqual(strengthGoal);
  });
});

describe('CRITICAL · replace 模式的 goals 处理', () => {
  it('文件带 goals 时应采用', () => {
    const current = state({ goals: [] });
    const raw = legalEnvelope(state({ goals: [strengthGoal] }));
    const r = applyImport(previewOf(raw, current), current, 'replace');
    expect(r.state.goals).toContainEqual(strengthGoal);
  });

  it('旧版导出无 goals 时不应清空本地 goals', () => {
    const current = state({ goals: [strengthGoal] });
    // 构造一个 records 里没有 goals 的信封
    const raw = legalEnvelopeRaw({
      sessions: [], weights: [], foods: [], occurrences: [], weekGoals: [], customTemplates: [],
    });
    const r = applyImport(previewOf(raw, current), current, 'replace');
    expect(r.state.goals).toEqual([strengthGoal]);
  });

  it('replace 必须返回 backup', () => {
    const current = state({ goals: [strengthGoal] });
    const raw = legalEnvelope(state());
    const r = applyImport(previewOf(raw, current), current, 'replace');
    expect(r.backup).not.toBeNull();
    expect(r.backup!.goals).toEqual([strengthGoal]);
  });

  it('replace 保留本机 datasetId / version / createdAt / onboarded', () => {
    const current = state({ datasetId: 'ds_local', version: 2, createdAt: '2026-01-01T00:00:00.000Z' });
    const raw = legalEnvelope(state({ datasetId: 'ds_other' }), 'ds_other');
    const r = applyImport(previewOf(raw, current), current, 'replace');
    expect(r.state.datasetId).toBe('ds_local');
    expect(r.state.version).toBe(2);
    expect(r.state.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(r.state.onboarded).toBe(true);
  });

  it('replace 忽略非正 weeklyGoal', () => {
    const current = state({ weeklyGoal: 3 });
    const raw = legalEnvelopeRaw({
      sessions: [], weights: [], foods: [], occurrences: [], weekGoals: [], customTemplates: [], weeklyGoal: 0,
    });
    const r = applyImport(previewOf(raw, current), current, 'replace');
    expect(r.state.weeklyGoal).toBe(3);
  });
});

describe('HIGH · merge 不去重文件内部重复项', () => {
  const w: WeightEntry = { id: 'w1', date: '2026-10-01', grams: 80000, note: '' };
  const s: Session = {
    id: 's1', templateId: null, dayId: null, title: 't', status: 'completed',
    startedAt: '2026-10-01T10:00:00.000Z', endedAt: '2026-10-01T11:00:00.000Z',
    businessDate: '2026-10-01', restEndsAt: null, note: '', exercises: [],
  };
  const f: FoodEntry = {
    id: 'f1', date: '2026-10-01', slot: 'lunch', label: '米饭',
    kcal: 300, protein: 8, createdAt: '2026-10-01T12:00:00.000Z',
  };
  const o: PlannedOccurrence = {
    id: 'o1', planVersionId: 'v1', weekStart: '2026-10-19', originalDate: '2026-10-19',
    scheduledDate: '2026-10-19', slotId: 'sl', title: 't', exerciseIds: [], disposition: 'scheduled',
  };
  const g: WeekGoal = { id: 'g1', weekStart: '2026-10-19', originalPlannedCount: 1, minimumTarget: 1, adjustments: [] };

  const cases: Array<[string, Record<string, unknown>, (r: ReturnType<typeof applyImport>) => number]> = [
    ['同日体重', { weights: [w, { ...w, id: 'w2' }] }, (r) => r.state.weights.filter((x) => x.date === '2026-10-01').length],
    ['同 id 会话', { sessions: [s, { ...s }] }, (r) => r.state.sessions.filter((x) => x.id === 's1').length],
    ['同 id 食物', { foods: [f, { ...f }] }, (r) => r.state.foods.filter((x) => x.id === 'f1').length],
    ['同 id 安排', { occurrences: [o, { ...o }] }, (r) => r.state.occurrences.filter((x) => x.id === 'o1').length],
    ['同周目标', { weekGoals: [g, { ...g }] }, (r) => r.state.weekGoals.filter((x) => x.weekStart === '2026-10-19').length],
  ];

  for (const [name, records, count] of cases) {
    it(`文件内重复的${name}不产生重复记录`, () => {
      const current = state();
      const raw = legalEnvelopeRaw({ sessions: [], weights: [], foods: [], occurrences: [], weekGoals: [], customTemplates: [], ...records });
      const r = applyImport(previewOf(raw, current), current, 'merge');
      expect(count(r)).toBe(1);
    });
  }
});

describe('MEDIUM · merge 其余实体类型', () => {
  it('occurrences / weekGoals 合并追加', () => {
    const current = state();
    const raw = legalEnvelopeRaw({
      sessions: [], weights: [], foods: [],
      occurrences: [{
        id: 'o1', planVersionId: 'v1', weekStart: '2026-10-19', originalDate: '2026-10-19',
        scheduledDate: '2026-10-19', slotId: 'sl', title: 't', exerciseIds: [], disposition: 'scheduled',
      }],
      weekGoals: [{ id: 'g1', weekStart: '2026-10-19', originalPlannedCount: 1, minimumTarget: 1, adjustments: [] }],
      customTemplates: [],
    });
    const r = applyImport(previewOf(raw, current), current, 'merge');
    expect(r.state.occurrences).toHaveLength(1);
    expect(r.state.weekGoals).toHaveLength(1);
  });
});

describe('MEDIUM · 信封形态与 schema 版本', () => {
  it('schemaVersion 0 被拒为 schema_unknown', () => {
    const current = state();
    const built = JSON.parse(legalEnvelope(current)) as Record<string, unknown>;
    const raw = JSON.stringify({ ...built, schemaVersion: 0 });
    const p = previewOf(raw, current);
    expect(p.ok).toBe(false);
    expect(p.issues.some((i) => i.code === 'schema_unknown')).toBe(true);
  });

  it('非对象 JSON 被拒', () => {
    const current = state();
    for (const raw of ['null', '[]', '42', '"str"']) {
      const p = previewOf(raw, current);
      expect(p.ok).toBe(false);
      expect(p.envelope).toBeNull();
    }
  });

  it('缺失 checksum 字段应报告 checksum_mismatch（非致命，不阻断）', () => {
    const current = state();
    const built = JSON.parse(legalEnvelope(current)) as Record<string, unknown>;
    delete built.checksum;
    const p = previewOf(JSON.stringify(built), current);
    // 设计口径：checksum 问题是提示而非阻断（transfer.ts:267-274 注释）
    expect(p.issues.some((i) => i.code === 'checksum_mismatch')).toBe(true);
    expect(p.issues.find((i) => i.code === 'checksum_mismatch')!.fatal).toBe(false);
  });

  it('被篡改的 records 应报告 checksum_mismatch', () => {
    const current = state();
    const built = JSON.parse(legalEnvelope(state({ weeklyGoal: 3 }))) as Record<string, unknown>;
    // 改内容但不改 checksum
    (built.records as Record<string, unknown>).weeklyGoal = 9;
    const p = previewOf(JSON.stringify(built), current);
    expect(p.issues.some((i) => i.code === 'checksum_mismatch')).toBe(true);
  });

  it('畸形 records（非数组）不抛错，返回 ok:false', () => {
    const current = state();
    for (const records of [{ sessions: {} }, { sessions: 5 }, { weights: {} }, { foods: null }, { occurrences: 'x' }, { weekGoals: {} }, { customTemplates: 7 }]) {
      const raw = JSON.stringify({
        format: 'tieguan.export', schemaVersion: 1, exportedAt: '2026-10-01T00:00:00.000Z',
        datasetId: 'ds_local',
        dataset: { createdAt: '2026-01-01T00:00:00.000Z', appStateVersion: 2, accountingTimezone: 'Asia/Shanghai' },
        records, contentRefs: {}, checksum: '',
      });
      let p;
      expect(() => { p = previewOf(raw, current); }).not.toThrow();
      expect(p!.ok).toBe(false);
    }
  });
});
