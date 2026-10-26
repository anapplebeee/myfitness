<script setup lang="ts">
import { computed } from 'vue';
import { store, derived } from '../store/appStore';
import { exerciseName } from '../content/exercises';
import {
  businessDate,
  formatVolume,
  shortDate,
  weekStartOf,
  weekdayLabel,
} from '../domain/units';
import {
  isValidCompleted,
  sessionVolumeGrams,
  trainingCount,
} from '../domain/metrics';
import Sparkline from '../components/Sparkline.vue';
import { openSession, startLive } from '../composables/useOverlay';
import type { NavigatePayload } from '../types/nav';
import { computeWeek, dayStatesForWeek, statusLabel, targetNarrative } from '../domain/week';
import { todayTraining } from '../domain/today';

const emit = defineEmits<{ (e: 'navigate', payload: NavigatePayload): void }>();
withDefaults(defineProps<{ greetingName?: string }>(), { greetingName: '你' });

const today = businessDate();
const weekStart = weekStartOf(today);

const sessions = computed(() => store.state.sessions);

const weekResult = computed(() =>
  computeWeek({
    weekStart,
    goal: store.goalForWeek(weekStart),
    occurrences: [...store.state.occurrences],
    sessions: [...sessions.value],
    now: new Date(),
  }),
);

// 周目标卡用 09 号口径：完成数来自被唯一满足的项目，而非会话总数
const doneThisWeek = computed(() => weekResult.value.completedOccurrences);
const weekGoal = computed(() => Math.max(1, weekResult.value.minimumTarget || store.state.weeklyGoal));
const weekPct = computed(() => Math.min(100, Math.round((doneThisWeek.value / weekGoal.value) * 100)));
const weekStatus = computed(() => weekResult.value.status);
const weekStatusText = computed(() => statusLabel(weekResult.value.status));
const adjustedHint = computed(() => targetNarrative(weekResult.value));

const template = computed(() =>
  store.state.activeTemplateId ? store.templateById(store.state.activeTemplateId) : null,
);

/**
 * 今天到底算"待训练 / 进行中 / 已完成 / 已顺延 / 休息"。
 *
 * 之前今日页只认模板的星期几，不看今天的计划项有没有被顺延、
 * 也不看今天是否已经练过，于是出现"练完了还让你开始训练"的矛盾。
 */
const todayInfo = computed(() =>
  todayTraining({
    today,
    occurrences: [...store.state.occurrences],
    sessions: [...sessions.value],
    result: weekResult.value,
  }),
);

const todayPlan = computed(() => {
  const tpl = template.value;
  if (!tpl) return null;
  // 优先用今天真正的计划项反查模板日：顺延进来的训练也能显示对
  const occ = todayInfo.value.occurrence;
  if (occ) {
    const bySlot = tpl.days.find((d) => `${tpl.id}-${d.id}` === occ.slotId);
    if (bySlot) return bySlot;
  }
  // 没有计划项时按星期几取（休息日也允许手动开一场）
  const dayIndex = new Date(`${today}T12:00:00`).getDay();
  const idx = dayIndex === 0 ? tpl.days.length - 1 : dayIndex - 1;
  return tpl.days[idx] ?? tpl.days[0] ?? null;
});

const recent = computed(() =>
  [...sessions.value]
    .filter(isValidCompleted)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .slice(0, 4),
);

const volumeTrend = computed(() => {
  const list = [...sessions.value]
    .filter(isValidCompleted)
    .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1))
    .slice(-10);
  return list.map((s) => sessionVolumeGrams(s) / 1000);
});

const weightTrend = computed(() => derived.weightSeries.value.map((w) => w.grams / 1000));
const latestWeight = computed(() => derived.latestWeight.value);
const weightDelta = computed(() => {
  const series = derived.weightSeries.value;
  if (series.length < 2) return 0;
  const first = series[0]!;
  const last = series[series.length - 1]!;
  return (last.grams - first.grams) / 1000;
});

