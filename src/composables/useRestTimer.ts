import { computed, onBeforeUnmount, ref } from 'vue';

/** 休息计时以持久化结束时间戳重算，不依赖后台任务。 */
export function useRestTimer() {
  const endsAt = ref<number | null>(null);
  const now = ref(Date.now());
  let tick: number | null = null;

  function ensureTick(): void {
    if (tick !== null) return;
    tick = window.setInterval(() => {
      now.value = Date.now();
      if (endsAt.value !== null && now.value >= endsAt.value) {
        endsAt.value = null;
        stopTick();
      }
    }, 500);
  }

  function stopTick(): void {
    if (tick !== null) {
      window.clearInterval(tick);
      tick = null;
    }
  }

  function start(seconds: number): void {
    endsAt.value = Date.now() + seconds * 1000;
    now.value = Date.now();
    ensureTick();
  }

  function stop(): void {
    endsAt.value = null;
    stopTick();
  }

  function add(seconds: number): void {
    if (endsAt.value === null) return;
    endsAt.value += seconds * 1000;
  }

  const remaining = computed(() => {
    if (endsAt.value === null) return 0;
    return Math.max(0, Math.ceil((endsAt.value - now.value) / 1000));
  });

  const running = computed(() => endsAt.value !== null && remaining.value > 0);

  onBeforeUnmount(stopTick);

  return { remaining, running, start, stop, add };
}
