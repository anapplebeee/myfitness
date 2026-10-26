import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearConflicts,
  conflictSnapshot,
  latestConflict,
  listConflicts,
  markResolved,
  saveConflict,
  type StoredConflict,
} from './conflictStore';
import type { Snapshot } from '../domain/snapshot';

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    _map: map,
  };
}

let storage: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  storage = fakeStorage();
  globalThis.localStorage = storage as unknown as Storage;
});

afterEach(() => {
  clearConflicts();
});

function snap(datasetId: string): Snapshot {
  return {
    schemaVersion: 1,
    ruleVersion: 1,
    datasetId,
    createdAt: '2026-01-01T00:00:00.000Z',
    accountingTimezone: 'Asia/Shanghai',
    records: {
      profile: {} as never,
      sessions: [],
      weights: [],
      foods: [],
      occurrences: [],
      weekGoals: [],
      customTemplates: [],
      bodyGoalGrams: null,
      targetKcal: null,
      targetProtein: null,
      weeklyGoal: 3,
      activeTemplateId: null,
      activeTemplateSince: null,
    },
  };
}

function item(id: string, at: string): StoredConflict {
  return {
    id,
    createdAt: at,
    remoteRevision: 7,
    remoteSnapshot: snap('ds_remote'),
    localSnapshot: snap('ds_local'),
    resolution: 'unresolved',
  };
}

describe('AC-S03 · 冲突副本持久化', () => {
  it('保存后能读回', () => {
    saveConflict(item('c1', '2026-10-25T10:00:00.000Z'));
    const list = listConflicts();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('c1');
  });

  it('最新的一份排在最前', () => {
    saveConflict(item('old', '2026-10-20T10:00:00.000Z'));
    saveConflict(item('new', '2026-10-25T10:00:00.000Z'));
    expect(latestConflict()?.id).toBe('new');
  });

  it('同 id 覆盖而非重复', () => {
    saveConflict(item('c1', '2026-10-25T10:00:00.000Z'));
    saveConflict(item('c1', '2026-10-25T11:00:00.000Z'));
    expect(listConflicts()).toHaveLength(1);
  });

  it('最多保留 5 份，超出丢弃最旧', () => {
    for (let i = 0; i < 8; i += 1) {
      saveConflict(item(`c${i}`, `2026-10-${String(10 + i).padStart(2, '0')}T10:00:00.000Z`));
    }
    const list = listConflicts();
    expect(list).toHaveLength(5);
    expect(list.map((x) => x.id)).not.toContain('c0');
  });

  it('两侧快照都保留', () => {
    const c = item('c1', '2026-10-25T10:00:00.000Z');
    saveConflict(c);
    const back = latestConflict()!;
    expect(back.remoteSnapshot.datasetId).toBe('ds_remote');
    expect(back.localSnapshot.datasetId).toBe('ds_local');
  });

  it('可以按侧取回', () => {
    const c = item('c1', '2026-10-25T10:00:00.000Z');
    expect(conflictSnapshot(c, 'remote').datasetId).toBe('ds_remote');
    expect(conflictSnapshot(c, 'local').datasetId).toBe('ds_local');
  });
});

describe('AC-S03 · 冲突解决标记', () => {
  it('默认未解决', () => {
    saveConflict(item('c1', '2026-10-25T10:00:00.000Z'));
    expect(latestConflict()?.resolution).toBe('unresolved');
  });

  it('标记保留本地', () => {
    saveConflict(item('c1', '2026-10-25T10:00:00.000Z'));
    markResolved('c1', 'kept_local');
    expect(latestConflict()?.resolution).toBe('kept_local');
  });

  it('标记保留远端', () => {
    saveConflict(item('c1', '2026-10-25T10:00:00.000Z'));
    markResolved('c1', 'kept_remote');
    expect(latestConflict()?.resolution).toBe('kept_remote');
  });

  it('标记不存在的 id 不报错', () => {
    expect(() => markResolved('nope', 'kept_local')).not.toThrow();
  });
});

describe('AC-S03 · 存储容错', () => {
  it('损坏数据返回空列表而非抛错', () => {
    storage.setItem('lianji.sync.conflicts', 'not json');
    expect(listConflicts()).toEqual([]);
  });

  it('写入失败不抛错（隐私模式）', () => {
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
      removeItem: () => undefined,
      clear: () => undefined,
    } as unknown as Storage;
    expect(() => saveConflict(item('c1', '2026-10-25T10:00:00.000Z'))).not.toThrow();
  });

  it('清空后为空', () => {
    saveConflict(item('c1', '2026-10-25T10:00:00.000Z'));
    clearConflicts();
    expect(listConflicts()).toEqual([]);
  });
});


