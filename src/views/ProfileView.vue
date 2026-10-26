<script setup lang="ts">
import { computed, ref } from 'vue';
import { store, derived } from '../store/appStore';
import { FOODS } from '../content/foods';
import { EXERCISE_PACKS, packSummary } from '../content/packs';
import GoalsPanel from '../components/GoalsPanel.vue';
import Sparkline from '../components/Sparkline.vue';
import { shortDate, weekdayLabel } from '../domain/units';
import { useToast } from '../composables/useToast';
import { useSheetBack } from '../composables/useBackLayer';
import { clearCacheAndReload, listCacheNames } from '../store/cacheControl';
import { applyTheme, loadThemePref, saveThemePref, type ThemePref } from '../store/theme';

import { ALLERGEN_CODES } from '../content/allergens';

const { push } = useToast();

/*
 * 外观偏好。
 *
 * 存 localStorage 而不是 AppState：这是设备私有偏好。
 * 进 AppState 会被物化进同步快照，两台设备主题不同就会算出不同哈希，
 * 表现为"明明数据一样却提示冲突"。
 */
const themePref = ref<ThemePref>(loadThemePref());
const THEME_OPTIONS: Array<{ value: ThemePref; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];
function pickTheme(next: ThemePref): void {
  themePref.value = next;
  saveThemePref(next);
  applyTheme(next);
}

/* 缓存清理状态 */
const clearingCache = ref(false);
const cacheMsg = ref('');
const cacheNames = ref<string[]>([]);

/**
 * 清理前端静态缓存并重新加载。
 *
 * 只清 Cache Storage 与 SW 注册，不动 localStorage / IndexedDB——
 * 那是用户的训练记录。有警告时不刷新，避免用户误以为已修好。
 */
async function doClearCache(): Promise<void> {
  clearingCache.value = true;
  cacheMsg.value = '';
  try {
    const r = await clearCacheAndReload();
    if (r.warnings.length) {
      cacheMsg.value = r.warnings.join('；');
      push('部分缓存未能清理', 'error');
    } else {
      // 成功时页面会重新加载，这里通常来不及显示
      push(`已清理 ${r.cachesCleared} 份缓存`, 'success');
    }
  } finally {
    clearingCache.value = false;
  }
}

void listCacheNames().then((n) => { cacheNames.value = n; });

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

// 返回键/边缘返回先关记体重的面板
useSheetBack(weightSheet, () => { weightSheet.value = false; });

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

/** 距离目标体重还差多少（正数=还要减，负数=已经低于目标）。没有目标或体重时为空。 */
const toGoal = computed(() => {
  const g = store.state.bodyGoalGrams;
  const w = latest.value?.grams;
  if (!g || !w) return null;
  return (w - g) / 1000;
});

/**
 * 身体数据集中在一处。
 *
 * 之前身高在"设置"里、体重在"身体"里、目标体重又在目标面板里，
 * 用户要改一个身体数据得跑三个地方。现在统一到"身体"页：
 * 身高、目标体重、BMI 与体重记录同屏，设置页只留一个跳转入口。
 */
const heightValue = computed(() => store.state.profile.heightCm ?? '');
const goalValue = computed(() => (store.state.bodyGoalGrams ? (store.state.bodyGoalGrams / 1000).toFixed(1) : ''));

function saveHeight(raw: string): void {
  const v = Number.parseInt(raw, 10);
  if (!Number.isFinite(v) || v < 100 || v > 250) {
    push('身高请填 100–250 cm', 'error');
    return;
  }
  store.updateProfile({ heightCm: v });
  push('已保存身高', 'success');
}