const caloriesToday = computed(() => {
  const foods = store.state.foods.filter((f) => f.date === today);
  return {
    kcal: foods.reduce((sum, f) => sum + f.kcal, 0),
    protein: foods.reduce((sum, f) => sum + f.protein, 0),
    count: foods.length,
  };
});

const kcalTarget = computed(() => store.state.targetKcal ?? 0);
const proteinTarget = computed(() => store.state.targetProtein ?? 0);

const kcalPct = computed(() => (kcalTarget.value ? Math.min(100, Math.round((caloriesToday.value.kcal / kcalTarget.value) * 100)) : 0));
const proteinPct = computed(() => (proteinTarget.value ? Math.min(100, Math.round((caloriesToday.value.protein / proteinTarget.value) * 100)) : 0));

const weekDays = computed(() => {
  const cells = dayStatesForWeek(weekStart, [...store.state.occurrences], [...sessions.value], weekResult.value, today);
  return cells.map((cell) => ({
    date: cell.date,
    done: cell.primary === 'done',
    live: cell.primary === 'in_progress',
    excused: cell.primary === 'excused',
    isToday: cell.date === today,
    isFuture: cell.date > today,
    isPlanDay: cell.openCount > 0,
    note: cell.missedNote,
    label: weekdayLabel(cell.date).replace('周', ''),
  }));
});

const totalTraining = computed(() => trainingCount([...sessions.value]));

const heroTitle = computed(() => {
  switch (todayInfo.value.state) {
    case 'live':
      return '训练进行中';
    case 'done':
      return '今天已经练完了';
    case 'moved':
      return '今天这项已顺延';
    case 'rest':
      return '今天没有安排';
    default:
      return '把这一组，记下来';
  }
});

/**
 * 开始训练。
 *
 * 原实现只 emit('navigate','train')——把用户丢到训练页，还得自己再点一次，
 * 与"开始训练"的字面承诺不符。现在按今日计划直接建会话并打开录制页；
 * 没有计划时才退回到训练页让用户选。
 */
function startWorkout(): void {
  const info = todayInfo.value;
  if (info.state === 'live' && info.session) {
    startLive(info.session.id);
    return;
  }
  if (info.state === 'done') {
    if (info.session) openSession(info.session.id);
    return;
  }
  const day = todayPlan.value;
  if (day) {
    const session = store.startSessionFromDay(day.id);
    if (session) {
      startLive(session.id);
      return;
    }
  }
  emit('navigate', 'train');
}

function openRecent(id: string): void {
  openSession(id);
}
</script>

