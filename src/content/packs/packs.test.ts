import { describe, expect, it } from 'vitest';
import { EXERCISE_PACKS, packExercisesToLibrary, packSummary, validatePacks, type ExercisePack } from './index';
import { EXERCISES, EXERCISE_BY_ID } from '../exercises';

function pack(overrides: Partial<ExercisePack> = {}): ExercisePack {
  return {
    packageId: 'test-pack',
    version: 1,
    title: '测试包',
    description: '',
    license: {
      id: 'Unlicense',
      url: 'https://unlicense.org/',
      attribution: 'test',
      upstream: 'https://example.com',
      upstreamSha256: 'abc',
      notice: '',
      modifications: '',
    },
    generatedAt: '2026-10-24T00:00:00.000Z',
    counts: { upstreamTotal: 1, included: 1, curated: 1, missingUpstream: 0, duplicateNames: 0 },
    modeDistribution: { load_reps: 1 },
    checksum: 'deadbeef',
    exercises: [
      {
        id: 'ext-test',
        name: '测试动作',
        group: 'legs',
        equipment: '杠铃',
        mode: 'load_reps',
        load: 'totalExternal',
        level: 'beginner',
        mechanic: 'compound',
        cues: ['要领'],
        source: { dataset: 'test', upstreamId: 'Test', license: 'Unlicense', url: 'https://example.com' },
      },
    ],
    ...overrides,
  };
}

describe('AC-C08 · 内容包授权校验', () => {
  it('合法包无问题', () => {
    expect(validatePacks([pack()])).toHaveLength(0);
  });

  it('缺 packageId 报错', () => {
    const p = pack();
    p.packageId = '';
    expect(validatePacks([p]).some((i) => i.issue.includes('packageId'))).toBe(true);
  });

  it('版本号非正整数报错', () => {
    expect(validatePacks([pack({ version: 0 })]).some((i) => i.issue.includes('version'))).toBe(true);
  });

  it('缺授权报错', () => {
    const p = pack();
    // @ts-expect-error 故意构造非法数据
    p.license = {};
    expect(validatePacks([p]).some((i) => i.issue.includes('license'))).toBe(true);
  });

  it('传染性授权被拒绝', () => {
    for (const bad of ['CC-BY-SA-4.0', 'ODbL-1.0', 'GPL-3.0']) {
      const p = pack();
      p.license.id = bad;
      expect(validatePacks([p]).some((i) => i.issue.includes('不在允许列表'))).toBe(true);
    }
  });

  it('允许列表内的授权通过', () => {
    for (const ok of ['Unlicense', 'CC0-1.0', 'MIT', 'Apache-2.0']) {
      const p = pack();
      p.license.id = ok;
      expect(validatePacks([p])).toHaveLength(0);
    }
  });

  it('缺 attribution 报错', () => {
    const p = pack();
    p.license.attribution = '';
    expect(validatePacks([p]).some((i) => i.issue.includes('attribution'))).toBe(true);
  });

  it('缺 checksum 报错', () => {
    expect(validatePacks([pack({ checksum: '' })]).some((i) => i.issue.includes('checksum'))).toBe(true);
  });

  it('动作 ID 重复报错', () => {
    const a = pack();
    const b = pack({ packageId: 'other' });
    b.exercises = [...a.exercises];
    expect(validatePacks([a, b]).some((i) => i.issue.includes('重复'))).toBe(true);
  });

  it('英文名被拒绝（中文界面不应出现纯英文）', () => {
    const p = pack();
    p.exercises[0]!.name = 'Barbell Squat';
    expect(validatePacks([p]).some((i) => i.issue.includes('英文'))).toBe(true);
  });
});

describe('AC-C08 · 实际内容包合规', () => {
  it('仓库内所有内容包通过校验', () => {
    const issues = validatePacks(EXERCISE_PACKS);
    expect(issues, JSON.stringify(issues)).toHaveLength(0);
  });

  it('扩展包使用允许商用的授权', () => {
    for (const p of EXERCISE_PACKS) {
      expect(['Unlicense', 'CC0-1.0', 'MIT', 'Apache-2.0', 'BSD-3-Clause']).toContain(p.license.id);
    }
  });

  it('扩展包记录了上游来源与校验和', () => {
    for (const p of EXERCISE_PACKS) {
      expect(p.license.upstream).toBeTruthy();
      expect(p.license.upstreamSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(p.checksum).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('扩展包动作全部有中文名', () => {
    for (const p of EXERCISE_PACKS) {
      for (const e of p.exercises) {
        expect(/[\u4e00-\u9fa5]/.test(e.name), `${e.id} 缺少中文名`).toBe(true);
      }
    }
  });

  it('扩展包无重名动作', () => {
    const names = new Map<string, string>();
    for (const p of EXERCISE_PACKS) {
      for (const e of p.exercises) {
        expect(names.has(e.name), `重名：${e.name}（${names.get(e.name)} 与 ${e.id}）`).toBe(false);
        names.set(e.name, e.id);
      }
    }
  });

  it('内容包动作已合并进动作库', () => {
    const packIds = EXERCISE_PACKS.flatMap((p) => p.exercises.map((e) => e.id));
    for (const id of packIds) {
      expect(EXERCISE_BY_ID.has(id), `${id} 未合并`).toBe(true);
    }
  });

  it('内置动作 ID 不被内容包覆盖', () => {
    for (const builtin of ['bb-squat', 'bb-bench', 'plank', 'pullup']) {
      const e = EXERCISE_BY_ID.get(builtin);
      expect(e).toBeDefined();
      // 内置动作名称是简短的常用名，不是扩展包的完整名
      expect(e!.name.length).toBeLessThan(12);
    }
  });

  it('动作库规模与摘要一致', () => {
    const fromPacks = packExercisesToLibrary(EXERCISE_PACKS);
    expect(EXERCISES.length).toBeGreaterThanOrEqual(fromPacks.length);
    expect(packSummary(EXERCISE_PACKS)).toContain('动作');
  });
});

