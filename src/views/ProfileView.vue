<script setup lang="ts">
import { computed, ref } from 'vue';
import { store, derived } from '../store/appStore';
import { EXERCISE_PACKS, packSummary } from '../content/packs';
import GoalsPanel from '../components/GoalsPanel.vue';
import Sparkline from '../components/Sparkline.vue';
import { weightTrendTone } from '../domain/weight';
import { ageFromBirthYear, mifflinStJeor } from '../domain/bmr';
import { computeTargets } from '../domain/nutrition-policy';
import { ACTIVITY_FACTORS } from '../domain/nutrition-policy';
import { shortDate, weekdayLabel, businessDate } from '../domain/units';
import { trainingCount } from '../domain/metrics';
import { useToast } from '../composables/useToast';
import { useSheetBack } from '../composables/useBackLayer';
import { clearCacheAndReload, listCacheNames } from '../store/cacheControl';
import { applyTheme, loadThemePref, saveThemePref, type ThemePref } from '../store/theme';
import { normalizeReminders, validTime } from '../domain/reminders';
import { useReminders } from '../composables/useReminders';
import { restNotifyEnabled, setRestNotifyEnabled } from '../composables/useRestNotification';
import { adaptiveTdeeFromState, adaptiveTdeeHint } from '../domain/adaptive-tdee';

import { ALLERGEN_CODES } from '../content/allergens';

const { push } = useToast();

/*
 * 提醒与饮水。
 *
 * 提醒设置进 AppState 会跟着快照同步——两台设备都排一遍通知没关系，
 * 反而换机后不用重设。真正排程在本机：原生走 Local Notifications，
 * 网页走插件的 Web 实现。
 */
const reminders = computed(() => normalizeReminders(store.state.reminders));
const {
  permission: notifyPermission,
  permissionLabel: notifyPermissionLabel,
  busy: notifyBusy,
  error: notifyError,
  requestPermission: requestNotifyPermission,
  applySchedule: applyReminderSchedule,
} = useReminders();

function toggleReminder(key: 'workoutEnabled' | 'waterEnabled', value: boolean): void {
  store.updateReminders({ [key]: value });
  void applyReminderSchedule();
}

function setReminderTime(key: 'workoutTime' | 'waterStart' | 'waterEnd', value: string): void {
  if (!validTime(value)) return;
  store.updateReminders({ [key]: value });
  void applyReminderSchedule();
}

const restNotify = ref(restNotifyEnabled());

/* 组间提醒是设备偏好，不进 AppState：它不随快照同步，也不该导出给别的设备。 */
function toggleRestNotify(on: boolean): void {
  setRestNotifyEnabled(on);
  restNotify.value = on;
}

/*
 * 自适应 TDEE：用近 4 周体重变化反推真实维持热量。
 *
 * 静态公式（Mifflin-St Jeor × 活动系数）误差常有 ±300–500 kcal，
 * 而我们有体重记录与每日摄入，可以直接反推。
 * 数据不足时宁可说"还缺什么"，也不给一个看起来精确的数字。
 */
const adaptive = computed(() => adaptiveTdeeFromState(store.state, businessDate(), 28));
const adaptiveHint = computed(() => adaptiveTdeeHint(adaptive.value));

function setWaterInterval(raw: string): void {
  store.updateReminders({ waterIntervalMin: Number(raw) });
  void applyReminderSchedule();
}

function saveWaterGoal(raw: string): void {
  const v = Number.parseInt(raw, 10);
  store.setWaterGoal(Number.isFinite(v) && v > 0 ? v : null);
}

async function enableNotifications(): Promise<void> {
  await requestNotifyPermission();
  await applyReminderSchedule();
}

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

/* 体重变化只相对目标方向评价；没设目标时不给颜色 */
const weightTone = computed(() => {
  const last = series.value[series.value.length - 1]?.grams ?? 0;
  const g = store.state.bodyGoalGrams;
  return weightTrendTone(delta.value, last / 1000, g === null ? null : g / 1000);
});
const bmi = computed(() => {
  const h = store.state.profile.heightCm;
  const w = latest.value?.grams;
  if (!h || !w) return null;
  return w / 1000 / ((h / 100) * (h / 100));
});

