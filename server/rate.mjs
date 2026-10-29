/**
 * 内存滑动窗口限流。
 *
 * 单机有效；多实例需要放到共享存储（Redis/数据库），否则每台机器各限各的。
 * 键用邮箱/IP 的哈希，避免把明文邮箱留在内存快照或转储里。
 */
import { sha256Hex } from './domain/canonical.mjs';

export function createRateLimiter() {
  /** @type {Map<string, number[]>} */
  const buckets = new Map();
  /** 桶数量上限：防止攻击者用海量 IP/邮箱把内存打满。 */
  const MAX_BUCKETS = 20_000;

  function prune(list, windowMs, nowMs) {
    const cutoff = nowMs - windowMs;
    return list.filter((stamp) => stamp > cutoff);
  }

  return {
    /**
     * @param {string} key 已哈希的限流键
     * @param {number} limit 窗口内允许次数
     * @param {number} windowMs 窗口长度
     * @param {number} nowMs
     * @returns {{ allowed: boolean, retryAfterSeconds: number }}
     */
    hit(key, limit, windowMs, nowMs) {
      if (buckets.size > MAX_BUCKETS) {
        /*
         * 直接清空而不是 LRU：清空的后果是"短时间内限流放宽"，
         * 泄漏的后果是"服务被内存打挂"。在少一个数量级的风险里选前者。
         */
        buckets.clear();
      }
      const existing = prune(buckets.get(key) ?? [], windowMs, nowMs);
      if (existing.length >= limit) {
        const oldest = existing[0];
        const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - nowMs) / 1000));
        buckets.set(key, existing);
        return { allowed: false, retryAfterSeconds };
      }
      existing.push(nowMs);
      buckets.set(key, existing);
      return { allowed: true, retryAfterSeconds: 0 };
    },
    /** 测试用：清空所有桶。 */
    reset() {
      buckets.clear();
    },
    size() {
      return buckets.size;
    },
  };
}

/** 限流键：域名 + 摘要，避免键里出现明文邮箱。 */
export function rateKey(scope, value) {
  return `${scope}:${sha256Hex(String(value)).slice(0, 24)}`;
}