<template>
  <div class="today">
    <!-- hero -->
    <section class="hero card card--ink">
      <div class="hero__head">
        <div>
          <p class="hero__eyebrow">{{ greetingName }}，今天练什么</p>
          <h1 class="hero__title">{{ heroTitle }}</h1>
        </div>
        <div class="ring" :style="{ '--pct': weekPct }" :aria-label="`本周完成 ${doneThisWeek} 次，目标 ${weekGoal} 次`">
          <div class="ring__inner">
            <span class="ring__num">{{ doneThisWeek }}<span>/{{ weekGoal }}</span></span>
            <span class="ring__cap">本周</span>
          </div>
        </div>
      </div>

      <div v-if="todayInfo.state === 'live' && todayInfo.session" class="hero__live">
        <span class="dot" />
        <span>{{ todayInfo.session.title }}</span>
        <span class="hero__live-time">{{ shortDate(todayInfo.session.businessDate) }} 开始</span>
      </div>

      <!-- 已完成：给出训练事实，而不是再让用户开始一次 -->
      <div v-else-if="todayInfo.state === 'done' && todayInfo.session" class="hero__plan">
        <div class="hero__plan-head">
          <span class="label">今天完成</span>
          <span class="chip chip--sm hero__chip">{{ todayInfo.credited ? '已计入周目标' : '未计入周目标' }}</span>
        </div>
        <p class="hero__plan-title">{{ todayInfo.session.title }}</p>
        <div class="hero__exercises">
          <span class="hero__ex">{{ todayInfo.session.exercises.length }} 个动作</span>
          <span class="hero__ex">{{ formatVolume(sessionVolumeGrams(todayInfo.session), 'kg') }} 容量</span>
        </div>
      </div>

      <!-- 已顺延 -->
      <div v-else-if="todayInfo.state === 'moved' && todayInfo.movedTo" class="hero__plan">
        <div class="hero__plan-head">
          <span class="label">今天原计划</span>
          <span class="chip chip--sm hero__chip">顺延至 {{ shortDate(todayInfo.movedTo) }}</span>
        </div>
        <p class="hero__plan-title">{{ todayInfo.occurrence?.title }}</p>
        <p class="tiny hero__plan-note">今天不用补，按新日期练即可；想加练可以开始一场空白训练。</p>
      </div>

      <div v-else-if="todayPlan" class="hero__plan">
        <div class="hero__plan-head">
          <span class="label">今日计划</span>
          <span class="chip chip--sm hero__chip">{{ todayPlan.exercises.length }} 个动作</span>
        </div>
        <p class="hero__plan-title">{{ todayPlan.title }}</p>
        <div class="hero__exercises">
          <span v-for="ex in todayPlan.exercises.slice(0, 4)" :key="ex.exerciseId" class="hero__ex">
            {{ exerciseName(ex.exerciseId) }}
          </span>
        </div>
      </div>

      <div class="hero__actions">
        <button
          v-if="todayInfo.state === 'done'"
          class="btn btn--lime btn--lg"
          @click="startWorkout"
        >
          查看这次训练
        </button>
        <button
          v-else-if="todayInfo.state === 'moved'"
          class="btn btn--lime btn--lg"
          @click="emit('navigate', { to: 'plan', from: 'today' })"
        >
          看本周安排
        </button>
        <button v-else class="btn btn--lime btn--lg" @click="startWorkout">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10" />
          </svg>
          {{ todayInfo.state === 'live' ? '继续训练' : '开始训练' }}
        </button>
        <button class="btn btn--ghost btn--lg hero__ghost" @click="emit('navigate', { to: 'train', from: 'today' })">
          {{ todayInfo.state === 'done' ? '再练一场' : '空白训练' }}
        </button>
      </div>

      <p v-if="todayInfo.state === 'done' && !todayInfo.credited" class="hero__hint">
        这场只记录了训练次数，没有计入本周目标（结束时可勾选「本次计入周目标」）。
      </p>
    </section>

    <!-- week strip -->
    <section class="week card">
      <div class="section__head">
        <div>
          <p class="label">本周节奏</p>
          <p class="h3">{{ doneThisWeek }} / {{ weekGoal }} 项完成</p>
          <p class="tiny week__narr">{{ adjustedHint }}</p>
        </div>
        <div class="week__badges">
          <span class="chip chip--sm" :class="weekStatus === 'achieved' ? 'chip--lime' : weekStatus === 'notAchieved' ? 'chip--clay' : ''">
            {{ weekStatusText }}
          </span>
          <span class="chip chip--sm">{{ weekPct }}%</span>
        </div>
      </div>
      <div class="week__strip">
        <div
          v-for="d in weekDays"
          :key="d.date"
          class="week__day"
          :class="{ 'is-done': d.done, 'is-today': d.isToday, 'is-plan': d.isPlanDay && !d.done }"
        >
          <span class="week__label">{{ d.label }}</span>
          <span class="week__dot">
            <svg v-if="d.done" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
              <path d="M5 13l4 4L19 7" />
            </svg>
          </span>
        </div>
      </div>
    </section>

    <!-- quick stats -->
    <section class="grid-2 quick">
      <article class="card quick__card">
        <p class="label">累计训练</p>
        <p class="stat__value">{{ totalTraining }}<span class="stat__unit">次</span></p>
        <Sparkline :points="volumeTrend" :height="36" tone="ink" />
      </article>
      <article class="card quick__card">
        <p class="label">体重趋势</p>
        <p class="stat__value">
          {{ latestWeight ? (latestWeight.grams / 1000).toFixed(1) : '—' }}<span class="stat__unit">kg</span>
        </p>
        <p class="tiny" :class="weightDelta <= 0 ? 'down' : 'up'">
          {{ weightDelta > 0 ? '+' : '' }}{{ weightDelta.toFixed(1) }} kg · 近 6 周
        </p>
        <Sparkline :points="weightTrend" :height="36" tone="clay" />
      </article>
    </section>

    <!-- nutrition -->
    <section class="card nutrition">
      <div class="section__head">
        <div>
          <p class="label">今日饮食</p>
          <p class="h3">
            {{ caloriesToday.kcal }}<span class="tiny"> / {{ kcalTarget || '—' }} kcal</span>
          </p>
        </div>
        <button class="btn btn--ghost btn--sm" @click="emit('navigate', { to: 'food', from: 'today' })">记录</button>
      </div>
      <div class="nutrition__bars">
        <div>
          <div class="row between nutrition__bar-head">
            <span class="tiny">热量</span>
            <span class="tiny">{{ kcalPct }}%</span>
          </div>
          <div class="bar"><div class="bar__fill" :style="{ width: `${kcalPct}%` }" /></div>
        </div>
        <div>
          <div class="row between nutrition__bar-head">
            <span class="tiny">蛋白质 {{ Math.round(caloriesToday.protein) }}g</span>
            <span class="tiny">{{ proteinPct }}%</span>
          </div>
          <div class="bar"><div class="bar__fill bar__fill--clay" :style="{ width: `${proteinPct}%` }" /></div>
        </div>
      </div>
      <p class="tiny nutrition__note">
        {{ caloriesToday.count === 0 ? '还没有记录今天的饮食，未记录不等于 0。' : `已记录 ${caloriesToday.count} 餐，部分记录不代表全天。` }}
      </p>
    </section>

    <!-- recent -->
    <section class="section">
      <div class="section__head">
        <h2 class="h2">最近训练</h2>
        <!-- 点「全部」是要看历史列表，不是看计划；带 focus 直接落到历史段 -->
        <button
          class="btn btn--ghost btn--sm"
          @click="emit('navigate', { to: 'train', from: 'today', focus: { kind: 'history' } })"
        >
          全部
        </button>
      </div>
      <div class="card recent">
        <button
          v-for="s in recent"
          :key="s.id"
          class="list__row recent__row"
          @click="openRecent(s.id)"
        >
          <span class="recent__date">
            <strong>{{ shortDate(s.businessDate).split('月')[1]?.replace('日', '') }}</strong>
            <span>{{ shortDate(s.businessDate).split('月')[0] }}月</span>
          </span>
          <span class="recent__body">
            <span class="h3">{{ s.title }}</span>
            <span class="tiny">{{ s.exercises.length }} 个动作 · {{ formatVolume(sessionVolumeGrams(s), 'kg') }} 容量</span>
          </span>
          <span class="chip chip--lime chip--sm">完成</span>
        </button>
        <p v-if="!recent.length" class="empty">还没有训练记录，从上面的「开始训练」开始。</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.today {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hero {
  padding: 22px;
  background: radial-gradient(120% 90% at 100% 0%, var(--ink-glow) 0%, var(--surface-ink) 55%);
  overflow: hidden;
}

.hero__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.hero__eyebrow {
  font-size: 12px;
  letter-spacing: 0.06em;
  color: rgba(var(--inv-rgb), 0.56);
  margin-bottom: 10px;
}

.hero__title {
  /* 真机 369px 宽时 6vw≈22px 偏小，但 clamp 下限 27px 又会把
     "把这一组，记下来" 顶成两行且断在词中间。用 8vw 让它在
     窄屏略小、宽屏仍受 38px 上限约束。 */
  font-size: clamp(24px, 7.6vw, 38px);
  line-height: 1.08;
  /* 中文不用负字距：负值会让行尾可断位置变怪，出现"记 / 下来" */
  letter-spacing: -0.02em;
  font-weight: 700;
  /* 优先在逗号处断行，别把词组拆开 */
  word-break: keep-all;
  overflow-wrap: break-word;
  text-wrap: balance;
}

.ring__inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
}

