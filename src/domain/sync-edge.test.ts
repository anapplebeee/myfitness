import { describe, expect, it, vi } from 'vitest';
import { INITIAL_SYNC_STATE, pullSnapshot, pushSnapshot, type SyncTransport, type SyncState } from './sync';
import { buildSnapshot, snapshotHash } from './snapshot';
import type { AppState } from './types';

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    version: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    onboarded: true,
    datasetId: 'ds_test',
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

describe('补充 · pullSnapshot etag 解析', () => {
  it('正常带引号 etag', async () => {
    const t = transport({ get: vi.fn(async () => ({ status: 200, json: SNAP, etag: '"42"' })) });
    const r = await pullSnapshot(t, SYNC);
    expect(r.revision).toBe(42);
  });

  it('不带引号的 etag', async () => {
    const t = transport({ get: vi.fn(async () => ({ status: 200, json: SNAP, etag: '42' })) });
    const r = await pullSnapshot(t, SYNC);
    expect(r.revision).toBe(42);
  });

  it('弱 etag W/"42"', async () => {
    const t = transport({ get: vi.fn(async () => ({ status: 200, json: SNAP, etag: 'W/"42"' })) });
    const r = await pullSnapshot(t, SYNC);
    // 去掉引号后是 W/42 → NaN
    expect(Number.isNaN(r.revision as number)).toBe(true);
  });

  it('etag 为 null 时回落 0', async () => {
    const t = transport({ get: vi.fn(async () => ({ status: 200, json: SNAP, etag: null })) });
    const r = await pullSnapshot(t, SYNC);
    expect(r.revision).toBe(0);
  });

  it('remoteRevision>0 时才带 If-None-Match', async () => {
    const t = transport({ get: vi.fn(async () => ({ status: 304, json: null, etag: null })) });
    await pullSnapshot(t, { ...SYNC, remoteRevision: 9 });
    const headers = vi.mocked(t.get).mock.calls[0]![0] as Record<string, string>;
    expect(headers['if-none-match']).toBe('"9"');
  });

  it('remoteRevision=0 时不带条件头', async () => {
    const t = transport({ get: vi.fn(async () => ({ status: 404, json: null, etag: null })) });
    await pullSnapshot(t, { ...SYNC, remoteRevision: 0 });
    const headers = vi.mocked(t.get).mock.calls[0]![0] as Record<string, string>;
    expect(headers['if-none-match']).toBeUndefined();
  });

  it('5xx 拉取失败返回错误', async () => {
    const t = transport({ get: vi.fn(async () => ({ status: 503, json: { error: { code: 'SERVICE_UNAVAILABLE', message: 'busy' } }, etag: null })) });
    const r = await pullSnapshot(t, SYNC);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('401 拉取失败需重新配对', async () => {
    const t = transport({ get: vi.fn(async () => ({ status: 401, json: { error: { code: 'UNAUTHORIZED' } }, etag: null })) });
    const r = await pullSnapshot(t, SYNC);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });
});

describe('补充 · pushSnapshot 响应体异常', () => {
  it('200 但响应体缺 revision 时为 undefined', async () => {
    const t = transport({ put: vi.fn(async () => ({ status: 200, json: {}, etag: null })) });
    const r = await pushSnapshot(t, SNAP, { ...SYNC, remoteRevision: 1 }, { idempotencyKey: 'k' });
    expect(r.ok).toBe(true);
    expect(r.revision).toBeUndefined();
    expect(r.snapshotHash).toBe(await snapshotHash(SNAP));
  });

  it('200 且响应体带 snapshotHash 时优先用响应值', async () => {
    const t = transport({ put: vi.fn(async () => ({ status: 200, json: { revision: 5, snapshotHash: 'server-hash' }, etag: '"5"' })) });
    const r = await pushSnapshot(t, SNAP, { ...SYNC, remoteRevision: 1 }, { idempotencyKey: 'k' });
    expect(r.snapshotHash).toBe('server-hash');
    expect(r.revision).toBe(5);
  });

  it('响应体为 null 时 200 仍成功并回落到本地哈希', async () => {
    const t = transport({ put: vi.fn(async () => ({ status: 200, json: null, etag: null })) });
    const r = await pushSnapshot(t, SNAP, { ...SYNC, remoteRevision: 1 }, { idempotencyKey: 'k' });
    expect(r.ok).toBe(true);
    expect(r.snapshotHash).toBe(await snapshotHash(SNAP));
  });

  it('409 用服务端 code 与 message', async () => {
    const t = transport({ put: vi.fn(async () => ({ status: 409, json: { error: { code: 'IDEMPOTENCY_CONFLICT', message: '键已用于不同负载' } }, etag: null })) });
    const r = await pushSnapshot(t, SNAP, { ...SYNC, remoteRevision: 1 }, { idempotencyKey: 'k' });
    expect(r.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(r.message).toBe('键已用于不同负载');
    expect(r.needsAttention).toBe(true);
  });

  it('4xx 且响应体无 error 字段时 code 为 UNKNOWN', async () => {
    const t = transport({ put: vi.fn(async () => ({ status: 400, json: { foo: 1 }, etag: null })) });
    const r = await pushSnapshot(t, SNAP, { ...SYNC, remoteRevision: 1 }, { idempotencyKey: 'k' });
    expect(r.code).toBe('UNKNOWN');
    expect(r.needsAttention).toBe(false);
  });

  it('500 且响应体无 error 时 code 归一为 INTERNAL', async () => {
    const t = transport({ put: vi.fn(async () => ({ status: 500, json: null, etag: null })) });
    const r = await pushSnapshot(t, SNAP, { ...SYNC, remoteRevision: 1 }, { idempotencyKey: 'k' });
    expect(r.code).toBe('INTERNAL');
    expect(r.retry).toBe(true);
  });

  it('抛非 Error 对象时也能重试', async () => {
    const t = transport({ put: vi.fn(async () => { throw 'string failure'; }) });
    const r = await pushSnapshot(t, SNAP, SYNC, { idempotencyKey: 'k' });
    expect(r.code).toBe('NETWORK');
    expect(r.message).toBe('网络错误');
  });

  it('非 Error 抛出时 pull 也归一', async () => {
    const t = transport({ get: vi.fn(async () => { throw 42; }) });
    const r = await pullSnapshot(t, SYNC);
    expect(r.code).toBe('NETWORK');
    expect(r.message).toBe('网络错误');
  });
});
