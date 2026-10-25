import { describe, expect, it } from 'vitest';
import { SNAPSHOT_SCHEMA_VERSION, buildSnapshot, checkSnapshotSize, snapshotByteSize } from './snapshot';
import type { AppState, Session } from './types';

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    version: 2, createdAt: '2026-01-01T00:00:00.000Z', onboarded: true, datasetId: 'ds_test',
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

function session(id: string, note = ''): Session {
  return {
    id, templateId: null, dayId: null, title: '训练', status: 'completed',
    startedAt: '2026-10-20T10:00:00.000Z', endedAt: '2026-10-20T11:00:00.000Z',
    businessDate: '2026-10-20', restEndsAt: null, note,
    exercises: [{
      id: 'se_' + id, exerciseId: 'bb-squat', order: 0, targetSets: 3,
      repMin: 5, repMax: 8, restSeconds: 120, incrementGrams: 2500,
      sets: [{
        id: 's_' + id, kind: 'work', status: 'completed',
        loadGrams: 100000, reps: 5, durationSeconds: null, distanceMeters: null,
        rpe: null, completedAt: '2026-10-20T10:00:00.000Z',
      }],
    }],
  };
}

const OPTS = { ruleVersion: 1, accountingTimezone: 'Asia/Shanghai' };

describe('补充 · checkSnapshotSize 边界', () => {
  it('恰好等于上限时通过', () => {
    const snap = buildSnapshot(state(), OPTS);
    const bytes = snapshotByteSize(snap);
    const r = checkSnapshotSize(snap, bytes);
    expect(r.ok).toBe(true);
    expect(r.bytes).toBe(bytes);
    expect(r.limit).toBe(bytes);
  });

  it('超出一个字节即失败', () => {
    const snap = buildSnapshot(state(), OPTS);
    const r = checkSnapshotSize(snap, snapshotByteSize(snap) - 1);
    expect(r.ok).toBe(false);
    expect(r.message).toBeTruthy();
  });

  it('上限为 0 时任何非空快照都失败', () => {
    const snap = buildSnapshot(state(), OPTS);
    expect(checkSnapshotSize(snap, 0).ok).toBe(false);
  });

  it('超限消息中的 MiB 数值正确', () => {
    const sessions: Session[] = Array.from({ length: 2000 }, (_, i) => session(`s${i}`, `备注${i}`.repeat(80)));
    const snap = buildSnapshot(state({ sessions }), OPTS);
    const bytes = snapshotByteSize(snap);
    expect(bytes).toBeGreaterThan(1024 * 1024);
    const target = Math.floor(1.5 * 1024 * 1024);
    const r = checkSnapshotSize(snap, target);
    expect(r.ok).toBe(false);
    const m = r.message!;
    expect(m).toContain(`${(bytes / 1024 / 1024).toFixed(1)} MiB`);
    expect(m).toContain(`${(target / 1024 / 1024).toFixed(0)} MiB`);
  });

  it('消息提示历史不会被裁剪', () => {
    const snap = buildSnapshot(state({ sessions: [session('s1')] }), OPTS);
    const r = checkSnapshotSize(snap, 10);
    expect(r.message).toContain('历史不会被裁剪');
    expect(r.message).toContain('导出备份');
  });

  it('3 年数据集规模下的字节数仍在合理量级', () => {
    // 600 会话 × 60 组
    const sessions: Session[] = [];
    for (let i = 0; i < 600; i++) {
      const s = session(`s${i}`, `备注${i}`);
      s.exercises[0]!.sets = Array.from({ length: 60 }, (_, j) => ({
        id: `set_${i}_${j}`, kind: 'work' as const, status: 'completed' as const,
        loadGrams: 100000 + j * 2500, reps: 5, durationSeconds: null, distanceMeters: null,
        rpe: null, completedAt: '2026-10-20T10:00:00.000Z',
      }));
      sessions.push(s);
    }
    const bytes = snapshotByteSize(buildSnapshot(state({ sessions }), OPTS));
    // 文档基线：3 年数据应远小于 32 MiB 上限
    expect(bytes).toBeLessThan(32 * 1024 * 1024);
    expect(bytes).toBeGreaterThan(1024 * 1024);
  });
});

describe('补充 · snapshotCanonical 稳定性', () => {
  it('键序不影响规范化结果', () => {
    const a = buildSnapshot(state({ sessions: [session('s1')] }), OPTS);
    const b = buildSnapshot(state({ sessions: [session('s1')] }), OPTS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('schemaVersion 是数字 1', () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
  });

  it('空状态的快照字节数很小', () => {
    expect(snapshotByteSize(buildSnapshot(state(), OPTS))).toBeLessThan(4096);
  });
});
