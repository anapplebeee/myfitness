/** 食物库：每 100g 可食部。数据为常见参考值，界面标注来源与估算。 */

import type { Food } from './types';

export type { Food } from './types';

const f = (
  id: string,
  name: string,
  group: Food['group'],
  kcal: number,
  protein: number,
  carb: number,
  fat: number,
  portionLabel: string,
  portionGrams: number,
  alias?: string[],
): Food => ({
  id,
  name,
  group,
  kcal,
  protein,
  carb,
  fat,
  portion: { label: portionLabel, grams: portionGrams },
  ...(alias ? { alias } : {}),
});

export const FOODS: Food[] = [
  f('chicken-breast', '鸡胸肉（熟）', 'protein', 165, 31, 0, 3.6, '一块', 150, ['鸡胸']),
  f('chicken-thigh', '鸡腿肉（去皮）', 'protein', 181, 24, 0, 9, '一只', 120),
  f('beef-lean', '牛里脊', 'protein', 133, 22, 0, 4.5, '一份', 120),
  f('beef-brisket', '牛腱肉', 'protein', 143, 22, 1.2, 5, '一份', 120),
  f('pork-loin', '猪里脊', 'protein', 143, 21, 0, 6, '一份', 120),
  f('salmon', '三文鱼', 'protein', 208, 20, 0, 13, '一块', 120),
  f('cod', '鳕鱼', 'protein', 82, 18, 0, 0.7, '一块', 120),
  f('shrimp', '虾仁', 'protein', 99, 20, 0.2, 1.4, '一份', 100),
  f('egg', '鸡蛋', 'protein', 143, 12.6, 0.7, 9.5, '一个', 50, ['水煮蛋', '煎蛋']),
  f('egg-white', '蛋清', 'protein', 52, 11, 0.7, 0.2, '一个', 33),
  f('tofu', '北豆腐', 'protein', 116, 12, 2, 7, '一块', 100, ['豆腐']),
  f('tuna-can', '金枪鱼（水浸）', 'protein', 116, 26, 0, 1, '一罐', 100),
  f('whey', '乳清蛋白粉', 'protein', 380, 78, 8, 4, '一勺', 30, ['蛋白粉']),
  f('edamame', '毛豆', 'protein', 131, 13, 10, 5, '一小碗', 80),

  f('rice-cooked', '米饭（熟）', 'carb', 116, 2.6, 25.9, 0.3, '一碗', 200, ['白米饭', '米饭']),
  f('brown-rice', '糙米饭（熟）', 'carb', 112, 2.3, 23, 0.8, '一碗', 200),
  f('oats', '燕麦片（干）', 'carb', 389, 16.9, 66, 6.9, '一份', 50, ['燕麦']),
  f('sweet-potato', '红薯', 'carb', 86, 1.6, 20, 0.1, '一个', 150),
  f('purple-potato', '紫薯', 'carb', 82, 1.5, 18, 0.2, '一个', 150),
  f('whole-bread', '全麦面包', 'carb', 246, 9, 46, 3.4, '两片', 70, ['面包']),
  f('pasta', '意面（干）', 'carb', 371, 13, 75, 1.5, '一份', 80),
  f('potato', '土豆', 'carb', 77, 2, 17, 0.1, '一个', 150),
  f('noodle', '挂面（干）', 'carb', 346, 11, 71, 0.7, '一份', 80, ['面条']),
  f('mantou', '馒头', 'carb', 223, 7, 47, 1.1, '一个', 100),
  f('corn', '玉米', 'carb', 112, 4, 22, 1.2, '一根', 200),

  f('avocado', '牛油果', 'fat', 160, 2, 8.5, 15, '半个', 100),
  f('nuts', '混合坚果', 'fat', 607, 20, 21, 54, '一小把', 25, ['坚果']),
  f('olive-oil', '橄榄油', 'fat', 884, 0, 0, 100, '一勺', 10, ['油']),
  f('peanut-butter', '花生酱', 'fat', 588, 25, 20, 50, '一勺', 20),
  f('cheese', '奶酪', 'dairy', 350, 25, 1.5, 27, '一片', 20),
  f('milk', '牛奶（全脂）', 'dairy', 54, 3, 3.4, 3.2, '一杯', 250),
  f('yogurt', '希腊酸奶（无糖）', 'dairy', 59, 10, 3.6, 0.4, '一杯', 150, ['酸奶']),
  f('soy-milk', '豆浆（无糖）', 'dairy', 31, 3, 1.2, 1.6, '一杯', 250),

  f('broccoli', '西兰花', 'veg', 34, 2.8, 7, 0.4, '一份', 150),
  f('spinach', '菠菜', 'veg', 23, 2.9, 3.6, 0.4, '一份', 150),
  f('tomato', '番茄', 'veg', 18, 0.9, 3.9, 0.2, '一个', 150, ['西红柿']),
  f('cucumber', '黄瓜', 'veg', 15, 0.7, 3.6, 0.1, '一根', 200),
  f('bok-choy', '小白菜', 'veg', 13, 1.5, 2.2, 0.2, '一份', 150),
  f('mushroom', '香菇', 'veg', 26, 2.2, 5.2, 0.3, '一份', 100),
  f('carrot', '胡萝卜', 'veg', 41, 0.9, 10, 0.2, '一根', 100),

  f('apple', '苹果', 'fruit', 52, 0.3, 14, 0.2, '一个', 200),
  f('banana', '香蕉', 'fruit', 89, 1.1, 23, 0.3, '一根', 120),
  f('orange', '橙子', 'fruit', 47, 0.9, 12, 0.1, '一个', 150),
  f('blueberry', '蓝莓', 'fruit', 57, 0.7, 14, 0.3, '一小盒', 100),

  f('rice-noodle', '米线（熟）', 'carb', 109, 2, 24, 0.3, '一碗', 250),
  f('dumpling', '猪肉饺子', 'carb', 230, 9, 26, 9, '一份', 200, ['饺子']),
  f('fried-rice', '蛋炒饭', 'carb', 168, 5, 26, 5, '一盘', 300),
  f('hotpot', '麻辣烫（荤素）', 'carb', 120, 7, 12, 5, '一份', 400),
  f('milk-tea', '奶茶（三分糖）', 'snack', 65, 1, 11, 2, '一杯', 500),
  f('cookie', '曲奇饼干', 'snack', 502, 5, 64, 25, '一块', 15),
];

export const FOOD_BY_ID = new Map(FOODS.map((x) => [x.id, x]));

export const FOOD_GROUPS: Array<{ id: Food['group']; label: string }> = [
  { id: 'protein', label: '蛋白质' },
  { id: 'carb', label: '主食' },
  { id: 'veg', label: '蔬菜' },
  { id: 'fruit', label: '水果' },
  { id: 'dairy', label: '乳制品' },
  { id: 'fat', label: '脂肪' },
  { id: 'snack', label: '加餐' },
];

export function searchFoods(keyword: string): Food[] {
  const q = keyword.trim().toLowerCase();
  if (!q) return FOODS;
  return FOODS.filter((food) => {
    const hay = [food.name, ...(food.alias ?? [])].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

export function nutritionFor(food: Food, grams: number) {
  const ratio = grams / 100;
  return {
    kcal: Math.round(food.kcal * ratio),
    protein: Math.round(food.protein * ratio * 10) / 10,
    carb: Math.round(food.carb * ratio * 10) / 10,
    fat: Math.round(food.fat * ratio * 10) / 10,
  };
}