.ring__num {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.04em;
}

.ring__num span {
  font-size: 13px;
  color: rgba(var(--inv-rgb), 0.5);
  font-weight: 560;
}

.ring__cap {
  font-size: 10.5px;
  letter-spacing: 0.1em;
  color: rgba(var(--inv-rgb), 0.5);
}

.hero__live {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 11px 14px;
  border-radius: 14px;
  background: rgba(201, 245, 63, 0.12);
  color: var(--lime);
  font-size: 13px;
  font-weight: 600;
}

.hero__live-time {
  margin-left: auto;
  color: rgba(201, 245, 63, 0.62);
  font-weight: 500;
  font-size: 12px;
}

.hero__plan {
  margin-top: 18px;
  padding: 14px;
  border-radius: 18px;
  background: rgba(var(--inv-rgb), 0.055);
  border: 1px solid rgba(var(--inv-rgb), 0.08);
}

.hero__plan-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.hero__chip {
  background: rgba(201, 245, 63, 0.16);
  color: var(--lime);
}

.hero__plan-title {
  font-size: 17px;
  font-weight: 650;
  letter-spacing: -0.025em;
}

.hero__plan-note {
  margin-top: 8px;
  color: rgba(var(--inv-rgb), 0.55);
  line-height: 1.5;
}

