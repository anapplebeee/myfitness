/**
 * 屏幕边缘滑动返回。
 *
 * 安卓的返回手势由系统接管，最终会走 history.back()（由 useBackLayer 的哨兵接住）；
 * 但在 iOS 独立 PWA、以及部分桌面浏览器里没有系统手势，用户"左滑返回"就没有反应。
 * 这里补一层应用内手势：从屏幕左/右边缘起手，向内滑动超过阈值即触发返回。
 *
 * 只在边缘起手，避免和横向滚动列表（.scroll-x）、图表拖拽抢手势。
 */

import { onBeforeUnmount, onMounted } from 'vue';

interface EdgeSwipeOptions {
  /** 起手判定宽度（px）。 */
  edge?: number;
  /** 触发阈值（px）。 */
  threshold?: number;
}

export function useEdgeSwipeBack(onBack: () => void, options: EdgeSwipeOptions = {}): void {
  // 与 useTabSwipe 的 edge 保持一致：<=28px 算边缘（返回），>28px 算页面中部（切页）
  const edge = options.edge ?? 28;
  const threshold = options.threshold ?? 64;

  let tracking = false;
  let fromLeft = true;
  let startX = 0;
  let startY = 0;
  let dx = 0;

  function reset(): void {
    tracking = false;
    dx = 0;
  }

  function onStart(event: TouchEvent): void {
    if (event.touches.length !== 1) {
      reset();
      return;
    }
    const touch = event.touches[0]!;
    const width = window.innerWidth;
    const left = touch.clientX <= edge;
    const right = touch.clientX >= width - edge;
    if (!left && !right) return;
    tracking = true;
    fromLeft = left;
    startX = touch.clientX;
    startY = touch.clientY;
    dx = 0;
  }

  function onMove(event: TouchEvent): void {
    if (!tracking) return;
    if (event.touches.length !== 1) {
      reset();
      return;
    }
    const touch = event.touches[0]!;
    const dy = touch.clientY - startY;
    dx = fromLeft ? touch.clientX - startX : startX - touch.clientX;
    // 竖向为主说明用户想滚动页面，交还手势
    if (Math.abs(dy) > 36 && Math.abs(dy) > Math.abs(dx)) reset();
  }

  function onEnd(): void {
    if (!tracking) return;
    const fired = dx >= threshold;
    reset();
    if (fired) onBack();
  }

  function onCancel(): void {
    reset();
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
