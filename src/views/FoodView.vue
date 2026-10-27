<script setup lang="ts">
import { computed, ref } from 'vue';
import { store } from '../store/appStore';
import { FOOD_GROUPS, nutritionFor, portionText, searchFoods, unitOf, type Food } from '../content/foods';
import { addDays, businessDate, shortDate } from '../domain/units';
import {
  DEFAULT_WATER_GOAL_ML,
  WATER_QUICK_ADD,
  waterProgress,
  waterText,
  waterTotal,
} from '../domain/water';
import { useToast } from '../composables/useToast';
import { useSheetBack } from '../composables/useBackLayer';
import { filterFoods } from '../domain/allergens';
import { ALLERGEN_CODES, FOOD_ALLERGENS } from '../content/allergens';
import type { DietRestriction, FoodEntry } from '../domain/types';
import type { Slot } from '../domain/types';
import { buildMealPlan, planForSlot, type MealPlanItem } from '../domain/meal-plan';


const { push } = useToast();

/**
 * 当前查看/记录的日期。
 *
 * 原来写死 `businessDate()`，只能记今天——"昨晚忘了记"这条最高频的真实路径
 * 直接走不通（PM 深评 §3.7）。现在可以往回翻并补记，不允许记未来。
 */
const selectedDate = ref(businessDate());
const isToday = computed(() => selectedDate.value === businessDate());

function shiftDate(days: number): void {
  const next = addDays(selectedDate.value, days);
  if (next > businessDate()) return;
  selectedDate.value = next;
}

function goToday(): void {
  selectedDate.value = businessDate();
}

const slots: Array<{ id: Slot; label: string; time: string }> = [
  { id: 'breakfast', label: '早餐', time: '08:00' },
  { id: 'lunch', label: '午餐', time: '12:00' },
  { id: 'dinner', label: '晚餐', time: '18:30' },
  { id: 'snack', label: '加餐', time: '21:00' },
];

const sheet = ref<{ slot: Slot } | null>(null);
const keyword = ref('');
const group = ref<Food['group'] | 'all'>('all');
const selected = ref<Food | null>(null);
/** 按克录入的数值。 */
const amount = ref(100);
/** 按份数录入的数值（个/根/片…）。 */
const count = ref(1);
const byCount = ref(true);
const manualKcal = ref('');
const manualProtein = ref('');
const manualCarb = ref('');
const manualFat = ref('');

// 返回键/边缘返回先关面板
useSheetBack(computed(() => sheet.value !== null), () => { sheet.value = null; });

const foodsOnDate = computed(() => store.state.foods.filter((f) => f.date === selectedDate.value));
const totals = computed(() => ({
  kcal: foodsOnDate.value.reduce((s, f) => s + f.kcal, 0),
  protein: foodsOnDate.value.reduce((s, f) => s + f.protein, 0),
  // carb/fat 一直在采集，但之前界面只显示热量与蛋白，等于白采（PM 评审 §3.7）
  carb: foodsOnDate.value.reduce((s, f) => s + (f.carb ?? 0), 0),
  fat: foodsOnDate.value.reduce((s, f) => s + (f.fat ?? 0), 0),
}));

/*
 * 碳水/脂肪是否"真的记录过"。
 *
 * totals 里用 ?? 0 兜底是为了求和方便，但直接显示就成了
 * "没记录 = 0 克"。1000 kcal 的餐显示 0 g 碳水，用户一算就发现对不上。
 */
const macroRecorded = computed(() => ({
  carb: foodsOnDate.value.some((f) => typeof f.carb === 'number'),
  fat: foodsOnDate.value.some((f) => typeof f.fat === 'number'),
}));

/*
 * 饮水：与饮食共用同一个 selectedDate，补记昨天时水量也落在昨天。
 * 环形进度用冷色，和热量环的酸橙分开，避免两个环看起来是同一个指标。
 */
const waterQuickAdd = WATER_QUICK_ADD;
const waterGoal = computed(() => store.state.waterGoalMl ?? DEFAULT_WATER_GOAL_ML);
const waterTotalMl = computed(() => waterTotal(store.state.water, selectedDate.value));
const waterPct = computed(() => waterProgress(waterTotalMl.value, waterGoal.value));
const waterHint = computed(() => waterText(waterTotalMl.value, waterGoal.value));

