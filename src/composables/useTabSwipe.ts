/**
 * 左右滑动切换标签页。
 *
 * 与 useEdgeSwipeBack 的分工：
 * - 边缘 28px 内起手 = 返回手势，本手势直接放弃，避免和返回抢；
 * - 页面中部横向拖动 = 切上一页 / 下一页；
 * - 竖向为主 = 用户想滚动，立刻放弃。
 *
 * 横向滚动容器（.scroll-x）、输入框内起手也不接管。
 */

import { onBeforeUnmount, onMounted } from 'vue';

export type SwipeDirection = 'next' | 'prev' | null;

/**
 * 纯判定：够远、且横向明显大于纵向，才算切页。
 * dx < 0（手指向左）→ 下一页；dx > 0 → 上一页。
 */
export function resolveTabSwipe(dx: number, dy: number, threshold = 56): SwipeDirection {
  if (Math.abs(dx) < threshold) return null;
  if (Math.abs(dx) < Math.abs(dy) * 1.4) return null;
  return dx < 0 ? 'next' : 'prev';
}

interface TabSwipeOptions {
  enabled: () => boolean;
  onNext: () => void;
  onPrev: () => void;
  threshold?: number;
  edge?: number;
}

export function useTabSwipe(options: TabSwipeOptions): void {
  const threshold = options.threshold ?? 56;
  const edge = options.edge ?? 28;

  let tracking = false;
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dy = 0;

  function reset(): void {
    tracking = false;
    dx = 0;
    dy = 0;
  }

  function onStart(event: TouchEvent): void {
    reset();
    if (!options.enabled() || event.touches.length !== 1) return;
    const touch = event.touches[0]!;
    // 边缘让给返回手势
    if (touch.clientX <= edge || touch.clientX >= window.innerWidth - edge) return;
    // 横向滚动容器 / 输入控件内不抢手势
    const target = event.target as HTMLElement | null;
    if (target?.closest('.scroll-x, input, textarea, select, [data-no-swipe]')) return;
    tracking = true;
    startX = touch.clientX;
    startY = touch.clientY;
  }

  function onMove(event: TouchEvent): void {
    if (!tracking || event.touches.length !== 1) return;
    const touch = event.touches[0]!;
    dx = touch.clientX - startX;
    dy = touch.clientY - startY;
    // 竖向为主：交还滚动
    if (Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx)) reset();
  }

  function onEnd(): void {
    if (!tracking) return;
    const direction = resolveTabSwipe(dx, dy, threshold);
    reset();
    if (direction === 'next') options.onNext();
    if (direction === 'prev') options.onPrev();
  }

  onMounted(() => {
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', reset, { passive: true });
  });

  onBeforeUnmount(() => {
    window.removeEventListener('touchstart', onStart);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('touchend', onEnd);
    window.removeEventListener('touchcancel', reset);
  });
}
