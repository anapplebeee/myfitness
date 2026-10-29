/**
 * 商业云服务（模块化单体）。
 *
 * 一个进程、一个存储、一组路由；不引框架、不引 ORM。
 * 职责边界写在这里，不是写在注释里：
 * - 认证上下文是唯一授权依据（客户端提交的 accountId 一律忽略）；
 * - 所有响应 no-store；
 * - 错误体只有 code/message/requestId；
 * - 日志只有请求 id、路径、状态码、耗时。
 */
import { randomUUID } from 'node:crypto';
import { createSessionTouchBuffer, authenticate } from './auth/sessions.mjs';
import { logEvent } from './audit.mjs';
import { CloudError, fail } from './domain/errors.mjs';
import { bearerToken, clientAddress, readJson, sendError, sendJson } from './http/io.mjs';
import { createRouter } from './http/router.mjs';
import { createRateLimiter } from './rate.mjs';
import { registerAccountRoutes } from './routes/account.mjs';
import { registerAuthRoutes } from './routes/auth.mjs';
import { registerDatasetRoutes } from './routes/dataset.mjs';

/**
 * @param {{ config: any, store: any, mailer: any, clock?: () => Date, quiet?: boolean }} options
 */
export function createCloudService({ config, store, mailer, clock = () => new Date(), quiet = false }) {
  const router = createRouter();
  const limiter = createRateLimiter();
  const touches = createSessionTouchBuffer();

  router.get('/api/cloud/v1/health', async () => ({
    status: 200,
    body: { status: 'ok', apiVersion: 'v1', storage: store.kind },
  }));

  registerAuthRoutes(router);
  registerDatasetRoutes(router);
  registerAccountRoutes(router);

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async function handler(req, res) {
    const startedAt = Date.now();
    const requestId = randomUUID();
    const now = clock();
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    /** @type {Promise<any> | null} */
    let bodyPromise = null;
    /** @type {Promise<any> | null} */
    let authPromise = null;

    const ctx = {
      req,
      res,
      params: {},
      requestId,
      now,
      nowMs: now.getTime(),
      config,
      store,
      mailer,
      limiter,
      touches,
      ip: clientAddress(req, config.trustProxy),
      json() {
        if (!bodyPromise) bodyPromise = readJson(req, config.bodyLimitBytes);
        return bodyPromise;
      },
      authenticate() {
        if (!authPromise) {
          const token = bearerToken(req);
          if (!token) throw fail.unauthorized();
          authPromise = store.read((state) => authenticate(state, token, { config, now }));
        }
        return authPromise;
      },
    };

    try {
      // 预检放最前：没有匹配路由的 OPTIONS 也应该回 Allow，而不是 405
      if (req.method === 'OPTIONS') {
        const allowed = router.methodsFor(pathname);
        if (!allowed.length) throw fail.notFound();
        res.writeHead(204, { Allow: [...allowed, 'OPTIONS'].join(','), 'Cache-Control': 'no-store' });
        res.end();
        return;
      }

      const matched = router.match(req.method ?? 'GET', pathname);
      if (!matched) {
        const allowed = router.methodsFor(pathname);
        if (allowed.length) {
          sendJson(res, 405, {
            error: { code: 'METHOD_NOT_ALLOWED', message: '方法不被允许', requestId },
          }, { Allow: [...allowed, 'OPTIONS'].join(', ') });
          return;
        }
        throw fail.notFound();
      }

      ctx.params = matched.params;
      const result = await matched.handler(ctx);
      if (result) sendJson(res, result.status, result.body, result.headers);
      else sendJson(res, 204, undefined);
    } catch (error) {
      sendError(res, error, requestId);
      /*
       * 请求体没读完就出错时，把剩余字节排空而不是 destroy：
       * destroy 会连同 socket 一起关掉，可能把刚写出的错误响应截断，
       * 客户端只会看到"连接被重置"，拿不到 413/401 的原因。
       */
      if (!req.readableEnded) req.resume();
      if (!(error instanceof CloudError)) {
        logEvent({
          event: 'request_failed',
          requestId,
          method: req.method,
          path: pathname,
          error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
        });
      }
    } finally {
      if (!quiet && req.method !== 'OPTIONS') {
        logEvent({
          event: 'request',
          requestId,
          method: req.method,
          path: pathname,
          status: res.statusCode,
          durationMs: Date.now() - startedAt,
        });
      }
    }
  }

  return { handler, router, limiter, touches };
}
