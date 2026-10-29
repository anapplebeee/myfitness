/**
 * 邮箱验证码。
 *
 * 设计要点（§5.3）：
 * - 6 位数字，安全随机；
 * - 10 分钟有效、单次使用、每次挑战最多 5 次错误；
 * - 服务端只存**带服务端密钥的摘要**（HMAC），不存明文也不存无密钥哈希；
 * - 验证码不进入 URL、日志、审计和分析事件。
 *
 * 这里额外做了一件设计没写但必要的事：同一邮箱同一用途只保留一个有效挑战。
 * 否则用户连点三次"发码"，三个码都有效，暴力枚举面直接翻三倍。
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { newCode, newId } from '../domain/ids.mjs';
import { fail } from '../domain/errors.mjs';

export const OTP_PURPOSES = new Set(['login', 'delete_dataset', 'delete_account']);

/** 验证码摘要：绑定挑战 id，避免同码在不同挑战间复用。 */
export function codeDigest(secret, challengeId, code) {
  return createHmac('sha256', secret).update(`${challengeId}:${code}`).digest('hex');
}

function sameDigest(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * 签发挑战。返回明文码只用于交给邮件发送端口，绝不进入响应体。
 * @param {object} state 事务内的可变状态
 * @param {{ email: string, purpose: string, secret: string, ttlSeconds: number, now: Date, requestId: string }} input
 */
export function issueChallenge(state, input) {
  const { email, purpose, secret, ttlSeconds, now, requestId } = input;
  // 同邮箱同用途的旧挑战立即失效
  for (const [id, record] of Object.entries(state.otp)) {
    if (record.email === email && record.purpose === purpose && !record.consumedAt) {
      record.consumedAt = now.toISOString();
      record.supersededBy = requestId;
      void id;
    }
  }
  const challengeId = newId('otp');
  const code = newCode();
  state.otp[challengeId] = {
    challengeId,
    email,
    purpose,
    digest: codeDigest(secret, challengeId, code),
    attempts: 0,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    consumedAt: null,
  };
  return { challengeId, code, expiresAt: state.otp[challengeId].expiresAt };
}

/**
 * 校验验证码并标记已用。
 *
 * **不抛异常**：失败时要把 attempts+1 提交掉，抛异常会让事务整体回滚，
 * 计数永远停在 0，5 次上限等于不存在（这条是测试抓出来的真实缺陷）。
 * 返回值交给路由决定回什么状态码。
 *
 * @param {object} state
 * @param {{ email: string, purpose: string, code: string, secret: string, now: Date, maxAttempts: number }} input
 * @returns {{ ok: true, challengeId: string, persist: true } | { ok: false, code: string, persist: boolean }}
 */
export function consumeChallenge(state, input) {
  const { email, purpose, code, secret, now, maxAttempts } = input;
  const candidates = Object.values(state.otp).filter(
    (record) => record.email === email && record.purpose === purpose,
  );
  // 只认最新的未消费挑战
  const challenge = candidates.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  if (!challenge) return { ok: false, code: 'CODE_INVALID', persist: false };
  if (challenge.consumedAt) return { ok: false, code: 'CODE_CONSUMED', persist: false };
  if (new Date(challenge.expiresAt) <= now) return { ok: false, code: 'CODE_EXPIRED', persist: false };
  if (challenge.attempts >= maxAttempts) {
    return { ok: false, code: 'CODE_ATTEMPTS_EXCEEDED', persist: false };
  }

  const expected = codeDigest(secret, challenge.challengeId, String(code ?? ''));
  if (!sameDigest(expected, challenge.digest)) {
    challenge.attempts += 1;
    if (challenge.attempts >= maxAttempts) {
      challenge.consumedAt = now.toISOString();
      challenge.consumedReason = 'attempts_exceeded';
      return { ok: false, code: 'CODE_ATTEMPTS_EXCEEDED', persist: true };
    }
    return { ok: false, code: 'CODE_INVALID', persist: true };
  }

  challenge.consumedAt = now.toISOString();
  challenge.consumedReason = 'used';
  return { ok: true, challengeId: challenge.challengeId, persist: true };
}

/** 把 consumeChallenge 的失败码映射成 HTTP 错误。 */
export function otpFailure(code) {
  if (code === 'CODE_EXPIRED') return fail.codeExpired();
  if (code === 'CODE_CONSUMED') return fail.codeConsumed();
  if (code === 'CODE_ATTEMPTS_EXCEEDED') return fail.codeAttempts();
  return fail.codeInvalid();
}
