<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import TodayView from './views/TodayView.vue';
import TrainView from './views/TrainView.vue';
import CoachView from './views/CoachView.vue';
import FoodView from './views/FoodView.vue';
import PlanView from './views/PlanView.vue';
import ProfileView from './views/ProfileView.vue';
import TemplateEditorView from './views/TemplateEditorView.vue';
import SessionDetailView from './views/SessionDetailView.vue';
import DataView from './views/DataView.vue';
import OnboardingView from './views/OnboardingView.vue';
import TabBar from './components/TabBar.vue';
import ToastHost from './components/ToastHost.vue';
import { store } from './store/appStore';
import { businessDate, shortDate, weekdayLabel } from './domain/units';
import type { NavigatePayload, Route } from './types/nav';
import { immersive } from './composables/useImmersive';
import { editingTemplateId, openSessionId, liveSessionId } from './composables/useOverlay';
import { forgetArrival, originOf, setIntent } from './composables/useNavigation';
import LiveWorkout from './components/LiveWorkout.vue';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { requestBack, resetBackLayers, setBackFallback } from './composables/useBackLayer';
import { useEdgeSwipeBack } from './composables/useEdgeSwipeBack';

const route = ref<Route>('today');
const booted = ref(false);

const VALID: readonly Route[] = ['today', 'train', 'plan', 'food', 'coach', 'me', 'data'];

function routeFromHash(): Route {
  const raw = window.location.hash.replace('#', '') as Route;
  return VALID.includes(raw) ? raw : 'today';
}

onMounted(async () => {
  route.value = routeFromHash();
  window.addEventListener('hashchange', () => {
    // 路由已经变了，说明哨兵没拦住（例如外部直接改 hash），
    // 残留的浮层记录必须清掉，否则后面的返回会被它吃掉。
    resetBackLayers();
    route.value = routeFromHash();
  });

  /*
   * 安卓返回键。
   *
   * Capacitor 的 Activity 默认**不拦截**返回键：真机实测按下返回，
   * 有面板打开时也是整个应用退出（回到桌面），用户会以为"数据没了"。
   * 必须注册 backButton 监听，把决定权拿回 JS：
   * 先关浮层 → 再退路由 → 都没有才最小化。
   */
  if (Capacitor.isNativePlatform()) {
    void NativeApp.addListener('backButton', () => {
      if (requestBack()) return;
      void NativeApp.minimizeApp();
    });
  }

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
    case 'plan':
      return PlanView;
    case 'coach':
      return CoachView;
    case 'food':
      return FoodView;
    case 'me':
      return ProfileView;
    case 'data':
      return DataView;
    default:
      return TodayView;
  }
});

/**
 * 切换标签。
 *
 * 接受两种写法：
 *   go('train')                     —— 纯切换（底部标签栏用，不带来源）
 *   go({ to, from, focus })         —— 带意图的跳转（页面内链接用）
 *
 * 带 from 的跳转会被记住，目的地的返回键优先回到来源，
 * 而不是一路退到应用外。这样"今日 → 训练 → 返回"才是直觉的。
 */
function go(next: NavigatePayload): void {
  const target: Route = typeof next === 'string' ? next : next.to;

  if (typeof next === 'string') {
    // 用户主动点标签切换：这次跳转没有"来处"，之前的来源记录作废
    forgetArrival(target);
  } else {
    setIntent(next);
  }

  route.value = target;
  if (window.location.hash.replace('#', '') !== target) window.location.hash = target;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** 点标题：非今日页回今日；已在今日页就滚到顶部。 */
function tapBrand(): void {
  if (route.value !== 'today') {
    go('today');
    return;
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * 没有浮层可关时的返回兜底。
 *
 * 优先级：
 *   1. 这个标签是"从别处跳来的" → 回跳来的地方
 *      （今日 →「全部」→ 训练，返回应该回今日，而不是退出应用）
 *   2. 否则交给浏览器后退（与安卓返回键同一条路径）
 *   3. 今日页不处理，交给系统（安卓退出应用）
 *
 * 不用 go('today') 兜底——那会再压一条历史，来回滑会在两个 Tab 之间打乒乓。
 */
setBackFallback(() => {
  const origin = originOf(route.value);
  if (origin) {
    forgetArrival(route.value);
    go(origin);
    return true;
  }
  if (route.value === 'today') return false;
  window.history.back();
  return true;
});

// 边缘滑动返回：系统手势之外的补充（iOS 独立 PWA、桌面浏览器）
useEdgeSwipeBack(() => {
  requestBack();
});
</script>

<template>
  <div class="shell" :class="{ 'shell--immersive': immersive }">
    <div class="shell__inner">
      <header class="topbar">
        <!-- 标题可点：回到今日页；已经在今日页时滚到顶部 -->
        <button class="brand" type="button" aria-label="回到今日" @click="tapBrand">
          <span class="brand__mark">练</span>
          <span class="brand__text">
            <span class="brand__name">练迹</span>
            <span class="brand__sub">{{ dateLabel }}</span>
          </span>
        </button>
        <div class="topbar__right">
          <!-- 本地存储：点开数据页，导出 / 备份 / 导入都在那里 -->
          <button class="chip chip--lime chip--sm chip--tap" type="button" aria-label="打开数据与备份" @click="go('data')">
            <span class="dot" />
            本地存储
          </button>
        </div>
      </header>

      <section v-if="booted && store.initError.value" class="card boot-error" role="alert">
        <h2 class="h2">无法安全读取本地数据</h2>
        <p class="small">{{ store.initError.value }}</p>
        <button class="btn btn--primary" @click="store.init()">重试读取</button>
      </section>
      <OnboardingView v-if="booted && !store.initError.value && !store.state.onboarded" @done="() => {}" />

      <main v-if="booted && !store.initError.value">
        <section v-if="store.saveError.value" class="card save-error" role="alert">
          <p class="small">{{ store.saveError.value }}</p>
          <button class="btn btn--ghost" @click="store.flush()">重试保存</button>
        </section>
        <!-- 全屏编辑/详情优先于普通页面 -->
        <TemplateEditorView
          v-if="editingTemplateId"
          :template-id="editingTemplateId"
          @close="editingTemplateId = null"
        />
        <LiveWorkout
          v-else-if="liveSessionId"
          :session-id="liveSessionId"
          @close="liveSessionId = null"
          @finished="liveSessionId = null"
        />
        <SessionDetailView
          v-else-if="openSessionId"
          :session-id="openSessionId"
          @close="openSessionId = null"
        />
        <Transition v-else name="rise" mode="out-in">
          <component :is="view" :key="route" :greeting-name="greeting" @navigate="go" />
        </Transition>
      </main>

      <div v-else-if="!booted" class="boot">
        <div class="boot__mark">练</div>
        <p class="small">正在读取本地数据…</p>
      </div>
    </div>

    <TabBar v-if="!store.initError.value && !immersive && !editingTemplateId && !openSessionId && !liveSessionId" :active="route" @change="go" />
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
  background: var(--surface-ink);
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











