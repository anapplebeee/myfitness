/**
 * 全局返回栈：把"返回上一级"收敛成一次可预期的行为。
 *
 * 真机反馈的问题：打开底部选项面板后，用安卓返回键或边缘返回手势，
 * 期望是关掉面板，实际却跳到了别的页面。原因是应用用 hash 路由，
 * WebView 的默认返回直接执行 history.back()，hash 一变就换了页面，
 * 面板所在的视图被卸载，用户看到的就是"跳到其他页面"。
 *
 * 做法：只要有浮层打开，就在 history 里压一条**同 URL 的哨兵条目**。
 * 返回键先消费哨兵 → 触发 popstate 而不是 hashchange → 在这里关掉
 * 最上层浮层，并按需重新压哨兵。这样"返回"永远先关当前层，
 * 全部关完之后才回到路由层面的后退。
 *
 * 约定：浮层自己不要监听 popstate，只通过本模块注册关闭回调。
 */

import { onBeforeUnmount, onMounted, watch, type WatchSource } from 'vue';

type CloseFn = () => void;

interface Layer {
  id: number;
  close: CloseFn;
}

const layers: Layer[] = [];
let seq = 0;
/** 当前 history 顶部是否有我们压的哨兵。 */
let armed = false;
/** 我们自己调 history.back() 时会先收到一次 popstate，用计数忽略它。 */
let ignoreNextPop = 0;
/** 没有浮层时的兜底返回（由 App 注入，例如回到今日页）。 */
let fallback: (() => boolean) | null = null;
let listening = false;

const TRAP_KEY = '__tieGuanBackTrap';

function ensureListener(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('popstate', onPopState);
}

function arm(): void {
  if (armed) return;
  try {
    const base = (window.history.state ?? {}) as Record<string, unknown>;
    window.history.pushState({ ...base, [TRAP_KEY]: true }, '', window.location.href);
    armed = true;
  } catch {
    // 某些 WebView 在 file:// 下会拒绝 pushState；此时退化为直接关闭
    armed = false;
  }
}

function disarm(): void {
  if (!armed) return;
  armed = false;
  ignoreNextPop += 1;
  window.history.back();
}

function onPopState(): void {
  if (ignoreNextPop > 0) {
    ignoreNextPop -= 1;
    return;
  }
  if (!layers.length) {
    armed = false;
    return;
  }
  armed = false;
  const top = layers.pop();
  top?.close();
  // 还有浮层就重新压哨兵，保证下一次返回仍然只关一层
  if (layers.length) arm();
}

/**
 * 注册一个可被返回键关闭的层，返回注销函数。
 *
 * 注销函数在层被 popstate 关闭后调用是安全的：此时层已出栈，
 * 找不到就什么都不做，避免误把哨兵又退掉一条。
 */
export function pushBackLayer(close: CloseFn): () => void {
  ensureListener();
  const layer: Layer = { id: (seq += 1), close };
  layers.push(layer);
  arm();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const at = layers.findIndex((l) => l.id === layer.id);
    if (at < 0) return;
    layers.splice(at, 1);
    if (!layers.length) disarm();
  };
}

/** 组件挂载期间一直存在的浮层（全屏录制/详情/模板编辑）。 */
export function useBackLayer(close: CloseFn): void {
  let release: (() => void) | null = null;
  onMounted(() => {
    release = pushBackLayer(close);
  });
  onBeforeUnmount(() => {
    release?.();
    release = null;
  });
}

/** 由 v-if 控制开关的浮层（底部面板、弹窗）。 */
export function useSheetBack(isOpen: WatchSource<boolean>, close: CloseFn): void {
  let release: (() => void) | null = null;
  watch(
    isOpen,
    (open) => {
      if (open && !release) {
        release = pushBackLayer(close);
      } else if (!open && release) {
        release();
        release = null;
      }
    },
    { immediate: true, flush: 'sync' },
  );
  onBeforeUnmount(() => {
    release?.();
    release = null;
  });
}

/**
 * 请求一次"返回"。
 *
 * 有浮层时走 history.back()，让 popstate 统一关闭最上层；
 * 没有浮层时交给 App 注入的兜底逻辑（如从其他 Tab 回到今日）。
 */
export function requestBack(): boolean {
  if (!layers.length) return fallback ? fallback() : false;
  if (armed) {
    window.history.back();
    return true;
  }
  const top = layers.pop();
  top?.close();
  if (layers.length) arm();
  return true;
}

export function setBackFallback(fn: (() => boolean) | null): void {
  fallback = fn;
}

/**
 * 路由已经变了（说明哨兵没能拦住，例如外部直接改 hash）时清空栈，
 * 避免残留的层把后续返回都吃掉。这里不调 history，因为导航已经发生。
 */
export function resetBackLayers(): void {
  layers.length = 0;
  armed = false;
}

/** 供测试与调试使用：当前打开的层数。 */
export function backLayerCount(): number {
  return layers.length;
}
