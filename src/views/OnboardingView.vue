<script setup lang="ts">
/**
 * 首次使用引导。
 *
 * 解决的问题（产品评审 §2.3）：新用户打开就看到 42 场"历史训练"和 289.5k kg 容量，
 * 会误以为那是自己的数据。之前 seed 把 onboarded 直接设为 true，
 * 等于宣称"用户已完成引导"，而实际上从没引导过。
 */
import { computed, ref } from 'vue';
import { store } from '../store/appStore';
import { TEMPLATES } from '../content/exercises';

const step = ref(0);

/*
 * 每周训练次数。
 *
 * 0 表示「自己安排」（不绑定模板）。
 *
 * 这个数字同时决定两件事：写进 weeklyGoal，并**推导出用哪套计划**。
 * 之前是分开问的——先选计划（模板自带每周 N 天），再单独问每周几次，
 * 同一件事问两遍，两个答案还可能打架（选 4 天计划却说练 3 次）。
 * 主流健身 App 都是「频率驱动计划」：先问一周几练，再给对应方案。
 */
const FREQ_OPTIONS = [
  { n: 2, label: '2' },
  { n: 3, label: '3' },
  { n: 4, label: '4' },
  { n: 0, label: '自定' },
] as const;
const weeklyGoal = ref(4);

/** 由频率推导出的计划；0 表示不排计划。 */
const matchedTemplate = computed(() =>
  weeklyGoal.value === 0 ? null : (TEMPLATES.find((t) => t.daysPerWeek === weeklyGoal.value) ?? null),
);
const chosenTemplate = computed(() => matchedTemplate.value?.id ?? '');

const planTitle = computed(() => {
  const t = matchedTemplate.value;
  if (weeklyGoal.value === 0) return '不预排计划，自己安排';
  return t ? t.title : `每周 ${weeklyGoal.value} 次（暂无对应模板）`;
});
const planHint = computed(() => {
  const t = matchedTemplate.value;
  if (weeklyGoal.value === 0) return '每次开训时自己挑动作，之后也能在「训练」里换计划。';
  return t ? t.subtitle : '可以先用空白训练，之后在「训练」里自建计划。';
});
const keepDemo = ref(true);

/*
 * 第四步：可选目标。
 *
 * 为什么不放前面：基线文档要求"无需填写身高体重即可开始记录训练"。
 * 一上来就问体重，会劝退一部分人；放在最后并允许跳过，
 * 既不挡路，又让用户知道有目标功能（此前完全没提，用户找不到）。
 */
const bodyGoalKg = ref('');
const strengthGoalKg = ref('');
const chosenLift = ref('bb-squat');

const emit = defineEmits<{ (e: 'done'): void }>();


const LIFT_OPTIONS = [
  { id: 'bb-squat', label: '杠铃深蹲' },
  { id: 'bench-press', label: '杠铃卧推' },
  { id: 'deadlift', label: '硬拉' },
] as const;

