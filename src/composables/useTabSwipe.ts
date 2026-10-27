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
  /** 本次手势起点所在的横向滚动容器（页面内的小标签条）。 */
  let scroller: HTMLElement | null = null;
  let atLeftStart = true;
  let atRightStart = true;

  function reset(): void {
    tracking = false;
    dx = 0;
    dy = 0;
    scroller = null;
    atLeftStart = true;
    atRightStart = true;
  }

  function onStart(event: TouchEvent): void {
    reset();
    if (!options.enabled() || event.touches.length !== 1) return;
    const touch = event.touches[0]!;
    // 边缘让给返回手势
    if (touch.clientX <= edge || touch.clientX >= window.innerWidth - edge) return;
    // 输入控件内不抢手势
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [data-no-swipe]')) return;

    /*
     * 嵌套横滑：优先让页面内的小标签滚动。
     * 只有内层已经在边界上，这次手势才交给切页；
     * 内层还能滚就先让它滚完，用户再滑一次才切页。
     */
    scroller = (target?.closest('.scroll-x') as HTMLElement | null) ?? null;
    if (scroller) {
      const max = scroller.scrollWidth - scroller.clientWidth;
      if (max <= 1) {
        // 内容不够宽，不需要滚动，按普通区域处理
        scroller = null;
      } else {
        atLeftStart = scroller.scrollLeft <= 1;
        atRightStart = scroller.scrollLeft >= max - 1;
      }
    }

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

    if (scroller) {
      // 手指左滑 = 内容往右滚（scrollLeft 增大）；没到最右就先给内层
      if (dx < 0 && !atRightStart) {
        reset();
        return;
      }
      // 手指右滑 = 内容往左滚；没到最左就先给内层
      if (dx > 0 && !atLeftStart) {
        reset();
        return;
      }
    }
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
