import { describe, expect, it } from 'vitest';
import { canAdopt, describeStaleness, stateFingerprint } from './ai-adopt';
import type { AppState } from './types';
import type { Draft } from './ai-draft';

function baseState(over: Partial<AppState> = {}): AppState {
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
    ...over,
  };
}

const draft: Draft = { summary: 'x', exercises: [] };

describe('AC-AI04 · 状态指纹', () => {
  it('相同状态指纹相同', () => {
    expect(stateFingerprint(baseState())).toBe(stateFingerprint(baseState()));
  });

  it('周目标变化会改变指纹', () => {
    const a = stateFingerprint(baseState());
    const b = stateFingerprint(baseState({ weeklyGoal: 5 }));
    expect(a).not.toBe(b);
  });

  it('新增训练会改变指纹', () => {
    const a = stateFingerprint(baseState());
    const b = stateFingerprint(
      baseState({
        sessions: [
          {
            id: 's1',
            templateId: null,
            dayId: null,
            title: 'x',
            status: 'completed',
            startedAt: '2026-10-24T10:00:00.000Z',
            endedAt: '2026-10-24T11:00:00.000Z',
            businessDate: '2026-10-24',
            restEndsAt: null,
            note: '',
            exercises: [],
          },
        ],
      }),
    );
    expect(a).not.toBe(b);
  });

  it('体重记录变化会改变指纹', () => {
    const a = stateFingerprint(baseState());
    const b = stateFingerprint(baseState({ weights: [{ id: 'w1', date: '2026-10-24', grams: 78000 }] }));
    expect(a).not.toBe(b);
  });

  it('目标变化会改变指纹', () => {
    const a = stateFingerprint(baseState());
    const b = stateFingerprint(
      baseState({
        goals: [{ kind: 'bodyweight', targetGrams: 70000, startGrams: 80000, targetDate: null, createdAt: '' }],
      }),
    );
    expect(a).not.toBe(b);
  });

  it('删除的场次不计入指纹（墓碑不算有效数据）', () => {
    const live = stateFingerprint(baseState());
    const withDeleted = stateFingerprint(
      baseState({
        sessions: [
          {
            id: 's1',
            templateId: null,
            dayId: null,
            title: 'x',
            status: 'completed',
            startedAt: '2026-10-24T10:00:00.000Z',
            endedAt: '2026-10-24T11:00:00.000Z',
            businessDate: '2026-10-24',
            restEndsAt: null,
            note: '',
            exercises: [],
            deletedAt: '2026-10-25T00:00:00.000Z',
          },
        ],
      }),
    );
    expect(live).toBe(withDeleted);
  });

  it('只有 lastBackupKey 变化时指纹不变（避免无谓过期）', () => {
    const a = stateFingerprint(baseState());
    const b = stateFingerprint(baseState({ lastBackupKey: 'backup-123' }));
    expect(a).toBe(b);
  });
});

describe('AC-AI04 · 过期判定', () => {
  const args = {
    draft,
    draftFingerprint: 'fp1',
    currentFingerprint: 'fp1',
    adoptedNonces: new Set<string>(),
    nonce: 'n1',
    acceptedCount: 2,
    now: '2026-10-25T10:00:00.000Z',
  };

  it('指纹一致可以采纳', () => {
    const r = canAdopt(args);
    expect(r.ok).toBe(true);
  });

  it('指纹不一致拒绝并提示过时', () => {
    const r = canAdopt({ ...args, currentFingerprint: 'fp2' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('stale');
      expect(r.message).toContain('过时');
    }
  });

  it('没有可用项时不能采纳', () => {
    const r = canAdopt({ ...args, acceptedCount: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('empty');
  });

  it('过期描述说明"哪里变了"而不是只说过期', () => {
    expect(describeStaleness('a', 'b')).toContain('更新');
  });

  it('未变化时描述明确', () => {
    expect(describeStaleness('a', 'a')).toContain('未变化');
  });
});

describe('AC-AI04 · 同操作去重', () => {
  const base = {
    draft,
    draftFingerprint: 'fp1',
    currentFingerprint: 'fp1',
    acceptedCount: 1,
    now: '2026-10-25T10:00:00.000Z',
  };

  it('首次采纳成功并返回记录', () => {
    const r = canAdopt({ ...base, adoptedNonces: new Set(), nonce: 'n1' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.nonce).toBe('n1');
      expect(r.record.adoptedAt).toBe(base.now);
    }
  });

  it('同一 nonce 第二次被拒（防重复写入）', () => {
    const r = canAdopt({ ...base, adoptedNonces: new Set(['n1']), nonce: 'n1' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('duplicate');
      expect(r.message).toContain('重复');
    }
  });

  it('不同 nonce 可以分别采纳', () => {
    const r = canAdopt({ ...base, adoptedNonces: new Set(['n1']), nonce: 'n2' });
    expect(r.ok).toBe(true);
  });

  it('去重优先于过期检查（先拦住重复，不误导用户）', () => {
    const r = canAdopt({
      ...base,
      currentFingerprint: 'fp2',
      adoptedNonces: new Set(['n1']),
      nonce: 'n1',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('duplicate');
  });
});

describe('AC-AI04 · 未采纳不改变事实', () => {
  it('canAdopt 是纯函数，不修改传入的集合', () => {
    const nonces = new Set<string>();
    canAdopt({
      draft,
      draftFingerprint: 'fp1',
      currentFingerprint: 'fp1',
      adoptedNonces: nonces,
      nonce: 'n1',
      acceptedCount: 1,
      now: '2026-10-25T10:00:00.000Z',
    });
    expect(nonces.size).toBe(0);
  });

  it('拒绝时也返回记录为 undefined（调用方拿不到可写入的凭据）', () => {
    const r = canAdopt({
      draft,
      draftFingerprint: 'fp1',
      currentFingerprint: 'fp2',
      adoptedNonces: new Set(),
      nonce: 'n1',
      acceptedCount: 1,
      now: '2026-10-25T10:00:00.000Z',
    });
    expect(r.ok).toBe(false);
    expect('record' in r).toBe(false);
  });
});
