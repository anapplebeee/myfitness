<script setup lang="ts">
import type { NavigatePayload } from '../types/nav';
import { computed, ref } from 'vue';
import { store } from '../store/appStore';
import { exerciseName, exerciseGroup, MUSCLES } from '../content/exercises';
import { suggestProgression } from '../domain/amend';
import { formatLoad, formatVolume, shortDate } from '../domain/units';
import { trendGeometry } from '../domain/trend';
import AiCoachPanel from '../components/AiCoachPanel.vue';
import WeeklyReportCard from '../components/WeeklyReportCard.vue';
import MuscleBalanceCard from '../components/MuscleBalanceCard.vue';
import {
  bestSet,
  isValidCompleted,
  sessionVolumeGrams,
} from '../domain/metrics';

defineProps<{ greetingName?: string }>();
const emit = defineEmits<{ (e: 'navigate', payload: NavigatePayload): void }>();

/** 点容量卡：去「训练 → 历史」，看这些容量是怎么攒出来的。 */
function openHistory(): void {
  emit('navigate', { to: 'train', from: 'coach', focus: { kind: 'history' } });
}

const unit = ref<'kg' | 'lb'>('kg');
const openId = ref<string | null>(null);

const sessions = computed(() =>
  [...store.state.sessions].filter(isValidCompleted).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)),
);

interface ExerciseRow {
  exerciseId: string;
  bestGrams: number;
  lastReps: number;
  /** 最近 6 次顶组重量（kg），时间正序 */
  series: number[];
  /** 与 series 一一对应的业务日期，用于首尾标注 */
  dates: string[];
  /** 折线 / 面积 path（按真实 min/max 缩放，见 domain/trend.ts） */
  line: string;
  area: string;
  /** Y 轴标注用的真实极值 */
  min: number;
  max: number;
  flat: boolean;
  /**
   * 首末变化百分比。
   * 样本不足 3 次时为 null——两个点算出来的"涨幅"没有统计意义，
   * 却会让用户以为自己在稳定进步（PM 深评 §2.8）。
   */
  changePct: number | null;
}

const exercises = computed<ExerciseRow[]>(() => {
  const map = new Map<string, Array<{ value: number; date: string }>>();
  for (const s of [...sessions.value].reverse()) {
    for (const ex of s.exercises) {
      const top = ex.sets
        .filter((x) => x.kind === 'work' && x.status === 'completed' && x.loadGrams)
        .reduce((max, x) => Math.max(max, x.loadGrams ?? 0), 0);
      if (!top) continue;
      const list = map.get(ex.exerciseId) ?? [];
      list.push({ value: top / 1000, date: s.businessDate });
      map.set(ex.exerciseId, list);
    }
  }
  return [...map.entries()]
    .map(([exerciseId, points]) => {
      const best = bestSet([...sessions.value], exerciseId);
      const recent = points.slice(-6);
      const series = recent.map((p) => p.value);
      const first = series[0] ?? 0;
      const last = series[series.length - 1] ?? 0;
      const geo = trendGeometry(series);
      return {
        exerciseId,
        bestGrams: best?.loadGrams ?? 0,
        lastReps: best?.reps ?? 0,
        series,
        dates: recent.map((p) => p.date),
        line: geo.line,
        area: geo.area,
        min: geo.min,
        max: geo.max,
        flat: geo.flat,
        changePct:
          series.length >= 3 && first > 0 ? Math.round(((last - first) / first) * 100) : null,
      };
    })
    .sort((a, b) => b.series.length - a.series.length);
});

/** 趋势卡默认只展开最近练得最多的 3 个，其余折起（原来 20 张全展开 = 5.3 屏）。 */
const showAll = ref(false);
const visibleExercises = computed(() =>
  showAll.value ? exercises.value : exercises.value.slice(0, 3),
);

/** 首尾日期区间，例如「10月1日 → 10月27日」。 */
function rangeLabel(row: ExerciseRow): string {
  const first = row.dates[0];
  const last = row.dates[row.dates.length - 1];
  if (!first || !last) return '';
  return `${shortDate(first)} → ${shortDate(last)}`;
}

