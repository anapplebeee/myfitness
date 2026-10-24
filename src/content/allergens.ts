/**
 * 食物过敏原标注（三态）。
 *
 * 口径见 docs/11-data-model.md 与 docs/content/README.md §6：
 * - presence 三态：contains / mayContain / free
 * - 未标注一律视为 mayContain（宁可少推荐）
 * - 标注粒度到菜品层
 *
 * 标注原则（保守优先）：
 * 1. 只有配料表明确且单一才标 free；
 * 2. 加工食品（面包、面、饼干、奶茶、饺子等）难以确认辅料与产线，
 *    标 mayContain；
 * 3. 复合菜品（炒饭、麻辣烫）除已知含蛋/大豆外，其余标 mayContain。
 *
 * 注意：本表是**参考标注**，不替代产品包装标识；外食无法保证。
 */

import type { AllergenCode, AllergenPresence } from '../domain/types';

export interface FoodAllergenRow {
  foodId: string;
  code: AllergenCode;
  presence: AllergenPresence;
  sourceRef: string;
}

/** 8 类常见过敏原（对应 07:32 要求）。 */
export const ALLERGEN_CODES: Array<{ code: AllergenCode; label: string; note: string }> = [
  { code: 'gluten', label: '麸质', note: '小麦、大麦、黑麦及其制品' },
  { code: 'egg', label: '蛋', note: '鸡蛋及蛋制品' },
  { code: 'milk', label: '奶', note: '牛奶及乳制品' },
  { code: 'soy', label: '大豆', note: '大豆及豆制品' },
  { code: 'peanut', label: '花生', note: '花生及花生制品' },
  { code: 'treenut', label: '坚果', note: '核桃、腰果、杏仁等树坚果' },
  { code: 'fish', label: '鱼', note: '鱼类及其制品' },
  { code: 'shellfish', label: '甲壳类', note: '虾、蟹、贝类' },
];

const SRC = '内容标注 v1（2026-10-25），按配料表与常见工艺判定';

/**
 * 每条记录：foodId → [contains 列表, free 列表]。
 * 未列出的过敏原按 mayContain 处理（保守默认）。
 */