/** 把 BMI 映射到 15–32 的刻度上（超出范围夹到两端）。 */
function bmiPos(v: number): number {
  return Math.min(100, Math.max(0, ((v - 15) / 17) * 100));
}

/**
 * BMI 分区（中国成人标准 WS/T 428-2013）。
 *
 * 只给一个裸数字，等于"告诉你超重却不给下一步"（PM 深评 §2.9）。
 * 这里补上分区、距正常区间多远，以及一条刻度条。
 */
const bmiInfo = computed(() => {
  const v = bmi.value;
  if (!v) return null;
  /*
   * 只描述"落在标准区间的哪一侧"，不下"超重/肥胖"的结论。
   *
   * BMI 不区分肌肉与脂肪。对规律做力量训练的人，24–28 很常见
   * 且完全健康；给这类用户贴"超重"，等于用一把不合适的尺子
   * 否定他的训练成果。数字照给，判断权交回用户。
   */
  if (v < 18.5) return { label: '低于标准区间', hint: '标准区间为 18.5–24', pos: bmiPos(v) };
  if (v < 24) return { label: '标准区间内', hint: '标准区间为 18.5–24', pos: bmiPos(v) };
  if (v < 28) return { label: '高于标准区间', hint: '规律力量训练者常在此区间', pos: bmiPos(v) };
  return { label: '明显高于标准区间', hint: '建议结合体脂率一起看', pos: bmiPos(v) };
});

/*
 * 按身体数据估算营养目标。
 *
 * 之前 computeTargets（含热量下限、蛋白区间、不适用人群声明）写好了
 * 但没有任何生产调用——用户只能自己拍两个数字。
 * 这里把它接上：用 Mifflin-St Jeor 算 BMR，乘活动系数得 TDEE，
 * 再按目标方向（减脂/维持/增肌）给出建议值。
 *
 * 原则不变：这是**估算**，填进去之后用户仍可手改，
 * 界面上也要说明数字是怎么来的。
 */
function saveActivity(v: string): void {
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return;
  store.updateProfile({ activity: n });
}

function estimateTargets(): void {
  const w = latest.value?.grams;
  const height = store.state.profile.heightCm;
  const sex = store.state.profile.sex;
  const activity = store.state.profile.activity;
  const age = ageFromBirthYear(store.state.profile.birthYear);

  const missing: string[] = [];
  if (!w) missing.push('体重');
  if (!height) missing.push('身高');
  if (!sex) missing.push('性别');
  if (!activity) missing.push('活动量');
  if (!age) missing.push('出生年');
  if (missing.length > 0) {
    push(`还缺${missing.join('、')}，填完才能估算`, 'error');
    return;
  }

  const bmr = mifflinStJeor({ weightKg: w! / 1000, heightCm: height!, ageYears: age!, sex: sex! });
  if (!bmr) {
    push('身体数据不合理，无法估算', 'error');
    return;
  }

  const goalGrams = store.state.bodyGoalGrams;
  const goal: 'cut' | 'maintain' | 'bulk' =
    goalGrams === null ? 'maintain' : goalGrams < w! ? 'cut' : goalGrams > w! ? 'bulk' : 'maintain';

  // profile.activity 是**乘数**（1.4/1.5），不是 1–5 的等级。
  // 之前把它当等级传进去，find 永远命中不到，功能 100% 失败。
  const r = computeTargets({ bmr: bmr.bmr, activityFactor: activity!, goal, weightKg: w! / 1000 });
  if (r.blocked) {
    // 不适用人群（如孕期、进食障碍史）不要硬给数字
    push(`无法给出建议：${r.blocked}`, 'error');
    return;
  }

  store.setTargets(r.kcal, r.proteinG);
  push(`已按估算填入：${r.kcal} kcal / 蛋白 ${r.proteinG} g，可手动改`, 'success');
}

