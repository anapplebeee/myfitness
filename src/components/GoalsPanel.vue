<script setup lang="ts">
/**
 * 目标设定与进度。
 *
 * 产品评审指出"没有目标就没有坚持的理由"。此面板让用户可以设：
 * - 体重目标（增重/减重方向自动判断）
 * - 力量目标（选定动作 + 目标重量）
 * - 频率目标（每周训练次数）
 */
import { computed, ref } from 'vue';
import { store } from '../store/appStore';
import { useToast } from '../composables/useToast';
import { EXERCISES, exerciseName } from '../content/exercises';
import { businessDate } from '../domain/units';
import {
  goalLabel,
  goalProgress,
  isOverdue,
  type Goal,
  type GoalKind,
  type GoalProgress,
} from '../domain/goals';

const { push } = useToast();

const today = businessDate();
const pickerOpen = ref(false);
const kind = ref<GoalKind>('bodyweight');
const targetKg = ref('');
const targetExercise = ref('bb-squat');
const targetDate = ref('');
const keyword = ref('');

const latestWeight = computed(() => {
  const list = [...store.state.weights].sort((a, b) => (a.date < b.date ? 1 : -1));
  return list[0] ?? null;
});

const goals = computed(() => store.state.goals);

/** 所有目标的进度。 */
const rows = computed(() =>
  goals.value.map((g) => {
    const progress = goalProgress(g, {
      currentWeightGrams: latestWeight.value?.grams ?? null,
      sessions: [...store.state.sessions],
      today,
    });
    return {
      goal: g,
      progress,
      label: goalLabel(g, exerciseName),
      overdue: isOverdue(g, today, progress),
      key: g.kind === 'strength' ? `strength_${g.exerciseId}` : g.kind,
    };
  }),
);

const filteredExercises = computed(() => {
  const q = keyword.value.trim();
  const list = EXERCISES.filter((e) => e.mode === 'load_reps');
  if (!q) return list.slice(0, 30);
  return list.filter((e) => e.name.includes(q)).slice(0, 30);
});

function openPicker(initial: GoalKind = 'bodyweight'): void {
  kind.value = initial;
  targetKg.value = '';
  targetDate.value = '';
  keyword.value = '';
  // 预填当前体重作为起点提示
  const w = latestWeight.value;
  if (initial === 'bodyweight' && w) targetKg.value = String(Math.round((w.grams / 1000) * 10) / 10);
  pickerOpen.value = true;
}

function submit(): void {
  const kg = Number.parseFloat(targetKg.value.replace(',', '.'));
  if (!Number.isFinite(kg) || kg <= 0) {
    push('请填写有效数值', 'error');
    return;
  }

  let goal: Goal;
  if (kind.value === 'bodyweight') {
    goal = {
      kind: 'bodyweight',
      targetGrams: Math.round(kg * 1000),
      startGrams: latestWeight.value?.grams ?? null,
      targetDate: targetDate.value || null,
      createdAt: new Date().toISOString(),
    };
  } else if (kind.value === 'strength') {
    goal = {
      kind: 'strength',
      exerciseId: targetExercise.value,
      targetGrams: Math.round(kg * 1000),
      targetDate: targetDate.value || null,
      createdAt: new Date().toISOString(),
    };
  } else {
    goal = { kind: 'frequency', perWeek: Math.round(kg), createdAt: new Date().toISOString() };
  }

  const err = store.setGoal(goal);
  if (err) {
    push(err, 'error');
    return;
  }
  pickerOpen.value = false;
  push('目标已保存', 'success');
}

function remove(key: string, g: Goal): void {
  store.removeGoal(g.kind, g.kind === 'strength' ? g.exerciseId : undefined);
  push('已删除目标');
  void key;
}

function pct(p: GoalProgress): number {
  return Math.round(p.ratio * 100);
}
</script>

