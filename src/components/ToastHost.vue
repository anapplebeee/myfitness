<script setup lang="ts">
import { computed } from 'vue';
import { useToast } from '../composables/useToast';

const { toasts, dismiss } = useToast();
const list = computed(() => toasts.value);

function act(id: number, run: () => void): void {
  run();
  dismiss(id);
}
</script>

<template>
  <div class="toast-root" role="status" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="t in list" :key="t.id" class="toast" :class="`toast--${t.tone}`">
        <span class="toast__text">{{ t.message }}</span>
        <button v-if="t.action" class="toast__action" @click="act(t.id, t.action.onAction)">
          {{ t.action.label }}
        </button>
      </div>
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

.toast__text {
  flex: 1;
  min-width: 0;
}

.toast__action {
  flex: none;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 2px;
  padding: 2px 2px 2px 10px;
  cursor: pointer;
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
