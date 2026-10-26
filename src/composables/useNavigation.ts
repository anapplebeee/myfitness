/**
 * 导航意图。
 *
 * 为什么需要它：原来的跨标签跳转只做 `route.value = next`，
 * 目的地永远落在默认首屏。于是出现这类不合理路径：
 *
 *   今日页 →「最近训练 · 全部」→ 训练页，但停在「计划」段，
 *   用户要看的是历史列表，还得再点一次「历史」。
 *
 *   今日页 →「本周节奏」→ 周目标页，但停在当前周，
 *   用户点的是"这一周"，却可能落到别的周。
 *
 * 现在跳转必须说明"去哪、为什么去、到了聚焦什么"：
 *   - to     目标标签
 *   - from   来源标签（用于返回）
 *   - focus  目的地要聚焦的对象
 *
 * 目的地在挂载时取走意图并据此调整自己的初始状态，
 * 实现"跳过去就落在正确位置"，而不是"跳过去再自己找"。
 */

import { ref } from 'vue';
import type { NavIntent, Route } from '../types/nav';

const pending = ref<NavIntent | null>(null);

/**
 * 记住"这个标签是怎么来的"。
 *
 * 只记录带 from 的跳转。用于返回键：从今日跳到训练，
 * 在训练页按返回应该回今日，而不是直接退出应用。
 */
const arrivals = ref<Array<{ route: Route; from: Route }>>([]);

export function setIntent(intent: NavIntent): void {
  pending.value = intent;
  if (intent.from) {
    // 同一个来源不重复压栈，避免来回跳把栈撑大
    const last = arrivals.value[arrivals.value.length - 1];
    if (!last || last.route !== intent.to || last.from !== intent.from) {
      arrivals.value.push({ route: intent.to, from: intent.from });
    }
  }
}

/** 目的地在挂载时调用：取走意图（只生效一次）。 */
export function takeIntent(): NavIntent | null {
  const it = pending.value;
  pending.value = null;
  return it;
}

/** 查看但不消费，供需要在 watch 里反复判断的场景。 */
export function peekIntent(): NavIntent | null {
  return pending.value;
}

/**
 * 离开某个标签时清掉它的来源记录。
 *
 * 用户已经用底部标签主动跳走，说明不再需要"返回来处"。
 */
export function forgetArrival(route: Route): void {
  arrivals.value = arrivals.value.filter((a) => a.route !== route);
}

/** 当前标签的来处，没有则 null。 */
export function originOf(route: Route): Route | null {
  for (let i = arrivals.value.length - 1; i >= 0; i -= 1) {
    const a = arrivals.value[i]!;
    if (a.route === route) return a.from;
  }
  return null;
}

/** 测试用：重置状态。 */
export function resetNavigation(): void {
  pending.value = null;
  arrivals.value = [];
}