function addWater(ml: number): void {
  store.addWater(ml, selectedDate.value);
}

/*
 * 饮食计划：把每日目标拆到四个餐次。
 * 用户按计划吃完就勾完成；吃的不一样就走手动录入——
 * store.addFood 会自动移除同餐次的"按计划"占位，避免重复计数。
 */
const mealPlan = computed(() => buildMealPlan(targetKcal.value, targetProtein.value));

function slotEntries(slot: Slot): FoodEntry[] {
  return foodsOnDate.value.filter((f) => f.slot === slot);
}

function slotPlan(slot: Slot): MealPlanItem | null {
  return planForSlot(mealPlan.value, slot);
}

function completeByPlan(slot: Slot): void {
  const plan = slotPlan(slot);
  if (!plan) return;
  store.addFood({
    date: selectedDate.value,
    slot,
    label: '按计划',
    kcal: plan.kcal,
    protein: plan.protein,
    source: 'plan',
  });
  push('已按计划完成', 'success');
}

/**
 * 目标只能来自用户设置。
 *
 * 原来这里回落到写死的 2350 kcal / 165 g：55kg 的用户也看到 2350，
 * "目标"变成假数字（PM 评审 §4.3 数据诚实）。没设置就如实说没设置，
 * 不画进度环，也不编一个默认值。
 */
const targetKcal = computed(() => store.state.targetKcal);
const targetProtein = computed(() => store.state.targetProtein);

const kcalPct = computed(() =>
  targetKcal.value && targetKcal.value > 0
    ? Math.min(100, Math.round((totals.value.kcal / targetKcal.value) * 100))
    : null,
);

/** 用户已确认的过敏原限制；未确认时为空，此时不隐藏食物但界面提示确认。 */
const restrictions = computed<DietRestriction[]>(() =>
  store.state.profile.allergies.map((code) => ({
    id: `r_${code}`,
    kind: 'allergen' as const,
    code,
    label: ALLERGEN_CODES.find((c) => c.code === code)?.label ?? code,
    severity: 'strict' as const,
    source: '用户设置',
  })),
);

const filterResult = computed(() =>
  filterFoods(searchFoods(keyword.value), FOOD_ALLERGENS, restrictions.value),
);

const results = computed(() => {
  const list = filterResult.value.allowed;
  return group.value === 'all' ? list : list.filter((f) => f.group === group.value);
});

/** 被过敏原排除的数量，用于给出可解释提示。 */
const excludedCount = computed(() => filterResult.value.excluded.length);

/** 当前食物的计数单位（鸡蛋=个、面包=片…），没有可数单位时返回 null。 */
const unit = computed(() => (selected.value ? unitOf(selected.value) : null));

/** 输入框清空时 v-model.number 会给出空串，统一收敛成合法份数。 */
const safeCount = computed(() => {
  const v = Number(count.value);
  return Number.isFinite(v) && v > 0 ? v : 1;
});

const safeAmount = computed(() => {
  const v = Number(amount.value);
  return Number.isFinite(v) && v > 0 ? v : 100;
});

/** 最终计入的克数：按份数时由单位重量换算。 */
const grams = computed(() => {
  if (byCount.value && unit.value) return Math.max(1, Math.round(safeCount.value * unit.value.grams));
  return Math.max(1, Math.round(safeAmount.value));
});

const preview = computed(() => (selected.value ? nutritionFor(selected.value, grams.value) : null));

function openSheet(slot: Slot): void {
  sheet.value = { slot };
  keyword.value = '';
  group.value = 'all';
  selected.value = null;
  amount.value = 100;
  count.value = 1;
  byCount.value = true;
}

function addFromFood(): void {
  if (!selected.value || !sheet.value || !preview.value) return;
  const food = selected.value;
  const u = unit.value;
  const label =
    byCount.value && u
      ? `${food.name} ${trimNum(safeCount.value)}${u.label}（${grams.value}g）`
      : `${food.name} ${grams.value}g`;
  store.addFood({
    date: selectedDate.value,
    slot: sheet.value.slot,
    label,
    kcal: preview.value.kcal,
    protein: preview.value.protein,
    carb: preview.value.carb,
    fat: preview.value.fat,
  });
  push('已记录', 'success');
  sheet.value = null;
}

