export type Route = 'today' | 'train' | 'plan' | 'food' | 'coach' | 'me' | 'data';

export const ROUTES: readonly Route[] = ['today', 'train', 'plan', 'food', 'coach', 'me', 'data'] as const;

/**
 * 目的地要聚焦的对象。
 *
 * 加新类型时问自己一句：目的地拿到它之后，**初始状态**会不会因此不同？
 * 如果只是滚动位置，用 scrollTo 就够，不必进这里。
 */
export type NavFocus =
  /** 训练页：直接打开历史段 */
  | { kind: 'history' }
  /** 训练页：直接打开动作库 */
  | { kind: 'library' }
  /** 周目标页：聚焦到某一周（周一日期） */
  | { kind: 'week'; start: string }
  /** 任意页：打开某场训练详情 */
  | { kind: 'session'; id: string };

export interface NavIntent {
  to: Route;
  /** 来源标签；带上它，目的地的返回键会回到这里 */
  from?: Route;
  /** 到达后要聚焦的对象 */
  focus?: NavFocus;
}

/** 视图 emit('navigate', ...) 可以只给字符串，也可以给完整意图。 */
export type NavigatePayload = Route | NavIntent;
