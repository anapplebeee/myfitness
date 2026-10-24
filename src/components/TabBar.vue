<script setup lang="ts">
defineProps<{
  active: 'today' | 'train' | 'food' | 'coach' | 'me';
}>();

const emit = defineEmits<{ (e: 'change', tab: 'today' | 'train' | 'food' | 'coach' | 'me'): void }>();

const items = [
  { id: 'today', label: '今日' },
  { id: 'train', label: '训练' },
  { id: 'food', label: '饮食' },
  { id: 'coach', label: '教练' },
  { id: 'me', label: '我的' },
] as const;
</script>

<template>
  <nav class="tabbar" aria-label="主导航">
    <button
      v-for="item in items"
      :key="item.id"
      class="tabbar__item"
      :class="{ 'is-active': active === item.id }"
      :aria-current="active === item.id ? 'page' : undefined"
      @click="emit('change', item.id)"
    >
      <svg v-if="item.id === 'today'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />
      </svg>
      <svg v-else-if="item.id === 'train'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10" />
      </svg>
      <svg v-else-if="item.id === 'food'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <path d="M6 3.4v7.2a2.4 2.4 0 0 0 2.4 2.4h.2a2.4 2.4 0 0 0 2.4-2.4V3.4" />
        <path d="M8.5 13v7.6M17 3.4c-1.6 1.2-2.4 3.1-2.4 5.2S15.4 12 17 12s2.4-1.3 2.4-3.4S18.6 4.6 17 3.4z" />
        <path d="M17 12v8.6" />
      </svg>
      <svg v-else-if="item.id === 'coach'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">
        <path d="M12 3.2l1.9 5.1 5.1 1.9-5.1 1.9L12 17.2l-1.9-5.1L5 10.2l5.1-1.9z" />
        <path d="M18.6 16.4l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z" />
      </svg>
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <circle cx="12" cy="8.4" r="3.6" />
        <path d="M4.8 20.2c.7-3.5 3.6-5.6 7.2-5.6s6.5 2.1 7.2 5.6" />
      </svg>
      <span class="tabbar__label">{{ item.label }}</span>
    </button>
  </nav>
</template>
