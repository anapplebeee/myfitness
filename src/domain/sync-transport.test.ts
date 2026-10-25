import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNTING_TIMEZONE, httpTransport, snapshotFor, type SyncConfig } from './sync';
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

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  vi.stubGlobal('fetch', vi.fn(handler as typeof fetch));
}

describe('补充 · snapshotFor 固定时区与 ruleVersion', () => {
  it('默认 ruleVersion=1，时区固定', () => {
    const s = snapshotFor(state());
    expect(s.ruleVersion).toBe(1);
    expect(s.accountingTimezone).toBe('Asia/Shanghai');
    expect(ACCOUNTING_TIMEZONE).toBe('Asia/Shanghai');
  });

  it('与直接 buildSnapshot 结果一致', async () => {
    const st = state();
    const via = snapshotFor(st, 2);
    const direct = buildSnapshot(st, { ruleVersion: 2, accountingTimezone: 'Asia/Shanghai' });
    expect(JSON.stringify(via)).toBe(JSON.stringify(direct));
  });

  it('时区是常量，不读取 Intl 本地时区', () => {
    const s = snapshotFor(state());
    // 断言依据是模块常量本身，而非当前机器时区
    expect(s.accountingTimezone).toBe(ACCOUNTING_TIMEZONE);
    expect(ACCOUNTING_TIMEZONE).toBe('Asia/Shanghai');
  });
});

describe('补充 · httpTransport', () => {
  const cfg: SyncConfig = { endpoint: 'https://sync.example.com/base/', token: 'tk' };

  it('去掉尾部斜杠并拼接路径', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    stubFetch((url, init) => {
      calls.push([url, init]);
      return new Response('{}', { status: 200, headers: { etag: '"7"' } });
    });
    const t = httpTransport(cfg);
    await t.health();
    expect(calls[0]![0]).toBe('https://sync.example.com/base/api/health');
  });

  it('PUT 带鉴权头、内容类型与自定义头', async () => {
    let seen: RequestInit | undefined;
    stubFetch((_url, init) => {
      seen = init;
      return new Response('{"revision":3,"snapshotHash":"h"}', { status: 200, headers: { etag: '"3"' } });
    });
    const t = httpTransport(cfg);
    const r = await t.put('{"a":1}', { 'if-match': '"2"', 'idempotency-key': 'k1' });
    expect(seen?.method).toBe('PUT');
    const h = seen?.headers as Record<string, string>;
    expect(h.authorization).toBe('Bearer tk');
    expect(h['content-type']).toBe('application/json');
    expect(h['if-match']).toBe('"2"');
    expect(h['idempotency-key']).toBe('k1');
    expect(seen?.body).toBe('{"a":1}');
    expect(r.etag).toBe('"3"');
  });

  it('GET 带鉴权头，不带 body', async () => {
    let seen: RequestInit | undefined;
    stubFetch((_url, init) => {
      seen = init;
      return new Response('{}', { status: 200 });
    });
    await httpTransport(cfg).get({ 'if-none-match': '"1"' });
    expect(seen?.method).toBeUndefined();
    const h = seen?.headers as Record<string, string>;
    expect(h.authorization).toBe('Bearer tk');
    expect(h['if-none-match']).toBe('"1"');
  });

  it('DELETE 用 DELETE 方法', async () => {
    let seen: RequestInit | undefined;
    stubFetch((_url, init) => {
      seen = init;
      return new Response(null, { status: 200 });
    });
    await httpTransport(cfg).remove({});
    expect(seen?.method).toBe('DELETE');
  });

  it('非 JSON 响应体不抛错，返回 null', async () => {
    stubFetch(() => new Response('<html>502</html>', { status: 502 }));
    const r = await httpTransport(cfg).health();
    expect(r.status).toBe(502);
    expect(r.json).toBeNull();
  });

  it('空响应体返回 null', async () => {
    stubFetch(() => new Response(null, { status: 200 }));
    const r = await httpTransport(cfg).health();
    expect(r.json).toBeNull();
  });

  it('缺少 etag 头时不是字符串', async () => {
    stubFetch(() => new Response('{}', { status: 200 }));
    const r = await httpTransport(cfg).health();
    expect(typeof (r as { etag?: unknown }).etag).not.toBe('string');
  });
});
