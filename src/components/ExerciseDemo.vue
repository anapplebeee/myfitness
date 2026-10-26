<script setup lang="ts">
/**
 * 动作演示面板：示意图 + 要领 + 器械/肌群 + 上次最佳。
 *
 * 用户反馈"训练里没有动作演示"——之前只有动作名和一个目标提示，
 * 新手不知道该怎么做。这里把要领和示意图放到训练现场，
 * 不用退出去翻动作库。
 */
import { computed } from 'vue';
import { store } from '../store/appStore';
import { EXERCISES, MUSCLES, exerciseName } from '../content/exercises';
import { DEMO_ATTRIBUTION, demoImage } from '../content/demo';
import { lastExerciseSets } from '../domain/metrics';
import { formatLoad } from '../domain/units';
import { useBackLayer } from '../composables/useBackLayer';

const props = defineProps<{ exerciseId: string }>();
const emit = defineEmits<{ (e: 'close'): void }>();

useBackLayer(() => emit('close'));

const def = computed(() => EXERCISES.find((e) => e.id === props.exerciseId) ?? null);
const image = computed(() => demoImage(props.exerciseId));
const muscle = computed(() => MUSCLES.find((m) => m.id === def.value?.group)?.label ?? '');
const cues = computed(() => def.value?.cues ?? []);

const modeText = computed(() => {
  switch (def.value?.mode) {
    case 'reps':
      return '自重次数';
    case 'duration':
      return '计时';
    case 'distance_duration':
      return '距离 + 时长';
    default:
      return '重量 × 次数';
  }
});

/** 上次最好的一组，给"今天该打多少"一个参照。 */
const best = computed(() => {
  const sets = lastExerciseSets([...store.state.sessions], props.exerciseId, null);
  if (!sets.length) return null;
  const top = sets.reduce((a, b) => ((b.loadGrams ?? 0) > (a.loadGrams ?? 0) ? b : a));
  if (top.loadGrams !== null && top.reps !== null) {
    return `${formatLoad(top.loadGrams, 'kg')} × ${top.reps}`;
  }
  if (top.reps !== null) return `自重 × ${top.reps}`;
  if (top.durationSeconds !== null) return `${top.durationSeconds} 秒`;
  return null;
});
</script>

<template>
  <div class="sheet" @click.self="emit('close')">
    <div class="sheet__panel demo">
      <div class="sheet__head">
        <div>
          <p class="label">{{ muscle }}{{ def?.equipment ? ` · ${def.equipment}` : '' }}</p>
          <h2 class="h2">{{ exerciseName(exerciseId) }}</h2>
        </div>
        <button class="icon-btn" aria-label="关闭" @click="emit('close')">✕</button>
      </div>

      <div v-if="image" class="demo__figure">
        <img :src="image" :alt="`${exerciseName(exerciseId)} 示意`" loading="lazy" />
      </div>
      <div v-else class="demo__figure demo__figure--empty">
        <span class="tiny">这个动作暂无示意图，先看下面的要领</span>
      </div>

      <div class="demo__meta">
        <span class="chip chip--sm">{{ modeText }}</span>
        <span v-if="best" class="chip chip--sm">上次最佳 {{ best }}</span>
      </div>

      <div class="demo__cues">
        <p class="label">动作要领</p>
        <ul v-if="cues.length" class="demo__list">
          <li v-for="(c, i) in cues" :key="i">{{ c }}</li>
        </ul>
        <p v-else class="small demo__nocue">
          这个动作没有内置要领。通用原则：全程控制、不借力、动作幅度完整；有疼痛就停。
        </p>
      </div>

      <p class="tiny demo__credit">{{ DEMO_ATTRIBUTION }}</p>

      <button class="btn btn--primary btn--block" style="margin-top: 14px" @click="emit('close')">知道了</button>
    </div>
  </div>
</template>

<style scoped>
.demo__figure {
  margin-top: 4px;
  border-radius: 18px;
  overflow: hidden;
  background: rgba(17, 20, 17, 0.05);
  aspect-ratio: 3 / 2;
  display: grid;
  place-items: center;
}

.demo__figure img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.demo__figure--empty {
  border: 1px dashed var(--line-strong);
  background: transparent;
  color: var(--text-3);
}

.demo__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.demo__cues {
  margin-top: 16px;
}

.demo__list {
  margin: 8px 0 0;
  padding-left: 18px;
  list-style: disc;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--text-2);
}

.demo__list li {
  list-style: disc;
  padding-left: 2px;
}

.demo__list li::marker {
  color: var(--ink);
}

.demo__nocue {
  margin-top: 8px;
  color: var(--text-2);
  line-height: 1.55;
}

.demo__credit {
  margin-top: 14px;
  color: var(--text-3);
}
</style>
