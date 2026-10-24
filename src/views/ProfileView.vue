<script setup lang="ts">
import { computed, ref } from 'vue';
import { store, derived } from '../store/appStore';
import { FOODS } from '../content/foods';
import { EXERCISE_PACKS, packSummary } from '../content/packs';
import Sparkline from '../components/Sparkline.vue';
import { shortDate, weekdayLabel } from '../domain/units';
import { useToast } from '../composables/useToast';

import { ALLERGEN_CODES } from '../content/allergens';

const { push } = useToast();

const ALLERGENS = ALLERGEN_CODES;

/**
 * 切换一个过敏原。
 * 修改后必须重新确认：安全声明依赖"用户看过并确认过当前设置"，
 * 改了却不重置确认状态，会让 AC-F03 的门禁失效。
 */
function toggleAllergy(code: string): void {
  const current = store.state.profile.allergies;
  const next = current.includes(code) ? current.filter((c) => c !== code) : [...current, code];
  store.updateProfile({ allergies: next, restrictionsConfirmed: false });
}

function confirmRestrictions(): void {
  store.updateProfile({ restrictionsConfirmed: true });
  push('已确认过敏原设置', 'success');
}

const emit = defineEmits<{ (e: 'navigate', tab: 'data'): void }>();
function openData(): void {
  emit('navigate', 'data');
}

defineProps<{ greetingName?: string }>();

const tab = ref<'body' | 'data' | 'settings'>('body');
const weightInput = ref('');
const weightSheet = ref(false);

const series = computed(() => derived.weightSeries.value);
const latest = computed(() => derived.latestWeight.value);
const points = computed(() => series.value.map((w) => w.grams / 1000));
const delta = computed(() => {
  if (series.value.length < 2) return 0;
  const a = series.value[0]!;
  const b = series.value[series.value.length - 1]!;
  return (b.grams - a.grams) / 1000;
});
const bmi = computed(() => {
  const h = store.state.profile.heightCm;
  const w = latest.value?.grams;
  if (!h || !w) return null;
  return w / 1000 / ((h / 100) * (h / 100));
});

const goal = computed(() => (store.state.bodyGoalGrams ?? 0) / 1000);

function saveWeight(): void {
  const v = Number.parseFloat(weightInput.value.replace(',', '.'));
  if (!Number.isFinite(v) || v <= 20 || v > 400) return;
  store.addWeight(Math.round(v * 1000));
  weightInput.value = '';
  weightSheet.value = false;
}

const foodCount = computed(() => FOODS.length);
const packInfo = computed(() => EXERCISE_PACKS);
const packText = computed(() => packSummary(EXERCISE_PACKS));
const sessionCount = computed(() => store.state.sessions.length);
</script>

