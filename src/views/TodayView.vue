<script setup lang="ts">
import { weightTrendTone } from '../domain/weight';
import { computed } from 'vue';
import { store, derived } from '../store/appStore';
import { exerciseName } from '../content/exercises';
import {
  addDays,
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
import { completedSetCount, plannedSetCount } from '../domain/metrics';
import {
  DEFAULT_WATER_GOAL_ML,
  WATER_QUICK_ADD,
  waterProgress,
  waterText,
  waterTotal,
} from '../domain/water';

const emit = defineEmits<{ (e: 'navigate', payload: NavigatePayload): void }>();
withDefaults(defineProps<{ greetingName?: string }>(), { greetingName: '你' });

const today = businessDate();
const weekStart = weekStartOf(today);

/* 饮水：独立于训练/饮食，空状态也显示；目标可改，界面明确标"参考" */
const waterQuickAdd = WATER_QUICK_ADD;
const waterGoal = computed(() => store.state.waterGoalMl ?? DEFAULT_WATER_GOAL_ML);
const waterTotalMl = computed(() => waterTotal(store.state.water, today));
const waterPct = computed(() => waterProgress(waterTotalMl.value, waterGoal.value));
const waterHint = computed(() => waterText(waterTotalMl.value, waterGoal.value));

function addWater(ml: number): void {
  store.addWater(ml);
}

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

/**
 * 体重变化只看最近 6 周。
 *
 * 原来标签写"近 6 周"、算的却是全部记录（14 条约 4 周），标签和事实对不上。
 * 现在按窗口过滤；记录跨度不足 6 周时，标签改成真实天数。
 */
const weightWindow = computed(() => {
  const series = derived.weightSeries.value;
  const cutoff = addDays(today, -41);
  const inWindow = series.filter((w) => w.date >= cutoff);
  return inWindow.length >= 2 ? inWindow : series;
});

/*
 * 体重变化只相对目标方向评价。
 * 没设目标体重时不给颜色，因为 App 不知道你在增肌还是减脂。
 */
const weightTone = computed(() => {
  const last = weightWindow.value[weightWindow.value.length - 1]?.grams ?? 0;
  const goal = store.state.bodyGoalGrams;
  return weightTrendTone(weightDelta.value, last / 1000, goal === null ? null : goal / 1000);
});

const weightDelta = computed(() => {
  const series = weightWindow.value;
  if (series.length < 2) return 0;
  const first = series[0]!;
  const last = series[series.length - 1]!;
  return (last.grams - first.grams) / 1000;
});

/** "近 6 周"只在真的有 6 周数据时才成立。 */
const weightSpanLabel = computed(() => {
  const series = weightWindow.value;
  if (series.length < 2) return '';
  const days =
    Math.round(
      (new Date(`${series[series.length - 1]!.date}T12:00:00`).getTime() -
        new Date(`${series[0]!.date}T12:00:00`).getTime()) /
        86_400_000,
    ) + 1;
  return days >= 42 ? '近 6 周' : `近 ${days} 天`;
});

const caloriesToday = computed(() => {
  const foods = store.state.foods.filter((f) => f.date === today);
  return {
    kcal: foods.reduce((sum, f) => sum + f.kcal, 0),
    protein: foods.reduce((sum, f) => sum + f.protein, 0),
    // "几餐"按餐次去重，不能数食物条目（PM 评审 §3.2 P2）
    slots: new Set(foods.map((f) => f.slot)).size,
  };
});

/**
 * 真正的空状态：训练、体重、饮食一条都没有。
 *
 * 没数据时不能显示"累计 0 次""0 / 默认目标"——0 会被读成"没达标"，
 * 默认目标又会被当成用户自己设的（PM 评审 §3.2 / §4.3）。
 */
const hasAnyData = computed(
  () => sessions.value.length > 0 || store.state.weights.length > 0 || store.state.foods.length > 0,
);

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
    case 'partial':
      return '今天只练了一半';
    case 'moved':
      return '今天这项已顺延';
    case 'rest':
      return '今天没有安排';
    default:
      return '把这一组，记下来';
  }
});

