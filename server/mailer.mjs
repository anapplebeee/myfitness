/**
 * 邮件发送端口。
 *
 * 三个实现，按环境选择：
 * - null：不发送（开发默认；生产禁用以防"验证码永远收不到"被当成正常）
 * - file：写到本地 JSONL（**仅开发/测试**，方便无网络时打通流程）
 * - webhook：POST 给邮件服务商（Resend/Mailgun 等），无第三方 SDK 依赖
 *
 * 无论哪种实现，验证码都不进入 HTTP 响应、日志与审计。
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { logEvent } from './audit.mjs';

const SUBJECTS = {
  login: '登录验证码',
  delete_dataset: '清空云端数据验证码',
  delete_account: '注销账号验证码',
};

/**
 * @param {ReturnType<import('./config.mjs').loadConfig>} config
 */
export function createMailer(config) {
  if (config.mailer === 'file') {
    return {
      kind: 'file',
      async send({ to, code, purpose, expiresInSeconds }) {
        await mkdir(dirname(config.devMailFile), { recursive: true });
        await appendFile(
          config.devMailFile,
          `${JSON.stringify({ at: new Date().toISOString(), to, purpose, code, expiresInSeconds })}\n`,
          { encoding: 'utf8', mode: 0o600 },
        );
      },
    };
  }

  if (config.mailer === 'webhook') {
    return {
      kind: 'webhook',
      async send({ to, code, purpose, expiresInSeconds }) {
        const response = await fetch(config.mailWebhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(config.mailWebhookToken ? { Authorization: `Bearer ${config.mailWebhookToken}` } : {}),
          },
          body: JSON.stringify({
            to,
            subject: `连记：${SUBJECTS[purpose] ?? '验证码'}`,
            text: `你的验证码是 ${code}，${Math.round(expiresInSeconds / 60)} 分钟内有效，仅可使用一次。如果不是你本人操作，请忽略本邮件。`,
            purpose,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          throw new Error(`邮件服务返回 ${response.status}`);
        }
      },
    };
  }

  return {
    kind: 'null',
    async send({ purpose }) {
      // 只记事件，不记收件人与验证码
      logEvent({ event: 'mail_skipped', purpose, mailer: 'null' });
    },
  };
}

/**
 * 发送验证码。失败只记录错误码，不影响对外响应（避免枚举账号与被探测）。
 * @param {{ send: (input: any) => Promise<void> }} mailer
 */
export async function deliverCode(mailer, payload, requestId) {
  try {
    await mailer.send(payload);
    return { delivered: true };
  } catch (error) {
    logEvent({
      event: 'mail_failed',
      requestId,
      error: error instanceof Error ? error.message.slice(0, 120) : 'unknown',
    });
    return { delivered: false };
  }
}
