<script setup lang="ts">
/**
 * 本周各部位组数。
 *
 * 为什么放在教练页：容量（sets×reps×kg）回答不了"这周胸做了几组、背做了几组"，
 * 而肌群组数是判断"练够没有、练偏没有"最直接的口径。
 * 教练真正会问的就是这句。
 *
 * 设计取舍：
 * - 只列本周练过的部位，不铺 8 行 0 组
 * - 用条长表示相对量，最大值为满格（避免"永远差一点"的挫败感）
 * - 组数带数字，图只是辅助
 */
import { computed } from 'vue';
import { store } from '../store/appStore';
import { currentWeekStart } from '../domain/week';
import { totalMuscleSets, weeklyMuscleSets } from '../domain/muscle-volume';
import { mondayOf } from '../domain/plan';
import { isValidCompleted } from '../domain/metrics';
import { shortDate } from '../domain/units';

/*
 * 本周没有记录时，退回"最近有数据的那一周"。
 *
 * 否则刚装 App 的人（以及用示例数据的人）永远看不到这张卡——
 * 功能存在但永远不出现，等于没做。
 */
const weekStart = computed(() => {
  const now = currentWeekStart();
  if (weeklyMuscleSets(store.state, now).length > 0) return now;
  const lastDate = store.state.sessions
    .filter((s) => isValidCompleted(s))
    .map((s) => s.businessDate)
    .sort()
    .pop();
  return lastDate ? mondayOf(lastDate) : now;
});

const rows = computed(() => weeklyMuscleSets(store.state, weekStart.value));
const isCurrent = computed(() => weekStart.value === currentWeekStart());
const total = computed(() => totalMuscleSets(rows.value));
const max = computed(() => rows.value[0]?.sets ?? 0);
</script>

<template>
  <section v-if="rows.length" class="card mb">
    <div class="row between">
      <div>
        <p class="label">{{ isCurrent ? '本周部位分布' : '最近一周部位分布' }}</p>
        <p class="tiny mb__sub">
          {{ isCurrent ? '' : `${shortDate(weekStart)} 那一周 · ` }}按已完成的工作组统计，热身不算
        </p>
      </div>
      <span class="chip chip--sm">{{ total }} 组</span>
    </div>

    <div class="mb__rows">
      <div v-for="r in rows" :key="r.group" class="mb__row">
        <span class="tiny mb__name">{{ r.label }}</span>
        <span class="mb__bar">
          <span class="mb__fill" :style="{ width: `${max > 0 ? (r.sets / max) * 100 : 0}%` }" />
        </span>
        <span class="tiny mb__num">{{ r.sets }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.mb__sub {
  color: var(--text-3);
  margin-top: 2px;
}

.mb__rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}

.mb__row {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 28px;
  align-items: center;
  gap: 10px;
}

.mb__name {
  color: var(--text-2);
}

.mb__bar {
  height: 8px;
  border-radius: 999px;
  background: rgba(var(--ink-rgb), 0.07);
  overflow: hidden;
}

.mb__fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--lime);
}

.mb__num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--text-2);
}
</style>
