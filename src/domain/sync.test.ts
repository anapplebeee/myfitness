import { describe, expect, it, vi } from 'vitest';
import {
  INITIAL_SYNC_STATE,
  backoffMs,
  detectConflict,
  isRetryable,
  makeConflictCopy,
  pullSnapshot,
  pushSnapshot,
  type SyncState,
  type SyncTransport,
} from './sync';
import { buildSnapshot } from './snapshot';
import type { AppState } from './types';

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
    targetKcal: null,
    targetProtein: null,
    weeklyGoal: 3,
    occurrences: [],
    weekGoals: [],
    customTemplates: [],
    ...overrides,
  };
}

const SNAP = buildSnapshot(state(), { ruleVersion: 1, accountingTimezone: 'Asia/Shanghai' });
const SYNC: SyncState = { ...INITIAL_SYNC_STATE };

function transport(overrides: Partial<SyncTransport> = {}): SyncTransport {
  return {
    put: vi.fn(async () => ({ status: 200, json: { revision: 1, snapshotHash: 'x' }, etag: '"1"' })),
    get: vi.fn(async () => ({ status: 404, json: null, etag: null })),
    remove: vi.fn(async () => ({ status: 204, json: null })),
    health: vi.fn(async () => ({ status: 200, json: { ok: true }, etag: null })),
    ...overrides,
  };
}

describe('AC-S02 · 离线重试与退避', () => {
  it('指数增长并封顶 30s', () => {
    expect(backoffMs(1, 0.5)).toBe(1000);
    expect(backoffMs(2, 0.5)).toBe(2000);
    expect(backoffMs(3, 0.5)).toBe(4000);
    expect(backoffMs(5, 0.5)).toBe(16000);
    expect(backoffMs(10, 0.5)).toBe(30000);
  });

  it('带抖动，落在 ±20% 区间', () => {
    const low = backoffMs(3, 0);
    const high = backoffMs(3, 1);
    expect(low).toBe(3200);
    expect(high).toBe(4800);
  });

  it('只对可重试错误码退避', () => {
    expect(isRetryable('NETWORK')).toBe(true);
    expect(isRetryable('INTERNAL')).toBe(true);
    expect(isRetryable('SERVICE_UNAVAILABLE')).toBe(true);
    expect(isRetryable('PRECONDITION_FAILED')).toBe(false);
    expect(isRetryable('IDEMPOTENCY_CONFLICT')).toBe(false);
    expect(isRetryable('PAYLOAD_TOO_LARGE')).toBe(false);
    expect(isRetryable(null)).toBe(false);
  });
});

describe('AC-S05 · 推送构造：条件头与幂等键', () => {
  it('远端为空用 If-None-Match:*', async () => {
    const t = transport();
    await pushSnapshot(t, SNAP, { ...SYNC, remoteRevision: 0 }, { idempotencyKey: 'k1' });
    const headers = vi.mocked(t.put).mock.calls[0]![1] as Record<string, string>;
    expect(headers['if-none-match']).toBe('*');
    expect(headers['if-match']).toBeUndefined();
    expect(headers['idempotency-key']).toBe('k1');
  });

  it('远端有数据用 If-Match', async () => {
    const t = transport();
    await pushSnapshot(t, SNAP, { ...SYNC, remoteRevision: 5 }, { idempotencyKey: 'k2' });
    const headers = vi.mocked(t.put).mock.calls[0]![1] as Record<string, string>;
    expect(headers['if-match']).toBe('"5"');
    expect(headers['if-none-match']).toBeUndefined();
  });

  it('内容未变且已同步过则跳过上传', async () => {
    const t = transport();
    const r = await pushSnapshot(
      t,
      SNAP,
      { ...SYNC, remoteRevision: 3, lastSyncedHash: await (await import('./snapshot')).snapshotHash(SNAP) },
      { idempotencyKey: 'k3' },
    );
    expect(r.ok).toBe(true);
    expect(t.put).not.toHaveBeenCalled();
  });

  it('force 强制上传', async () => {
    const t = transport();
    const { snapshotHash } = await import('./snapshot');
    await pushSnapshot(
      t,
      SNAP,
      { ...SYNC, remoteRevision: 3, lastSyncedHash: await snapshotHash(SNAP) },
      { idempotencyKey: 'k4', force: true },
    );
    expect(t.put).toHaveBeenCalled();
  });
});

