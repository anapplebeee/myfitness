<script setup lang="ts">
import { computed, ref } from 'vue';
import { store } from '../store/appStore';
import { FOOD_GROUPS, nutritionFor, searchFoods, type Food } from '../content/foods';
import { businessDate } from '../domain/units';
import { useToast } from '../composables/useToast';
import type { Slot } from '../domain/types';


const { push } = useToast();
const today = businessDate();

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
const grams = ref(100);
const manualKcal = ref('');
const manualProtein = ref('');

const foodsToday = computed(() => store.state.foods.filter((f) => f.date === today));
const totals = computed(() => ({
  kcal: foodsToday.value.reduce((s, f) => s + f.kcal, 0),
  protein: foodsToday.value.reduce((s, f) => s + f.protein, 0),
}));

const targetKcal = computed(() => store.state.targetKcal ?? 2350);
const targetProtein = computed(() => store.state.targetProtein ?? 165);

const results = computed(() => {
  const list = searchFoods(keyword.value);
  return group.value === 'all' ? list : list.filter((f) => f.group === group.value);
});

const preview = computed(() => (selected.value ? nutritionFor(selected.value, grams.value) : null));

function openSheet(slot: Slot): void {
  sheet.value = { slot };
  keyword.value = '';
  group.value = 'all';
  selected.value = null;
  grams.value = 100;
}

function addFromFood(): void {
  if (!selected.value || !sheet.value || !preview.value) return;
  store.addFood({
    date: today,
    slot: sheet.value.slot,
    label: `${selected.value.name} ${grams.value}g`,
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
    date: today,
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
  grams.value = food.portion.grams;
}

function removeEntry(id: string): void {
  store.removeFood(id);
  push('已删除');
}
</script>

<template>
  <div class="me">
    <header class="me__head">
      <div>
        <p class="label">饮食</p>
        <h1 class="h1">今天吃了什么</h1>
      </div>
    </header>

    <!-- nutrition card -->
    <section class="card card--ink nutrition">
      <div class="nutrition__top">
        <div>
          <p class="label">今日摄入</p>
          <p class="nutrition__kcal">
            {{ totals.kcal }}<span>/ {{ targetKcal }} kcal</span>
          </p>
        </div>
        <div class="ring" :style="{ '--pct': Math.min(100, Math.round((totals.kcal / targetKcal) * 100)) }">
          <div class="ring__inner">
            <span class="ring__num">{{ Math.min(100, Math.round((totals.kcal / targetKcal) * 100)) }}<span>%</span></span>
          </div>
        </div>
      </div>
      <div class="nutrition__macro">
        <div>
          <span class="tiny">蛋白质</span>
          <strong>{{ Math.round(totals.protein) }} / {{ targetProtein }} g</strong>
          <div class="bar"><div class="bar__fill" :style="{ width: `${Math.min(100, Math.round((totals.protein / targetProtein) * 100))}%` }" /></div>
        </div>
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
          <button class="btn btn--ghost btn--sm" @click="openSheet(slot.id)">添加</button>
        </div>
        <div v-if="foodsToday.filter((f) => f.slot === slot.id).length" class="meal__items">
          <div v-for="f in foodsToday.filter((x) => x.slot === slot.id)" :key="f.id" class="meal__item">
            <span class="recent__body">
              <span class="h3">{{ f.label }}</span>
              <span class="tiny">{{ f.kcal }} kcal · 蛋白 {{ f.protein }}g</span>
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
            <div class="add__list">
              <button v-for="f in results.slice(0, 40)" :key="f.id" class="add__item" @click="selectFood(f)">
                <span class="recent__body">
                  <span class="h3">{{ f.name }}</span>
                  <span class="tiny">{{ f.kcal }} kcal/100g · 蛋白 {{ f.protein }}g</span>
                </span>
                <span class="tiny">{{ f.portion.label }}</span>
              </button>
            </div>
            <div class="divider" />
            <p class="tiny">找不到？直接填总量</p>
            <div class="row gap-8" style="margin-top: 8px">
              <input v-model="manualKcal" class="input" inputmode="numeric" placeholder="热量 kcal" />
              <input v-model="manualProtein" class="input" inputmode="decimal" placeholder="蛋白 g" />
              <button class="btn btn--primary btn--sm" @click="addManual">记录</button>
            </div>
          </template>

          <template v-else>
            <div class="confirm">
              <p class="h2">{{ selected.name }}</p>
              <p class="small">{{ selected.kcal }} kcal / 100g</p>
              <div class="confirm__amount">
                <button class="icon-btn" @click="grams = Math.max(10, grams - 10)">−</button>
                <input v-model.number="grams" class="input input--lg confirm__input" inputmode="numeric" />
                <span class="small">g</span>
                <button class="icon-btn" @click="grams = grams + 10">+</button>
              </div>
              <div v-if="preview" class="grid-2 confirm__stats">
                <div class="stat"><span class="stat__value">{{ preview.kcal }}</span><span class="stat__label">kcal</span></div>
                <div class="stat"><span class="stat__value">{{ preview.protein }}<span class="stat__unit">g</span></span><span class="stat__label">蛋白</span></div>
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

.nutrition {
  background: radial-gradient(120% 100% at 100% 0%, #26301f 0%, var(--ink) 58%);
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
  color: rgba(244, 246, 238, 0.5);
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
  color: rgba(244, 246, 238, 0.5);
}

.nutrition__macro {
  margin-top: 18px;
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
  background: rgba(17, 20, 17, 0.055);
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
  width: 26px;
  height: 26px;
  border-radius: 9px;
  color: var(--text-3);
  font-size: 12px;
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

.recent__body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}
</style>




