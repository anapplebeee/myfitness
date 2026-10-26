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
import { useSheetBack } from '../composables/useBackLayer';
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

// 返回键/边缘返回先关目标面板
useSheetBack(pickerOpen, () => { pickerOpen.value = false; });

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

/**
 * 按类型分组。
 *
 * 之前面板只列出"已经设过的目标"，只设了体重时就只剩一条，
 * 用户会以为这个应用只能设体重目标。改成三类恒常展示：
 * 没设的那类显示成可点的空状态，能力一眼可见。
 */
const groups = computed(() => [
  {
    kind: 'bodyweight' as const,
    label: '体重',
    hint: '减脂 / 增重，按最近体重算进度',
    empty: '还没设目标体重',
    rows: rows.value.filter((r) => r.goal.kind === 'bodyweight'),
  },
  {
    kind: 'strength' as const,
    label: '力量',
    hint: '某个动作要做到多重，按历史最佳单组算',
    empty: '还没设力量目标',
    rows: rows.value.filter((r) => r.goal.kind === 'strength'),
  },
  {
    kind: 'frequency' as const,
    label: '频率',
    hint: '每周练几次，按最近 4 周平均算',
    empty: '还没设频率目标',
    rows: rows.value.filter((r) => r.goal.kind === 'frequency'),
  },
]);
</script>

<template>
  <section class="card goals">
    <div class="row between">
      <p class="label">目标</p>
      <button class="btn btn--ghost btn--sm" @click="openPicker()">设定目标</button>
    </div>

    <div v-for="g in groups" :key="g.kind" class="goalgroup">
      <div class="goalgroup__head">
        <span class="goalgroup__name">{{ g.label }}</span>
        <span class="tiny goalgroup__hint">{{ g.hint }}</span>
      </div>

      <button v-if="!g.rows.length" class="goalslot" @click="openPicker(g.kind)">
        <span class="goalslot__plus">+</span>
        <span class="goalslot__text">{{ g.empty }}</span>
        <span class="goalslot__cta">去设定</span>
      </button>

      <div v-for="r in g.rows" :key="r.key" class="goal">
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

      <button v-if="g.rows.length && g.kind === 'strength'" class="goalslot goalslot--slim" @click="openPicker('strength')">
        <span class="goalslot__plus">+</span>
        <span class="goalslot__text">再加一个动作</span>
      </button>
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

.goalgroup {
  margin-top: 16px;
}

.goalgroup__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}

.goalgroup__name {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--text);
}

.goalgroup__hint {
  color: var(--text-3);
  line-height: 1.3;
}

/* 未设定的一类：虚线空槽，点一下直接去设，避免"只有体重"的错觉 */
.goalslot {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 11px 13px;
  border-radius: 14px;
  border: 1px dashed var(--line-strong);
  background: transparent;
  text-align: left;
}

.goalslot--slim {
  margin-top: 8px;
  padding: 8px 12px;
}

.goalslot__plus {
  width: 20px;
  height: 20px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  background: rgba(var(--ink-rgb), 0.06);
  font-size: 13px;
  font-weight: 700;
  color: var(--text-2);
  flex: none;
}

.goalslot__text {
  flex: 1;
  font-size: 12.5px;
  color: var(--text-2);
}

.goalslot__cta {
  font-size: 12px;
  font-weight: 640;
  color: var(--text);
}

.goal {
  margin-top: 14px;
  padding: 13px 15px;
  border-radius: 16px;
  background: rgba(var(--ink-rgb), 0.03);
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
  color: var(--lime-ink);
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
  background: rgba(var(--ink-rgb), 0.08);
  margin-top: 12px;
  overflow: hidden;
}

.goal__fill {
  height: 100%;
  border-radius: 999px;
  background: var(--surface-ink);
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
  background: var(--surface-ink);
  border-color: var(--text);
  color: var(--paper);
}
</style>




