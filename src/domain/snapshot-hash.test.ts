/**
 * snapshot.ts 补充覆盖：纯 JS SHA-256 回落路径。
 *
 * snapshot.ts 覆盖率低，几乎全部缺口集中在 sha256Fallback
 * （109-164 行）——它是无 WebCrypto 环境（老 WebView / 部分测试环境）
 * 下的唯一哈希实现，一旦算错，跨设备同步会判出"假冲突"。
 * 浏览器环境走 WebCrypto，这条分支在生产里几乎不跑，
 * 所以必须用测试把它和 node:crypto 逐字节对齐。
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex, snapshotHash } from './snapshot';
import type { AppState } from './types';

const nodeSha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * 临时移除 globalThis.crypto.subtle 以触发回落实现。
 *
 * globalThis.crypto 在 Node 里是只有 getter 的访问器，直接赋值会抛
 * TypeError，必须用 defineProperty 覆盖。
 */
async function withFallback<T>(fn: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      writable: true,
      value: { getRandomValues: (arr: Uint32Array): Uint32Array => arr },
    });
    return await fn();
  } finally {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
  }
}

describe('补充 · sha256Hex 回落实现与 node:crypto 一致', () => {
  const cases = [
    '', 'a', 'abc', 'hello world',
    'x'.repeat(55),
    'x'.repeat(56),
    'x'.repeat(57),
    'x'.repeat(63),
    'x'.repeat(64),
    'x'.repeat(65),
    'x'.repeat(119),
    'x'.repeat(120),
    'x'.repeat(127),
    'x'.repeat(128),
    'x'.repeat(1000),
    'x'.repeat(4096),
    '练迹力量训练',
    'é'.repeat(300),
    '{"a":1,"b":[1,2,3],"c":{"d":null}}',
  ];

  for (const input of cases) {
    it(`长度 ${new TextEncoder().encode(input).length} 字节`, async () => {
      const expected = nodeSha(input);
      // 同时校验两条实现路径
      expect(await sha256Hex(input)).toBe(expected);
      await withFallback(async () => {
        expect(await sha256Hex(input)).toBe(expected);
      });
    });
  }

  it('回落路径与 WebCrypto 路径结果相同', async () => {
    const input = 'a'.repeat(500);
    const viaWebCrypto = await sha256Hex(input);
    const viaFallback = await withFallback(() => sha256Hex(input));
    expect(viaFallback).toBe(viaWebCrypto);
  });

  it('回落是确定性的', async () => {
    await withFallback(async () => {
      const a = await sha256Hex('determinism');
      const b = await sha256Hex('determinism');
      expect(a).toBe(b);
    });
  });
});

describe('补充 · snapshotHash 走回落仍稳定', () => {
  it('回落哈希与 WebCrypto 哈希一致', async () => {
    const { buildSnapshot } = await import('./snapshot');
    const state = {
      version: 2 as const, createdAt: '2026-01-01T00:00:00.000Z', onboarded: true, datasetId: 'ds_x',
      lastBackupKey: null,
      profile: {
        name: '', experience: 'beginner', equipment: 'gym', weeklyTarget: 3,
        heightCm: 175, sex: 'male', birthYear: 1995, activity: 1.4,
        restrictions: [], allergies: [], restrictionsConfirmed: false,
      },
      sessions: [], weights: [], foods: [], occurrences: [], weekGoals: [],
      customTemplates: [], bodyGoalGrams: null, targetKcal: null, targetProtein: null,
      weeklyGoal: 3, activeTemplateId: null, activeTemplateSince: null, goals: [],
    } satisfies AppState;
    const snap = buildSnapshot(state, { ruleVersion: 1, accountingTimezone: 'Asia/Shanghai' });
    const a = await snapshotHash(snap);
    const b = await withFallback(() => snapshotHash(snap));
    expect(b).toBe(a);
    expect(a).toHaveLength(64);
  });
});

