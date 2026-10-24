<script setup lang="ts">
import { computed } from 'vue';
import { useToast } from '../composables/useToast';

const { toasts } = useToast();
const list = computed(() => toasts.value);
</script>

<template>
  <div class="toast-root" role="status" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="t in list" :key="t.id" class="toast" :class="`toast--${t.tone}`">{{ t.message }}</div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast--success {
  background: #1f3d1a;
  color: #e9ffd6;
}

.toast--error {
  background: #4a1d10;
  color: #ffe3d8;
}

.toast-move,
.toast-enter-active,
.toast-leave-active {
  transition: all 0.28s var(--ease-spring);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.96);
}
</style>