/** 部分完成时"继续这场"：把已结束的会话重新打开，数据不拆成两场。 */
function continueSession(): void {
  const info = todayInfo.value;
  if (!info.session) return;
  const error = store.reopenSession(info.session.id);
  if (error) {
    openSession(info.session.id);
    return;
  }
  startLive(info.session.id);
}

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
  if (info.state === 'done' || info.state === 'partial') {
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

/**
 * 点 hero 标题区。
 *
 * 大块深色区域看起来最像"能点"，之前点了没反应（用户实测）。
 * 有当天会话（进行中 / 已完成 / 部分完成）就打开会话；
 * 否则去训练页选今天的计划。
 */
function tapHeroHead(): void {
  const info = todayInfo.value;
  if (info.session && (info.state === 'live' || info.state === 'done' || info.state === 'partial')) {
    openSession(info.session.id);
    return;
  }
  emit('navigate', 'train');
}

/* 大卡片的目的地：点哪儿都比"没反应"强 */
function goPlan(): void {
  emit('navigate', { to: 'plan', from: 'today' });
}

function goHistory(): void {
  emit('navigate', { to: 'train', from: 'today', focus: { kind: 'history' } });
}

function goBody(): void {
  emit('navigate', { to: 'me', from: 'today' });
}

function goFood(): void {
  emit('navigate', { to: 'food', from: 'today' });
}
</script>

<template>
  <div class="today">
    <!-- hero -->
    <section class="hero card card--ink">
      <div class="hero__head">
        <!-- 整块可点：有当天会话就打开会话，否则去训练页 -->
        <div
          class="hero__head-main"
          role="button"
          tabindex="0"
          :aria-label="todayInfo.session ? '打开今天的训练' : '去训练页选今天的计划'"
          @click="tapHeroHead"
          @keydown.enter.prevent="tapHeroHead"
          @keydown.space.prevent="tapHeroHead"
        >
          <p class="hero__eyebrow">{{ greetingName }}，今天练什么</p>
          <h1 class="hero__title">
            {{ heroTitle }}
            <span class="hero__go" aria-hidden="true">›</span>
          </h1>
        </div>
        <!-- 圆环是周目标进度，点了要能进周目标，而不是只能看 -->
        <button
          type="button"
          class="ring ring--tap"
          :style="{ '--pct': weekPct }"
          :aria-label="`本周完成 ${doneThisWeek} 次，目标 ${weekGoal} 次，打开周目标`"
          @click="emit('navigate', { to: 'plan', from: 'today' })"
        >
          <span class="ring__inner">
            <span class="ring__num">{{ doneThisWeek }}<span>/{{ weekGoal }}</span></span>
            <span class="ring__cap">本周</span>
          </span>
        </button>
      </div>

      <div v-if="todayInfo.state === 'live' && todayInfo.session" class="hero__live">
        <span class="dot" />
        <span>{{ todayInfo.session.title }}</span>
        <span class="hero__live-time">{{ shortDate(todayInfo.session.businessDate) }} 开始</span>
      </div>

      <!-- 已完成 / 部分完成：给出训练事实，而不是再让用户开始一次 -->
      <div
        v-else-if="(todayInfo.state === 'done' || todayInfo.state === 'partial') && todayInfo.session"
        class="hero__plan"
      >
        <div class="hero__plan-head">
          <span class="label">{{ todayInfo.state === 'partial' ? '今天部分完成' : '今天完成' }}</span>
          <span class="chip chip--sm hero__chip">{{ todayInfo.credited ? '已计入周目标' : '未计入周目标' }}</span>
        </div>
        <p class="hero__plan-title">{{ todayInfo.session.title }}</p>
        <div class="hero__exercises">
          <span class="hero__ex">{{ todayInfo.session.exercises.length }} 个动作</span>
          <span class="hero__ex">{{ completedSetCount(todayInfo.session) }}/{{ plannedSetCount(todayInfo.session) }} 组</span>
          <span class="hero__ex">{{ formatVolume(sessionVolumeGrams(todayInfo.session), 'kg') }} 容量</span>
        </div>
        <p v-if="todayInfo.state === 'partial'" class="tiny hero__plan-note">
          还没练完，可以继续这场把剩下的组记完。
        </p>
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
          <!-- 没有真实计划项时不能说"今日计划"，否则与"今天没有安排"自相矛盾 -->
          <span class="label">{{ todayInfo.occurrence ? '今日计划' : '按模板今天该练' }}</span>
          <span class="chip chip--sm hero__chip">{{ todayPlan.exercises.length }} 个动作</span>
        </div>
        <p class="hero__plan-title">{{ todayPlan.title }}</p>
        <div class="hero__exercises">
          <span v-for="ex in todayPlan.exercises.slice(0, 4)" :key="ex.exerciseId" class="hero__ex">
            {{ exerciseName(ex.exerciseId) }}
          </span>
        </div>
        <p v-if="!todayInfo.occurrence" class="tiny hero__plan-note">
          没排进本周计划，练了算加练，不影响周目标。
        </p>
      </div>

      <div class="hero__actions">
        <button
          v-if="todayInfo.state === 'partial'"
          class="btn btn--lime btn--lg"
          @click="continueSession"
        >
          继续这场
        </button>
        <button
          v-else-if="todayInfo.state === 'done'"
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
          {{ todayInfo.state === 'done' || todayInfo.state === 'partial' ? '再练一场' : '空白训练' }}
        </button>
      </div>

      <p v-if="todayInfo.state === 'done' && !todayInfo.credited" class="hero__hint">
        这场只记录了训练次数，没有计入本周目标（结束时可勾选「本次计入周目标」）。
      </p>
      <p v-else-if="todayInfo.state === 'partial' && !todayInfo.credited" class="hero__hint">
        没练完的场次默认不计入周目标；确认这次就练到这儿，可在记录里手动关联。
      </p>
    </section>

    <!-- week strip -->
    <section
      class="week card tap-card"
      role="button"
      tabindex="0"
      aria-label="查看周目标"
      @click="goPlan"
      @keydown.enter.prevent="goPlan"
      @keydown.space.prevent="goPlan"
    >
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
          <span class="tap-go" aria-hidden="true">›</span>
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

    <!-- quick stats：没有数据时整块隐藏，改用引导卡 -->
    <section v-if="hasAnyData" class="grid-2 quick">
      <article
        class="card quick__card tap-card"
        role="button"
        tabindex="0"
        aria-label="查看训练历史"
        @click="goHistory"
        @keydown.enter.prevent="goHistory"
        @keydown.space.prevent="goHistory"
      >
        <p class="label">累计训练 <span class="tap-go" aria-hidden="true">›</span></p>
        <p class="stat__value">{{ totalTraining }}<span class="stat__unit">次</span></p>
        <Sparkline :points="volumeTrend" :height="36" tone="ink" />
      </article>
      <article
        class="card quick__card tap-card"
        role="button"
        tabindex="0"
        aria-label="查看身体数据"
        @click="goBody"
        @keydown.enter.prevent="goBody"
        @keydown.space.prevent="goBody"
      >
        <p class="label">体重趋势 <span class="tap-go" aria-hidden="true">›</span></p>
        <p class="stat__value">
          {{ latestWeight ? (latestWeight.grams / 1000).toFixed(1) : '—' }}<span class="stat__unit">kg</span>
        </p>
        <p class="tiny" :class="`tone-${weightTone}`">
          {{ weightDelta > 0 ? '+' : '' }}{{ weightDelta.toFixed(1) }} kg · {{ weightSpanLabel }}
        </p>
        <Sparkline :points="weightTrend" :height="36" tone="clay" />
      </article>
    </section>

    <!-- nutrition -->
    <section v-if="hasAnyData" class="card nutrition">
      <div class="section__head">
        <div
          class="tap-head"
          role="button"
          tabindex="0"
          aria-label="打开饮食页"
          @click="goFood"
          @keydown.enter.prevent="goFood"
          @keydown.space.prevent="goFood"
        >
          <p class="label">今日饮食</p>
          <p class="h3">
            {{ caloriesToday.kcal }}<span v-if="kcalTarget" class="tiny"> / {{ kcalTarget }} kcal</span><span v-else class="tiny"> kcal · 未设目标</span>
          </p>
        </div>
        <button class="btn btn--ghost btn--sm" @click="emit('navigate', { to: 'food', from: 'today' })">记录</button>
      </div>
      <div class="nutrition__bars">
        <div>
          <div class="row between nutrition__bar-head">
            <span class="tiny">热量</span>
            <span class="tiny">{{ kcalTarget ? `${kcalPct}%` : '—' }}</span>
          </div>
          <div class="bar"><div class="bar__fill" :style="{ width: `${kcalPct}%` }" /></div>
        </div>
        <div>
          <div class="row between nutrition__bar-head">
            <span class="tiny">蛋白质 {{ Math.round(caloriesToday.protein) }}g</span>
            <span class="tiny">{{ proteinTarget ? `${proteinPct}%` : '—' }}</span>
          </div>
          <div class="bar"><div class="bar__fill bar__fill--clay" :style="{ width: `${proteinPct}%` }" /></div>
        </div>
      </div>
      <p class="tiny nutrition__note">
        {{ caloriesToday.slots === 0 ? '还没有记录今天的饮食，未记录不等于 0。' : `已记录 ${caloriesToday.slots} 餐，部分记录不代表全天。` }}
      </p>
    </section>

    <!-- 空状态：不显示 0 与默认目标，给三条最直接的入口 -->
    <section v-else class="card empty-guide">
      <p class="label">从第一条记录开始</p>
      <h2 class="h2">先记一笔，之后才有趋势</h2>
      <p class="small empty-guide__lead">
        现在还没有训练、饮食或体重记录。没有数据时不显示 0 和默认目标——那会让“空”看起来像“没达标”。
      </p>
      <div class="empty-guide__actions">
        <button class="btn btn--primary btn--block" @click="emit('navigate', { to: 'me', from: 'today' })">
          记体重
        </button>
        <button class="btn btn--ghost btn--block" @click="emit('navigate', { to: 'food', from: 'today' })">
          记饮食
        </button>
        <button class="btn btn--lime btn--block" @click="startWorkout">开始训练</button>
      </div>
    </section>

    <!-- 饮水：与训练/饮食解耦，即使还没有训练数据也显示 -->
    <section class="card water">
      <div class="section__head">
        <div
          class="tap-head"
          role="button"
          tabindex="0"
          aria-label="打开饮食页看饮水进度"
          @click="goFood"
          @keydown.enter.prevent="goFood"
          @keydown.space.prevent="goFood"
        >
          <p class="label">今日饮水</p>
          <p class="h3">
            {{ waterTotalMl }}<span class="tiny"> / {{ waterGoal }} ml</span>
          </p>
        </div>
        <span class="tiny">{{ waterHint }}</span>
      </div>
      <div class="bar">
        <div class="bar__fill bar__fill--water" :style="{ width: `${waterPct ?? 0}%` }" />
      </div>
      <div class="water__actions">
        <button v-for="ml in waterQuickAdd" :key="ml" class="btn btn--ghost btn--sm" @click="addWater(ml)">
          +{{ ml }} ml
        </button>
      </div>
      <p class="tiny water__note">
        参考目标 {{ waterGoal }} ml，可在「我的 → 设置」里改；记录按天保存。
      </p>
    </section>

    <!-- recent -->
    <section v-if="hasAnyData" class="section">
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

/* 空状态引导卡：不用 0 和默认值填满屏幕 */
.empty-guide {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.empty-guide__lead {
  margin-top: 4px;
  color: var(--text-2);
  line-height: 1.55;
}

.empty-guide__actions {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
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

/* 大块深色区域必须可点：之前整块没反应，用户会以为界面卡死 */
.hero__head-main {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.hero__head-main:active {
  opacity: 0.72;
}

.hero__head-main:focus-visible {
  outline: 2px solid rgba(var(--inv-rgb), 0.5);
  outline-offset: 6px;
  border-radius: 12px;
}

.hero__go {
  display: inline-block;
  margin-left: 6px;
  font-size: 0.62em;
  opacity: 0.45;
  transform: translateY(-0.12em);
}

/* 圆环从 div 改成 button，去掉浏览器默认外观 */
.ring--tap {
  padding: 0;
  border: 0;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
}

.ring--tap:active {
  transform: scale(0.97);
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
  /*
   * 深色 hero 上的次级按钮：浅色文字已经有了，但 8% 白的底
   * 在深色背景上边界只有 ~1.2:1，看起来像"浮着的一行字"。
   * 提到 14% 底 + 28% 亮描边，按钮形状可辨（PM 深评 P0-6）。
   */
  background: rgba(var(--inv-rgb), 0.14);
  color: var(--text-inverse);
  border-color: rgba(var(--inv-rgb), 0.28);
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

/* 饮水：用冷色区分于训练/饮食的酸橙与黏土 */
.bar__fill--water {
  background: var(--sky);
}

.water__actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.water__actions .btn {
  flex: 1;
}

.water__note {
  margin-top: 10px;
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




















