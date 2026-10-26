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
  background: var(--toast-ok-bg);
  color: var(--toast-ok-ink);
}

.toast--error {
  background: var(--toast-bad-bg);
  color: var(--toast-bad-ink);
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




