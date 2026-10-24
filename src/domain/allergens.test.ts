import { describe, expect, it } from 'vitest';
import {
  allergenRestrictions,
  coverageByCode,
  filterFoods,
  mealPlanBlocker,
  presenceOf,
  type AllergenMark,
} from './allergens';
import type { AllergenCode, AllergenPresence, DietRestriction } from './types';
import { ALLERGEN_CODES, FOOD_ALLERGENS, allergenCoverage, allergensOf } from '../content/allergens';
import { FOODS } from '../content/foods';

function mark(foodId: string, code: AllergenCode, presence: AllergenPresence): AllergenMark {
  return { foodId, code, presence, sourceRef: 'test' };
}

function restriction(code: string, severity: 'avoid' | 'strict'): DietRestriction {
  return { id: `r_${code}`, kind: 'allergen', code, label: code, severity, source: 'test' };
}

const A = { id: 'a', name: 'A' };
const B = { id: 'b', name: 'B' };
const C = { id: 'c', name: 'C' };

describe('AC-N08 · 三态查询', () => {
  it('有标注时返回标注值', () => {
    const marks = [mark('a', 'gluten', 'contains')];
    expect(presenceOf(marks, 'a', 'gluten')).toBe('contains');
  });

  it('无标注一律返回 mayContain（安全默认）', () => {
    expect(presenceOf([], 'a', 'gluten')).toBe('mayContain');
    expect(presenceOf([mark('a', 'gluten', 'free')], 'a', 'egg')).toBe('mayContain');
  });

  it('不同食物的标注互不干扰', () => {
    const marks = [mark('a', 'gluten', 'contains'), mark('b', 'gluten', 'free')];
    expect(presenceOf(marks, 'a', 'gluten')).toBe('contains');
    expect(presenceOf(marks, 'b', 'gluten')).toBe('free');
  });
});

describe('AC-N08 · strict 级过滤', () => {
  it('排除 contains 与 mayContain', () => {
    const marks = [mark('a', 'milk', 'contains'), mark('b', 'milk', 'mayContain'), mark('c', 'milk', 'free')];
    const r = filterFoods([A, B, C], marks, [restriction('milk', 'strict')]);
    expect(r.allowed.map((f) => f.id)).toEqual(['c']);
    expect(r.excluded).toHaveLength(2);
    expect(r.warnings).toHaveLength(0);
  });

  it('未标注的食物被当作 mayContain 排除', () => {
    const r = filterFoods([A], [], [restriction('gluten', 'strict')]);
    expect(r.allowed).toHaveLength(0);
    expect(r.excluded[0]!.reason).toBe('mayContain');
  });
});

describe('AC-N08 · avoid 级过滤', () => {
  it('只排除 contains，mayContain 给提示', () => {
    const marks = [mark('a', 'milk', 'contains'), mark('b', 'milk', 'mayContain')];
    const r = filterFoods([A, B, C], marks, [restriction('milk', 'avoid')]);
    expect(r.allowed.map((f) => f.id)).toEqual(['b', 'c']);
    expect(r.excluded.map((f) => f.food.id)).toEqual(['a']);
    expect(r.warnings.map((f) => f.food.id)).toContain('b');
  });
});

