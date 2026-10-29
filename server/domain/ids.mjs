/**
 * 标识符与随机数。
 *
 * 全部使用 CSPRNG：账号、数据集、版本、删除台账的标识都不可猜测——
 * 它们属于"不能靠猜中拿到别人数据"的第一道边界（§4.2 授权只认认证上下文）。
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';

/** base64url 编码（无 padding，可用于 URL 与头部）。 */
function b64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 生成不可猜测的标识。
 * @param {string} prefix 人类可读前缀，便于日志区分（不含业务内容）
 * @param {number} [bytes] 熵字节数，默认 16（128 位）
 */
export function newId(prefix, bytes = 16) {
  return `${prefix}_${b64url(randomBytes(bytes))}`;
}

/** 6 位数字验证码：安全随机，不用 Math.random。 */
export function newCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** 高熵不透明令牌（刷新令牌、近期验证令牌）。 */
export function newToken(bytes = 32) {
  return b64url(randomBytes(bytes));
}

/** 设备显示名清理：只做长度与不可见字符处理，内容由客户端提供。 */
export function sanitizeDeviceName(raw) {
  if (typeof raw !== 'string') return '未命名设备';
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64);
  return cleaned || '未命名设备';
}

/** 邮箱规范化：仅用于账号查找，不参与授权（§3.1）。 */
export function normalizeEmail(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length < 3 || trimmed.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

/** 邮箱的不可逆指纹：写审计与日志时用它，不落明文邮箱。 */
export function emailFingerprint(email) {
  return createHash('sha256').update(email).digest('hex').slice(0, 16);
}