.hero__hint {
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(var(--inv-rgb), 0.07);
  color: rgba(var(--inv-rgb), 0.7);
  font-size: 12px;
  line-height: 1.5;
}

.hero__exercises {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 9px;
}

.hero__ex {
  font-size: 11.5px;
  padding: 4px 9px;
  border-radius: 999px;
  background: rgba(var(--inv-rgb), 0.08);
  color: rgba(var(--inv-rgb), 0.72);
}

.hero__actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}

.hero__actions .btn--lime {
  flex: 1;
}

.hero__ghost {
  background: rgba(var(--inv-rgb), 0.08);
  color: var(--text-inverse);
}

.hero .label {
  color: rgba(var(--inv-rgb), 0.5);
}

.week__narr {
  margin-top: 3px;
}

.week__badges {
  display: flex;
  align-items: center;
  gap: 6px;
}
.week__strip {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
}

.week__day {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 9px 0;
  border-radius: 14px;
  background: rgba(var(--ink-rgb), 0.03);
}

.week__day.is-done {
  background: var(--surface-ink);
  color: var(--lime);
}

.week__day.is-today {
  box-shadow: inset 0 0 0 1.5px var(--text);
}

.week__day.is-plan:not(.is-done) .week__dot {
  background: rgba(var(--ink-rgb), 0.12);
}

.week__label {
  font-size: 11px;
  color: var(--text-3);
  font-weight: 560;
}

.week__day.is-done .week__label {
  color: rgba(201, 245, 63, 0.7);
}

.week__dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: transparent;
  color: var(--text);
}

.week__day.is-done .week__dot {
  background: var(--lime);
}

.quick__card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px;
}

.down {
  color: var(--lime-ink);
}

.up {
  color: var(--clay);
}

.nutrition__bars {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 4px;
}

.nutrition__bar-head {
  margin-bottom: 5px;
}

.bar__fill--clay {
  background: var(--clay);
}

.nutrition__note {
  margin-top: 12px;
}

.recent {
  padding: 6px 16px;
}

.recent__row {
  align-items: center;
}

.recent__date {
  width: 44px;
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.05;
  flex: none;
}

.recent__date strong {
  font-size: 19px;
  font-weight: 680;
  letter-spacing: -0.03em;
}

.recent__date span {
  font-size: 10px;
  color: var(--text-3);
}

.recent__body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}
</style>


















