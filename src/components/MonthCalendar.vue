<script setup lang="ts">
/**
 * 月历网格。
 *
 * 只负责画格子与发点击事件，状态判定全部来自 domain/calendar，
 * 避免"月历自己算一套"导致和周视图对不上。
 */
import { parseBusinessDate } from '../domain/units';
import type { MonthCell } from '../domain/calendar';

defineProps<{ cells: MonthCell[]; today: string }>();
const emit = defineEmits<{ (e: 'select', cell: MonthCell): void }>();

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const;

const TONE: Record<MonthCell['primary'], string> = {
  done: 'is-done',
  in_progress: 'is-live',
  partial: 'is-partial',
  excused: 'is-excused',
  missed: 'is-missed',
  scheduled: 'is-scheduled',
  rest: 'is-rest',
};

function dayNum(date: string): number {
  return parseBusinessDate(date).getDate();
}
</script>

<template>
  <div class="mcal">
    <div class="mcal__week">
      <span v-for="w in WEEKDAYS" :key="w" class="mcal__wd">{{ w }}</span>
    </div>
    <div class="mcal__grid">
      <button
        v-for="cell in cells"
        :key="cell.date"
        class="mcal__cell"
        :class="[TONE[cell.primary], { 'is-out': !cell.inMonth, 'is-today': cell.date === today }]"
        :aria-label="`${cell.date} ${cell.primary}`"
        @click="emit('select', cell)"
      >
        <span class="mcal__num">{{ dayNum(cell.date) }}</span>
        <span class="mcal__dot" />
      </button>
    </div>
    <div class="mcal__legend">
      <span class="lg"><i class="lg__dot lg--done" />完成</span>
      <span class="lg"><i class="lg__dot lg--scheduled" />待训练</span>
      <span class="lg"><i class="lg__dot lg--missed" />未完成</span>
      <span class="lg"><i class="lg__dot lg--excused" />豁免</span>
    </div>
  </div>
</template>

<style scoped>
.mcal {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mcal__week {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
}

.mcal__wd {
  text-align: center;
  font-size: 10.5px;
  color: var(--text-3);
  font-weight: 560;
}

.mcal__grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
}

.mcal__cell {
  position: relative;
  min-height: 46px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border-radius: 12px;
  background: var(--card);
  border: 1px solid var(--line);
  transition: transform 0.16s var(--ease-spring);
}

.mcal__cell:active {
  transform: scale(0.94);
}

.mcal__num {
  font-size: 13.5px;
  font-weight: 620;
  letter-spacing: -0.02em;
  line-height: 1;
}

.mcal__dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: transparent;
}

/* 相邻月的补位格只作参照，不参与状态着色，避免"上个月的完成"看着像这个月。
   必须放在所有状态样式之后：同优先级下后定义的规则才会生效。 */
.mcal__cell.is-out {
  background: transparent;
  border-color: transparent;
  border-style: solid;
  color: var(--text-3);
  box-shadow: none;
}

.mcal__cell.is-out .mcal__dot {
  background: transparent;
  opacity: 0;
}

/* 完成 */
.mcal__cell.is-done {
  background: var(--surface-ink);
  border-color: transparent;
  color: var(--lime);
}

.mcal__cell.is-done .mcal__dot {
  background: var(--lime);
}

/* 进行中 */
.mcal__cell.is-live {
  background: var(--lime);
  border-color: transparent;
  color: var(--lime-ink);
}

.mcal__cell.is-live .mcal__dot {
  background: var(--lime-ink);
}

/* 待训练 */
.mcal__cell.is-scheduled {
  border-color: var(--line-strong);
}

.mcal__cell.is-scheduled .mcal__dot {
  background: var(--surface-ink);
  opacity: 0.5;
}

/* 未完成 / 部分完成 */
.mcal__cell.is-missed,
.mcal__cell.is-partial {
  border-color: rgba(226, 87, 44, 0.45);
  border-style: dashed;
}

.mcal__cell.is-missed .mcal__dot,
.mcal__cell.is-partial .mcal__dot {
  background: var(--clay);
}

.mcal__cell.is-partial {
  background: var(--clay-soft);
}

/* 豁免 */
.mcal__cell.is-excused {
  background: var(--sky-soft);
  border-color: transparent;
}

.mcal__cell.is-excused .mcal__dot {
  background: var(--sky-ink);
}

.mcal__cell.is-today {
  box-shadow: inset 0 0 0 1.6px var(--text);
}

/* 补位格最后覆盖一次，确保上面的状态色不会漏出来 */
.mcal__cell.is-out,
.mcal__cell.is-out.is-done,
.mcal__cell.is-out.is-live,
.mcal__cell.is-out.is-missed,
.mcal__cell.is-out.is-partial,
.mcal__cell.is-out.is-excused,
.mcal__cell.is-out.is-scheduled {
  background: transparent;
  border-color: transparent;
  border-style: solid;
  color: var(--text-3);
  box-shadow: none;
}

.mcal__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 6px;
  padding: 0 2px;
}

.lg {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  color: var(--text-3);
}

.lg__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}

.lg--done {
  background: var(--surface-ink);
}

.lg--scheduled {
  background: var(--line-strong);
}

.lg--missed {
  background: var(--clay);
}

.lg--excused {
  background: var(--sky-ink);
}
</style>