<template>
  <section class="card goals">
    <div class="row between">
      <p class="label">目标</p>
      <button class="btn btn--ghost btn--sm" @click="openPicker()">设定目标</button>
    </div>

    <p v-if="!rows.length" class="small goals__empty">
      还没有目标。定一个能判断"达成没达成"的数字——比如体重到多少、某个动作做到多重、每周练几次。
    </p>

    <div v-for="r in rows" :key="r.key" class="goal">
      <div class="goal__head">
        <div>
          <p class="h3">{{ r.label }}</p>
          <p class="tiny goal__status" :class="{ 'is-done': r.progress.achieved, 'is-late': r.overdue }">
            {{ r.progress.text }}
          </p>
        </div>
        <button class="icon-btn goal__del" aria-label="删除目标" @click="remove(r.key, r.goal)">✕</button>
      </div>

      <div class="goal__bar">
        <div class="goal__fill" :class="{ 'is-done': r.progress.achieved }" :style="{ width: `${pct(r.progress)}%` }" />
      </div>

      <div class="goal__foot">
        <span class="tiny">{{ r.progress.current }}{{ r.progress.unit }} / {{ r.progress.target }}{{ r.progress.unit }}</span>
        <span class="tiny">{{ pct(r.progress) }}%</span>
      </div>

      <p v-if="r.overdue" class="tiny goal__overdue">
        已超过目标日期，仍未达成。可以改目标或延长日期。
      </p>
    </div>

    <Transition name="sheet">
      <div v-if="pickerOpen" class="sheet" @click.self="pickerOpen = false">
        <div class="sheet__panel">
          <div class="sheet__head">
            <div>
              <p class="label">新目标</p>
              <h2 class="h2">设定一个能验证的目标</h2>
            </div>
            <button class="icon-btn" aria-label="关闭" @click="pickerOpen = false">✕</button>
          </div>

          <div class="seg" style="margin-bottom: 14px">
            <button class="seg__item" :class="{ 'is-on': kind === 'bodyweight' }" @click="kind = 'bodyweight'">体重</button>
            <button class="seg__item" :class="{ 'is-on': kind === 'strength' }" @click="kind = 'strength'">力量</button>
            <button class="seg__item" :class="{ 'is-on': kind === 'frequency' }" @click="kind = 'frequency'">频率</button>
          </div>

          <template v-if="kind === 'strength'">
            <label class="tiny">动作</label>
            <input v-model="keyword" class="input" type="search" placeholder="搜索动作" style="margin: 6px 0 8px" />
            <div class="goals__exlist">
              <button
                v-for="e in filteredExercises"
                :key="e.id"
                class="goals__exitem"
                :class="{ 'is-on': targetExercise === e.id }"
                @click="targetExercise = e.id"
              >
                {{ e.name }}
              </button>
            </div>
          </template>

          <label class="tiny" style="display: block; margin-top: 12px">
            {{ kind === 'bodyweight' ? '目标体重 (kg)' : kind === 'strength' ? '目标重量 (kg)' : '每周次数' }}
          </label>
          <input v-model="targetKg" class="input" inputmode="decimal" style="margin-top: 6px" placeholder="75" />

          <template v-if="kind !== 'frequency'">
            <label class="tiny" style="display: block; margin-top: 12px">目标日期（可选）</label>
            <input v-model="targetDate" class="input" type="date" style="margin-top: 6px" />
          </template>

          <p class="tiny" style="margin-top: 12px; color: var(--text-2)">
            {{ kind === 'bodyweight'
              ? '进度按你最近的体重记录计算。增重或减重方向会自动判断。'
              : kind === 'strength'
                ? '进度按该动作历史最佳单组重量计算。'
                : '进度按最近 4 周平均每周训练次数计算，不是只看本周。' }}
          </p>

          <button class="btn btn--lime btn--block" style="margin-top: 16px" @click="submit">保存目标</button>
        </div>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.goals__empty {
  margin-top: 10px;
  line-height: 1.55;
  color: var(--text-2);
}

.goal {
  margin-top: 14px;
  padding: 13px 15px;
  border-radius: 16px;
  background: rgba(17, 20, 17, 0.03);
}

.goal__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.goal__status {
  margin-top: 3px;
  color: var(--text-2);
}

.goal__status.is-done {
  color: #4a7a1f;
}

.goal__status.is-late {
  color: var(--clay);
}

.goal__del {
  flex: none;
  opacity: 0.4;
}

.goal__bar {
  height: 8px;
  border-radius: 999px;
  background: rgba(17, 20, 17, 0.08);
  margin-top: 12px;
  overflow: hidden;
}

.goal__fill {
  height: 100%;
  border-radius: 999px;
  background: var(--ink);
  transition: width 0.3s ease;
}

.goal__fill.is-done {
  background: var(--lime);
}

.goal__foot {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  color: var(--text-3);
}

.goal__overdue {
  margin-top: 8px;
  color: var(--clay);
  line-height: 1.45;
}

.goals__exlist {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  max-height: 26vh;
  overflow-y: auto;
}

.goals__exitem {
  padding: 7px 12px;
  border-radius: 999px;
  border: 1.5px solid var(--line-strong);
  background: transparent;
  font-size: 12.5px;
  cursor: pointer;
}

.goals__exitem.is-on {
  background: var(--ink);
  border-color: var(--ink);
  color: var(--paper);
}
</style>