/** 体重记录默认折叠到 7 条；14 条全展开会把设置入口推到很下面。 */
const showAllWeights = ref(false);
const visibleWeights = computed(() => {
  const list = [...series.value].reverse();
  return showAllWeights.value ? list : list.slice(0, 7);
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
  // 与 domain 的 validateGoal 对齐（35–250 kg），否则会被拒却提示"已更新"
  if (!Number.isFinite(kg) || kg < 35 || kg > 250) {
    push('目标体重请填 35–250 kg', 'error');
    return;
  }
  const existing = store.state.goals.find((g) => g.kind === 'bodyweight');
  // 之前丢弃了 setGoal 的返回值：校验失败（如与当前体重差 < 0.5kg）也会提示成功
  const error = store.setGoal({
    kind: 'bodyweight',
    targetGrams: Math.round(kg * 1000),
    startGrams: existing?.kind === 'bodyweight' ? existing.startGrams : (latest.value?.grams ?? null),
    targetDate: existing?.kind === 'bodyweight' ? existing.targetDate : null,
    createdAt: new Date().toISOString(),
  });
  if (error) {
    push(error, 'error');
    return;
  }
  push('目标体重已更新', 'success');
}

function saveWeight(): void {
  const v = Number.parseFloat(weightInput.value.replace(',', '.'));
  if (!Number.isFinite(v) || v <= 20 || v > 400) return;
  store.addWeight(Math.round(v * 1000));
  weightInput.value = '';
  weightSheet.value = false;
}

/** 删除体重记录：给 5 秒撤销，比弹确认框轻，也防误触。 */
function removeWeightEntry(entry: { id: string; date: string; grams: number }): void {
  store.removeWeight(entry.date);
  push('已删除这条体重记录', 'default', {
    label: '撤销',
    onAction: () => {
      store.restoreWeight(entry);
      push('已恢复', 'success');
    },
  });
}

const packInfo = computed(() => EXERCISE_PACKS);
const packText = computed(() => packSummary(EXERCISE_PACKS));

// 数据页讲"我的数据"，不再把内容库条目数（内置食物）当用户数据展示
const sessionCount = computed(() => trainingCount(store.state.sessions));
const foodLogCount = computed(() => store.state.foods.length);
const weightLogCount = computed(() => store.state.weights.length);

/**
 * 营养目标。
 *
 * 之前 2350 kcal / 165 g 写死在种子数据里，且没有任何 UI 能改，
 * 55kg 用户也看到同一个目标（PM 评审 §3.7 / §4.3）。现在由用户设定：
 * 留空即"未设置"，饮食页就如实说没设置，不编默认值。
 */
const proteinHint = computed(() => {
  const g = latest.value?.grams;
  // 1.8 g/kg 是 docs/11 蛋白区间的中位值，仅作参考
  return g ? Math.round((g / 1000) * 1.8) : null;
});

function saveKcal(raw: string): void {
  const v = Number.parseInt(raw, 10);
  const next = Number.isFinite(v) && v > 0 ? v : null;
  store.setTargets(next, store.state.targetProtein);
  push(next ? '热量目标已更新' : '已清除热量目标', 'success');
}

function saveProtein(raw: string): void {
  const v = Number.parseFloat(raw.replace(',', '.'));
  const next = Number.isFinite(v) && v > 0 ? v : null;
  store.setTargets(store.state.targetKcal, next);
  push(next ? '蛋白目标已更新' : '已清除蛋白目标', 'success');
}

function useProteinHint(): void {
  if (!proteinHint.value) return;
  store.setTargets(store.state.targetKcal, proteinHint.value);
  push('已按当前体重填入蛋白目标', 'success');
}

function clearNutrition(): void {
  store.setTargets(null, null);
  push('已清除营养目标', 'success');
}
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
            <p class="weight__delta" :class="`tone-${weightTone}`">
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
        <div class="bodydata__grid bodydata__grid--body">
          <!--
            当前体重必须在同一张卡里出现。
            原来这里只有"身高 / 目标体重 / BMI"，用户看到 BMI 25.2 却找不到
            它是按哪个体重算的（当前体重在页面顶部的深色卡里）。
          -->
          <div class="bodyfield">
            <span class="tiny">当前体重 kg</span>
            <strong class="bodyfield__value">
              {{ latest ? (latest.grams / 1000).toFixed(1) : '—' }}
            </strong>
            <span class="tiny">按最近一次记录</span>
          </div>
          <div class="bodyfield">
            <span class="tiny">BMI（按当前体重）</span>
            <strong class="bodyfield__value">{{ bmi ? bmi.toFixed(1) : '—' }}</strong>
          </div>
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
            <!-- 占位符不能长得像真实值：写"未设置"，并且用弱化样式 -->
            <input
              class="input bodyfield__input"
              type="number"
              inputmode="decimal"
              :value="goalValue"
              placeholder="未设置"
              @change="saveGoalWeight(($event.target as HTMLInputElement).value)"
            />
          </label>
          <!--
            活动量：估算热量必须用，但原来全 App 没有任何入口，
            所有人都用默认 1.5（中度）。用户改不了，估算就只能靠猜。
            这里存的是**乘数**（1.2–1.9），与 computeTargets 的口径一致。
          -->
          <label class="bodyfield">
            <span class="tiny">日常活动量</span>
            <select
              class="input"
              :value="store.state.profile.activity ?? 1.375"
              @change="saveActivity(($event.target as HTMLSelectElement).value)"
            >
              <option v-for="a in ACTIVITY_FACTORS" :key="a.level" :value="a.factor">
                {{ a.label }} · {{ a.description }}
              </option>
            </select>
          </label>
        </div>
        <!-- BMI 不只是一个数字：给分区、给距离、给刻度 -->
        <div v-if="bmiInfo" class="bmi">
          <div class="bmi__head">
            <span class="tiny">{{ bmiInfo.label }}</span>
            <span class="tiny">{{ bmiInfo.hint }}</span>
          </div>
          <div class="bmi__bar" aria-hidden="true">
            <span class="bmi__seg bmi__seg--low" />
            <span class="bmi__seg bmi__seg--ok" />
            <span class="bmi__seg bmi__seg--warn" />
            <span class="bmi__seg bmi__seg--high" />
            <span class="bmi__dot" :style="{ left: `${bmiInfo.pos}%` }" />
          </div>
        </div>
      </section>

      <!-- 营养目标：由用户设定。留空即"未设置"，不写死 2350/165 -->
      <section class="card bodydata">
        <div class="section__head">
          <div>
            <p class="label">营养目标</p>
            <p class="tiny">参考值，不是处方；留空即不设目标，饮食页不会假装有</p>
          </div>
        </div>
        <div class="bodydata__grid bodydata__grid--nutrition">
          <label class="bodyfield">
            <span class="tiny">热量 kcal</span>
            <input
              class="input bodyfield__input"
              type="number"
              inputmode="numeric"
              :value="store.state.targetKcal ?? ''"
              placeholder="未设置"
              @change="saveKcal(($event.target as HTMLInputElement).value)"
            />
          </label>
          <label class="bodyfield">
            <span class="tiny">蛋白质 g</span>
            <input
              class="input bodyfield__input"
              type="number"
              inputmode="decimal"
              :value="store.state.targetProtein ?? ''"
              placeholder="未设置"
              @change="saveProtein(($event.target as HTMLInputElement).value)"
            />
          </label>
        </div>
        <div class="nutrition-actions">
          <p class="tiny">
            蛋白参考 <strong>{{ proteinHint ?? '—' }} g</strong>（按当前体重 1.8 g/kg）
          </p>
          <div class="nutrition-actions__btns">
            <button class="btn btn--ghost btn--sm" @click="estimateTargets">按身体数据估算</button>
            <button v-if="proteinHint" class="btn btn--ghost btn--sm" @click="useProteinHint">用蛋白参考</button>
            <button
              v-if="store.state.targetKcal || store.state.targetProtein"
              class="btn btn--ghost btn--sm"
              @click="clearNutrition"
            >
              清除
            </button>
          </div>
        </div>

        <!--
          实测维持热量：有足够数据才给数值，否则只说缺什么，不猜。
          它和上面"按身体数据估算"是两种口径：那个是公式推算，这个是实测反推。
        -->
        <p class="tiny adaptive" :class="{ 'adaptive--ok': adaptive.maintenanceKcal !== null }">
          {{ adaptiveHint }}
        </p>
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
        <div v-for="w in visibleWeights" :key="w.id" class="list__row weight__row">
          <span class="recent__body">
            <span class="h3">{{ (w.grams / 1000).toFixed(1) }} kg</span>
            <span class="tiny">{{ shortDate(w.date) }} · {{ weekdayLabel(w.date) }}</span>
          </span>
          <button class="meal__del" aria-label="删除" @click="removeWeightEntry(w)">✕</button>
        </div>
        <p v-if="!series.length" class="empty">还没有体重记录。</p>
        <button
          v-if="series.length > 7"
          class="btn btn--ghost btn--block weight__more"
          @click="showAllWeights = !showAllWeights"
        >
          {{ showAllWeights ? '收起' : `查看全部 ${series.length} 条` }}
        </button>
      </div>
    </template>

    <template v-else-if="tab === 'data'">
      <!-- 数据页只讲"我的数据"：内置食物数是内容库，不是用户数据 -->
      <div class="card">
        <p class="label">我的数据</p>
        <div class="row between datarow">
          <span class="small">有效训练</span>
          <strong>{{ sessionCount }} 次</strong>
        </div>
        <div class="row between datarow">
          <span class="small">饮食记录</span>
          <strong>{{ foodLogCount }} 条</strong>
        </div>
        <div class="row between datarow">
          <span class="small">体重记录</span>
          <strong>{{ weightLogCount }} 条</strong>
        </div>
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

      <!-- 提醒与饮水：本地通知，不经过服务器 -->
      <div class="card">
        <p class="label">提醒与饮水</p>
        <p class="small" style="margin-top: 8px">
          提醒在本机定时触发，不上传数据。网页版需要允许通知且页面开着；装成 Android App 后关闭也能提醒。
        </p>

        <div class="reminder">
          <label class="reminder__row">
            <input
              type="checkbox"
              :checked="reminders.workoutEnabled"
              @change="toggleReminder('workoutEnabled', ($event.target as HTMLInputElement).checked)"
            />
            <span class="reminder__text">
              <span class="h3">训练提醒</span>
              <span class="tiny">每天固定时间提醒今天该练什么</span>
            </span>
            <input
              v-if="reminders.workoutEnabled"
              class="input reminder__time"
              type="time"
              :value="reminders.workoutTime"
              @change="setReminderTime('workoutTime', ($event.target as HTMLInputElement).value)"
            />
          </label>
        </div>

        <div class="reminder">
          <label class="reminder__row">
            <input
              type="checkbox"
              :checked="restNotify"
              @change="toggleRestNotify(($event.target as HTMLInputElement).checked)"
            />
            <span class="reminder__text">
              <span class="h3">组间休息提醒</span>
              <span class="tiny">休息结束时提醒，锁屏也能收到（装成 App 后）</span>
            </span>
          </label>
        </div>

        <div class="reminder">
          <label class="reminder__row">
            <input
              type="checkbox"
              :checked="reminders.waterEnabled"
              @change="toggleReminder('waterEnabled', ($event.target as HTMLInputElement).checked)"
            />
            <span class="reminder__text">
              <span class="h3">喝水提醒</span>
              <span class="tiny">在时段内按间隔提醒</span>
            </span>
          </label>
          <div v-if="reminders.waterEnabled" class="reminder__grid">
            <label class="field">
              <span class="tiny">开始</span>
              <input
                class="input"
                type="time"
                :value="reminders.waterStart"
                @change="setReminderTime('waterStart', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label class="field">
              <span class="tiny">结束</span>
              <input
                class="input"
                type="time"
                :value="reminders.waterEnd"
                @change="setReminderTime('waterEnd', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label class="field">
              <span class="tiny">间隔</span>
              <select
                class="input"
                :value="reminders.waterIntervalMin"
                @change="setWaterInterval(($event.target as HTMLSelectElement).value)"
              >
                <option v-for="m in [60, 90, 120, 180, 240]" :key="m" :value="m">每 {{ m }} 分钟</option>
              </select>
            </label>
            <label class="field">
              <span class="tiny">每日目标 ml</span>
              <input
                class="input"
                type="number"
                inputmode="numeric"
                :value="store.state.waterGoalMl ?? 2000"
                @change="saveWaterGoal(($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>
        </div>

        <div class="row between reminder__foot">
          <span class="tiny">通知权限：{{ notifyPermissionLabel }}</span>
          <button class="btn btn--ghost btn--sm" :disabled="notifyBusy" @click="enableNotifications">
            {{ notifyPermission === 'granted' ? '重新调度' : '开启通知' }}
          </button>
        </div>
        <p v-if="notifyError" class="tiny reminder__error">{{ notifyError }}</p>
      </div>

      <!-- 外观：设备私有偏好，属于设置，不属于"数据" -->
      <div class="card">
        <p class="label">外观</p>
        <p class="small" style="margin-top: 8px">
          深色模式适合夜间或低光环境，也更省电。
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

      <!-- 授权是"关于"信息，不是日常数据操作 -->
      <div class="card">
        <p class="label">关于与开源许可</p>
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

/*
 * 涨跌颜色只表达"是否朝目标走"，不再默认"掉秤=好"。
 * 没设目标体重时用中性灰：App 不知道你在增肌还是减脂。
 */
.weight__delta.tone-good {
  color: var(--lime);
}

.weight__delta.tone-bad {
  color: var(--on-ink-warn);
}

.weight__delta.tone-neutral {
  color: rgba(var(--inv-rgb), 0.6);
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

/* 身体数据四项（当前体重 / BMI / 身高 / 目标体重）两列排，避免挤成一行 */
.bodydata__grid--body {
  grid-template-columns: 1fr 1fr;
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

/* 未填的目标体重必须一眼看出是空的，不能和真实数值同样式 */
.bodyfield__input::placeholder {
  color: var(--text-3);
  font-weight: 500;
  font-size: 13px;
}

/* BMI 刻度：偏瘦 / 正常 / 超重 / 肥胖（中国成人标准 WS/T 428-2013） */
.bmi {
  margin-top: 16px;
}

.bmi__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 7px;
}

.bmi__bar {
  position: relative;
  display: flex;
  height: 8px;
}

.bmi__seg {
  height: 100%;
}

/*
 * 刻度条只标"标准区间在哪"，不再用绿→红表达好坏。
 *
 * 原来 18.5–24 是绿的、往上依次黄、红，用户 25.2 的点落在粉红段里，
 * 视觉上仍被判成"不好"——措辞改成中性，颜色却还在下判断，等于没改。
 * 现在只有"标准区间"高亮，两侧都是中性灰，位置由点表示。
 */
.bmi__seg--low {
  flex: 21;
  background: rgba(var(--ink-rgb), 0.08);
  border-radius: 999px 0 0 999px;
}

.bmi__seg--ok {
  flex: 32;
  background: var(--lime-soft);
}

.bmi__seg--warn {
  flex: 24;
  background: rgba(var(--ink-rgb), 0.08);
}

.bmi__seg--high {
  flex: 23;
  background: rgba(var(--ink-rgb), 0.08);
  border-radius: 0 999px 999px 0;
}

.bmi__dot {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--text);
  border: 2px solid var(--card);
  transform: translate(-50%, -50%);
}

/* 营养目标是两列；不要和上面三项身体数据挤成一行 */
.bodydata__grid--nutrition {
  grid-template-columns: 1fr 1fr;
}

.nutrition-actions {
  /*
   * 原来是"一行左右分栏"。360px 下三个按钮 + 一段说明文字
   * 挤在同一行，文字换行后与按钮不齐，视觉审计判为行内错位。
   * 改成上下两段：说明一行，按钮一行且允许换行。
   */
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  margin-top: 12px;
  gap: 8px;
}

.nutrition-actions__btns {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* 数据页"我的数据"三行 */
.datarow {
  padding: 9px 0;
  border-bottom: 1px solid var(--line);
}

.datarow:last-child {
  border-bottom: none;
}

.weight__list {
  padding: 4px 16px;
}

.weight__row {
  align-items: center;
}

.weight__more {
  margin-top: 8px;
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
/* 提醒与饮水 */
.reminder {
  margin-top: 14px;
}

.reminder__row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.reminder__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.reminder__time {
  max-width: 120px;
}

.reminder__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 10px;
}

.reminder__foot {
  margin-top: 14px;
  align-items: center;
}

.reminder__error {
  margin-top: 6px;
  color: var(--clay);
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
.adaptive {
  margin-top: 10px;
  color: var(--text-3);
}

.adaptive--ok {
  color: var(--lime-ink);
  font-weight: 600;
}
</style>



