function addManual(): void {
  const kcal = Number.parseInt(manualKcal.value, 10);
  const protein = Number.parseFloat(manualProtein.value);
  if (!Number.isFinite(kcal) || kcal <= 0 || !sheet.value) {
    push('请填写热量', 'error');
    return;
  }
  store.addFood({
    date: selectedDate.value,
    slot: sheet.value.slot,
    label: '手工记录',
    kcal,
    protein: Number.isFinite(protein) ? protein : 0,
  });
  manualKcal.value = '';
  manualProtein.value = '';
  push('已记录', 'success');
  sheet.value = null;
}

function selectFood(food: Food): void {
  selected.value = food;
  amount.value = food.portion.grams;
  count.value = 1;
  // 有可数单位的食物默认按份数录入：鸡蛋点"2 个"比算 100g 自然
  byCount.value = unitOf(food) !== null;
}

/** 去掉 2.0 这类多余小数，让记录标签干净。 */
function trimNum(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

function stepCount(delta: number): void {
  const step = unit.value?.step ?? 1;
  const next = Math.round((safeCount.value + delta * step) * 10) / 10;
  count.value = Math.max(step, next);
}

function stepGrams(delta: number): void {
  amount.value = Math.max(10, Math.round(safeAmount.value + delta));
}

function removeEntry(id: string): void {
  // 先取出整条，撤销时原样放回（id 不变，不会产生重复条目）
  const removed = store.state.foods.find((f) => f.id === id);
  if (!removed) return;
  store.removeFood(id);
  push('已删除这条记录', 'default', {
    label: '撤销',
    onAction: () => {
      store.restoreFood(removed);
      push('已恢复', 'success');
    },
  });
}
</script>

<template>
  <div class="me">
    <header class="me__head">
      <div>
        <p class="label">饮食</p>
        <h1 class="h1">{{ isToday ? '今天吃了什么' : `${shortDate(selectedDate)}吃了什么` }}</h1>
      </div>
    </header>

    <!-- 日期切换：昨晚忘了记，今天还能补；不允许记未来 -->
    <div class="date-nav">
      <button class="icon-btn" aria-label="前一天" @click="shiftDate(-1)">‹</button>
      <button class="date-nav__label" @click="goToday">
        <span>{{ isToday ? '今天' : shortDate(selectedDate) }}</span>
        <span v-if="!isToday" class="tiny">回到今天</span>
      </button>
      <button class="icon-btn" aria-label="后一天" :disabled="isToday" @click="shiftDate(1)">›</button>
    </div>

    <!-- nutrition card -->
    <section class="card card--ink nutrition">
      <div class="nutrition__top">
        <div>
          <p class="label">{{ isToday ? '今日摄入' : '当日摄入' }}</p>
          <p class="nutrition__kcal">
            {{ totals.kcal }}<span v-if="targetKcal">/ {{ targetKcal }} kcal</span><span v-else> kcal</span>
          </p>
          <p v-if="!targetKcal" class="tiny nutrition__unset">
            还没设目标 · 在「我的 → 身体」里设置
          </p>
        </div>
        <div v-if="kcalPct !== null" class="ring" :style="{ '--pct': kcalPct }">
          <div class="ring__inner">
            <span class="ring__num">{{ kcalPct }}<span>%</span></span>
          </div>
        </div>
      </div>
      <!-- 三大宏量都展示：carb/fat 已经采集，不展示等于白采 -->
      <div class="nutrition__macro">
        <div>
          <span class="tiny">蛋白质</span>
          <strong>
            {{ Math.round(totals.protein) }}<template v-if="targetProtein"> / {{ targetProtein }}</template> g
          </strong>
        </div>
        <div>
          <span class="tiny">碳水</span>
          <!--
            没记录过碳水就显示"—"，不要显示 0 g。
            "0 g" 会让用户以为碳水真的是 0，而热量却有一千多，
            数字自己算不平，信任从这一处开始崩。
          -->
          <strong>{{ macroRecorded.carb ? `${Math.round(totals.carb)} g` : '—' }}</strong>
        </div>
        <div>
          <span class="tiny">脂肪</span>
          <strong>{{ macroRecorded.fat ? `${Math.round(totals.fat)} g` : '—' }}</strong>
        </div>
      </div>
    </section>

    <!-- 饮水：和饮食同一天；环形进度，中间水滴 -->
    <section class="card water-card">
      <div class="water-card__main">
        <div class="water-card__text">
          <p class="label">今日饮水</p>
          <p class="h3">{{ waterTotalMl }}<span class="tiny"> / {{ waterGoal }} ml</span></p>
          <p class="tiny">{{ waterHint }}</p>
        </div>
        <div
          class="ring ring--water"
          :style="{ '--pct': waterPct ?? 0 }"
          role="img"
          :aria-label="`饮水 ${waterTotalMl} 毫升，目标 ${waterGoal} 毫升`"
        >
          <div class="ring__inner ring__inner--water">
            <svg
              class="water-drop"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M12 3.2c3.2 4 5.4 6.7 5.4 9.6a5.4 5.4 0 1 1-10.8 0c0-2.9 2.2-5.6 5.4-9.6Z" />
            </svg>
            <span class="ring__num ring__num--water">{{ waterPct ?? 0 }}<span>%</span></span>
          </div>
        </div>
      </div>
      <div class="water-card__actions">
        <button v-for="ml in waterQuickAdd" :key="ml" class="btn btn--ghost btn--sm" @click="addWater(ml)">
          +{{ ml }} ml
        </button>
      </div>
    </section>

    <!-- meals -->
    <section class="stack gap-10">
      <div v-for="slot in slots" :key="slot.id" class="card meal">
        <div class="meal__head">
          <div class="row gap-10">
            <span class="meal__badge">{{ slot.label.slice(0, 1) }}</span>
            <div>
              <p class="h3">{{ slot.label }}</p>
              <p class="tiny">{{ slot.time }}</p>
            </div>
          </div>
          <div class="meal__actions">
            <span v-if="slotEntries(slot.id).length" class="chip chip--sm chip--lime">✓ 已完成</span>
            <button v-else-if="slotPlan(slot.id)" class="btn btn--ghost btn--sm" @click="completeByPlan(slot.id)">
              按计划完成
            </button>
            <button class="btn btn--ghost btn--sm" @click="openSheet(slot.id)">添加</button>
          </div>
        </div>
        <p v-if="!slotEntries(slot.id).length && slotPlan(slot.id)" class="tiny meal__plan">
          计划 {{ slotPlan(slot.id)!.kcal }} kcal<template v-if="slotPlan(slot.id)!.protein"> · 蛋白 {{ slotPlan(slot.id)!.protein }}g</template>
        </p>
        <div v-if="slotEntries(slot.id).length" class="meal__items">
          <div v-for="f in slotEntries(slot.id)" :key="f.id" class="meal__item">
            <span class="recent__body">
              <span class="h3">{{ f.label }}</span>
              <span class="tiny">
                {{ f.kcal }} kcal · 蛋白 {{ f.protein }}g<template v-if="f.carb != null"> · 碳 {{ Math.round(f.carb) }}g</template><template v-if="f.fat != null"> · 脂 {{ Math.round(f.fat) }}g</template>
              </span>
            </span>
            <button class="meal__del" aria-label="删除" @click="removeEntry(f.id)">✕</button>
          </div>
        </div>
        <p v-else class="tiny meal__empty">还没有记录</p>
      </div>
    </section>

    <p class="tiny me__note">
      未记录的餐次按 0 展示，不代表实际为 0；部分记录不等于全天完整。
    </p>

    <!-- add food sheet -->
    <Transition name="sheet">
      <div v-if="sheet" class="sheet" @click.self="sheet = null">
        <div class="sheet__panel">
          <div class="sheet__head">
            <div>
              <p class="label">{{ slots.find((s) => s.id === sheet?.slot)?.label }}</p>
              <h2 class="h2">{{ selected ? '确认份量' : '选择食物' }}</h2>
            </div>
            <button class="icon-btn" @click="sheet = null" aria-label="关闭">✕</button>
          </div>

          <template v-if="!selected">
            <input v-model="keyword" class="input" type="search" placeholder="搜索食物，如 鸡胸 / 米饭" />
            <div class="scroll-x add__groups">
              <button class="chip" :class="{ 'chip--on': group === 'all' }" @click="group = 'all'">全部</button>
              <button
                v-for="g in FOOD_GROUPS"
                :key="g.id"
                class="chip"
                :class="{ 'chip--on': group === g.id }"
                @click="group = g.id"
              >
                {{ g.label }}
              </button>
            </div>
            <p v-if="excludedCount > 0" class="add__notice">
              已按你的过敏原设置隐藏 {{ excludedCount }} 项食物。
            </p>
            <div class="add__list">
              <button v-for="f in results.slice(0, 40)" :key="f.id" class="add__item" @click="selectFood(f)">
                <span class="recent__body">
                  <span class="h3">{{ f.name }}</span>
                  <span class="tiny">{{ f.kcal }} kcal/100g · 蛋白 {{ f.protein }}g</span>
                </span>
                <span class="tiny">{{ portionText(f) }}</span>
              </button>
            </div>
            <div class="divider" />
            <p class="tiny">找不到？直接填总量</p>
            <!--
              四个字段放两行：一行塞四个 input 在 390px 下每个只有 60px，
              连"1200"都显示不全。
              碳水/脂肪是可选：不填就存 undefined，界面显示"—"而不是 0 g。
            -->
            <div class="manual">
              <input v-model="manualKcal" class="input" inputmode="numeric" placeholder="热量 kcal" />
              <input v-model="manualProtein" class="input" inputmode="decimal" placeholder="蛋白 g" />
              <input v-model="manualCarb" class="input" inputmode="decimal" placeholder="碳水 g（可选）" />
              <input v-model="manualFat" class="input" inputmode="decimal" placeholder="脂肪 g（可选）" />
              <button class="btn btn--primary btn--sm manual__go" @click="addManual">记录</button>
            </div>
          </template>

          <template v-else>
            <div class="confirm">
              <p class="h2">{{ selected.name }}</p>
              <p class="small">{{ selected.kcal }} kcal / 100g</p>

              <!-- 有可数单位时先问"几个"，再换算成克 -->
              <div v-if="unit" class="seg unitseg">
                <button class="seg__item" :class="{ 'is-on': byCount }" @click="byCount = true">
                  按{{ unit.label }}
                </button>
                <button class="seg__item" :class="{ 'is-on': !byCount }" @click="byCount = false">
                  按克
                </button>
              </div>

              <div v-if="byCount && unit" class="confirm__amount">
                <button class="icon-btn" aria-label="减少" @click="stepCount(-1)">−</button>
                <input v-model.number="count" class="input input--lg confirm__input" inputmode="decimal" />
                <span class="small">{{ unit.label }}</span>
                <button class="icon-btn" aria-label="增加" @click="stepCount(1)">+</button>
              </div>
              <div v-else class="confirm__amount">
                <button class="icon-btn" aria-label="减少" @click="stepGrams(-10)">−</button>
                <input v-model.number="amount" class="input input--lg confirm__input" inputmode="numeric" />
                <span class="small">g</span>
                <button class="icon-btn" aria-label="增加" @click="stepGrams(10)">+</button>
              </div>

              <p v-if="byCount && unit" class="tiny confirm__hint">
                {{ trimNum(safeCount) }}{{ unit.label }} ≈ {{ grams }}g（1{{ unit.label }}约 {{ Math.round(unit.grams) }}g）
              </p>

              <div v-if="preview" class="grid-2 confirm__stats">
                <div class="stat"><span class="stat__value">{{ preview.kcal }}</span><span class="stat__label">kcal</span></div>
                <div class="stat"><span class="stat__value">{{ preview.protein }}<span class="stat__unit">g</span></span><span class="stat__label">蛋白</span></div>
                <div class="stat"><span class="stat__value">{{ preview.carb }}<span class="stat__unit">g</span></span><span class="stat__label">碳水</span></div>
                <div class="stat"><span class="stat__value">{{ preview.fat }}<span class="stat__unit">g</span></span><span class="stat__label">脂肪</span></div>
              </div>
            </div>
            <div class="row gap-10" style="margin-top: 18px">
              <button class="btn btn--ghost btn--block" @click="selected = null">返回</button>
              <button class="btn btn--lime btn--block" @click="addFromFood">记录</button>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.me {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.me__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
}

/* 日期切换：整行可点，触控区 44px */
.date-nav {
  display: flex;
  align-items: center;
  gap: 8px;
}

.date-nav__label {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--card);
  color: var(--text);
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.date-nav .icon-btn {
  min-width: 44px;
  min-height: 44px;
}

.date-nav .icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.nutrition {
  background: radial-gradient(120% 100% at 100% 0%, var(--ink-glow) 0%, var(--surface-ink) 58%);
  padding: 20px;
}

.nutrition__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.nutrition__kcal {
  font-size: 40px;
  font-weight: 700;
  letter-spacing: -0.045em;
  line-height: 1;
}

.nutrition__kcal span {
  font-size: 14px;
  color: rgba(var(--inv-rgb), 0.5);
  font-weight: 500;
  letter-spacing: 0;
  margin-left: 4px;
}

.ring__inner {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.ring__num {
  font-size: 22px;
  font-weight: 700;
}

.ring__num span {
  font-size: 12px;
  color: rgba(var(--inv-rgb), 0.5);
}

/* 饮水卡：环形用冷色，和热量环的酸橙区分开 */
.water-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.water-card__main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.water-card__text {
  min-width: 0;
}

.water-card__actions {
  display: flex;
  gap: 8px;
}

.water-card__actions .btn {
  flex: 1;
}

.ring--water {
  --size: 84px;
  background:
    radial-gradient(closest-side, var(--card) 76%, transparent 77% 100%),
    conic-gradient(var(--sky) calc(var(--pct) * 1%), rgba(var(--ink-rgb), 0.08) 0);
}

.ring__inner--water {
  gap: 1px;
}

.water-drop {
  width: 20px;
  height: 20px;
  color: var(--sky);
}

.ring__num--water {
  font-size: 12px;
  line-height: 1;
}

.ring__num--water span {
  font-size: 9px;
  color: var(--text-3);
}

.meal__plan {
  margin-top: 8px;
  color: var(--text-3);
}

.meal__actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.nutrition__macro {
  margin-top: 18px;
  display: grid;
  grid-template-columns: 1.5fr 1fr 1fr;
  gap: 12px;
  align-items: start;
}

.nutrition__unset {
  margin-top: 6px;
  color: rgba(var(--inv-rgb), 0.5);
}

.nutrition__macro strong {
  display: block;
  font-size: 15px;
  margin: 5px 0 7px;
}

.ring {
  --size: 92px;
}

.meal {
  padding: 15px 16px;
}

.meal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.meal__badge {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  background: rgba(var(--ink-rgb), 0.055);
  display: grid;
  place-items: center;
  font-size: 13px;
  font-weight: 650;
}

.meal__items {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
}

.meal__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-top: 1px solid var(--line);
}

.meal__del {
  position: relative;
  width: 26px;
  height: 26px;
  border-radius: 9px;
  color: var(--text-3);
  font-size: 12px;
}

/* 视觉保持 26px，触控区扩到 44×44，避免真机上难点中 */
.meal__del::after {
  content: '';
  position: absolute;
  inset: -9px;
}



.meal__del:hover {
  background: var(--clay-soft);
  color: var(--clay);
}

.meal__empty {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}

.me__note {
  padding: 0 4px;
}

.add__groups {
  margin-top: 10px;
}

.add__list {
  margin-top: 10px;
  max-height: 38vh;
  overflow: auto;
}

.add__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 2px;
  border-bottom: 1px solid var(--line);
  text-align: left;
}

.confirm {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.confirm__amount {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}

.confirm__input {
  max-width: 130px;
}

.confirm__stats {
  margin-top: 14px;
}

.unitseg {
  margin-top: 12px;
}

.confirm__hint {
  margin-top: 8px;
  color: var(--text-2);
}

.recent__body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}
.add__notice {
  margin: 8px 2px;
  padding: 9px 12px;
  border-radius: 12px;
  background: var(--warn-soft);
  color: var(--warn-ink);
  font-size: 12.5px;
  line-height: 1.45;
}
</style>

















/* 手动录入：两行两列 + 一个整行按钮 */
.manual {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 8px;
}

.manual__go {
  grid-column: 1 / -1;
}