const topPrs = computed(() =>
  exercises.value
    // 自重动作（引体/俯卧撑）的最佳负载是 0，混进"力量榜"会显示成 `0 kg`，
    // 看起来像数据坏了。这里只排有真实负载的动作，自重 PR 另有地方看次数。
    .filter((e) => e.bestGrams > 0)
    .slice()
    .sort((a, b) => b.bestGrams - a.bestGrams)
    .slice(0, 5),
);

const template = computed(() =>
  store.state.activeTemplateId ? store.templateById(store.state.activeTemplateId) : null,
);

const totalVolume = computed(() => formatVolume(sessions.value.reduce((s, x) => s + sessionVolumeGrams(x), 0), unit.value));

/** 渐进建议用真实规则：达标上限则加配重，连续低于下限则减重。 */
const suggestions = computed(() => {
  const out: Array<{ exerciseId: string; text: string; action: string }> = [];
  const tpl = template.value;
  for (const row of exercises.value.slice(0, 5)) {
    const planEx = tpl?.days
      .flatMap((d) => d.exercises)
      .find((e) => e.exerciseId === row.exerciseId);
    const repMin = planEx?.repMin ?? 6;
    const repMax = planEx?.repMax ?? 10;
    const increment = planEx?.incrementGrams ?? 2500;
    const tip = suggestProgression(
      [...sessions.value],
      row.exerciseId,
      repMin,
      repMax,
      increment,
      unit.value,
    );
    if (tip) out.push({ exerciseId: row.exerciseId, text: tip.text, action: tip.action });
  }
  return out;
});

function toggle(id: string): void {
  openId.value = openId.value === id ? null : id;
}

function groupOf(id: string): string {
  return MUSCLES.find((m) => m.id === exerciseGroup(id))?.label ?? '';
}
</script>