const TABLE: Record<string, { contains: AllergenCode[]; free: AllergenCode[] }> = {
  // ---- 蛋白类 ----
  'chicken-breast': { contains: [], free: ['gluten', 'egg', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  'chicken-thigh': { contains: [], free: ['gluten', 'egg', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  'beef-lean': { contains: [], free: ['gluten', 'egg', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  'beef-brisket': { contains: [], free: ['gluten', 'egg', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  'pork-loin': { contains: [], free: ['gluten', 'egg', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  salmon: { contains: ['fish'], free: ['gluten', 'egg', 'milk', 'soy', 'peanut', 'treenut', 'shellfish'] },
  cod: { contains: ['fish'], free: ['gluten', 'egg', 'milk', 'soy', 'peanut', 'treenut', 'shellfish'] },
  shrimp: { contains: ['shellfish'], free: ['gluten', 'egg', 'milk', 'soy', 'peanut', 'treenut', 'fish'] },
  egg: { contains: ['egg'], free: ['gluten', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  'egg-white': { contains: ['egg'], free: ['gluten', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  tofu: { contains: ['soy'], free: ['gluten', 'egg', 'milk', 'peanut', 'treenut', 'fish', 'shellfish'] },
  // 金枪鱼罐头：水浸通常无麸质，但产线可能交叉
  'tuna-can': { contains: ['fish'], free: ['egg', 'milk', 'soy', 'peanut', 'treenut', 'shellfish'] },
  // 乳清蛋白：乳制品；多数产品含大豆卵磷脂
  whey: { contains: ['milk', 'soy'], free: ['gluten', 'egg', 'peanut', 'treenut', 'fish', 'shellfish'] },
  edamame: { contains: ['soy'], free: ['gluten', 'egg', 'milk', 'peanut', 'treenut', 'fish', 'shellfish'] },

  // ---- 主食类 ----
  'rice-cooked': { contains: [], free: ['gluten', 'egg', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  'brown-rice': { contains: [], free: ['gluten', 'egg', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  // 燕麦：纯燕麦无麸质，但常见产线交叉污染
  oats: { contains: [], free: ['egg', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  'sweet-potato': { contains: [], free: ['gluten', 'egg', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  'purple-potato': { contains: [], free: ['gluten', 'egg', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  // 全麦面包：含麸质；商用面团常含乳与大豆
  'whole-bread': { contains: ['gluten'], free: ['fish', 'shellfish'] },
  // 意面（干）：杜兰小麦，含麸质；可能含蛋
  pasta: { contains: ['gluten'], free: ['milk', 'peanut', 'fish', 'shellfish'] },
  potato: { contains: [], free: ['gluten', 'egg', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  // 挂面：含麸质；部分产品加蛋
  noodle: { contains: ['gluten'], free: ['milk', 'peanut', 'fish', 'shellfish'] },
  // 馒头：小麦粉，含麸质
  mantou: { contains: ['gluten'], free: ['egg', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  corn: { contains: [], free: ['gluten', 'egg', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },

  // ---- 脂肪类 ----
  avocado: { contains: [], free: ['gluten', 'egg', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  // 混合坚果：含树坚果，多数产线也处理花生
  nuts: { contains: ['treenut', 'peanut'], free: ['gluten', 'egg', 'milk', 'soy', 'fish', 'shellfish'] },
  'olive-oil': { contains: [], free: ['gluten', 'egg', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  'peanut-butter': { contains: ['peanut'], free: ['gluten', 'egg', 'milk', 'fish', 'shellfish'] },

  // ---- 乳制品 ----
  cheese: { contains: ['milk'], free: ['gluten', 'egg', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  milk: { contains: ['milk'], free: ['gluten', 'egg', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  yogurt: { contains: ['milk'], free: ['gluten', 'egg', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  'soy-milk': { contains: ['soy'], free: ['gluten', 'egg', 'milk', 'peanut', 'treenut', 'fish', 'shellfish'] },

  // ---- 蔬菜 ----
  broccoli: { contains: [], free: ['gluten', 'egg', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  spinach: { contains: [], free: ['gluten', 'egg', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  tomato: { contains: [], free: ['gluten', 'egg', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  cucumber: { contains: [], free: ['gluten', 'egg', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  'bok-choy': { contains: [], free: ['gluten', 'egg', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  mushroom: { contains: [], free: ['gluten', 'egg', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  carrot: { contains: [], free: ['gluten', 'egg', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },

  // ---- 水果 ----
  apple: { contains: [], free: ['gluten', 'egg', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  banana: { contains: [], free: ['gluten', 'egg', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  orange: { contains: [], free: ['gluten', 'egg', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },
  blueberry: { contains: [], free: ['gluten', 'egg', 'milk', 'soy', 'peanut', 'treenut', 'fish', 'shellfish'] },

  // ---- 复合与加工品（不确定项一律保守） ----
  'rice-noodle': { contains: [], free: ['egg', 'milk', 'peanut', 'treenut', 'fish', 'shellfish'] },
  // 饺子：面皮含麸质；馅料常含大豆（酱油）、蛋
  dumpling: { contains: ['gluten', 'soy'], free: ['milk', 'peanut', 'treenut', 'fish', 'shellfish'] },
  // 蛋炒饭：含蛋与米饭；酱油可能含大豆与小麦
  'fried-rice': { contains: ['egg', 'soy'], free: ['milk', 'peanut', 'treenut', 'fish', 'shellfish'] },
  // 麻辣烫：底料与蘸料成分不可控
  hotpot: { contains: [], free: [] },
  // 奶茶：含乳；珍珠与配料常含麸质
  'milk-tea': { contains: ['milk'], free: ['egg', 'peanut', 'fish', 'shellfish'] },
  // 曲奇：含麸质、乳、蛋；产线常接触坚果
  cookie: { contains: ['gluten', 'milk', 'egg'], free: ['fish', 'shellfish'] },
};

/** 生成扁平标注表：每个食物 × 每个过敏原一行。 */
export function buildFoodAllergens(): FoodAllergenRow[] {
  const rows: FoodAllergenRow[] = [];
  for (const [foodId, spec] of Object.entries(TABLE)) {
    for (const { code } of ALLERGEN_CODES) {
      const presence: AllergenPresence = spec.contains.includes(code)
        ? 'contains'
        : spec.free.includes(code)
          ? 'free'
          : 'mayContain';
      rows.push({ foodId, code, presence, sourceRef: SRC });
    }
  }
  return rows;
}

export const FOOD_ALLERGENS: FoodAllergenRow[] = buildFoodAllergens();

/** 某食物的过敏原标注；未收录的食物返回空（调用方应按 mayContain 处理）。 */
export function allergensOf(foodId: string): FoodAllergenRow[] {
  return FOOD_ALLERGENS.filter((r) => r.foodId === foodId);
}

/** 标注覆盖率统计，供内容审核核对。 */
export function allergenCoverage(foodIds: string[]): {
  total: number;
  annotated: number;
  missing: string[];
  byPresence: Record<AllergenPresence, number>;
} {
  const byPresence: Record<AllergenPresence, number> = { contains: 0, mayContain: 0, free: 0 };
  const missing: string[] = [];
  let annotated = 0;
  for (const id of foodIds) {
    const rows = allergensOf(id);
    if (!rows.length) {
      missing.push(id);
      continue;
    }
    annotated += 1;
    for (const r of rows) byPresence[r.presence] += 1;
  }
  return { total: foodIds.length, annotated, missing, byPresence };
}
