/**
 * 内容包加载：把扩展包合并进内置动作库。
 *
 * 授权约束（11:45）：
 * - 每个包必须带 packageId / version / licenseRef / attribution / checksum
 * - 用户记录引用版本，内容包更新不改写已记录的动作
 * - 只接受明确允许商用的授权（Unlicense / CC0 / MIT 等），
 *   CC-BY-SA、ODbL 等"传染性"授权不进入默认分发包
 */

import type { Exercise } from '../types';
import extPack from './exercises-ext.json';
import type { MuscleGroup, TrackingMode, LoadConvention } from '../../domain/types';

export interface PackLicense {
  id: string;
  url: string;
  attribution: string;
  upstream: string;
  upstreamSha256: string;
  notice: string;
  modifications: string;
}

export interface ExercisePack {
  packageId: string;
  version: number;
  title: string;
  description: string;
  license: PackLicense;
  generatedAt: string;
  counts: {
    upstreamTotal: number;
    included: number;
    curated: number;
    missingUpstream: number;
    duplicateNames: number;
  };
  modeDistribution: Record<string, number>;
  checksum: string;
  exercises: Array<{
    id: string;
    name: string;
    group: MuscleGroup;
    equipment: string;
    mode: TrackingMode;
    load: LoadConvention;
    level: string | null;
    mechanic: string | null;
    cues: string[];
    source: { dataset: string; upstreamId: string; license: string; url: string };
  }>;
}

/**
 * 已启用的内容包。当前只有扩展动作包（Unlicense）。
 * 体积约 29KB，随动作库一起加载；后续可按需改为懒加载。
 */
export const EXERCISE_PACKS: ExercisePack[] = [extPack as ExercisePack];

/** 允许进入默认分发包的授权：必须允许商用且无传染性。 */
const ALLOWED_LICENSES = new Set(['Unlicense', 'CC0-1.0', 'MIT', 'Apache-2.0', 'BSD-3-Clause']);

export interface PackIssue {
  packageId: string;
  issue: string;
}

export function validatePacks(packs: ExercisePack[]): PackIssue[] {
  const issues: PackIssue[] = [];
  const ids = new Set<string>();
  for (const p of packs) {
    if (!p.packageId) issues.push({ packageId: '(unknown)', issue: '缺少 packageId' });
    if (!Number.isInteger(p.version) || p.version < 1) {
      issues.push({ packageId: p.packageId, issue: 'version 必须是正整数' });
    }
    if (!p.license?.id) {
      issues.push({ packageId: p.packageId, issue: '缺少 license.id' });
    } else if (!ALLOWED_LICENSES.has(p.license.id)) {
      issues.push({
        packageId: p.packageId,
        issue: `授权 ${p.license.id} 不在允许列表（需允许商用且无传染性）`,
      });
    }
    if (!p.license?.attribution) {
      issues.push({ packageId: p.packageId, issue: '缺少 attribution' });
    }
    if (!p.checksum) issues.push({ packageId: p.packageId, issue: '缺少 checksum' });

    for (const e of p.exercises) {
      if (ids.has(e.id)) {
        issues.push({ packageId: p.packageId, issue: `动作 ID 重复：${e.id}` });
      }
      ids.add(e.id);
      if (!e.name?.trim()) {
        issues.push({ packageId: p.packageId, issue: `动作 ${e.id} 缺少名称` });
      }
      // 中文界面不应出现纯英文名
      if (/^[\x00-\x7F\s]+$/.test(e.name)) {
        issues.push({ packageId: p.packageId, issue: `动作 ${e.id} 名称为英文：${e.name}` });
      }
    }
  }
  return issues;
}

/** 把扩展包转成本项目动作结构。 */
export function packExercisesToLibrary(packs: ExercisePack[]): Exercise[] {
  return packs.flatMap((p) =>
    p.exercises.map((e) => ({
      id: e.id,
      name: e.name,
      group: e.group,
      equipment: e.equipment,
      mode: e.mode,
      load: e.load,
      cues: e.cues,
      alternatives: [],
    })),
  );
}

export function packSummary(packs: ExercisePack[]): string {
  const total = packs.reduce((s, p) => s + p.exercises.length, 0);
  const names = packs.map((p) => `${p.packageId}@v${p.version}`).join(', ');
  return `${packs.length} 个内容包，共 ${total} 个动作（${names}）`;
}