<template>
  <div class="coach">
    <header class="coach__head">
      <div>
        <p class="label">教练</p>
        <h1 class="h1">进步来自可比较的记录</h1>
      </div>
    </header>

    <!--
      AI 教练放最上面：这个标签叫"教练"，用户点进来首先应该看到教练。
      下面的图表是"数据"，不是"教练"。
    -->
    <AiCoachPanel />

      <!--
        周报放在 AI 之后、总容量之前：
        总容量是"至今累计"，回答不了"我最近有没有进步"；
        周报给的正是这个问题。
      -->
      <!--
        完全没有记录时不显示周报：空状态页已经在解释"先练一次"，
        再叠一张全是 0 的卡片等于重复劝退。
      -->
      <WeeklyReportCard v-if="sessions.length" />

      <!-- 容量回答不了"这周胸做了几组"，部位分布来回答 -->
      <MuscleBalanceCard />

    <!-- 空状态：一次训练都没有时，不显示 0 kg 与空榜，直接给下一步 -->
    <section v-if="!sessions.length" class="card coach__blank">
      <p class="label">还没有可比较的记录</p>
      <p class="h2" style="margin-top: 8px">先完成一次训练</p>
      <p class="small" style="margin-top: 8px">
        教练会用你实际完成的组做比较：同一个动作这次比上次重了多少、多了几次。
        没有记录之前，这里的任何数字都没有意义，所以先不显示。
      </p>
      <button class="btn btn--lime btn--block" style="margin-top: 16px" @click="emit('navigate', { to: 'today', from: 'coach' })">
        去记第一组
      </button>
    </section>

    <template v-else>
    <section class="card card--ink coach__hero">
      <!-- 整块可点：容量数字不是装饰，点进去看它怎么攒出来的 -->
      <button type="button" class="coach__hero-top coach__hero-tap" @click="openHistory">
        <span class="coach__hero-main">
          <span class="label">累计训练容量</span>
          <span class="coach__volume">{{ totalVolume }}</span>
          <span class="tiny coach__hero-sub">{{ sessions.length }} 场训练 · 全部来自本机记录</span>
        </span>
        <span class="coach__hero-side">
          <!-- 纯文字提示：之前做成深色 pill，像一块独立色块，和卡片其他小字脱节 -->
          <span class="coach__hint">可比较工作组</span>
          <span class="coach__go" aria-hidden="true">›</span>
        </span>
      </button>
      <div class="seg coach__unit">
        <button class="seg__item" :class="{ 'is-on': unit === 'kg' }" @click="unit = 'kg'">kg</button>
        <button class="seg__item" :class="{ 'is-on': unit === 'lb' }" @click="unit = 'lb'">lb</button>
      </div>
    </section>

    <section class="section">
      <div class="section__head">
        <h2 class="h2">力量榜</h2>
        <span class="tiny">最佳工作组</span>
      </div>
      <div class="card prs">
        <div v-for="(row, i) in topPrs" :key="row.exerciseId" class="pr">
          <span class="pr__rank">{{ i + 1 }}</span>
          <span class="recent__body">
            <span class="h3">{{ exerciseName(row.exerciseId) }}</span>
            <span class="tiny">{{ groupOf(row.exerciseId) }}</span>
          </span>
          <span class="pr__value">{{ formatLoad(row.bestGrams, unit) }}</span>
        </div>
        <p v-if="!topPrs.length" class="empty">完成一次训练后，这里会显示你的最佳记录。</p>
      </div>
    </section>

    <section class="section">
      <div class="section__head">
        <h2 class="h2">动作趋势</h2>
        <span class="tiny">最近 6 次 · 默认 3 个</span>
      </div>
      <div class="stack gap-8">
        <button
          v-for="row in visibleExercises"
          :key="row.exerciseId"
          class="card lift"
          @click="toggle(row.exerciseId)"
        >
          <span class="lift__head">
            <span class="recent__body">
              <span class="h3">{{ exerciseName(row.exerciseId) }}</span>
              <span class="tiny">{{ formatLoad(row.bestGrams, unit) }} × {{ row.lastReps }}</span>
            </span>
            <span
              class="lift__change"
              :class="
                row.changePct === null ? 'is-flat' : row.changePct >= 0 ? 'is-up' : 'is-down'
              "
            >
              <template v-if="row.changePct === null">样本不足</template>
              <template v-else>
                {{ row.changePct >= 0 ? '+' : '' }}{{ row.changePct }}%
              </template>
            </span>
          </span>
          <!--
            折线按真实 min/max 缩放，不再归一化到序列最大值。
            全程同重量就是一条水平线——"停滞"和"进步"必须长得不一样。
          -->
          <span class="lift__chart">
            <svg viewBox="0 0 280 44" preserveAspectRatio="none" aria-hidden="true">
              <path :d="row.area" class="lift__area" />
              <path :d="row.line" class="lift__line" vector-effect="non-scaling-stroke" />
            </svg>
            <span class="lift__minmax mono">
              <span>{{ row.max.toFixed(1) }}</span>
              <span>{{ row.min.toFixed(1) }}</span>
            </span>
          </span>
          <span v-if="openId === row.exerciseId" class="lift__detail">
            <span class="tiny">
              {{ rangeLabel(row) }} · 首次 {{ row.series[0]?.toFixed(1) }} kg → 最近
              {{ row.series[row.series.length - 1]?.toFixed(1) }} kg
              <template v-if="row.changePct === null">（样本不足 3 次，暂不判断趋势）</template>
              <template v-else>
                ，{{ row.changePct > 0 ? '上升' : row.changePct < 0 ? '下降' : '持平' }}
                {{ Math.abs(row.changePct) }}%
              </template>
            </span>
          </span>
        </button>

        <button
          v-if="exercises.length > 3"
          class="btn btn--ghost btn--block"
          @click="showAll = !showAll"
        >
          {{ showAll ? '收起' : `查看全部 ${exercises.length} 个动作` }}
        </button>
      </div>
    </section>

    <section class="section">
      <div class="section__head">
        <h2 class="h2">下次怎么加</h2>
      </div>
      <div class="card card--flat">
        <div v-for="s in suggestions" :key="s.exerciseId" class="suggest">
          <span class="dot" />
          <span class="small">{{ exerciseName(s.exerciseId) }}：{{ s.text }}</span>
        </div>
        <p v-if="!suggestions.length" class="tiny">记录更多训练后，会基于你的实际完成情况给出建议。</p>
        <div class="divider" />
        <p class="tiny">{{ template?.progression ?? '达到重复区间上限后加最小配重；达不到下限则保持重量。' }}</p>
      </div>
    </section>
    </template>
  </div>
