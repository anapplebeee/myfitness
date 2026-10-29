/**
 * 存储端口（内存实现）+ 事务语义。
 *
 * 端口只有三个动作，够用且难以误用：
 *   read(fn)            只读快照视图，fn 里禁止改状态
 *   transaction(keys,fn) 按 key 串行；fn 返回 { result, persist }
 *   close()
 *
 * 事务用"克隆—执行—提交"：fn 抛错即整体丢弃，不会留下半截状态。
 * 代价是每次写入克隆整份状态（含快照），大快照下有明显开销；
 * 生产应换 PostgreSQL 事务（store/schema.sql），见 docs/29。
 */
import { createKeyedLock } from './lock.mjs';
import { createState } from './state.mjs';

/**
 * @typedef {object} Store
 * @property {(fn: (state: any) => any) => Promise<any>} read
 * @property {(keys: string[], fn: (state: any) => { result: any, persist?: boolean } | Promise<{ result: any, persist?: boolean }>) => Promise<any>} transaction
 * @property {string} kind
 */

function clone(value) {
  return structuredClone(value);
}

/** 内存存储：测试用，进程退出即消失。 */
export function createMemoryStore() {
  let state = createState();
  const lock = createKeyedLock();

  return {
    kind: 'memory',
    async read(fn) {
      return fn(state);
    },
    async transaction(keys, fn) {
      return lock.run(keys, async () => {
        const draft = clone(state);
        const { result, persist = true } = await fn(draft);
        if (persist) state = draft;
        return result;
      });
    },
    async close() {},
    /** 测试辅助：直接读整份状态。 */
    debugState() {
      return state;
    },
  };
}
