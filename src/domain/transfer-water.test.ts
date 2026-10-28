import { describe, expect, it } from 'vitest';
import { applyImport, buildExport, previewImport } from './transfer';
import type { AppState } from './types';

function baseState(overrides: Partial<AppState> = {}): AppState {
  return {
    version: 2,
    createdAt: '2026-10-27T00:00:00.000Z',
    profile: { name: '', sex: 'male', heightCm: 175 } as AppState['profile'],
    activeTemplateId: null,
    sessions: [],
    weights: [],
    foods: [],
    bodyGoalGrams: null,
    goals: [],
    targetKcal: null,
    targetProtein: null,
    weeklyGoal: 3,
    onboarded: true,
    occurrences: [],
    weekGoals: [],
    activeTemplateSince: null,
    customTemplates: [],
    datasetId: 'ds_test',
    lastBackupKey: null,
    water: [],
    waterGoalMl: 2000,
    reminders: {
      workoutEnabled: true,
      workoutTime: '19:00',
      waterEnabled: true,
      waterIntervalMin: 120,
      waterStart: '09:00',
      waterEnd: '21:00',
    },
    ...overrides,
  };
}

const water = (id: string, ml: number) => ({
  id,
  date: '2026-10-27',
  ml,
  createdAt: '2026-10-27T08:00:00.000Z',
});

describe('饮水与提醒必须进备份', () => {
  it('导出包含饮水、饮水目标与提醒设置', () => {
    const state = baseState({ water: [water('w1', 300)] });
    const env = buildExport(state, state.datasetId);
    expect(env.records.water).toHaveLength(1);
    expect(env.records.waterGoalMl).toBe(2000);
    expect(env.records.reminders?.workoutTime).toBe('19:00');
  });

  it('replace 导入后饮水与提醒被恢复（旧文件缺字段则保留本地）', () => {
    const source = baseState({ water: [water('w1', 900)] });
    const raw = JSON.stringify(buildExport(source, source.datasetId));
    const current = baseState({ datasetId: 'ds_local', water: [water('old', 300)] });
    const preview = previewImport(raw, { currentDatasetId: current.datasetId, currentState: current });
    expect(preview.ok).toBe(true);
    const result = applyImport(preview, current, 'replace');
    expect(result.state.water).toHaveLength(1);
    expect(result.state.water![0]!.ml).toBe(900);
    expect(result.state.reminders?.waterStart).toBe('09:00');
  });

  it('merge 导入按条目 id 合并饮水，不丢任何一边', () => {
    const source = baseState({ water: [water('w2', 500)] });
    const raw = JSON.stringify(buildExport(source, source.datasetId));
    const current = baseState({ datasetId: 'ds_local', water: [water('w1', 300)] });
    const preview = previewImport(raw, { currentDatasetId: current.datasetId, currentState: current });
    const result = applyImport(preview, current, 'merge');
    expect(result.state.water!.map((w) => w.id).sort()).toEqual(['w1', 'w2']);
  });
});