</template>

<style scoped>
.coach {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.coach__hero {
  padding: 20px;
  background: radial-gradient(120% 100% at 100% 0%, var(--ink-glow) 0%, var(--surface-ink) 58%);
}

.coach__hero-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

/* 整块卡头是按钮：去掉默认外观，保持原有排版 */
.coach__hero-tap {
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
}

.coach__hero-tap:active {
  opacity: 0.82;
}

.coach__hero-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  text-align: left;
}

.coach__hero-side {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}

.coach__hint {
  font-size: 11.5px;
  line-height: 1.45;
  color: rgba(var(--inv-rgb), 0.55);
  white-space: nowrap;
}

.coach__go {
  font-size: 22px;
  line-height: 1;
  color: rgba(var(--inv-rgb), 0.45);
}

.coach__volume {
  font-size: 40px;
  font-weight: 700;
  letter-spacing: -0.045em;
  line-height: 1.05;
  margin-top: 6px;
}

.coach__hero-sub {
  margin-top: 8px;
  color: rgba(var(--inv-rgb), 0.5);
}

.coach__unit {
  max-width: 140px;
  margin-top: 16px;
  background: rgba(var(--inv-rgb), 0.1);
}

.coach__unit .seg__item {
  color: rgba(var(--inv-rgb), 0.6);
}

.coach__unit .seg__item.is-on {
  background: var(--lime);
  color: var(--on-lime);
}

.prs {
  padding: 6px 16px;
}

.pr {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px solid var(--line);
}

.pr:last-child {
  border-bottom: 0;
}

.pr__rank {
  width: 22px;
  font-size: 12px;
  font-weight: 680;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.pr__value {
  font-size: 15px;
  font-weight: 680;
  letter-spacing: -0.02em;
}

.lift {
  display: flex;
  flex-direction: column;
  gap: 12px;
  text-align: left;
  width: 100%;
  padding: 16px;
}

.lift__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.lift__change {
  font-size: 13px;
  font-weight: 680;
  letter-spacing: -0.01em;
}

.lift__change.is-up {
  color: var(--lime-ink);
}

.lift__change.is-down {
  color: var(--clay);
}

/* 样本不足：不给涨跌色，避免把噪声染成"进步" */
.lift__change.is-flat {
  color: var(--text-3);
  font-weight: 500;
}

/*
 * 折线图：真实 min/max 缩放。
 *
 * 原实现是柱状图，高度按序列最大值归一化并兜底 12%，
 * 于是"6 次同重量"和"进步 20%"长得一模一样（PM 深评 P0-1）。
 * 折线 + 水平基线，全程同重量时画成一条直线，方向一眼可读。
 */
.lift__chart {
  position: relative;
  display: block;
  height: 44px;
  /* 跟随主题：浅色深线、深色浅线 */
  color: var(--text);
}

.lift__chart svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.lift__line {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.lift__area {
  fill: currentColor;
  opacity: 0.1;
}

.lift__minmax {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  font-size: 10px;
  line-height: 1;
  color: var(--text-3);
  pointer-events: none;
  opacity: 0.85;
}

.lift__detail {
  padding-top: 4px;
  border-top: 1px solid var(--line);
}

.suggest {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 0;
}

.suggest .dot {
  margin-top: 6px;
  background: var(--surface-ink);
}

.recent__body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}
</style>

















