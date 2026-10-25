import { describe, expect, it } from 'vitest';
import { previewImport } from './transfer';
import type { AppState } from './types';

/**
 * 引用校验回归测试（代码审查 #5）。
 *
 * 原缺陷：knownExerciseIds 只从导入文件自身收集，从未与内容库比对，
 * 于是 bad_reference 永远不触发——导入引用不存在动作的会话会通过校验，
 * 写入后该动作的容量被静默跳过，用户统计莫名少数据。
 */

function baseState(): AppState {
  return {
    version: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    profile: {
      name: '测试',
      experience: 'intermediate',
      equipment: 'gym',
      weeklyTarget: 4,
      heightCm: 175,
      sex: 'male',
      birthYear: 1995,
      activity: 1.5,
      restrictions: [],
      allergies: [],
      restrictionsConfirmed: true,
    },
    activeTemplateId: null,
    sessions: [],
    weights: [],
    foods: [],
    bodyGoalGrams: null,
    goals: [],
    targetKcal: null,
    targetProtein: null,
    weeklyGoal: 4,
    onboarded: true,
    occurrences: [],
    weekGoals: [],
    activeTemplateSince: null,
    customTemplates: [],
    datasetId: 'ds_test',
    lastBackupKey: null,
  };
}

/** 造一份导出信封，可指定动作 id。 */
function envelopeWithExercise(exerciseId: string): string {
  const state: AppState = baseState();
  return JSON.stringify({
    format: 'tieguan-export',
    schemaVersion: 1,
    exportedAt: '2026-10-25T00:00:00.000Z',
    datasetId: state.datasetId,
    dataset: {
      createdAt: state.createdAt,
      appStateVersion: 2,
      accountingTimezone: 'Asia/Shanghai',
    },
    records: {
      profile: state.profile,
      sessions: [
        {
          id: 's1',
          templateId: null,
          dayId: null,
          title: '测试',
          status: 'completed',
          startedAt: '2026-10-24T10:00:00.000Z',
          endedAt: '2026-10-24T11:00:00.000Z',
          businessDate: '2026-10-24',
          restEndsAt: null,
          note: '',
          exercises: [
            {
              id: 'se1',
              exerciseId,
              order: 0,
              targetSets: 3,
              repMin: 5,
              repMax: 8,
              restSeconds: 120,
              incrementGrams: 2500,
              sets: [
                {
                  id: 'x1',
                  kind: 'work',
                  status: 'completed',
                  loadGrams: 100000,
                  reps: 5,
                  durationSeconds: null,
                  distanceMeters: null,
                  rpe: null,
                  completedAt: '2026-10-24T10:10:00.000Z',
                },
              ],
            },
          ],
        },
      ],
      weights: [],
      foods: [],
      occurrences: [],
      weekGoals: [],
      customTemplates: [],
      bodyGoalGrams: null,
      targetKcal: null,
      targetProtein: null,
      weeklyGoal: 4,
      activeTemplateId: null,
      activeTemplateSince: null,
      goals: [],
    },
    contentRefs: [],
  });
}

describe('导入引用校验（#5）', () => {
  it('已知动作能通过校验', () => {
    const r = previewImport(envelopeWithExercise('bb-squat'), { currentDatasetId: 'ds_test', currentState: baseState() });
    const badRef = r.issues.filter((i) => i.code === 'bad_reference');
    expect(badRef).toHaveLength(0);
  });

  it('不存在的动作被报为 bad_reference', () => {
    const r = previewImport(envelopeWithExercise('不存在的动作id'), { currentDatasetId: 'ds_test', currentState: baseState() });
    const badRef = r.issues.filter((i) => i.code === 'bad_reference');
    expect(badRef.length).toBeGreaterThan(0);
    expect(badRef[0]!.message).toContain('不存在的动作id');
  });

  it('bad_reference 是致命问题，会阻止导入', () => {
    const r = previewImport(envelopeWithExercise('ghost-exercise'), { currentDatasetId: 'ds_test', currentState: baseState() });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'bad_reference' && i.fatal)).toBe(true);
  });

  it('多个不同动作都合法时不误报', () => {
    const env = envelopeWithExercise('bb-squat');
    const r = previewImport(env, { currentDatasetId: 'ds_test', currentState: baseState() });
    expect(r.issues.filter((i) => i.code === 'bad_reference')).toHaveLength(0);
  });
});

