/**
 * 按 key 串行的互斥锁。
 *
 * 为什么必须有：同一账号的两次条件写如果并行处理，两边都会读到同一个
 * revision、都判定条件成立，最后谁写谁赢——这正好是"静默覆盖"（§4.2 要求
 * 每次写入按账号及数据集串行化）。
 *
 * 单进程内有效；多实例部署必须换成数据库行锁/咨询锁，见 store/schema.sql 注释。
 */
export function createKeyedLock() {
  /** @type {Map<string, Promise<unknown>>} */
  const tails = new Map();

  /**
   * @template T
   * @param {string[]} keys
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async function run(keys, fn) {
    const ordered = [...new Set(keys)].sort();
    const previous = ordered.map((key) => tails.get(key) ?? Promise.resolve());
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    for (const key of ordered) tails.set(key, current);
    try {
      await Promise.all(previous);
      return await fn();
    } finally {
      release();
      // 没有后来者排队时清掉，避免 Map 无界增长
      for (const key of ordered) {
        if (tails.get(key) === current) tails.delete(key);
      }
    }
  }

  return { run };
}