describe('AC-N08 · 组合与边界', () => {
  it('多个过敏原时命中任一即排除', () => {
    // a 含奶、明确不含蛋：应按奶排除
    const marks = [mark('a', 'milk', 'contains'), mark('a', 'egg', 'free')];
    const r = filterFoods([A], marks, [restriction('milk', 'strict'), restriction('egg', 'strict')]);
    expect(r.excluded[0]!.code).toBe('milk');
    expect(r.allowed).toHaveLength(0);
  });

  it('多个过敏原同时命中时按 code 字典序取第一个', () => {
    const marks = [mark('a', 'milk', 'contains'), mark('a', 'egg', 'contains')];
    const r = filterFoods([A], marks, [restriction('milk', 'strict'), restriction('egg', 'strict')]);
    expect(r.excluded[0]!.code).toBe('egg'); // egg < milk
  });

  it('无限制时全部通过', () => {
    const r = filterFoods([A, B, C], [], []);
    expect(r.allowed).toHaveLength(3);
    expect(r.excluded).toHaveLength(0);
  });

  it('非过敏原类限制不参与过滤', () => {
    const religious: DietRestriction = {
      id: 'r1',
      kind: 'religious',
      code: 'pork',
      label: '猪肉',
      severity: 'strict',
      source: 'test',
    };
    const r = filterFoods([A], [], [religious]);
    expect(r.allowed).toHaveLength(1);
  });

  it('allergenRestrictions 只挑过敏原', () => {
    const list: DietRestriction[] = [
      restriction('milk', 'strict'),
      { id: 'x', kind: 'medical', code: 'x', label: 'x', severity: 'avoid', source: 't' },
    ];
    expect(allergenRestrictions(list)).toHaveLength(1);
  });

  it('输出顺序稳定（按 code 字典序）', () => {
    const marks = [mark('a', 'soy', 'contains'), mark('a', 'egg', 'contains')];
    const r1 = filterFoods([A], marks, [restriction('soy', 'strict'), restriction('egg', 'strict')]);
    const r2 = filterFoods([A], marks, [restriction('egg', 'strict'), restriction('soy', 'strict')]);
    expect(r1.excluded[0]!.code).toBe(r2.excluded[0]!.code);
  });
});

describe('AC-F03 · 未确认限制不得生成餐单', () => {
  it('未确认时阻止', () => {
    expect(mealPlanBlocker({ restrictionsConfirmed: false, allergies: [] })).toContain('确认');
  });

  it('确认后放行', () => {
    expect(mealPlanBlocker({ restrictionsConfirmed: true, allergies: ['milk'] })).toBeNull();
  });

  it('即使没有任何过敏原也必须确认', () => {
    expect(mealPlanBlocker({ restrictionsConfirmed: false, allergies: [] })).not.toBeNull();
  });
});

describe('AC-N08 · 食物库过敏原标注完整性', () => {
  it('每条食物对 8 类过敏原都有标注', () => {
    const cov = allergenCoverage(FOODS.map((f) => f.id));
    expect(cov.missing).toEqual([]);
    expect(cov.annotated).toBe(FOODS.length);
  });

  it('8 类过敏原齐全', () => {
    expect(ALLERGEN_CODES.map((c) => c.code).sort()).toEqual(
      ['egg', 'fish', 'gluten', 'milk', 'peanut', 'shellfish', 'soy', 'treenut'].sort(),
    );
  });

  it('明确含某过敏原的食物被标为 contains', () => {
    expect(presenceOf(FOOD_ALLERGENS, 'milk', 'milk')).toBe('contains');
    expect(presenceOf(FOOD_ALLERGENS, 'egg', 'egg')).toBe('contains');
    expect(presenceOf(FOOD_ALLERGENS, 'shrimp', 'shellfish')).toBe('contains');
    expect(presenceOf(FOOD_ALLERGENS, 'salmon', 'fish')).toBe('contains');
    expect(presenceOf(FOOD_ALLERGENS, 'peanut-butter', 'peanut')).toBe('contains');
    expect(presenceOf(FOOD_ALLERGENS, 'tofu', 'soy')).toBe('contains');
    expect(presenceOf(FOOD_ALLERGENS, 'nuts', 'treenut')).toBe('contains');
    expect(presenceOf(FOOD_ALLERGENS, 'whole-bread', 'gluten')).toBe('contains');
  });

  it('单一配料食物标为 free', () => {
    expect(presenceOf(FOOD_ALLERGENS, 'chicken-breast', 'gluten')).toBe('free');
    expect(presenceOf(FOOD_ALLERGENS, 'rice-cooked', 'milk')).toBe('free');
    expect(presenceOf(FOOD_ALLERGENS, 'broccoli', 'egg')).toBe('free');
    expect(presenceOf(FOOD_ALLERGENS, 'apple', 'peanut')).toBe('free');
  });

  it('成分不可控的复合菜品保守标 mayContain', () => {
    // 麻辣烫底料与蘸料不可控，任何过敏原都不应标 free
    const rows = allergensOf('hotpot');
    expect(rows.every((r) => r.presence === 'mayContain')).toBe(true);
  });

  it('加工食品不轻易标 free（面包的奶/大豆为 mayContain）', () => {
    expect(presenceOf(FOOD_ALLERGENS, 'whole-bread', 'milk')).toBe('mayContain');
    expect(presenceOf(FOOD_ALLERGENS, 'whole-bread', 'soy')).toBe('mayContain');
  });

  it('每条标注都带 sourceRef', () => {
    expect(FOOD_ALLERGENS.every((r) => r.sourceRef.length > 0)).toBe(true);
  });

  it('标注总数为 食物数 × 过敏原数', () => {
    expect(FOOD_ALLERGENS).toHaveLength(FOODS.length * ALLERGEN_CODES.length);
  });
});

