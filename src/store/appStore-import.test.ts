import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * appStore 的导入/备份路径集成测试。
 *
 * 为什么单独做这个文件：视图层与 appStore 在单测里是 0% 覆盖
 * （依赖 DOM/IndexedDB/Vue 响应式），但"备份写了却找不回来"这类缺陷
 * 恰恰最容易在这里滋生——它不是纯函数，测不到就永远发现不了。
 *
 * 这里用最小 mock 把 node 环境撑起来：
 *   - localStorage：内存实现
 *   - indexedDB：故意让它不可用，强制走 localStorage 回落
 *   - window.setTimeout：直接用 Node 的
 *
 * 只测 applyImportPreview 这一条关键路径，不追求整体覆盖。
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
    _map: map,
  };
}

let storage: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  vi.resetModules();
  storage = memoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  // 强制 IndexedDB 不可用，走 localStorage 回落路径
  Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'window', {
    value: { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** 造一份最小但合法的导出信封。 */
function envelope(datasetId: string, sessionId: string, opts: { omitGoals?: boolean } = {}): string {
  return JSON.stringify({
    format: 'tieguan-export',
    schemaVersion: 1,
    exportedAt: '2026-10-25T00:00:00.000Z',
    datasetId,
    dataset: { createdAt: '2026-01-01T00:00:00.000Z', appStateVersion: 2, accountingTimezone: 'Asia/Shanghai' },
    records: {
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
      sessions: [
        {
          id: sessionId,
          templateId: null,
          dayId: null,
          title: '导入的训练',
          status: 'completed',
          startedAt: '2026-10-24T10:00:00.000Z',
          endedAt: '2026-10-24T11:00:00.000Z',
          businessDate: '2026-10-24',
          restEndsAt: null,
          note: '',
          exercises: [
            {
              id: 'se1',
              exerciseId: 'bb-squat',
              order: 0,
              targetSets: 3,
              repMin: 5,
              repMax: 8,
              restSeconds: 120,
              incrementGrams: 2500,
              sets: [
                {
                  id: 'x1',
                  kind: 'work',
                  status: 'completed',
                  loadGrams: 100000,
                  reps: 5,
                  durationSeconds: null,
                  distanceMeters: null,
                  rpe: null,
                  completedAt: '2026-10-24T10:10:00.000Z',
                },
              ],
            },
          ],
        },
      ],
      weights: [],
      foods: [],
      occurrences: [],
      weekGoals: [],
      customTemplates: [],
      bodyGoalGrams: null,
      targetKcal: null,
      targetProtein: null,
      weeklyGoal: 4,
      activeTemplateId: null,
      activeTemplateSince: null,
      // 旧版导出没有 goals 字段；opts.omitGoals 用来模拟这一情况
      ...(opts.omitGoals ? {} : { goals: [] }),
    },
    contentRefs: [],
  });
}

describe('applyImportPreview · 备份指针（HIGH：写了却找不回来）', () => {
  it('replace 模式成功后 lastBackupKey 指向真实存在的备份', async () => {
    const { store } = await import('./appStore');
    const { previewImport } = await import('../domain/transfer');
    await store.init();

    const preview = previewImport(envelope(store.datasetId(), 's_imported'), {
      currentDatasetId: store.datasetId(),
      currentState: store.state,
    });
    expect(preview.ok).toBe(true);

    const err = store.applyImportPreview(preview, 'replace');
    expect(err).toBeNull();

    // 关键断言：备份指针必须非空，且指向的键真实存在
    const key = store.state.lastBackupKey;
    expect(key).not.toBeNull();
    expect(storage.getItem(key!)).not.toBeNull();

    // 且能通过 latestBackup 取回（"恢复到替换前"入口可用）
    const backup = store.latestBackup();
    expect(backup).not.toBeNull();
  });

  it('备份内容包含替换前的数据', async () => {
    const { store } = await import('./appStore');
    const { previewImport } = await import('../domain/transfer');
    await store.init();
    const beforeCount = store.state.sessions.length;

    const preview = previewImport(envelope(store.datasetId(), 's_new'), {
      currentDatasetId: store.datasetId(),
      currentState: store.state,
    });
    store.applyImportPreview(preview, 'replace');

    const backup = store.latestBackup();
    // 显式收窄类型：expect().not.toBeNull() 不会让 TS 认为非空
    if (!backup) throw new Error('备份指针为空：lastBackupKey 被 Object.assign 覆盖了')
    expect(backup.state.sessions.length).toBe(beforeCount);
  });
});

describe('applyImportPreview · 目标不丢失（CRITICAL）', () => {
  it('replace 导入旧版无 goals 的文件时保留本地目标', async () => {
    const { store } = await import('./appStore');
    const { previewImport } = await import('../domain/transfer');
    await store.init();

    // 先设一个本地目标
    store.setGoal({
      kind: 'bodyweight',
      targetGrams: 72000,
      startGrams: 80000,
      targetDate: null,
      createdAt: '2026-10-01T00:00:00.000Z',
    });
    const goalsBefore = store.state.goals.length;
    expect(goalsBefore).toBeGreaterThan(0);

    // 导入一份**没有 goals 字段**的文件（旧版导出即如此）
    // 注意：不能传 goals: []——空数组是文件的明确声明，replace 模式清空属合理行为
    const preview = previewImport(envelope(store.datasetId(), 's_old', { omitGoals: true }), {
      currentDatasetId: store.datasetId(),
      currentState: store.state,
    });
    expect(preview.ok).toBe(true);
    store.applyImportPreview(preview, 'replace');

    // 旧版文件没有 goals，不应把用户已有目标清空
    expect(store.state.goals.length).toBe(goalsBefore);
  });

  it('merge 模式不会丢弃本地目标', async () => {
    const { store } = await import('./appStore');
    const { previewImport } = await import('../domain/transfer');
    await store.init();

    store.setGoal({
      kind: 'frequency',
      perWeek: 4,
      createdAt: '2026-10-01T00:00:00.000Z',
    });
    const before = store.state.goals.length;

    const preview = previewImport(envelope(store.datasetId(), 's_merge'), {
      currentDatasetId: store.datasetId(),
      currentState: store.state,
    });
    store.applyImportPreview(preview, 'merge');

    expect(store.state.goals.length).toBeGreaterThanOrEqual(before);
  });
});


