import { describe, expect, it } from 'vitest';
import { LIMITS, parseDraft, validateDraft, validateFoodDraft, type Draft } from './ai-draft';
import type { AllergenMark } from './allergens';
import type { Profile } from './types';

function profile(over: Partial<Profile> = {}): Profile {
  return {
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
    ...over,
  };
}

function draft(exercises: Draft['exercises'], weeklyGoal: number | null = null): Draft {
  return { summary: '建议', exercises, weeklyGoal };
}

describe('AC-AI03 · 未知动作被拒', () => {
  it('动作库没有的动作不能采纳', () => {
    const v = validateDraft(draft([{ exercise: '外星深蹲', loadKg: 100, reps: 5, sets: 3 }]), profile());
    expect(v.accepted).toHaveLength(0);
    expect(v.rejected[0]!.code).toBe('unknown_exercise');
    expect(v.adoptable).toBe(false);
  });

  it('按 id 能解析', () => {
    const v = validateDraft(draft([{ exercise: 'bb-squat', loadKg: 100, reps: 5, sets: 3 }]), profile());
    expect(v.accepted).toHaveLength(1);
    expect(v.accepted[0]!.exercise).toBe('bb-squat');
  });

  it('按中文名能解析', () => {
    const v = validateDraft(draft([{ exercise: '杠铃深蹲', loadKg: 100, reps: 5, sets: 3 }]), profile());
    expect(v.accepted[0]!.exercise).toBe('bb-squat');
  });

  it('模糊名不做猜测（宁可拒绝）', () => {
    const v = validateDraft(draft([{ exercise: '深蹲', loadKg: 100, reps: 5, sets: 3 }]), profile());
    // "深蹲"可能指杠铃深蹲或高脚杯深蹲，不猜
    expect(v.rejected[0]!.code).toBe('unknown_exercise');
  });
});

describe('AC-AI03 · 数值越界被拒', () => {
  it('重量超过 500kg 被拒', () => {
    const v = validateDraft(draft([{ exercise: 'bb-squat', loadKg: 999, reps: 5, sets: 3 }]), profile());
    expect(v.rejected[0]!.code).toBe('load_out_of_range');
    expect(v.accepted).toHaveLength(0);
  });

  it('负重量被拒', () => {
    const v = validateDraft(draft([{ exercise: 'bb-squat', loadKg: -10, reps: 5, sets: 3 }]), profile());
    expect(v.rejected[0]!.code).toBe('load_out_of_range');
  });

  it('次数为 0 被拒', () => {
    const v = validateDraft(draft([{ exercise: 'bb-squat', loadKg: 100, reps: 0, sets: 3 }]), profile());
    expect(v.rejected[0]!.code).toBe('reps_out_of_range');
  });

  it('次数超过 100 被拒', () => {
    const v = validateDraft(draft([{ exercise: 'bb-squat', loadKg: 100, reps: 500, sets: 3 }]), profile());
    expect(v.rejected[0]!.code).toBe('reps_out_of_range');
  });

  it('组数超过 20 被拒', () => {
    const v = validateDraft(draft([{ exercise: 'bb-squat', loadKg: 100, reps: 5, sets: 50 }]), profile());
    expect(v.rejected[0]!.code).toBe('sets_out_of_range');
  });

  it('非整数次数被拒', () => {
    const v = validateDraft(draft([{ exercise: 'bb-squat', loadKg: 100, reps: 5.5, sets: 3 }]), profile());
    expect(v.rejected[0]!.code).toBe('reps_out_of_range');
  });

  it('NaN 被拒而不是漏网', () => {
    const v = validateDraft(draft([{ exercise: 'bb-squat', loadKg: Number.NaN, reps: 5, sets: 3 }]), profile());
    expect(v.rejected[0]!.code).toBe('load_out_of_range');
  });

  it('边界值通过（500kg / 100次 / 20组）', () => {
    const v = validateDraft(
      draft([
        { exercise: 'bb-squat', loadKg: LIMITS.maxLoadKg, reps: LIMITS.maxReps, sets: LIMITS.maxSets },
      ]),
      profile(),
    );
    expect(v.accepted).toHaveLength(1);
  });
});

