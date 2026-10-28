import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 远端快照应用的回归测试。
 *
 * 评审批次复现过：远端 900ml、本机 300ml，应用返回成功后仍是 300ml。
 * 原因是快照里有 water，applyExternalSnapshot 却漏了赋值。
 */

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  Object.defineProperty(globalThis, 'localStorage', {
    value: memoryStorage(),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'window', {
    value: { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout },
    configurable: true,
    writable: true,
  });
});

describe('applyExternalSnapshot', () => {
  it('远端快照里的饮水、饮水目标与提醒会写入本机', async () => {
    const { store } = await import('./appStore');
    const error = store.applyExternalSnapshot({
      datasetId: 'ds_remote',
      createdAt: '2026-10-01T00:00:00.000Z',
      records: {
        water: [{ id: 'remote', date: '2026-10-27', ml: 900, createdAt: '2026-10-27T09:00:00.000Z' }],
        waterGoalMl: 2500,
        reminders: {
          workoutEnabled: false,
          workoutTime: '20:00',
          waterEnabled: true,
          waterIntervalMin: 60,
          waterStart: '08:00',
          waterEnd: '22:00',
        },
      },
    });
    expect(error).toBeNull();
    expect(store.state.water?.[0]?.ml).toBe(900);
    expect(store.state.waterGoalMl).toBe(2500);
    expect(store.state.reminders?.workoutTime).toBe('20:00');
  });
});