<template>
  <div class="me">
    <header class="me__head">
      <div>
        <p class="label">我的</p>
        <h1 class="h1">身体与数据</h1>
      </div>
      <button class="btn btn--primary btn--sm" @click="weightSheet = true">记体重</button>
    </header>

    <div class="seg">
      <button class="seg__item" :class="{ 'is-on': tab === 'body' }" @click="tab = 'body'">身体</button>
      <button class="seg__item" :class="{ 'is-on': tab === 'data' }" @click="tab = 'data'">数据</button>
      <button class="seg__item" :class="{ 'is-on': tab === 'settings' }" @click="tab = 'settings'">设置</button>
    </div>

    <template v-if="tab === 'body'">
      <section class="card card--ink weight">
        <div class="weight__top">
          <div>
            <p class="label">当前体重</p>
            <p class="weight__value">
              {{ latest ? (latest.grams / 1000).toFixed(1) : '—' }}<span>kg</span>
            </p>
            <p class="weight__delta" :class="delta <= 0 ? 'is-down' : 'is-up'">
              {{ delta > 0 ? '+' : '' }}{{ delta.toFixed(1) }} kg · 近 {{ series.length }} 次记录
            </p>
          </div>
          <div class="weight__goal">
            <span class="tiny">目标</span>
            <strong>{{ goal ? goal.toFixed(1) : '—' }} kg</strong>
          </div>
        </div>
        <Sparkline :points="points" :height="64" tone="lime" />
      </section>

      <div class="grid-2">
        <div class="card stat-card">
          <span class="stat__value">{{ bmi ? bmi.toFixed(1) : '—' }}</span>
          <span class="stat__label">BMI</span>
        </div>
        <div class="card stat-card">
          <span class="stat__value">{{ series.length }}</span>
          <span class="stat__label">体重记录</span>
        </div>
      </div>

      <div class="card weight__list">
        <div v-for="w in [...series].reverse().slice(0, 10)" :key="w.id" class="list__row weight__row">
          <span class="recent__body">
            <span class="h3">{{ (w.grams / 1000).toFixed(1) }} kg</span>
            <span class="tiny">{{ shortDate(w.date) }} · {{ weekdayLabel(w.date) }}</span>
          </span>
          <button class="meal__del" aria-label="删除" @click="store.removeWeight(w.date)">✕</button>
        </div>
        <p v-if="!series.length" class="empty">还没有体重记录。</p>
      </div>
    </template>

    <template v-else-if="tab === 'data'">
      <div class="grid-2">
        <div class="card stat-card">
          <span class="stat__value">{{ sessionCount }}</span>
          <span class="stat__label">训练记录</span>
        </div>
        <div class="card stat-card">
          <span class="stat__value">{{ foodCount }}</span>
          <span class="stat__label">内置食物</span>
        </div>
      </div>
      <div class="card">
        <p class="label">内容来源与授权</p>
        <p class="small" style="margin-top: 8px">{{ packText }}</p>
        <div v-for="p in packInfo" :key="p.packageId" class="lic">
          <div class="lic__row">
            <span class="h3">{{ p.title }}</span>
            <span class="chip chip--lime chip--sm">{{ p.license.id }}</span>
          </div>
          <p class="tiny">{{ p.exercises.length }} 个动作 · v{{ p.version }} · {{ p.license.url }}</p>
          <p class="tiny lic__note">{{ p.license.attribution }}</p>
          <p class="tiny lic__note">{{ p.license.notice }}</p>
        </div>
        <div class="divider" />
        <p class="tiny">
          内置动作与模板为自建内容；食物营养值为常见参考值，非医疗建议。
        </p>
      </div>

      <div class="card">
        <p class="label">数据说明</p>
        <p class="small" style="margin-top: 8px">
          所有训练、饮食与体重数据保存在本机 IndexedDB，不上传、不需要账号。清理浏览器数据会删除记录，请定期导出备份。
        </p>
        <div class="divider" />
        <div class="row between">
          <span class="small">本地保存</span>
          <span class="chip chip--lime chip--sm">已启用</span>
        </div>
        <button class="btn btn--primary btn--block" style="margin-top: 14px" @click="openData()">
          导出、导入与备份
        </button>
      </div>
    </template>

    <template v-else>
      <div class="card">
        <p class="label">训练偏好</p>
        <div class="field" style="margin-top: 10px">
          <label class="tiny">每周目标次数</label>
          <input
            class="input"
            type="number"
            min="1"
            max="7"
            :value="store.state.weeklyGoal"
            @change="store.updateProfile({ weeklyTarget: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>
        <div class="field" style="margin-top: 12px">
          <label class="tiny">过敏原</label>
          <p class="tiny" style="margin: 4px 0 8px; color: var(--text-2)">
            选中后会从食物库中隐藏相关食物（含"可能含有"的加工食品）。
          </p>
          <div class="aller">
            <button
              v-for="a in ALLERGENS"
              :key="a.code"
              class="aller__chip"
              :class="{ 'is-on': store.state.profile.allergies.includes(a.code) }"
              @click="toggleAllergy(a.code)"
            >
              {{ a.label }}
            </button>
          </div>
          <button class="btn btn--ghost btn--sm" style="margin-top: 10px" @click="confirmRestrictions">
            {{ store.state.profile.restrictionsConfirmed ? '已确认，修改后需重新确认' : '确认这些限制' }}
          </button>
        </div>
        <div class="field" style="margin-top: 12px">
          <label class="tiny">身高 cm</label>
          <input
            class="input"
            type="number"
            :value="store.state.profile.heightCm ?? ''"
            @change="store.updateProfile({ heightCm: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>
      </div>
    </template>

    <Transition name="sheet">
      <div v-if="weightSheet" class="sheet" @click.self="weightSheet = false">
        <div class="sheet__panel">
          <div class="sheet__head">
            <div>
              <p class="label">记录</p>
              <h2 class="h2">今天的体重</h2>
            </div>
            <button class="icon-btn" @click="weightSheet = false" aria-label="关闭">✕</button>
          </div>
          <div class="field">
            <input v-model="weightInput" class="input input--lg" inputmode="decimal" placeholder="78.4" />
            <p class="tiny">单位 kg，同一天再次记录会覆盖当天数值。</p>
          </div>
          <button class="btn btn--lime btn--block btn--lg" style="margin-top: 16px" @click="saveWeight">保存</button>
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
  gap: 12px;
}

.weight {
  padding: 20px;
  background: radial-gradient(120% 100% at 100% 0%, #26301f 0%, var(--ink) 58%);
}

.weight__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.weight__value {
  font-size: 44px;
  font-weight: 700;
  letter-spacing: -0.05em;
  line-height: 1;
  margin-top: 6px;
}

.weight__value span {
  font-size: 15px;
  color: rgba(244, 246, 238, 0.5);
  margin-left: 4px;
  letter-spacing: 0;
}

.weight__delta {
  margin-top: 8px;
  font-size: 12.5px;
}

.weight__delta.is-down {
  color: var(--lime);
}

.weight__delta.is-up {
  color: #ffb59a;
}

.weight__goal {
  text-align: right;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.weight__goal strong {
  font-size: 16px;
}

.stat-card {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.weight__list {
  padding: 4px 16px;
}

.weight__row {
  align-items: center;
}

.recent__body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
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
.lic {
  margin-top: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(17, 20, 17, 0.03);
}

.lic__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.lic__note {
  margin-top: 4px;
  line-height: 1.45;
}
.aller {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.aller__chip {
  padding: 8px 14px;
  border-radius: 999px;
  border: 1.5px solid var(--line-strong);
  background: transparent;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
  cursor: pointer;
}

.aller__chip.is-on {
  background: var(--ink);
  border-color: var(--ink);
  color: var(--paper);
}
</style>






