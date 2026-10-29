/**
 * 商业云错误模型。
 *
 * 约定（docs/28-commercial-backend-mvp.md §4.2）：
 * - 错误体只含 code / message / requestId，**不含业务正文**；
 * - 客户端按状态码分流：401 重新登录、403 无权限、409 不匹配或幂等键复用、
 *   412 版本变化、413 超限、422 数据无效、428 缺条件、429 限流、5xx 可重试。
 */
export class CloudError extends Error {
  /**
   * @param {number} status HTTP 状态码
   * @param {string} code 机器可读错误码（大写下划线）
   * @param {string} message 面向用户的简短说明（不含业务数据）
   * @param {Record<string, unknown>} [extra] 附加字段，仅限非敏感信息
   */
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = 'CloudError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** 常用错误：集中定义，避免各处手写状态码不一致。 */
export const fail = {
  unauthorized: (message = '登录状态已失效，请重新登录') =>
    new CloudError(401, 'UNAUTHORIZED', message),
  codeInvalid: () => new CloudError(401, 'CODE_INVALID', '验证码不正确'),
  codeExpired: () => new CloudError(401, 'CODE_EXPIRED', '验证码已过期，请重新获取'),
  codeConsumed: () => new CloudError(401, 'CODE_CONSUMED', '验证码已使用，请重新获取'),
  codeAttempts: () => new CloudError(429, 'CODE_ATTEMPTS_EXCEEDED', '验证码错误次数过多，请重新获取'),
  forbidden: (message = '没有权限执行该操作') => new CloudError(403, 'FORBIDDEN', message),
  notFound: () => new CloudError(404, 'NOT_FOUND', '资源不存在'),
  conflict: (code, message) => new CloudError(409, code, message),
  precondition: (code, message) => new CloudError(412, code, message),
  tooLarge: (message = '数据超过服务端上限') => new CloudError(413, 'SNAPSHOT_TOO_LARGE', message),
  invalid: (code, message) => new CloudError(422, code, message),
  conditionRequired: (message = '缺少条件请求头') => new CloudError(428, 'CONDITION_REQUIRED', message),
  idempotencyRequired: () => new CloudError(400, 'IDEMPOTENCY_KEY_REQUIRED', '缺少 Idempotency-Key'),
  rateLimited: (retryAfterSeconds) =>
    new CloudError(429, 'RATE_LIMITED', '请求过于频繁，请稍后再试', { retryAfterSeconds }),
  unsupportedVersion: (message) => new CloudError(422, 'VERSION_UNSUPPORTED', message),
  unavailable: (message = '服务暂时不可用') => new CloudError(503, 'SERVICE_UNAVAILABLE', message),
};

/** 是否为可重试故障（客户端应保留待同步，而不是进入阻塞态）。 */
export function isRetryable(error) {
  if (!(error instanceof CloudError)) return true;
  return error.status >= 500 || error.status === 429;
}
