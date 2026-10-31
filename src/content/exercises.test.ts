import { describe, expect, it } from 'vitest';
import { EXERCISE_BY_ID, EXERCISES } from './exercises';

/**
 * 动作库的完整性约束。
 *
 * 扩展包与内置动作有 24 个同名条目（其中 20 个连器械/肌群/模式都相同）。
 * 不去重的话动作库会出现两个"杠铃深蹲"，而训练记录按 id 存储，
 * 历史最佳与肌群统计会被拆成两半。
 */

describe('动作库', () => {
  it('没有重名条目（用户不该看到两个一模一样的动作）', () => {
    const names = EXERCISES.map((e) => e.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it('没有重复 id', () => {
    const ids = EXERCISES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('查表覆盖每一个展示条目', () => {
    for (const e of EXERCISES) {
      expect(EXERCISE_BY_ID.get(e.id)).toBeTruthy();
    }
  });

  it('被去重的影子条目仍能查到（老记录不会退化成"自定义动作"）', () => {
    // 扩展包里与内置同名的动作，展示列表里没有，但查表里必须还在
    const shadowed = [...EXERCISE_BY_ID.values()].filter(
      (e) => !EXERCISES.some((x) => x.id === e.id),
    );
    // 有影子条目时，它们的名字必须是某个展示条目的重复名
    for (const s of shadowed) {
      const shown = EXERCISES.find((x) => x.name === s.name);
      expect(shown).toBeTruthy();
    }
  });
});
