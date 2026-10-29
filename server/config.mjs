/**
 * 服务配置。
 *
 * 生产环境缺少密钥时**拒绝启动**（不是回落到默认值）：
 * 一个用默认密钥跑起来的认证服务，等于把所有人的数据集挂在公网上。
 * 开发环境允许派生开发密钥，但会在 stderr 明确告警。
 */
import { join } from 'node:path';

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** 默认快照上限：64 MiB，与设计文档的候选值一致（待压测确认，见 CB-A16）。 */
export const DEFAULT_MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;

const DEV_TOKEN_SECRET = 'dev-only-token-secret-do-not-use-in-production-0001';
const DEV_OTP_SECRET = 'dev-only-otp-secret-do-not-use-in-production-00002';

function int(env, key, fallback, min, max) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${key} 必须是 ${min}–${max} 之间的整数，当前为 ${raw}`);
  }
  return value;
}

/**
 * @param {Record<string, string | undefined>} [env]
 */
export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const production = nodeEnv === 'production';
  const warnings = [];

  let tokenSecret = env.CLOUD_TOKEN_SECRET ?? '';
  let otpSecret = env.CLOUD_OTP_SECRET ?? '';
  if (production) {
    if (tokenSecret.length < 32) throw new ConfigError('CLOUD_TOKEN_SECRET 至少 32 字符');
    if (otpSecret.length < 32) throw new ConfigError('CLOUD_OTP_SECRET 至少 32 字符');
  } else {
    if (tokenSecret.length < 32) {
      tokenSecret = DEV_TOKEN_SECRET;
      warnings.push('未设置 CLOUD_TOKEN_SECRET，已使用开发密钥（生产环境会拒绝启动）');
    }
    if (otpSecret.length < 32) {
      otpSecret = DEV_OTP_SECRET;
      warnings.push('未设置 CLOUD_OTP_SECRET，已使用开发密钥（生产环境会拒绝启动）');
    }
  }

  const mailer = env.CLOUD_MAILER ?? 'null';
  if (!['null', 'file', 'webhook'].includes(mailer)) {
    throw new ConfigError('CLOUD_MAILER 只能是 null / file / webhook');
  }
  if (production && mailer === 'null') {
    throw new ConfigError('生产环境必须配置真实邮件发送（CLOUD_MAILER=webhook）');
  }
  if (mailer === 'webhook' && !env.CLOUD_MAIL_WEBHOOK_URL) {
    throw new ConfigError('CLOUD_MAILER=webhook 时必须提供 CLOUD_MAIL_WEBHOOK_URL');
  }

  return Object.freeze({
    nodeEnv,
    production,
    port: int(env, 'CLOUD_PORT', 8787, 1, 65535),
    host: env.CLOUD_HOST ?? '127.0.0.1',
    dataDir: env.CLOUD_DATA_DIR ?? join(process.cwd(), 'var', 'cloud'),
    tokenSecret,
    otpSecret,
    accessTtlSeconds: int(env, 'CLOUD_ACCESS_TTL_SECONDS', 900, 60, 3600),
    refreshTtlDays: int(env, 'CLOUD_REFRESH_TTL_DAYS', 30, 1, 90),
    otpTtlSeconds: int(env, 'CLOUD_OTP_TTL_SECONDS', 600, 60, 1800),
    otpMaxAttempts: int(env, 'CLOUD_OTP_MAX_ATTEMPTS', 5, 1, 10),
    recentAuthTtlSeconds: int(env, 'CLOUD_RECENT_AUTH_TTL_SECONDS', 600, 60, 1800),
    maxSnapshotBytes: int(env, 'CLOUD_MAX_SNAPSHOT_BYTES', DEFAULT_MAX_SNAPSHOT_BYTES, 1024, 256 * 1024 * 1024),
    versionRetentionDays: 30,
    versionRetentionCount: 10,
    idempotencyTtlDays: 7,
    /** 请求体封装开销：64 MiB 快照 + 顶层字段的余量。 */
    bodyLimitBytes: int(env, 'CLOUD_MAX_BODY_BYTES', DEFAULT_MAX_SNAPSHOT_BYTES + 1024 * 1024, 4096, 512 * 1024 * 1024),
    mailer,
    mailWebhookUrl: env.CLOUD_MAIL_WEBHOOK_URL ?? '',
    mailWebhookToken: env.CLOUD_MAIL_WEBHOOK_TOKEN ?? '',
    devMailFile: env.CLOUD_DEV_MAIL_FILE ?? join(process.cwd(), '.tmp', 'cloud-mail.jsonl'),
    /** 只有显式设置才信任反向代理的 X-Forwarded-For，否则可被伪造绕过限流。 */
    trustProxy: env.CLOUD_TRUST_PROXY === '1',
    warnings,
  });
}