const bodyGoalNum = computed(() => {
  const n = Number.parseFloat(bodyGoalKg.value.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
});
const strengthGoalNum = computed(() => {
  const n = Number.parseFloat(strengthGoalKg.value.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
});

function finish(): void {
  store.completeOnboarding({
    templateId: chosenTemplate.value,
    weeklyGoal: weeklyGoal.value,
    keepDemoData: keepDemo.value,
    bodyGoalKg: bodyGoalNum.value,
    strengthGoal: strengthGoalNum.value ? { exerciseId: chosenLift.value, targetKg: strengthGoalNum.value } : null,
  });
  emit('done');
}
</script>

<template>
  <div class="onb">
    <div class="onb__card">
      <div class="onb__mark">练</div>

      <template v-if="step === 0">
        <p class="label">第一次使用</p>
        <h1 class="onb__title">先把一件事<br />记下来</h1>
        <p class="onb__text">
          练迹只做三件事：快速记下一组、可靠留住每次训练、让你看见进步。
          数据存在本机，不需要账号。
        </p>
        <div class="onb__demo">
          <p class="h3">你现在看到的是示例数据</p>
          <p class="tiny">
            为了让你直接体验界面，我们预置了 12 周训练记录。这些不是你的数据，
            导出或清空时会一并处理。
          </p>
        </div>
        <button class="btn btn--lime btn--block btn--lg" @click="step = 1">知道了，下一步</button>
      </template>

      <template v-else-if="step === 1">
        <p class="label">第二步</p>
        <h1 class="onb__title">每周练几次？</h1>
        <p class="onb__text">定一个你能做到的数字。做不到比定太高更伤信心。</p>

        <div class="onb__goals">
          <button
            v-for="opt in FREQ_OPTIONS"
            :key="opt.n"
            class="onb__goal"
            :class="{ 'is-on': weeklyGoal === opt.n }"
            @click="weeklyGoal = opt.n"
          >
            <span class="onb__goal-num">{{ opt.label }}</span>
            <span class="tiny">{{ opt.n === 0 ? '不排计划' : '次/周' }}</span>
          </button>
        </div>

        <!--
          频率决定计划：选了 3 次就自动用 3 天的推拉腿，不再单独问一遍"选哪套"。
          原来第 2 步选计划（自带每周 N 天）、第 3 步又问每周几次，
          同一个问题问两遍，而且两个答案可能互相矛盾。
        -->
        <div class="onb__plan">
          <p class="label">将使用</p>
          <p class="h3">{{ planTitle }}</p>
          <p class="tiny">{{ planHint }}</p>
        </div>

        <!--
          示例数据是两条明确的路径，而不是一个容易被忽略的勾选框：
          选"体验示例"会一直带着"示例数据"标记；选"从空白开始"才清空。
        -->
        <div class="onb__choice" :class="{ 'is-on': keepDemo }" role="button" tabindex="0" @click="keepDemo = true" @keydown.enter.prevent="keepDemo = true">
          <span>
            <span class="h3">体验示例数据</span>
            <span class="tiny">预置 12 周记录，先看界面怎么用；顶栏会标"示例数据"</span>
          </span>
        </div>
        <div class="onb__choice" :class="{ 'is-on': !keepDemo }" role="button" tabindex="0" @click="keepDemo = false" @keydown.enter.prevent="keepDemo = false">
          <span>
            <span class="h3">从空白开始</span>
            <span class="tiny">清空示例记录，直接记自己的（不可撤销）</span>
          </span>
        </div>

        <div class="row gap-10" style="margin-top: 16px">
          <button class="btn btn--ghost btn--block" @click="step = 0">上一步</button>
          <button class="btn btn--lime btn--block" @click="step = 2">下一步</button>
        </div>
      </template>

      <template v-else>
        <p class="label">最后一步 · 可跳过</p>
        <h1 class="onb__title">想练成什么样？</h1>
        <p class="onb__text">不填也能开始记录，之后在「我的」里随时补。</p>

        <div class="onb__optional">
          <label class="tiny onb__field-label">目标体重（kg）</label>
          <input v-model="bodyGoalKg" class="input" inputmode="decimal" placeholder="例如 72" />

          <label class="tiny onb__field-label">目标力量（kg）</label>
          <div class="onb__lift-row">
            <select v-model="chosenLift" class="input onb__lift-select">
              <option v-for="l in LIFT_OPTIONS" :key="l.id" :value="l.id">{{ l.label }}</option>
            </select>
            <input v-model="strengthGoalKg" class="input onb__lift-weight" inputmode="decimal" placeholder="例如 100" />
          </div>
        </div>

        <div class="row gap-10" style="margin-top: 16px">
          <button class="btn btn--ghost btn--block" @click="step = 1">上一步</button>
          <button class="btn btn--lime btn--block" @click="finish">开始使用</button>
        </div>
      </template>
    </div>
  </div>
</template>
<style scoped>
.onb {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: var(--paper);
  overflow-y: auto;
}

.onb__card {
  width: 100%;
  max-width: 380px;
  background: var(--paper-card);
  border-radius: 24px;
  padding: 26px 22px 24px;
  box-shadow: 0 24px 60px rgba(var(--ink-rgb), 0.12);
}

.onb__mark {
  width: 44px;
  height: 44px;
  border-radius: 13px;
  background: var(--surface-ink);
  color: var(--lime);
  display: grid;
  place-items: center;
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 18px;
}

.onb__title {
  font-size: 30px;
  line-height: 1.15;
  font-weight: 730;
  letter-spacing: -0.035em;
  margin: 10px 0 12px;
}

.onb__text {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-2);
  margin-bottom: 16px;
}

.onb__demo {
  padding: 13px 15px;
  border-radius: 16px;
  background: var(--warn-soft);
  color: var(--warn-ink);
  margin-bottom: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.onb__templates {
  display: flex;
  flex-direction: column;
  gap: 9px;
  max-height: 44vh;
  overflow-y: auto;
}

.onb__tpl {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 13px 15px;
  border-radius: 16px;
  border: 1.5px solid var(--line-strong);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.onb__tpl.is-on {
  border-color: var(--text);
  background: rgba(var(--ink-rgb), 0.04);
}

.onb__tpl-meta {
  color: var(--text-3);
}

.onb__goals {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 9px;
  margin: 16px 0;
}

.onb__goal {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 14px 0;
  border-radius: 16px;
  border: 1.5px solid var(--line-strong);
  background: transparent;
  cursor: pointer;
}

.onb__goal.is-on {
  border-color: var(--text);
  background: var(--surface-ink);
  color: var(--paper);
}

.onb__goal-num {
  font-size: 22px;
  font-weight: 700;
}

/* 计划预览：让用户看到"选 4 次"具体会得到什么，而不是盲选 */
.onb__plan {
  margin-top: 16px;
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(var(--ink-rgb), 0.04);
}

.onb__plan .h3 {
  margin-top: 2px;
}

.onb__plan .tiny {
  margin-top: 4px;
  color: var(--text-3);
}
.onb__keep,
.onb__choice {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 16px;
  border: 1.5px solid transparent;
  background: rgba(var(--ink-rgb), 0.03);
  cursor: pointer;
  text-align: left;
  width: 100%;
}

/* 选中的路径用描边标出，两条路一眼可分 */
.onb__choice.is-on {
  border-color: var(--text);
}

.onb__keep > span,
.onb__choice > span {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.onb__choice + .onb__choice {
  margin-top: 10px;
}

.onb__check {
  width: 20px;
  height: 20px;
  margin-top: 1px;
  accent-color: var(--text);
  flex: none;
}
.onb__optional {
  margin-top: 16px;
  padding: 14px;
  border-radius: 16px;
  background: rgba(var(--ink-rgb), 0.035);
}

.onb__opt-hint {
  margin-top: 4px;
  color: var(--text-3);
  line-height: 1.5;
}

.onb__field-label {
  display: block;
  margin-top: 12px;
}

.onb__lift-row {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 8px;
  margin-top: 6px;
}

.onb__lift-select,
.onb__lift-weight {
  min-width: 0;
  width: 100%;
}

.onb__optional .input {
  margin-top: 6px;
}
</style>













