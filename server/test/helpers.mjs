/**
 * 测试脚手架：真实 HTTP + 可注入时钟 + 接码邮箱。
 *
 * 坚持走 HTTP 而不是直接调路由函数：契约里一半的坑在状态码、头部和
 * 请求体边界上，绕过 HTTP 就等于绕过这些约定。
 */
import { createServer } from 'node:http';
import { createCloudService } from '../app.mjs';
import { loadConfig } from '../config.mjs';
import { createMemoryStore } from '../store/memory.mjs';

/** 可推进的时钟（版本留存、令牌过期都靠它验证）。 */
export function createClock(startIso = '2026-10-29T02:00:00.000Z') {
  let current = new Date(startIso);
  /** 服务端按 `clock()` 取当前时间，所以这里必须是可调用对象。 */
  const clock = () => new Date(current);
  clock.advance = (ms) => {
    current = new Date(current.getTime() + ms);
  };
  clock.advanceDays = (days) => {
    current = new Date(current.getTime() + days * 86_400_000);
  };
  clock.iso = () => current.toISOString();
  return clock;
}

/** 把验证码"收"进内存，绝不进响应体。 */
export function createCaptureMailer() {
  const sent = [];
  return {
    kind: 'capture',
    sent,
    async send(payload) {
      sent.push({ ...payload, at: new Date().toISOString() });
    },
    lastCode(email, purpose = 'login') {
      const matches = sent.filter((item) => item.to === email && item.purpose === purpose);
      return matches.length ? matches[matches.length - 1].code : null;
    },
    last() {
      return sent[sent.length - 1] ?? null;
    },
    clear() {
      sent.length = 0;
    },
  };
}

/**
 * 起一个监听随机端口的测试服务。
 * @param {{ clock?: any, env?: Record<string,string>, store?: any, mailer?: any }} [options]
 */
export async function createTestServer(options = {}) {
  const clock = options.clock ?? createClock();
  const mailer = options.mailer ?? createCaptureMailer();
  const store = options.store ?? createMemoryStore();
  const config = loadConfig({
    NODE_ENV: 'test',
    CLOUD_MAILER: 'null',
    ...options.env,
  });
  const service = createCloudService({ config, store, mailer, clock, quiet: true });
  const server = createServer((req, res) => {
    service.handler(req, res).catch(() => {
      if (!res.writableEnded) res.writeHead(500).end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    config,
    store,
    mailer,
    clock,
    service,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * 发请求并返回 { status, body, headers }。
 * @param {string} base
 * @param {string} path
 * @param {{ method?: string, body?: unknown, headers?: Record<string,string>, raw?: string }} [init]
 */
export async function request(base, path, init = {}) {
  const headers = { ...(init.headers ?? {}) };
  let payload;
  if (init.raw !== undefined) {
    payload = init.raw;
    headers['Content-Type'] ??= 'application/json';
  } else if (init.body !== undefined) {
    payload = JSON.stringify(init.body);
    headers['Content-Type'] ??= 'application/json';
  }
  const response = await fetch(`${base}${path}`, {
    method: init.method ?? (payload ? 'POST' : 'GET'),
    headers,
    body: payload,
    redirect: 'manual',
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body, headers: Object.fromEntries(response.headers) };
}

/** 发码 + 验证，返回会话与账号。 */
export async function login(base, mailer, email, deviceName = '测试机') {
  await request(base, '/api/cloud/v1/auth/code', { body: { email } });
  const code = mailer.lastCode(email);
  if (!code) throw new Error(`没有收到 ${email} 的验证码`);
  const verified = await request(base, '/api/cloud/v1/auth/verify', {
    body: { email, code, deviceName },
  });
  if (verified.status !== 200) {
    throw new Error(`登录失败：${verified.status} ${JSON.stringify(verified.body)}`);
  }
  return verified.body;
}

/** 取近期验证令牌（清空云端/注销用）。 */
export async function recentAuthToken(base, mailer, email, purpose) {
  await request(base, '/api/cloud/v1/auth/code', { body: { email, purpose } });
  const code = mailer.lastCode(email, purpose);
  const verified = await request(base, '/api/cloud/v1/auth/verify', {
    body: { email, code, purpose },
  });
  if (verified.status !== 200) {
    throw new Error(`近期验证失败：${verified.status} ${JSON.stringify(verified.body)}`);
  }
  return verified.body.recentAuthToken;
}

/** 构造一份合法快照。 */
export function makeSnapshot(datasetId, overrides = {}) {
  return {
    schemaVersion: 1,
    ruleVersion: 1,
    datasetId,
    createdAt: '2026-10-29T02:00:00.000Z',
    accountingTimezone: 'Asia/Shanghai',
    records: {
      profile: { sex: 'male', birthYear: 1990, heightCm: 178 },
      sessions: [],
      weights: [],
      foods: [],
      water: [],
      waterGoalMl: 2000,
      reminders: { workoutTime: '19:00', waterIntervalMin: 60 },
      occurrences: [],
      weekGoals: [],
      customTemplates: [],
      bodyGoalGrams: 75000,
      targetKcal: 2200,
      targetProtein: 150,
      weeklyGoal: 4,
      activeTemplateId: null,
      activeTemplateSince: null,
      ...overrides,
    },
  };
}

/** 取数据集当前状态（含 ETag）。 */
export async function getDataset(base, token) {
  return request(base, '/api/cloud/v1/dataset', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** 初始化或更新数据集。 */
export async function putDataset(base, token, { snapshot, etag, idempotencyKey, epoch }) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Idempotency-Key': idempotencyKey,
  };
  if (etag === '*') headers['If-None-Match'] = '*';
  else if (etag) headers['If-Match'] = etag;
  return request(base, '/api/cloud/v1/dataset', {
    method: 'PUT',
    headers,
    body: { snapshot, ...(epoch !== undefined ? { epoch } : {}) },
  });
}