function saveGoalWeight(raw: string): void {
  const kg = Number.parseFloat(raw.replace(',', '.'));
  if (!Number.isFinite(kg) || kg <= 0 || kg > 400) {
    push('目标体重请填 1–400 kg', 'error');
    return;
  }
  const existing = store.state.goals.find((g) => g.kind === 'bodyweight');
  store.setGoal({
    kind: 'bodyweight',
    targetGrams: Math.round(kg * 1000),
    startGrams: existing?.kind === 'bodyweight' ? existing.startGrams : (latest.value?.grams ?? null),
    targetDate: existing?.kind === 'bodyweight' ? existing.targetDate : null,
    createdAt: new Date().toISOString(),
  });
  push('目标体重已更新', 'success');
}

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

      <section class="card bodydata">
        <div class="section__head">
          <div>
            <p class="label">身体数据</p>
            <p class="tiny">身高、目标体重、BMI 与体重记录放在一起</p>
          </div>
        </div>
        <div class="bodydata__grid">
          <label class="bodyfield">
            <span class="tiny">身高 cm</span>
            <input
              class="input"
              type="number"
              inputmode="numeric"
              :value="heightValue"
              placeholder="175"
              @change="saveHeight(($event.target as HTMLInputElement).value)"
            />
          </label>
          <label class="bodyfield">
            <span class="tiny">目标体重 kg</span>
            <input
              class="input"
              type="number"
              inputmode="decimal"
              :value="goalValue"
              placeholder="75"
              @change="saveGoalWeight(($event.target as HTMLInputElement).value)"
            />
          </label>
          <div class="bodyfield">
            <span class="tiny">BMI</span>
            <strong class="bodyfield__value">{{ bmi ? bmi.toFixed(1) : '—' }}</strong>
          </div>
        </div>
      </section>

      <GoalsPanel />

      <div class="grid-2">
        <div class="card stat-card">
          <span class="stat__value">{{ series.length }}</span>
          <span class="stat__label">体重记录</span>
        </div>
        <!-- BMI 已经在上面身体数据卡里了，这里换成"距目标"，避免同一屏两个 BMI -->
        <div class="card stat-card">
          <span class="stat__value">
            {{ toGoal === null ? '—' : `${toGoal > 0 ? '+' : ''}${toGoal.toFixed(1)}` }}
            <span v-if="toGoal !== null" class="stat__unit">kg</span>
          </span>
          <span class="stat__label">距目标</span>
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
        <p class="label">外观</p>
        <p class="small" style="margin-top: 8px">
          深色模式适合健身房低光环境，也更省电。
        </p>
        <div class="seg" style="margin-top: 12px">
          <button
            v-for="opt in THEME_OPTIONS"
            :key="opt.value"
            class="seg__item"
            :class="{ 'is-on': themePref === opt.value }"
            @click="pickTheme(opt.value)"
          >
            {{ opt.label }}
          </button>
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

        <div class="divider" />
        <button class="btn btn--ghost btn--block" @click="tab = 'body'">
          身高 / 体重 / 目标体重 · 去「身体」页
        </button>
      </div>

      <!--
        清理前端缓存。
        与"清空本机数据"是两件不同的事：这里只清静态资源缓存，
        不碰训练记录。放在设置里，因为它属于"修问题"而非日常操作。
      -->
      <div class="card cache">
        <p class="label">清理缓存</p>
        <p class="small" style="margin-top: 6px">
          应用更新后如果界面没变化，多半是浏览器缓存了旧文件。清理后会重新加载。
        </p>
        <p class="tiny cache__safe">
          只清静态资源缓存，<strong>不会删除任何训练、饮食、体重记录</strong>。
        </p>
        <p v-if="cacheNames.length" class="tiny cache__list">
          当前有 {{ cacheNames.length }} 份缓存待清理。
        </p>
        <button class="btn btn--ghost btn--block" style="margin-top: 12px" :disabled="clearingCache" @click="doClearCache">
          {{ clearingCache ? "清理中…" : "清理缓存并重新加载" }}
        </button>
        <p v-if="cacheMsg" class="tiny cache__msg">{{ cacheMsg }}</p>
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
  background: radial-gradient(120% 100% at 100% 0%, var(--ink-glow) 0%, var(--surface-ink) 58%);
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
  color: rgba(var(--inv-rgb), 0.5);
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
  color: var(--on-ink-warn);
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

.bodydata__grid {
  display: grid;
  grid-template-columns: 1fr 1fr 0.8fr;
  gap: 10px;
  margin-top: 12px;
}

.bodyfield {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.bodyfield__value {
  font-size: 19px;
  font-weight: 680;
  letter-spacing: -0.03em;
  padding-top: 6px;
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
  background: rgba(var(--ink-rgb), 0.03);
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
  background: var(--surface-ink);
  border-color: var(--text);
  color: var(--paper);
}
.cache__safe {
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(201, 245, 63, 0.14);
  color: var(--text-2);
  line-height: 1.5;
}

.cache__safe strong {
  font-weight: 700;
  color: var(--text);
}

.cache__list {
  margin-top: 6px;
  color: var(--text-3);
}

.cache__msg {
  margin-top: 8px;
  color: var(--clay);
  line-height: 1.5;
}
</style>















