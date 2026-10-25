/**
 * AI 模型调用。
 *
 * 设计要点（对应 AC-AI02）：
 * - 60 秒超时，可取消
 * - 401/403、429、5xx、空响应、非法 JSON 都要**可恢复且输入保留**
 * - 不自动循环重试（AC-AI04：不自动循环付费重试）
 *
 * 与 sync.ts 的 httpTransport 一样，这里是唯一允许碰 fetch 的地方。
 * transport 由调用方注入，测试里替换成假实现——所以这个模块本身
 * 拿到假 transport 就是纯逻辑，可在 D 层测。
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type AiFailure =
  | 'unauthorized' // 401/403：Key 无效或无权限
  | 'rate_limited' // 429：限流或额度用尽
  | 'server_error' // 5xx
  | 'timeout' // 60 秒超时
  | 'cancelled' // 用户取消
  | 'empty' // 200 但内容为空
  | 'bad_json' // 200 但不是合法 JSON
  | 'bad_shape' // JSON 合法但结构不符
  | 'network' // 网络层失败
  | 'bad_request'; // 4xx 其他

export interface AiOk {
  ok: true;
  content: string;
  /** 用于诊断的模型名，不落盘 */
  model: string;
}

export interface AiErr {
  ok: false;
  failure: AiFailure;
  /** 给用户看的中文说明，必须可操作 */
  message: string;
  /** 是否建议用户重试（用于按钮状态，不自动重试） */
  retryable: boolean;
}

export type AiResult = AiOk | AiErr;

export interface AiTransport {
  (args: {
    url: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  }): Promise<{ status: number; text: string }>;
}

/** 默认传输：真实 fetch。 */
export const httpTransport: AiTransport = async ({ url, headers, body, signal }) => {
  const res = await fetch(url, { method: 'POST', headers, body, signal });
  const text = await res.text();
  return { status: res.status, text };
};

export const AI_TIMEOUT_MS = 60_000;

/** 把各失败类型映射成可操作的中文提示。 */
function failureOf(f: AiFailure): { message: string; retryable: boolean } {
  switch (f) {
    case 'unauthorized':
      return { message: 'Key 无效或没有权限。请检查 Key 是否填对、是否已过期。', retryable: false };
    case 'rate_limited':
      return { message: '请求过于频繁或额度已用尽。请稍后再试，或检查账户额度。', retryable: true };
    case 'server_error':
      return { message: '模型服务暂时不可用（服务器错误）。稍后重试通常可以恢复。', retryable: true };
    case 'timeout':
      return { message: '超过 60 秒没有响应，已中止。可以再试一次。', retryable: true };
    case 'cancelled':
      return { message: '已取消本次请求。你输入的内容还在。', retryable: true };
    case 'empty':
      return { message: '模型返回了空内容。可以再试一次，或换一个模型。', retryable: true };
    case 'bad_json':
      return { message: '模型返回的不是合法 JSON，可能是端点填错了（不像是聊天接口）。', retryable: true };
    case 'bad_shape':
      return { message: '模型返回的结构与预期不符，可能是端点或模型名不兼容。', retryable: true };
    case 'network':
      return {
        // 浏览器直连第三方时，最常见的原因是端点没有返回 CORS 头。
        // 只说"网络失败"会让用户一直查网络，其实问题在服务端配置。
        message:
          '网络请求失败。常见原因：端点地址不对，或该端点不允许浏览器跨域访问（缺少 CORS 头）。官方 OpenAI / DeepSeek 接口可以直接用。',
        retryable: true,
      };
    case 'bad_request':
      return { message: '请求被拒绝（参数或模型名可能有误）。请检查模型名是否存在。', retryable: false };
  }
}

function err(f: AiFailure): AiErr {
  const { message, retryable } = failureOf(f);
  return { ok: false, failure: f, message, retryable };
}

/**
 * 从 OpenAI 兼容响应里取文本。
 *
 * 只认 choices[0].message.content（字符串）。
 * 结构不符一律 bad_shape，不用猜——猜错的代价是把垃圾当答案显示给用户。
 */
export function extractContent(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const choices = (raw as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (typeof first !== 'object' || first === null) return null;
  const msg = (first as { message?: unknown }).message;
  if (typeof msg !== 'object' || msg === null) return null;
  const content = (msg as { content?: unknown }).content;
  if (typeof content !== 'string') return null;
  return content;
}

export interface CallOptions {
  endpoint: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  transport?: AiTransport;
  /** 外部取消信号（用户点"取消"） */
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * 调用模型。
 *
 * 关键：超时与用户取消都用 AbortController 实现，
 * 并且**区分**这两种 abort —— 用户取消要说"已取消"，超时要说"超时"，
 * 因为用户的下一步动作完全不同（取消是自己点的，超时是服务问题）。
 */
export async function callModel(opts: CallOptions): Promise<AiResult> {
  const transport = opts.transport ?? httpTransport;
  const timeoutMs = opts.timeoutMs ?? AI_TIMEOUT_MS;

  const ac = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, timeoutMs);

  const onUserAbort = () => ac.abort();
  opts.signal?.addEventListener('abort', onUserAbort, { once: true });

  try {
    const body = JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      // 低温度：训练建议要稳定，不要每次说得不一样
      temperature: 0.3,
      stream: false,
    });

    const res = await transport({
      url: opts.endpoint,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body,
      signal: ac.signal,
    });

    if (res.status === 401 || res.status === 403) return err('unauthorized');
    if (res.status === 429) return err('rate_limited');
    if (res.status >= 500) return err('server_error');
    if (res.status >= 400) return err('bad_request');

    if (!res.text.trim()) return err('empty');

    let parsed: unknown;
    try {
      parsed = JSON.parse(res.text);
    } catch {
      return err('bad_json');
    }

    const content = extractContent(parsed);
    if (content === null) return err('bad_shape');
    if (!content.trim()) return err('empty');

    return { ok: true, content, model: opts.model };
  } catch (e) {
    if (opts.signal?.aborted) return err('cancelled');
    if (timedOut) return err('timeout');
    // AbortError 但既非用户取消也非超时，按网络失败处理
    if (e instanceof Error && e.name === 'AbortError') return err('network');
    return err('network');
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onUserAbort);
  }
}