describe('AC-N08 · 覆盖率统计', () => {
  it('按 code 统计四种状态', () => {
    const marks = [mark('a', 'milk', 'contains'), mark('b', 'milk', 'free')];
    const c = coverageByCode([A, B, C], marks, ['milk']);
    expect(c.milk).toEqual({ contains: 1, mayContain: 0, free: 1, missing: 1 });
  });

  it('真实食物库无遗漏', () => {
    const c = coverageByCode(FOODS, FOOD_ALLERGENS, ALLERGEN_CODES.map((x) => x.code));
    for (const code of Object.keys(c)) {
      expect(c[code]!.missing).toBe(0);
    }
  });
});

describe('AC-N08 · 用真实食物库验证过滤', () => {
  it('奶过敏 strict 时排除所有含奶与未标注品', () => {
    const r = filterFoods(FOODS, FOOD_ALLERGENS, [restriction('milk', 'strict')]);
    const names = r.allowed.map((f) => f.name);
    expect(names).not.toContain('牛奶（全脂）');
    expect(names).not.toContain('奶酪');
    expect(names).not.toContain('希腊酸奶（无糖）');
    // 鸡胸肉标了 free，应留下
    expect(names).toContain('鸡胸肉（熟）');
  });

  it('甲壳类过敏 strict 时排除虾仁，保留鱼', () => {
    const r = filterFoods(FOODS, FOOD_ALLERGENS, [restriction('shellfish', 'strict')]);
    const names = r.allowed.map((f) => f.name);
    expect(names).not.toContain('虾仁');
    expect(names).toContain('三文鱼');
  });

  it('麸质 strict 排除面包面条，保留米饭', () => {
    const r = filterFoods(FOODS, FOOD_ALLERGENS, [restriction('gluten', 'strict')]);
    const names = r.allowed.map((f) => f.name);
    expect(names).not.toContain('全麦面包');
    expect(names).not.toContain('挂面（干）');
    expect(names).toContain('米饭（熟）');
  });

  it('多种过敏原同时生效时结果更少', () => {
    const one = filterFoods(FOODS, FOOD_ALLERGENS, [restriction('milk', 'strict')]);
    const two = filterFoods(FOODS, FOOD_ALLERGENS, [
      restriction('milk', 'strict'),
      restriction('gluten', 'strict'),
    ]);
    expect(two.allowed.length).toBeLessThan(one.allowed.length);
  });

  it('过滤是纯函数：同样输入两次结果一致', () => {
    const r1 = filterFoods(FOODS, FOOD_ALLERGENS, [restriction('egg', 'strict')]);
    const r2 = filterFoods(FOODS, FOOD_ALLERGENS, [restriction('egg', 'strict')]);
    expect(r1.allowed.map((f) => f.id)).toEqual(r2.allowed.map((f) => f.id));
  });
});



