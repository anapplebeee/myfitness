<script setup lang="ts">
/**
 * 本周小结。
 *
 * 放在教练页顶部：这是用户"回头看进步"的地方，
 * 而单次训练记录给不了"我比上个月强了多少"这个答案。
 *
 * 设计取舍：
 * - 只显示 4 个数字，不铺图表——周报的价值在结论，不在数据量
 * - 与上周对比用百分比 + 箭头，但上周为 0 时不显示（避免 +100% 的假涨幅）
 * - 没设周目标时不显示完成率，而不是显示 0%
 */
import { computed } from 'vue';
import { store } from '../store/appStore';
import { currentWeekStart } from '../domain/week';
import { bestLiftName, buildWeeklyReport, changePct, trendOf } from '../domain/report';
import { formatVolume, formatLoad, shortDate } from '../domain/units';

const report = computed(() => buildWeeklyReport(store.state, currentWeekStart()));

const bestName = computed(() => bestLiftName(report.value));

/** 三项对比：次数、容量、组数。 */
const stats = computed(() => {
  const r = report.value;
  // 周中不显示环比：见 report.ts 里 inProgress 的说明
  return [
    { key: 'sessions', label: '训练', value: String(r.sessions), unit: '次', pct: changePct(r.sessions, r.prevSessions), trend: trendOf(r.sessions, r.prevSessions) },
    { key: 'volume', label: '容量', value: formatVolume(r.volumeGrams, 'kg'), unit: '', pct: changePct(r.volumeGrams, r.prevVolumeGrams), trend: trendOf(r.volumeGrams, r.prevVolumeGrams) },
    { key: 'sets', label: '工作组', value: String(r.sets), unit: '组', pct: changePct(r.sets, r.prevSets), trend: trendOf(r.sets, r.prevSets) },
  ];
});

/** 完成率百分比，没有目标时为 null。 */
const goalPct = computed(() => (report.value.goalRate === null ? null : Math.round(report.value.goalRate * 100)));
</script>

<template>
  <section class="card wr">
    <div class="row between">
      <div>
        <p class="label">本周小结</p>
        <p class="tiny wr__range">
          {{ shortDate(report.from) }} – {{ shortDate(report.to) }}
          <span v-if="report.inProgress" class="wr__live">· 进行中</span>
        </p>
      </div>
      <span v-if="report.prCount > 0" class="chip chip--lime chip--sm">
        {{ report.prCount }} 项新纪录
      </span>
    </div>

    <div class="wr__stats">
      <div v-for="s in stats" :key="s.key" class="wr__cell">
        <p class="tiny wr__cell-label">{{ s.label }}</p>
        <p class="wr__cell-value">
          {{ s.value }}<span v-if="s.unit" class="wr__cell-unit">{{ s.unit }}</span>
        </p>
        <!--
          只在上周有数据时才给环比。上周为 0 时显示"首次"会更好，
          但这里空间有限，留白比一个假的 +100% 更诚实。
        -->
        <p v-if="!report.inProgress && s.pct !== null" class="tiny wr__delta" :class="`is-${s.trend}`">
          {{ s.pct > 0 ? '+' : '' }}{{ s.pct }}%
        </p>
      </div>
    </div>

    <div v-if="goalPct !== null" class="wr__goal">
      <div class="row between">
        <span class="tiny">周目标</span>
        <span class="tiny wr__goal-num">{{ goalPct }}%</span>
      </div>
      <div class="bar"><div class="bar__fill" :style="{ width: `${goalPct}%` }" /></div>
    </div>

    <p v-if="bestName && report.bestLift" class="tiny wr__best">
      本周最重：{{ bestName }} {{ formatLoad(report.bestLift.loadGrams, 'kg') }} × {{ report.bestLift.reps }}
    </p>

    <p v-else-if="report.sessions === 0" class="tiny wr__best">
      本周还没有训练记录。记下第一组，下周这里就会有对比。
    </p>
  </section>
</template>

<style scoped>
.wr__range {
  color: var(--text-3);
  margin-top: 2px;
}

.wr__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.wr__cell {
  min-width: 0;
}

.wr__cell-label {
  color: var(--text-3);
}

.wr__cell-value {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  margin-top: 2px;
}

.wr__cell-unit {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-3);
  margin-left: 2px;
}

.wr__delta {
  margin-top: 2px;
  font-variant-numeric: tabular-nums;
}

.wr__delta.is-up {
  color: var(--lime-ink);
}

.wr__delta.is-down {
  color: var(--clay);
}

.wr__delta.is-flat {
  color: var(--text-3);
}

.wr__goal {
  margin-top: 16px;
}

.wr__goal-num {
  font-variant-numeric: tabular-nums;
  color: var(--text-2);
}

.wr__goal .bar {
  margin-top: 6px;
}

.wr__best {
  margin-top: 12px;
  color: var(--text-2);
}
.wr__live {
  color: var(--lime-ink);
}
</style>