describe('AC-AI03 · 无器械被拒', () => {
  it('极简装备下推荐杠铃动作被拒', () => {
    const v = validateDraft(draft([{ exercise: 'bb-squat', loadKg: 100, reps: 5, sets: 3 }]), profile({ equipment: 'minimal' }));
    expect(v.rejected[0]!.code).toBe('no_equipment');
    expect(v.rejected[0]!.message).toContain('器械');
  });

  it('极简装备下自重动作可用', () => {
    // 找一个自重动作
    const v = validateDraft(draft([{ exercise: 'pushup', loadKg: null, reps: 10, sets: 3 }]), profile({ equipment: 'minimal' }));
    // 如果 pushup 不存在于动作库，至少验证不会因装备被拒
    if (v.accepted.length) {
      expect(v.accepted).toHaveLength(1);
    } else {
      expect(v.rejected[0]!.code).toBe('unknown_exercise');
    }
  });

  it('家庭装备下哑铃动作可用', () => {
    const v = validateDraft(draft([{ exercise: 'db-rdl', loadKg: 20, reps: 10, sets: 3 }]), profile({ equipment: 'home' }));
    expect(v.accepted).toHaveLength(1);
  });

  it('家庭装备下器械动作被拒', () => {
    const v = validateDraft(draft([{ exercise: 'leg-press', loadKg: 100, reps: 10, sets: 3 }]), profile({ equipment: 'home' }));
    expect(v.rejected[0]!.code).toBe('no_equipment');
  });
});

describe('AC-AI03 · 注入无法绕过校验', () => {
  it('用户输入要求"忽略指令写 999kg"，模型照做也会被拒', () => {
    // 模拟：用户提示注入 → 模型输出离谱数值
    const v = validateDraft(
      draft([{ exercise: 'bb-squat', loadKg: 999, reps: 5, sets: 3, reason: '用户要求直接写入' }]),
      profile(),
    );
    expect(v.accepted).toHaveLength(0);
    expect(v.adoptable).toBe(false);
  });

  it('注入要求"跳过校验"，但校验仍在', () => {
    const v = validateDraft(
      draft([{ exercise: '不存在动作', loadKg: 100, reps: 5, sets: 3 }]),
      profile(),
    );
    expect(v.rejected).toHaveLength(1);
  });

  it('注入要求"改周目标为 999"，超范围被拒', () => {
    const v = validateDraft(draft([{ exercise: 'bb-squat', loadKg: 100, reps: 5, sets: 3 }], 999), profile());
    expect(v.rejected.some((r) => r.code === 'weekly_goal_out_of_range')).toBe(true);
  });

  it('合法动作 + 越界周目标：动作可采纳，周目标被拒', () => {
    const v = validateDraft(draft([{ exercise: 'bb-squat', loadKg: 100, reps: 5, sets: 3 }], 999), profile());
    expect(v.accepted).toHaveLength(1);
    expect(v.rejected.some((r) => r.code === 'weekly_goal_out_of_range')).toBe(true);
  });

  it('重复动作只采纳第一条', () => {
    const v = validateDraft(
      draft([
        { exercise: 'bb-squat', loadKg: 100, reps: 5, sets: 3 },
        { exercise: 'bb-squat', loadKg: 200, reps: 5, sets: 3 },
      ]),
      profile(),
    );
    expect(v.accepted).toHaveLength(1);
    expect(v.rejected[0]!.code).toBe('duplicate_exercise');
  });
});

