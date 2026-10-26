import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { seedState } from './seed';
import { cloneTemplate } from '../domain/template';
const KEY = 'lianji.v2.state';
let data: Map<string, string>;
let failWrites: boolean;
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); data = new Map(); failWrites = false;
  vi.stubGlobal('window', { setTimeout, clearTimeout }); vi.stubGlobal('indexedDB', undefined);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { if (failWrites) throw new Error('quota'); data.set(k, v); },
    removeItem: (k: string) => data.delete(k),
  });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('数据安全与模板执行回归', () => {
  it('未来版本不会播种、补计划或覆盖原始字节', async () => {
    const raw = JSON.stringify({ ...seedState(), version: 999 }); data.set(KEY, raw);
    const { store } = await import('./appStore'); await store.init();
    expect(store.initError.value).toContain('不支持的版本'); expect(store.ready.value).toBe(false);
    store.updateProfile({ name: '不应写入' }); expect(await store.flush()).toBe(false);
    expect(data.get(KEY)).toBe(raw);
  });
  it('损坏数据保持原样并提供重试，不转换成种子', async () => {
    data.set(KEY, '{broken'); const { store } = await import('./appStore'); await store.init();
    expect(store.initError.value).not.toBeNull(); expect(data.get(KEY)).toBe('{broken');
    data.set(KEY, JSON.stringify(seedState())); await store.init(); expect(store.ready.value).toBe(true);
    await store.flush();
  });
  it('录组失败不标完成；原有输入可重试，成功才更新保存状态', async () => {
    const { store } = await import('./appStore'); await store.init(); await store.flush();
    const tpl = store.templateById(store.state.activeTemplateId!)!;
    const session = store.startSessionFromDay(tpl.days[0]!.id)!;
    const ex = session.exercises[0]!; const set = ex.sets[0]!;
    failWrites = true;
    expect(await store.completeSet(session.id, ex.exerciseId, set.id, { loadGrams: 60000, reps: 8 })).toBe(false);
    expect(set.status).toBe('planned'); expect(store.saveError.value).toContain('保存失败');
    failWrites = false;
    expect(await store.completeSet(session.id, ex.exerciseId, set.id, { loadGrams: 60000, reps: 8 })).toBe(true);
    expect(JSON.parse(data.get(KEY)!).sessions.find((s: { id: string }) => s.id === session.id).exercises[0].sets[0].status).toBe('completed');
    expect(store.saveError.value).toBeNull();
  });
  it('结束失败保持活动会话，恢复存储后可以再次结束', async () => {
    const { store } = await import('./appStore'); await store.init();
    const tpl = store.templateById(store.state.activeTemplateId!)!;
    const session = store.startSessionFromDay(tpl.days[0]!.id)!;
    failWrites = true; expect(await store.finishSession(session.id, 'not-committed-occurrence')).toBe(false);
    expect(session.status).toBe('active');
    expect(session.occurrenceId).not.toBe('not-committed-occurrence');
    failWrites = false; expect(await store.finishSession(session.id, null)).toBe(true);
    expect(session.status).toBe('completed');
  });
  it('自建副本可以启用、预建日程并开始训练，刷新后仍可执行', async () => {
    const { store } = await import('./appStore'); await store.init();
    const copy = store.duplicateTemplate(store.allTemplates()[0]!.id)!;
    expect(store.applyTemplate(copy.id)).toBeNull();
    expect(store.state.occurrences.some(o => o.planVersionId.startsWith(copy.id))).toBe(true);
    await store.flush(); await store.init();
    const session = store.startSessionFromDay(copy.days[0]!.id);
    expect(session?.templateId).toBe(copy.id); await store.flush();
  });
  it('编辑内置模板后，计划与新会话使用改后的组数，历史不变', async () => {
    const { store } = await import('./appStore'); await store.init();
    const id = store.state.activeTemplateId!;
    const tpl = cloneTemplate(store.templateById(id)!);
    const historical = JSON.stringify(store.state.sessions);
    tpl.version += 1; tpl.days[0]!.exercises[0]!.sets = 5;
    expect(store.saveTemplate(tpl)).toBeNull();
    const session = store.startSessionFromDay(tpl.days[0]!.id)!;
    expect(session.exercises[0]?.sets).toHaveLength(5);
    expect(JSON.stringify(store.state.sessions.slice(0, -1))).toBe(historical); await store.flush();
  });
});