describe('AC-S02 · 错误分类：可重试与需处理', () => {
  it('412 需人工处理不重试', async () => {
    const t = transport({ put: vi.fn(async () => ({ status: 412, json: { error: { code: 'PRECONDITION_FAILED' } }, etag: null })) });
    const r = await pushSnapshot(t, SNAP, { ...SYNC, remoteRevision: 1 }, { idempotencyKey: 'k' });
    expect(r.ok).toBe(false);
    expect(r.retry).toBe(false);
    expect(r.needsAttention).toBe(true);
  });

  it('5xx 可重试', async () => {
    const t = transport({ put: vi.fn(async () => ({ status: 500, json: { error: { code: 'INTERNAL' } }, etag: null })) });
    const r = await pushSnapshot(t, SNAP, { ...SYNC, remoteRevision: 1 }, { idempotencyKey: 'k' });
    expect(r.retry).toBe(true);
  });

  it('网络异常可重试', async () => {
    const t = transport({
      put: vi.fn(async () => {
        throw new Error('failed to fetch');
      }),
    });
    const r = await pushSnapshot(t, SNAP, SYNC, { idempotencyKey: 'k' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('NETWORK');
    expect(r.retry).toBe(true);
  });

  it('413 不重试且需处理', async () => {
    const t = transport({ put: vi.fn(async () => ({ status: 413, json: { error: { code: 'PAYLOAD_TOO_LARGE', message: '太大' } }, etag: null })) });
    const r = await pushSnapshot(t, SNAP, { ...SYNC, remoteRevision: 1 }, { idempotencyKey: 'k' });
    expect(r.retry).toBe(false);
    expect(r.needsAttention).toBe(true);
  });

  it('401 需重新配对', async () => {
    const t = transport({ put: vi.fn(async () => ({ status: 401, json: { error: { code: 'UNAUTHORIZED' } }, etag: null })) });
    const r = await pushSnapshot(t, SNAP, { ...SYNC, remoteRevision: 1 }, { idempotencyKey: 'k' });
    expect(r.needsAttention).toBe(true);
    expect(r.retry).toBe(false);
  });

  it('超限在本地预检就拦截，不发请求', async () => {
    const t = transport();
    const r = await pushSnapshot(t, SNAP, { ...SYNC, maxSnapshotBytes: 10 }, { idempotencyKey: 'k' });
    expect(r.code).toBe('SNAPSHOT_TOO_LARGE');
    expect(r.needsAttention).toBe(true);
    expect(t.put).not.toHaveBeenCalled();
  });
});

describe('AC-S02 · 拉取与 304', () => {
  it('304 表示未变化', async () => {
    const t = transport({ get: vi.fn(async () => ({ status: 304, json: null, etag: null })) });
    const r = await pullSnapshot(t, { ...SYNC, remoteRevision: 2 });
    expect(r.ok).toBe(true);
    expect(r.notModified).toBe(true);
  });

  it('404 表示远端为空', async () => {
    const t = transport();
    const r = await pullSnapshot(t, SYNC);
    expect(r.ok).toBe(true);
    expect(r.code).toBe('DATASET_EMPTY');
  });

  it('200 返回快照与 revision', async () => {
    const t = transport({ get: vi.fn(async () => ({ status: 200, json: SNAP, etag: '"7"' })) });
    const r = await pullSnapshot(t, SYNC);
    expect(r.ok).toBe(true);
    expect(r.revision).toBe(7);
    expect(r.snapshot).toBeDefined();
  });

  it('网络异常返回 NETWORK', async () => {
    const t = transport({
      get: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    const r = await pullSnapshot(t, SYNC);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('NETWORK');
  });
});

describe('AC-S04 · 冲突检测（三方比对）', () => {
  it('远端为空 → local_ahead', () => {
    expect(detectConflict({ localHash: 'h', remoteHash: null, baseHash: null, localDirty: true }).kind).toBe('local_ahead');
  });

  it('本地无改动、远端也一致 → none', () => {
    expect(detectConflict({ localHash: 'h', remoteHash: 'h', baseHash: 'h', localDirty: false }).kind).toBe('none');
  });

  it('本地无改动、远端变了 → fast_forward', () => {
    expect(detectConflict({ localHash: 'h1', remoteHash: 'h2', baseHash: 'h1', localDirty: false }).kind).toBe('fast_forward');
  });

  it('仅本地改动 → local_ahead', () => {
    expect(detectConflict({ localHash: 'h2', remoteHash: 'h1', baseHash: 'h1', localDirty: true }).kind).toBe('local_ahead');
  });

  it('双方都改 → diverged', () => {
    expect(detectConflict({ localHash: 'h3', remoteHash: 'h2', baseHash: 'h1', localDirty: true }).kind).toBe('diverged');
  });

  it('本地改动后内容恰好与远端相同 → none', () => {
    expect(detectConflict({ localHash: 'h2', remoteHash: 'h2', baseHash: 'h1', localDirty: true }).kind).toBe('none');
  });

  it('无基线但双方都有数据 → diverged（保守）', () => {
    expect(detectConflict({ localHash: 'h3', remoteHash: 'h2', baseHash: null, localDirty: true }).kind).toBe('diverged');
  });
});

describe('AC-S03 · 冲突副本保留双方', () => {
  it('同时保留远端与本地快照', () => {
    const local = SNAP;
    const remote = buildSnapshot(state({ datasetId: 'ds_remote' }), { ruleVersion: 1, accountingTimezone: 'Asia/Shanghai' });
    const copy = makeConflictCopy(7, remote, local, 'c1');
    expect(copy.remoteRevision).toBe(7);
    expect(copy.remoteSnapshot.datasetId).toBe('ds_remote');
    expect(copy.localSnapshot.datasetId).toBe('ds_test');
    expect(copy.createdAt).toBeTruthy();
  });
});

