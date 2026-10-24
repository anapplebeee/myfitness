<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    points: number[];
    height?: number;
    tone?: 'ink' | 'lime' | 'clay';
    fill?: boolean;
  }>(),
  { height: 44, tone: 'ink', fill: true },
);

const W = 120;

const path = computed(() => {
  const pts = props.points;
  if (pts.length < 2) return '';
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const step = W / (pts.length - 1);
  return pts
    .map((v, i) => {
      const x = (i * step).toFixed(2);
      const y = (props.height - ((v - min) / span) * (props.height - 6) - 3).toFixed(2);
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
});

const areaPath = computed(() => {
  const p = path.value;
  if (!p) return '';
  return `${p} L${W},${props.height} L0,${props.height} Z`;
});

const stroke = computed(() => {
  if (props.tone === 'lime') return 'var(--lime)';
  if (props.tone === 'clay') return 'var(--clay)';
  return 'var(--ink)';
});

const gradId = computed(() => `spark-${props.tone}-${props.height}`);
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${height}`" :height="height" width="100%" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient :id="gradId" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" :stop-color="stroke" stop-opacity="0.18" />
        <stop offset="100%" :stop-color="stroke" stop-opacity="0" />
      </linearGradient>
    </defs>
    <path v-if="fill && areaPath" :d="areaPath" :fill="`url(#${gradId})`" />
    <path :d="path" fill="none" :stroke="stroke" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>
