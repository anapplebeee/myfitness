/**
 * 审计与结构化日志。
 *
 * 红线：审计里**不写**邮箱明文、验证码、令牌、训练/饮食/身体正文。
 * 需要定位账号时用不可逆指纹（accountHash）。
 *
 * 日志同样只输出错误码、请求 ID、版本、耗时、状态码——排障够用，
 * 泄露不了业务内容（§5.3）。
 */
import { AUDIT_LIMIT } from './store/state.mjs';

/**
 * 追加审计（必须在事务内，和业务变更一起提交）。
 * @param {object} state
 * @param {{ at: string, action: string, outcome: string, accountHash?: string | null, requestId?: string, meta?: Record<string, unknown> }} input
 */
export function recordAudit(state, input) {
  state.audit.push({
    at: input.at,
    action: input.action,
    outcome: input.outcome,
    accountHash: input.accountHash ?? null,
    requestId: input.requestId ?? null,
    ...(input.meta ? { meta: input.meta } : {}),
  });
  if (state.audit.length > AUDIT_LIMIT) {
    state.audit.splice(0, state.audit.length - AUDIT_LIMIT);
  }
}

/**
 * 写一行结构化日志到 stdout。
 * @param {Record<string, unknown>} event
 */
export function logEvent(event) {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
}
