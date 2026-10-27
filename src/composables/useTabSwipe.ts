/**
 * 左右滑动切换标签页。
 *
 * 与 useEdgeSwipeBack 的分工：
 * - 边缘 28px 内起手 = 返回手势，本手势直接放弃，避免和返回抢；
 * - 页面中部横向拖动 = 切上一页 / 下一页；
 * - 竖向为主 = 用户想滚动，立刻放弃。
 *
 * 嵌套横滑：页面内的小标签（.scroll-x）优先滚动，
 * 只有内层已经在边界上，这次手势才交给切页。
 *
 * 两种模式：
 * - 跟手：提供 onDragStart/onDragMove/onDragEnd 时，拖动过程实时回报位移，
 *   松手由外部决定切页还是回弹（页面跟着手指走）；
 * - 兜底：不提供时松手超过阈值才触发 onNext/onPrev。
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
  /** 提供即进入"跟手"模式：实时回报位移，松手由外部决定切页/回弹。 */
  onDragStart?: (dir: 'next' | 'prev') => void;
  onDragMove?: (dx: number) => void;
  onDragEnd?: (dx: number, dir: 'next' | 'prev') => void;
  onDragCancel?: () => void;
  threshold?: number;
  edge?: number;
}

export function useTabSwipe(options: TabSwipeOptions): void {
  const threshold = options.threshold ?? 56;
  const edge = options.edge ?? 28;
  const dragMode = Boolean(options.onDragStart && options.onDragEnd);

  let tracking = false;
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dy = 0;
  /** 方向锁定：第一次明显横移后不再变，避免左右抖动时页面来回跳。 */
  let dirLocked: 'next' | 'prev' | null = null;
  /** 本次手势起点所在的横向滚动容器（页面内的小标签条）。 */
  let scroller: HTMLElement | null = null;
  let atLeftStart = true;
  let atRightStart = true;

  function reset(): void {
    tracking = false;
    dx = 0;
    dy = 0;
    dirLocked = null;
    scroller = null;
    atLeftStart = true;
    atRightStart = true;
  }

  function cancelDrag(): void {
    const wasDragging = dirLocked !== null;
    reset();
    if (wasDragging) options.onDragCancel?.();
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
    if (!tracking || event.touches.length !== 1) {
      console.log('[swipe:skip]', tracking, event.touches.length);
      return;
    }
    const touch = event.touches[0]!;
    dx = touch.clientX - startX;
    dy = touch.clientY - startY;
    // 竖向为主：交还滚动
    if (Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx)) {
      cancelDrag();
      return;
    }

    if (scroller) {
      // 手指左滑 = 内容往右滚（scrollLeft 增大）；没到最右就先给内层
      if (dx < 0 && !atRightStart) {
        cancelDrag();
        return;
      }
      // 手指右滑 = 内容往左滚；没到最左就先给内层
      if (dx > 0 && !atLeftStart) {
        cancelDrag();
        return;
      }
    }

    // 锁定方向后进入跟手回报
    if (dirLocked === null && Math.abs(dx) > 8) {
      dirLocked = dx < 0 ? 'next' : 'prev';
      options.onDragStart?.(dirLocked);
    }
    if (dirLocked) options.onDragMove?.(dx);
  }

  function onEnd(): void {
    if (!tracking) return;
    const locked = dirLocked;
    const lastDx = dx;
    const lastDy = dy;
    reset();
    if (dragMode && locked) {
      options.onDragEnd?.(lastDx, locked);
      return;
    }
    const direction = resolveTabSwipe(lastDx, lastDy, threshold);
    if (direction === 'next') options.onNext();
    if (direction === 'prev') options.onPrev();
  }

  function onCancel(): void {
    if (!tracking) return;
    cancelDrag();
  }

  onMounted(() => {
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onCancel, { passive: true });
  });

  onBeforeUnmount(() => {
    window.removeEventListener('touchstart', onStart);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('touchend', onEnd);
    window.removeEventListener('touchcancel', onCancel);
  });
}
