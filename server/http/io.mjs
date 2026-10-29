/**
 * HTTP 读写辅助。
 *
 * 几条硬约束：
 * - 所有响应 Cache-Control: no-store（快照里是训练与身体数据）；
 * - 错误体不含业务正文，只给 code/message/requestId；
 * - 请求体必须**先看 Content-Length 再读**，否则一个 1 GiB 的请求会先把
 *   内存吃满才轮到 413。
 */
import { CloudError, fail } from '../domain/errors.mjs';

/** 强 ETag：数据集 + 代次 + 版本，任何一项变化都必须让条件失效。 */
export function datasetEtag(dataset) {
  return `"ds:${dataset.datasetId}:e${dataset.epoch}:r${dataset.revision}"`;
}

/** 已删除数据集的令牌：用于 reinitialize 的 If-Match。 */
export function deletionEtag(dataset) {
  return `"del:e${dataset.epoch}:${dataset.deletionId}"`;
}

/**
 * 读取并解析 JSON 请求体。
 * @param {import('node:http').IncomingMessage} req
 * @param {number} limitBytes
 * @returns {Promise<any>}
 */
export async function readJson(req, limitBytes) {
  const declared = Number(req.headers['content-length'] ?? NaN);
  if (Number.isFinite(declared) && declared > limitBytes) {
    throw fail.tooLarge(`请求体 ${declared} 字节，超过上限 ${limitBytes} 字节`);
  }

  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limitBytes) {
        // 不 destroy：要让调用方先把 413 写出去；由 app 在响应结束后断开。
        req.pause();
        finish(reject, fail.tooLarge(`请求体超过上限 ${limitBytes} 字节`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) return finish(resolve, null);
      try {
        finish(resolve, JSON.parse(text));
      } catch {
        finish(reject, new CloudError(400, 'INVALID_JSON', '请求体不是合法 JSON'));
      }
    });
    req.on('error', (error) => finish(reject, error));
    req.on('aborted', () => finish(reject, new CloudError(400, 'REQUEST_ABORTED', '请求被中断')));
  });
}

/**
 * 写 JSON 响应。
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [headers]
 */
export function sendJson(res, status, body, headers = {}) {
  if (res.writableEnded) return;
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
    'Content-Length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

/**
 * 写错误响应。
 * @param {import('node:http').ServerResponse} res
 * @param {unknown} error
 * @param {string} requestId
 */
export function sendError(res, error, requestId) {
  const cloudError =
    error instanceof CloudError
      ? error
      : new CloudError(500, 'INTERNAL_ERROR', '服务内部错误');
  const body = {
    error: {
      code: cloudError.code,
      message: cloudError.message,
      requestId,
      ...cloudError.extra,
    },
  };
  /** @type {Record<string, string>} */
  const headers = cloudError.extra?.retryAfterSeconds
    ? { 'Retry-After': String(cloudError.extra.retryAfterSeconds) }
    : {};
  sendJson(res, cloudError.status, body, headers);
}

/** 取 Bearer 令牌。 */
export function bearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/** 取条件请求头（If-Match / If-None-Match），去掉弱校验前缀与引号。 */
export function conditionalHeader(req, name) {
  const raw = req.headers[name];
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return raw.trim();
}

/**
 * 解析 If-Match：支持 `*` 与逗号分隔多值。
 * @returns {string[] | null}
 */
export function parseIfMatch(req) {
  const raw = conditionalHeader(req, 'if-match');
  if (!raw) return null;
  return raw.split(',').map((part) => part.trim());
}

/** 客户端地址：默认不信任转发头，避免伪造 X-Forwarded-For 绕过限流。 */
export function clientAddress(req, trustProxy) {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0].trim();
    }
  }
  return req.socket.remoteAddress ?? 'unknown';
}