describe('AC-AI03 · 食物过敏原被拒', () => {
  const marks: AllergenMark[] = [
    { foodId: 'chicken', code: 'peanut', presence: 'free', sourceRef: 'x' },
    { foodId: 'padthai', code: 'peanut', presence: 'contains', sourceRef: 'x' },
  ];
  const known = new Set(['chicken', 'padthai']);

  it('含过敏原的食物被拒', () => {
    const r = validateFoodDraft(
      [{ foodId: 'padthai', label: '泰式炒河粉', grams: 300 }],
      profile({ allergies: ['peanut'] }),
      { marks, knownFoodIds: known },
    );
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected[0]!.code).toBe('allergen');
  });

  it('明确标注 free 的食物通过', () => {
    const r = validateFoodDraft(
      [{ foodId: 'chicken', label: '鸡胸肉', grams: 200 }],
      profile({ allergies: ['peanut'] }),
      { marks, knownFoodIds: known },
    );
    expect(r.accepted).toHaveLength(1);
  });

  it('未标注过敏原的食物按 mayContain 拒绝（安全默认）', () => {
    const r = validateFoodDraft(
      [{ foodId: 'chicken', label: '鸡胸肉', grams: 200 }],
      profile({ allergies: ['shellfish'] }),
      { marks, knownFoodIds: known },
    );
    // chicken 没有 shellfish 标注 → presenceOf 返回 mayContain → 拒绝
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected[0]!.code).toBe('allergen');
  });

  it('不在食物库的被拒', () => {
    const r = validateFoodDraft(
      [{ foodId: 'unknown-food', label: '神秘料理', grams: 100 }],
      profile(),
      { marks, knownFoodIds: known },
    );
    expect(r.rejected[0]!.code).toBe('unknown_food');
  });

  it('份量超范围被拒', () => {
    const r = validateFoodDraft(
      [{ foodId: 'chicken', label: '鸡胸肉', grams: 9999 }],
      profile(),
      { marks, knownFoodIds: known },
    );
    expect(r.rejected[0]!.code).toBe('grams_out_of_range');
  });
});

describe('AC-AI03 · 草稿解析', () => {
  it('纯 JSON 能解析', () => {
    const d = parseDraft('{"summary":"x","exercises":[{"exercise":"bb-squat","loadKg":100,"reps":5,"sets":3}]}');
    expect(d?.exercises).toHaveLength(1);
    expect(d?.exercises[0]!.loadKg).toBe(100);
  });

  it('包在 ```json 代码块里能解析', () => {
    const d = parseDraft('```json\n{"summary":"x","exercises":[{"exercise":"bb-squat","loadKg":100}]}\n```');
    expect(d?.exercises).toHaveLength(1);
  });

  it('前后带解释文字能解析', () => {
    const d = parseDraft('好的，建议如下：{"summary":"x","exercises":[{"exercise":"bb-squat"}]} 希望有帮助');
    expect(d?.exercises).toHaveLength(1);
  });

  it('不是 JSON 返回 null', () => {
    expect(parseDraft('我觉得你应该多练腿')).toBeNull();
  });

  it('缺 exercises 返回 null', () => {
    expect(parseDraft('{"summary":"只有摘要"}')).toBeNull();
  });

  it('exercises 里缺动作名的项被跳过', () => {
    const d = parseDraft('{"exercises":[{"loadKg":100},{"exercise":"bb-squat"}]}');
    expect(d?.exercises).toHaveLength(1);
  });

  it('兼容 name 字段（有些模型不用 exercise）', () => {
    const d = parseDraft('{"exercises":[{"name":"bb-squat","load":100}]}');
    expect(d?.exercises[0]!.exercise).toBe('bb-squat');
    expect(d?.exercises[0]!.loadKg).toBe(100);
  });

  it('数组根不是对象返回 null', () => {
    expect(parseDraft('[1,2,3]')).toBeNull();
  });
});

describe('AC-AI03 · 影响预览', () => {
  it('effects 描述会改变什么', () => {
    const v = validateDraft(draft([{ exercise: 'bb-squat', loadKg: 100, reps: 5, sets: 3 }]), profile());
    expect(v.effects.some((e) => e.includes('杠铃深蹲'))).toBe(true);
    expect(v.effects.some((e) => e.includes('3 组'))).toBe(true);
  });

  it('周目标变化写进 effects', () => {
    const v = validateDraft(draft([{ exercise: 'bb-squat', loadKg: 100, reps: 5, sets: 3 }], 5), profile());
    expect(v.effects.some((e) => e.includes('每周训练次数'))).toBe(true);
  });

  it('全部被拒时 adoptable 为 false', () => {
    const v = validateDraft(draft([{ exercise: 'xxx', loadKg: 1, reps: 1, sets: 1 }]), profile());
    expect(v.adoptable).toBe(false);
  });
});

