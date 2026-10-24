<script setup lang="ts">
import { computed, ref } from 'vue';
import { store } from '../store/appStore';
import { exerciseName, exerciseGroup, MUSCLES, TEMPLATE_BY_ID } from '../content/exercises';
import { formatLoad, formatVolume } from '../domain/units';
import {
  bestSet,
  isValidCompleted,
  lastExerciseSets,
  sessionVolumeGrams,
} from '../domain/metrics';

defineProps<{ greetingName?: string }>();

const unit = ref<'kg' | 'lb'>('kg');
const openId = ref<string | null>(null);

const sessions = computed(() =>
  [...store.state.sessions].filter(isValidCompleted).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)),
);

interface ExerciseRow {
  exerciseId: string;
  bestGrams: number;
  lastReps: number;
  series: number[];
  changePct: number;
}

const exercises = computed<ExerciseRow[]>(() => {
  const map = new Map<string, number[]>();
  for (const s of [...sessions.value].reverse()) {
    for (const ex of s.exercises) {
      const top = ex.sets
        .filter((x) => x.kind === 'work' && x.status === 'completed' && x.loadGrams)
        .reduce((max, x) => Math.max(max, x.loadGrams ?? 0), 0);
      if (!top) continue;
      const list = map.get(ex.exerciseId) ?? [];
      list.push(top / 1000);
      map.set(ex.exerciseId, list);
    }
  }
  return [...map.entries()]
    .map(([exerciseId, series]) => {
      const best = bestSet([...sessions.value], exerciseId);
      const recent = series.slice(-6);
      const first = recent[0] ?? 0;
      const last = recent[recent.length - 1] ?? 0;
      return {
        exerciseId,
        bestGrams: best?.loadGrams ?? 0,
        lastReps: best?.reps ?? 0,
        series: recent,
        changePct: first > 0 ? Math.round(((last - first) / first) * 100) : 0,
      };
    })
    .sort((a, b) => b.series.length - a.series.length);
});

const topPrs = computed(() =>
  exercises.value
    .slice()
    .sort((a, b) => b.bestGrams - a.bestGrams)
    .slice(0, 5),
);

const template = computed(() =>
  store.state.activeTemplateId ? TEMPLATE_BY_ID.get(store.state.activeTemplateId) ?? null : null,
);

const totalVolume = computed(() => formatVolume(sessions.value.reduce((s, x) => s + sessionVolumeGrams(x), 0), unit.value));

const suggestions = computed(() => {
  const out: Array<{ exerciseId: string; text: string }> = [];
  for (const row of exercises.value.slice(0, 3)) {
    const hist = lastExerciseSets([...sessions.value], row.exerciseId, null);
    const top = hist.reduce((max, s) => Math.max(max, s.loadGrams ?? 0), 0);
    if (!top) continue;
    const next = Math.round((top + 2500) / 2500) * 2500;
    out.push({
      exerciseId: row.exerciseId,
      text: `下次可尝试 ${formatLoad(next, unit.value)}（上次 ${formatLoad(top, unit.value)}）`,
    });
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

    <section class="card card--ink coach__hero">
      <div class="coach__hero-top">
        <div>
          <p class="label">累计训练容量</p>
          <p class="coach__volume">{{ totalVolume }}</p>
          <p class="tiny coach__hero-sub">{{ sessions.length }} 场训练 · 全部来自本机记录</p>
        </div>
        <span class="chip chip--lime chip--sm">可比较工作组</span>
      </div>
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
        <span class="tiny">最近 6 次</span>
      </div>
      <div class="stack gap-8">
        <button v-for="row in exercises" :key="row.exerciseId" class="card lift" @click="toggle(row.exerciseId)">
          <span class="lift__head">
            <span class="recent__body">
              <span class="h3">{{ exerciseName(row.exerciseId) }}</span>
              <span class="tiny">{{ formatLoad(row.bestGrams, unit) }} × {{ row.lastReps }}</span>
            </span>
            <span class="lift__change" :class="row.changePct >= 0 ? 'is-up' : 'is-down'">
              {{ row.changePct >= 0 ? '+' : '' }}{{ row.changePct }}%
            </span>
          </span>
          <span class="lift__bars">
            <span
              v-for="(v, i) in row.series"
              :key="i"
              class="lift__bar"
              :style="{ height: `${Math.max(12, (v / Math.max(...row.series)) * 100)}%` }"
            />
          </span>
          <span v-if="openId === row.exerciseId" class="lift__detail">
            <span class="tiny">
              首次 {{ row.series[0]?.toFixed(1) }} kg → 最近 {{ row.series[row.series.length - 1]?.toFixed(1) }} kg，
              {{ row.changePct >= 0 ? '保持上升' : '需要调整' }}。
            </span>
          </span>
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
  background: radial-gradient(120% 100% at 100% 0%, #26301f 0%, var(--ink) 58%);
}

.coach__hero-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
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
  color: rgba(244, 246, 238, 0.5);
}

.coach__unit {
  max-width: 140px;
  margin-top: 16px;
  background: rgba(244, 246, 238, 0.1);
}

.coach__unit .seg__item {
  color: rgba(244, 246, 238, 0.6);
}

.coach__unit .seg__item.is-on {
  background: var(--lime);
  color: var(--ink);
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

.lift__bars {
  display: flex;
  align-items: flex-end;
  gap: 5px;
  height: 54px;
}

.lift__bar {
  flex: 1;
  border-radius: 5px 5px 3px 3px;
  background: linear-gradient(180deg, var(--ink) 0%, rgba(17, 20, 17, 0.35) 100%);
  transition: height 0.5s var(--ease-out);
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
  background: var(--ink);
}

.recent__body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}
</style>



