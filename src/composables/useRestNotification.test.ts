import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * node 环境没有 localStorage / window。这里放最小内存实现，
 * 比引入 jsdom 轻，也足够验证"开关读写 + 默认值"与"不排程"的分支。
 */
const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});
vi.stubGlobal('window', {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (id: number) => clearTimeout(id),
});

/**
 * 组间休息通知的偏好读写。
 *
 * 只测纯逻辑部分：真正的排程调用依赖 Capacitor 插件与系统权限，
 * 那部分在真机上验收；这里保证"开关状态"不会写丢或读错默认值。
 */

const KEY = 'lianji.restNotify';

describe('偏好', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('默认开启', async () => {
    const m = await import('./useRestNotification');
    expect(m.restNotifyEnabled()).toBe(true);
  });

  it('关闭后读到 off', async () => {
    const m = await import('./useRestNotification');
    m.setRestNotifyEnabled(false);
    expect(m.restNotifyEnabled()).toBe(false);
    expect(localStorage.getItem(KEY)).toBe('off');
  });

  it('重新打开', async () => {
    const m = await import('./useRestNotification');
    m.setRestNotifyEnabled(false);
    m.setRestNotifyEnabled(true);
    expect(m.restNotifyEnabled()).toBe(true);
    expect(localStorage.getItem(KEY)).toBe('on');
  });

  it('结束时间为 null 时不排程也不报错', async () => {
    const m = await import('./useRestNotification');
    await expect(m.armRestNotification(null)).resolves.toBeUndefined();
  });

  it('已过期的结束时间不排程', async () => {
    const m = await import('./useRestNotification');
    await expect(m.armRestNotification(Date.now() - 5000)).resolves.toBeUndefined();
  });

  it('关闭开关后即使有时间也不排程', async () => {
    const m = await import('./useRestNotification');
    m.setRestNotifyEnabled(false);
    await expect(m.armRestNotification(Date.now() + 60000)).resolves.toBeUndefined();
  });

  it('disarm 在没有任何待触发通知时也不抛错', async () => {
    const m = await import('./useRestNotification');
    await expect(m.disarmRestNotification()).resolves.toBeUndefined();
  });
});

