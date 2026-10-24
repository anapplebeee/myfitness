<script setup lang="ts">
import { computed } from 'vue';
import { store, derived } from '../store/appStore';
import { TEMPLATE_BY_ID, exerciseName } from '../content/exercises';
import {
  addDays,
  businessDate,
  formatVolume,
  shortDate,
  weekStartOf,
  weekdayLabel,
} from '../domain/units';
import {
  activeSession,
  isValidCompleted,
  sessionVolumeGrams,
  trainingCount,
  weekCompletion,
} from '../domain/metrics';
import Sparkline from '../components/Sparkline.vue';
import type { Route } from '../types/nav';

const emit = defineEmits<{ (e: 'navigate', tab: Route): void }>();
withDefaults(defineProps<{ greetingName?: string }>(), { greetingName: '你' });

const today = businessDate();
const weekStart = weekStartOf(today);
const nextWeekStart = addDays(weekStart, 7);

const sessions = computed(() => store.state.sessions);
const live = computed(() => activeSession([...sessions.value]));
const activeSessionList = computed(() => [...sessions.value]);

const doneThisWeek = computed(() => weekCompletion(activeSessionList.value, weekStart, nextWeekStart));
const weekGoal = computed(() => Math.max(1, store.state.weeklyGoal));
const weekPct = computed(() => Math.min(100, Math.round((doneThisWeek.value / weekGoal.value) * 100)));

const template = computed(() =>
  store.state.activeTemplateId ? TEMPLATE_BY_ID.get(store.state.activeTemplateId) ?? null : null,
);

const todayPlan = computed(() => {
  if (!template.value) return null;
  const dayIndex = new Date(`${today}T12:00:00`).getDay();
  const idx = dayIndex === 0 ? template.value.days.length - 1 : dayIndex - 1;
  return template.value.days[idx] ?? template.value.days[0] ?? null;
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

const weekDays = computed(() =>
  Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const done = sessions.value.some((s) => s.businessDate === date && isValidCompleted(s));
    const isToday = date === today;
    const isFuture = date > today;
    const isPlanDay = template.value ? i % Math.max(2, Math.round(7 / template.value.daysPerWeek)) === 0 : false;
    return { date, done, isToday, isFuture, isPlanDay, label: weekdayLabel(date).replace('周', '') };
  }),
);

const totalTraining = computed(() => trainingCount([...sessions.value]));

function startWorkout(): void {
  emit('navigate', 'train');
}
</script>

<template>
  <div class="today">
    <!-- hero -->
    <section class="hero card card--ink">
      <div class="hero__head">
        <div>
          <p class="hero__eyebrow">{{ greetingName }}，今天练什么</p>
          <h1 class="hero__title">
            {{ live ? '训练进行中' : '把这一组，记下来' }}
          </h1>
        </div>
        <div class="ring" :style="{ '--pct': weekPct }" :aria-label="`本周完成 ${doneThisWeek} 次，目标 ${weekGoal} 次`">
          <div class="ring__inner">
            <span class="ring__num">{{ doneThisWeek }}<span>/{{ weekGoal }}</span></span>
            <span class="ring__cap">本周</span>
          </div>
        </div>
      </div>

      <div v-if="live" class="hero__live">
        <span class="dot" />
        <span>{{ live.title }}</span>
        <span class="hero__live-time">{{ shortDate(live.businessDate) }} 开始</span>
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
        <button class="btn btn--lime btn--lg" @click="startWorkout">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10" />
          </svg>
          {{ live ? '继续训练' : '开始训练' }}
        </button>
        <button class="btn btn--ghost btn--lg hero__ghost" @click="emit('navigate', 'train')">空白训练</button>
      </div>
    </section>

    <!-- week strip -->
    <section class="week card">
      <div class="section__head">
        <div>
          <p class="label">本周节奏</p>
          <p class="h3">{{ doneThisWeek }} / {{ weekGoal }} 次完成</p>
        </div>
        <span class="chip chip--sm">{{ weekPct }}%</span>
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
        <button class="btn btn--ghost btn--sm" @click="emit('navigate', 'food')">记录</button>
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
        <button class="btn btn--ghost btn--sm" @click="emit('navigate', 'train')">全部</button>
      </div>
      <div class="card recent">
        <button
          v-for="s in recent"
          :key="s.id"
          class="list__row recent__row"
          @click="emit('navigate', 'train')"
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
  background: radial-gradient(120% 90% at 100% 0%, #26301f 0%, var(--ink) 55%);
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
  color: rgba(244, 246, 238, 0.56);
  margin-bottom: 10px;
}

.hero__title {
  font-size: clamp(27px, 6vw, 38px);
  line-height: 1.04;
  letter-spacing: -0.045em;
  font-weight: 700;
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
  color: rgba(244, 246, 238, 0.5);
  font-weight: 560;
}

.ring__cap {
  font-size: 10.5px;
  letter-spacing: 0.1em;
  color: rgba(244, 246, 238, 0.5);
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
  background: rgba(244, 246, 238, 0.055);
  border: 1px solid rgba(244, 246, 238, 0.08);
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
  background: rgba(244, 246, 238, 0.08);
  color: rgba(244, 246, 238, 0.72);
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
  background: rgba(244, 246, 238, 0.08);
  color: var(--text-inverse);
}

.hero .label {
  color: rgba(244, 246, 238, 0.5);
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
  background: rgba(17, 20, 17, 0.03);
}

.week__day.is-done {
  background: var(--ink);
  color: var(--lime);
}

.week__day.is-today {
  box-shadow: inset 0 0 0 1.5px var(--ink);
}

.week__day.is-plan:not(.is-done) .week__dot {
  background: rgba(17, 20, 17, 0.12);
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
  color: var(--ink);
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


