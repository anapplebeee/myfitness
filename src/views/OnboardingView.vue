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
const chosenTemplate = ref<string>(TEMPLATES[2]?.id ?? TEMPLATES[0]!.id);
const weeklyGoal = ref(3);
// 默认保留：清空是不可逆操作，不该是默认选项。
// 用户想从零开始可以主动取消勾选。
const keepDemo = ref(true);

const emit = defineEmits<{ (e: 'done'): void }>();

const templateOptions = computed(() =>
  TEMPLATES.map((t) => ({ id: t.id, title: t.title, subtitle: t.subtitle, days: t.daysPerWeek })),
);

function finish(): void {
  store.completeOnboarding({
    templateId: chosenTemplate.value,
    weeklyGoal: weeklyGoal.value,
    keepDemoData: keepDemo.value,
  });
  emit('done');
}
</script>

<template>
  <div class="onb">
    <div class="onb__card">
      <div class="onb__mark">铁</div>

      <template v-if="step === 0">
        <p class="label">第一次使用</p>
        <h1 class="onb__title">先把一件事<br />记下来</h1>
        <p class="onb__text">
          铁馆只做三件事：快速记下一组、可靠留住每次训练、让你看见进步。
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
        <h1 class="onb__title">选一套训练计划</h1>
        <p class="onb__text">之后随时可以换，也可以自己改。</p>
        <div class="onb__templates">
          <button
            v-for="t in templateOptions"
            :key="t.id"
            class="onb__tpl"
            :class="{ 'is-on': chosenTemplate === t.id }"
            @click="chosenTemplate = t.id"
          >
            <span class="h3">{{ t.title }}</span>
            <span class="tiny">{{ t.subtitle }}</span>
            <span class="tiny onb__tpl-meta">每周 {{ t.days }} 天</span>
          </button>
        </div>
        <div class="row gap-10" style="margin-top: 16px">
          <button class="btn btn--ghost btn--block" @click="step = 0">上一步</button>
          <button class="btn btn--lime btn--block" @click="step = 2">下一步</button>
        </div>
      </template>

      <template v-else>
        <p class="label">最后一步</p>
        <h1 class="onb__title">每周练几次？</h1>
        <p class="onb__text">定一个你能做到的数字。做不到比定太高更伤信心。</p>

        <div class="onb__goals">
          <button
            v-for="n in [2, 3, 4, 5]"
            :key="n"
            class="onb__goal"
            :class="{ 'is-on': weeklyGoal === n }"
            @click="weeklyGoal = n"
          >
            <span class="onb__goal-num">{{ n }}</span>
            <span class="tiny">次/周</span>
          </button>
        </div>

        <label class="onb__keep">
          <input v-model="keepDemo" type="checkbox" class="onb__check" />
          <span>
            <span class="h3">保留示例数据</span>
            <span class="tiny">取消勾选会清空示例记录，从零开始（不可撤销）</span>
          </span>
        </label>

        <button class="btn btn--lime btn--block btn--lg" style="margin-top: 16px" @click="finish">
          开始使用
        </button>
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
  box-shadow: 0 24px 60px rgba(17, 20, 17, 0.12);
}

.onb__mark {
  width: 44px;
  height: 44px;
  border-radius: 13px;
  background: var(--ink);
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
  background: #fdf6e3;
  color: #7a5f14;
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
  border-color: var(--ink);
  background: rgba(17, 20, 17, 0.04);
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
  border-color: var(--ink);
  background: var(--ink);
  color: var(--paper);
}

.onb__goal-num {
  font-size: 22px;
  font-weight: 700;
}

.onb__keep {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(17, 20, 17, 0.03);
  cursor: pointer;
}

.onb__keep > span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.onb__check {
  width: 20px;
  height: 20px;
  margin-top: 1px;
  accent-color: var(--ink);
  flex: none;
}
</style>

