import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_SCHEMA_VERSION,
  buildSnapshot,
  checkSnapshotSize,
  sha256Hex,
  snapshotByteSize,
  snapshotCanonical,
  snapshotHash,
  type Snapshot,
} from './snapshot';
import type { AppState, Session, SetRecord } from './types';

function set(id: string, partial: Partial<SetRecord> = {}): SetRecord {
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
    ...partial,
  };
}

function session(id: string, partial: Partial<Session> = {}): Session {
  return {
    id,
    templateId: null,
    dayId: null,
    title: '训练',
    status: 'completed',
    startedAt: '2026-10-20T10:00:00.000Z',
    endedAt: '2026-10-20T11:00:00.000Z',
    businessDate: '2026-10-20',
    restEndsAt: null,
    note: '',
    exercises: [
      {
        id: 'se_' + id,
        exerciseId: 'bb-squat',
        order: 0,
        targetSets: 3,
        repMin: 5,
        repMax: 8,
        restSeconds: 120,
        incrementGrams: 2500,
        sets: [set('s_' + id)],
      },
    ],
    ...partial,
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
    activeTemplateId: null,
    activeTemplateSince: null,
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

const OPTS = { ruleVersion: 1, accountingTimezone: 'Asia/Shanghai' };

describe('契约 · SHA-256 正确性', () => {
  const vectors: Array<[string, string]> = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['hello world', 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
  ];

  for (const [input, expected] of vectors) {
    it('已知向量 "' + input.slice(0, 20) + '" 哈希正确', async () => {
      expect(await sha256Hex(input)).toBe(expected);
    });
  }

  it('长输入（跨块边界）正确', async () => {
    // 1000 个 'a'，与 Node crypto 的 SHA-256 输出一致
    const input = 'a'.repeat(1000);
    expect(await sha256Hex(input)).toBe(
      '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
    );
  });

  it('中文按 UTF-8 字节计算', async () => {
    const h = await sha256Hex('练迹');
    expect(h).toHaveLength(64);
    expect(h).not.toBe(await sha256Hex('练迹 '));
  });
});

describe('契约 · 快照物化确定性', () => {
  it('同一状态两次物化哈希相同', async () => {
    const s = state({ sessions: [session('s1'), session('s2')] });
    const a = await snapshotHash(buildSnapshot(s, OPTS));
    const b = await snapshotHash(buildSnapshot(s, OPTS));
    expect(a).toBe(b);
  });

  it('数组顺序不同但内容相同 → 哈希相同（按 id 排序）', async () => {
    const a = state({ sessions: [session('s1'), session('s2')] });
    const b = state({ sessions: [session('s2'), session('s1')] });
    expect(await snapshotHash(buildSnapshot(a, OPTS))).toBe(await snapshotHash(buildSnapshot(b, OPTS)));
  });

  it('内容变化 → 哈希变化', async () => {
    const a = state({ sessions: [session('s1')] });
    const b = state({ sessions: [session('s1', { note: '改了' })] });
    expect(await snapshotHash(buildSnapshot(a, OPTS))).not.toBe(
      await snapshotHash(buildSnapshot(b, OPTS)),
    );
  });

  it('包含 schemaVersion 与 ruleVersion', () => {
    const snap = buildSnapshot(state(), OPTS);
    expect(snap.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(snap.ruleVersion).toBe(1);
    expect(snap.accountingTimezone).toBe('Asia/Shanghai');
  });

  it('ruleVersion 变化导致哈希变化', async () => {
    const s = state();
    const a = await snapshotHash(
      buildSnapshot(s, { ruleVersion: 1, accountingTimezone: 'Asia/Shanghai' }),
    );
    const b = await snapshotHash(
      buildSnapshot(s, { ruleVersion: 2, accountingTimezone: 'Asia/Shanghai' }),
    );
    expect(a).not.toBe(b);
  });
});

describe('契约 · tombstone 必须随快照传播', () => {
  it('已删除会话仍在快照中', () => {
    const deleted = session('s2', { deletedAt: '2026-10-21T00:00:00.000Z' });
    const snap = buildSnapshot(state({ sessions: [session('s1'), deleted] }), OPTS);
    expect(snap.records.sessions).toHaveLength(2);
    expect(snap.records.sessions.find((s) => s.id === 's2')?.deletedAt).toBeTruthy();
  });

  it('删除与移除产生不同哈希（防止复活）', async () => {
    const removed = state({ sessions: [session('s1')] });
    const tombstoned = state({
      sessions: [session('s1'), session('s2', { deletedAt: '2026-10-21T00:00:00.000Z' })],
    });
    expect(await snapshotHash(buildSnapshot(removed, OPTS))).not.toBe(
      await snapshotHash(buildSnapshot(tombstoned, OPTS)),
    );
  });

  it('occurrence 的 cancelled 保留', () => {
    const snap = buildSnapshot(
      state({
        occurrences: [
          {
            id: 'o1',
            planVersionId: 'v1',
            weekStart: '2026-10-19',
            originalDate: '2026-10-20',
            scheduledDate: '2026-10-20',
            slotId: 't1-d0',
            title: '训练',
            exerciseIds: ['bb-squat'],
            disposition: 'cancelled',
            dispositionReason: '换模板',
          },
        ],
      }),
      OPTS,
    );
    expect(snap.records.occurrences[0]!.disposition).toBe('cancelled');
  });
});

describe('契约 · 不写入派生值', () => {
  it('快照不含容量/PR/周完成数', () => {
    const snap = buildSnapshot(state({ sessions: [session('s1')] }), OPTS);
    const json = snapshotCanonical(snap);
    expect(json).not.toContain('volumeGrams');
    expect(json).not.toContain('personalRecord');
    expect(json).not.toContain('completedOccurrences');
  });

  it('快照不含设备私有数据', () => {
    const json = snapshotCanonical(buildSnapshot(state(), OPTS));
    expect(json).not.toContain('outbox');
    expect(json).not.toContain('apiKey');
    expect(json).not.toContain('syncToken');
  });
});

describe('AC-S09 · 容量边界与超限不裁剪', () => {
  it('小于上限通过', () => {
    const snap = buildSnapshot(state({ sessions: [session('s1')] }), OPTS);
    const r = checkSnapshotSize(snap, 32 * 1024 * 1024);
    expect(r.ok).toBe(true);
    expect(r.bytes).toBeGreaterThan(0);
  });

  it('超限返回明确信息且不裁剪', () => {
    const many = Array.from({ length: 200 }, (_, i) => session('s' + String(i).padStart(4, '0')));
    const snap = buildSnapshot(state({ sessions: many }), OPTS);
    const r = checkSnapshotSize(snap, 1000);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('超出同步上限');
    expect(r.message).toContain('不会被裁剪');
    expect(snap.records.sessions).toHaveLength(200);
  });

  it('字节数按 UTF-8 计算（中文占 3 字节）', () => {
    const withChinese = state({ sessions: [session('s1', { note: '中文备注' })] });
    const empty = state({ sessions: [session('s1')] });
    const a = snapshotByteSize(buildSnapshot(withChinese, OPTS));
    const b = snapshotByteSize(buildSnapshot(empty, OPTS));
    expect(a - b).toBe(new TextEncoder().encode('中文备注').length);
  });
});

describe('canonical 与哈希稳定性', () => {
  it('null 与有值产生不同哈希', async () => {
    const withNull = state({ bodyGoalGrams: null });
    const withValue = state({ bodyGoalGrams: 74000 });
    expect(await snapshotHash(buildSnapshot(withNull, OPTS))).not.toBe(
      await snapshotHash(buildSnapshot(withValue, OPTS)),
    );
  });

  it('快照可 JSON 往返而哈希不变', async () => {
    const snap: Snapshot = buildSnapshot(state({ sessions: [session('s1')] }), OPTS);
    const round = JSON.parse(JSON.stringify(snap)) as Snapshot;
    expect(await snapshotHash(round)).toBe(await snapshotHash(snap));
  });
});




