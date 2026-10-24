<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import TodayView from './views/TodayView.vue';
import TrainView from './views/TrainView.vue';
import CoachView from './views/CoachView.vue';
import FoodView from './views/FoodView.vue';
import ProfileView from './views/ProfileView.vue';
import TabBar from './components/TabBar.vue';
import ToastHost from './components/ToastHost.vue';
import { store } from './store/appStore';
import { businessDate, shortDate, weekdayLabel } from './domain/units';
import type { Route } from './types/nav';
import { immersive } from './composables/useImmersive';

const route = ref<Route>('today');
const booted = ref(false);

const VALID: readonly Route[] = ['today', 'train', 'food', 'coach', 'me'];

function routeFromHash(): Route {
  const raw = window.location.hash.replace('#', '') as Route;
  return VALID.includes(raw) ? raw : 'today';
}

onMounted(async () => {
  route.value = routeFromHash();
  window.addEventListener('hashchange', () => {
    route.value = routeFromHash();
  });
  await store.init();
  booted.value = true;
});

const today = businessDate();
const dateLabel = computed(() => `${shortDate(today)} · ${weekdayLabel(today)}`);
const greeting = computed(() => {
  const name = store.state.profile.name.trim();
  return name ? name.slice(0, 1) : '你';
});

const view = computed(() => {
  switch (route.value) {
    case 'train':
      return TrainView;
    case 'coach':
      return CoachView;
    case 'food':
      return FoodView;
    case 'me':
      return ProfileView;
    default:
      return TodayView;
  }
});

function go(next: Route): void {
  route.value = next;
  if (window.location.hash.replace('#', '') !== next) window.location.hash = next;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
</script>

<template>
  <div class="shell" :class="{ 'shell--immersive': immersive }">
    <div class="shell__inner">
      <header class="topbar">
        <div class="brand">
          <span class="brand__mark">铁</span>
          <span class="brand__text">
            <span class="brand__name">铁馆</span>
            <span class="brand__sub">{{ dateLabel }}</span>
          </span>
        </div>
        <div class="topbar__right">
          <span class="chip chip--lime chip--sm">
            <span class="dot" />
            本地存储
          </span>
        </div>
      </header>

      <main v-if="booted">
        <Transition name="rise" mode="out-in">
          <component :is="view" :key="route" :greeting-name="greeting" @navigate="go" />
        </Transition>
      </main>

      <div v-else class="boot">
        <div class="boot__mark">铁</div>
        <p class="small">正在读取本地数据…</p>
      </div>
    </div>

    <TabBar v-if="!immersive" :active="route" @change="go" />
    <ToastHost />
  </div>
</template>

<style scoped>
.boot {
  min-height: 60vh;
  display: grid;
  place-items: center;
  gap: 14px;
  align-content: center;
}

.boot__mark {
  width: 58px;
  height: 58px;
  border-radius: 20px;
  background: var(--ink);
  color: var(--lime);
  display: grid;
  place-items: center;
  font-size: 24px;
  font-weight: 700;
  animation: pulse 1.4s var(--ease-out) infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.72; transform: scale(0.96); }
}
</style>


