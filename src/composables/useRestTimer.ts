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

  /**
   * 从持久化的结束时间戳恢复计时。
   *
   * 计时原本只存在组件里，训练中切出去看一眼消息再回来，倒计时就没了——
   * 而这恰恰是健身房里最常见的动作。现在把结束时间写进 session.restEndsAt，
   * 重新进入时按时间戳接着走。
   */
  function restore(endsAtMs: number): void {
    if (!Number.isFinite(endsAtMs) || endsAtMs <= Date.now()) return;
    endsAt.value = endsAtMs;
    now.value = Date.now();
    ensureTick();
  }

  /** 当前计时的结束时间戳（没有计时则为 null），供上层持久化。 */
  function endsAtMs(): number | null {
    return endsAt.value;
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

  return { remaining, running, start, stop, add, restore, endsAtMs };
}
