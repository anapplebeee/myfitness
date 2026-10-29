/**
 * 访问令牌：HMAC 签名的紧凑令牌（`v1.<payload>.<sig>`）。
 *
 * 为什么不用 JWT 库：只需要"服务端能验、客户端不解析"的持票能力，
 * 自己签名 15 行就够，且不会因为引入 alg 协商类漏洞而被打穿。
 *
 * 注意：访问令牌里**没有**权限位。授权一律由服务端认证上下文决定，
 * 客户端提交的 accountId 永远不作为依据（§4.2）。
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { newToken } from '../domain/ids.mjs';
import { sha256Hex } from '../domain/canonical.mjs';

const PREFIX = 'v1';

function b64url(input) {
  return Buffer.from(input, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(input) {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function sign(secret, data) {
  return createHmac('sha256', secret).update(data).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 签发访问令牌。
 * @param {{ accountId: string, sessionId: string, secret: string, ttlSeconds: number, now: Date }} input
 */
export function signAccessToken({ accountId, sessionId, secret, ttlSeconds, now }) {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload = {
    aid: accountId,
    sid: sessionId,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
    jti: newToken(9),
  };
  const body = b64url(JSON.stringify(payload));
  return {
    token: `${PREFIX}.${body}.${sign(secret, `${PREFIX}.${body}`)}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

/**
 * 校验访问令牌；任何异常一律当作无效（不区分原因，避免给攻击者反馈）。
 * @param {string} token
 * @param {{ secret: string, now: Date }} options
 * @returns {{ accountId: string, sessionId: string, exp: number } | null}
 */
export function verifyAccessToken(token, { secret, now }) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const expected = sign(secret, `${PREFIX}.${parts[1]}`);
  const given = parts[2];
  if (expected.length !== given.length) return null;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(given))) return null;
  let payload;
  try {
    payload = JSON.parse(fromB64url(parts[1]));
  } catch {
    return null;
  }
  if (typeof payload?.aid !== 'string' || typeof payload?.sid !== 'string') return null;
  if (typeof payload?.exp !== 'number') return null;
  if (payload.exp * 1000 <= now.getTime()) return null;
  return { accountId: payload.aid, sessionId: payload.sid, exp: payload.exp };
}

/** 刷新令牌只存摘要：库被读走也换不出新会话。 */
export function hashRefreshToken(token) {
  return `sha256:${sha256Hex(token)}`;
}

/** 生成刷新令牌（高熵不透明串，客户端不解析）。 */
export function newRefreshToken() {
  return newToken(32);
}
