import { describe, expect, it, vi } from 'vitest';
import { AI_TIMEOUT_MS, callModel, extractContent, type AiTransport } from './ai-client';

/** 造一个固定响应的假 transport。 */
function fakeTransport(status: number, text: string): AiTransport {
  return async () => ({ status, text });
}

function okBody(content: string): string {
  return JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] });
}

const base = {
  endpoint: 'https://api.example.com/v1/chat/completions',
  apiKey: 'sk-test',
  model: 'test-model',
  messages: [{ role: 'user' as const, content: '你好' }],
};

describe('AC-AI02 · 成功路径', () => {
  it('正常响应返回内容', async () => {
    const r = await callModel({ ...base, transport: fakeTransport(200, okBody('加 2.5kg')) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content).toBe('加 2.5kg');
  });

  it('请求带 Bearer 头与模型名', async () => {
    let captured: { headers: Record<string, string>; body: string; url: string } | null = null;
    const t: AiTransport = async (args) => {
      captured = { headers: args.headers, body: args.body, url: args.url };
      return { status: 200, text: okBody('ok') };
    };
    await callModel({ ...base, transport: t });
    expect(captured!.headers.Authorization).toBe('Bearer sk-test');
    expect(captured!.url).toBe(base.endpoint);
    expect(JSON.parse(captured!.body).model).toBe('test-model');
  });

  it('不开启流式（便于统一处理超时与取消）', async () => {
    let body = '';
    const t: AiTransport = async (args) => {
      body = args.body;
      return { status: 200, text: okBody('x') };
    };
    await callModel({ ...base, transport: t });
    expect(JSON.parse(body).stream).toBe(false);
  });
});

describe('AC-AI02 · 错误可恢复', () => {
  it('401 → unauthorized，不可重试', async () => {
    const r = await callModel({ ...base, transport: fakeTransport(401, 'unauthorized') });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure).toBe('unauthorized');
      expect(r.retryable).toBe(false);
      expect(r.message).toContain('Key');
    }
  });

  it('403 同样视为凭证问题', async () => {
    const r = await callModel({ ...base, transport: fakeTransport(403, 'forbidden') });
    if (!r.ok) expect(r.failure).toBe('unauthorized');
  });

  it('429 → rate_limited，可重试且提示额度', async () => {
    const r = await callModel({ ...base, transport: fakeTransport(429, 'slow down') });
    if (!r.ok) {
      expect(r.failure).toBe('rate_limited');
      expect(r.retryable).toBe(true);
      expect(r.message).toMatch(/频繁|额度/);
    }
  });

  it('500/502/503 都是 server_error', async () => {
    for (const code of [500, 502, 503]) {
      const r = await callModel({ ...base, transport: fakeTransport(code, 'oops') });
      if (!r.ok) expect(r.failure).toBe('server_error');
    }
  });

  it('400 是 bad_request（多半是模型名错）', async () => {
    const r = await callModel({ ...base, transport: fakeTransport(400, 'bad model') });
    if (!r.ok) {
      expect(r.failure).toBe('bad_request');
      expect(r.message).toContain('模型名');
    }
  });

  it('200 但空响应 → empty', async () => {
    const r = await callModel({ ...base, transport: fakeTransport(200, '   ') });
    if (!r.ok) expect(r.failure).toBe('empty');
  });

  it('200 但非法 JSON → bad_json，提示端点可能填错', async () => {
    const r = await callModel({ ...base, transport: fakeTransport(200, '<html>404</html>') });
    if (!r.ok) {
      expect(r.failure).toBe('bad_json');
      expect(r.message).toContain('端点');
    }
  });

  it('200 合法 JSON 但结构不符 → bad_shape', async () => {
    const r = await callModel({ ...base, transport: fakeTransport(200, JSON.stringify({ foo: 1 })) });
    if (!r.ok) expect(r.failure).toBe('bad_shape');
  });

  it('choices.message.content 为空串 → empty', async () => {
    const r = await callModel({ ...base, transport: fakeTransport(200, okBody('   ')) });
    if (!r.ok) expect(r.failure).toBe('empty');
  });

  it('网络异常 → network，可重试', async () => {
    const t: AiTransport = async () => {
      throw new Error('ECONNREFUSED');
    };
    const r = await callModel({ ...base, transport: t });
    if (!r.ok) {
      expect(r.failure).toBe('network');
      expect(r.retryable).toBe(true);
    }
  });

  it('每种失败都有非空的中文提示', async () => {
    const cases: Array<[number, string]> = [
      [401, ''],
      [429, ''],
      [500, ''],
      [400, ''],
      [200, ''],
      [200, 'not json'],
    ];
    for (const [code, text] of cases) {
      const r = await callModel({ ...base, transport: fakeTransport(code, text) });
      if (!r.ok) expect(r.message.length).toBeGreaterThan(5);
    }
  });
});

describe('AC-AI02 · 超时与取消', () => {
  it('超时后返回 timeout，且提示 60 秒', async () => {
    const t: AiTransport = ({ signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      });
    const r = await callModel({ ...base, transport: t, timeoutMs: 30 });
    if (!r.ok) {
      expect(r.failure).toBe('timeout');
      expect(r.message).toContain('60');
    }
  });

  it('默认超时是 60 秒', () => {
    expect(AI_TIMEOUT_MS).toBe(60_000);
  });

  it('用户取消返回 cancelled，与超时区分开', async () => {
    const ac = new AbortController();
    const t: AiTransport = ({ signal }) =>
      new Promise((_, reject) => {
        const kill = () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        };
        signal.addEventListener('abort', kill);
      });
    const p = callModel({ ...base, transport: t, signal: ac.signal });
    setTimeout(() => ac.abort(), 20);
    const r = await p;
    if (!r.ok) {
      expect(r.failure).toBe('cancelled');
      expect(r.message).toContain('取消');
    }
  });

  it('取消后提示"输入还在"，让用户知道没丢东西', async () => {
    const ac = new AbortController();
    const t: AiTransport = () =>
      new Promise((_, reject) => {
        setTimeout(() => {
          const e = new Error('x');
          e.name = 'AbortError';
          reject(e);
        }, 10);
      });
    const p = callModel({ ...base, transport: t, signal: ac.signal });
    ac.abort();
    const r = await p;
    if (!r.ok) expect(r.message).toContain('还在');
  });
});

describe('AC-AI04 · 不自动重试', () => {
  it('失败只调用一次传输，不内部重试', async () => {
    const spy = vi.fn(async () => ({ status: 500, text: 'err' }));
    await callModel({ ...base, transport: spy });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('429 也只调用一次（避免重复计费）', async () => {
    const spy = vi.fn(async () => ({ status: 429, text: 'slow' }));
    await callModel({ ...base, transport: spy });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('extractContent 结构校验', () => {
  it('标准结构能取到', () => {
    expect(extractContent({ choices: [{ message: { content: 'hi' } }] })).toBe('hi');
  });

  it('缺 choices → null', () => {
    expect(extractContent({})).toBeNull();
  });

  it('choices 为空数组 → null', () => {
    expect(extractContent({ choices: [] })).toBeNull();
  });

  it('message 缺失 → null', () => {
    expect(extractContent({ choices: [{}] })).toBeNull();
  });

  it('content 不是字符串 → null', () => {
    expect(extractContent({ choices: [{ message: { content: 42 } }] })).toBeNull();
  });

  it('null 输入 → null', () => {
    expect(extractContent(null)).toBeNull();
  });

  it('数组输入 → null', () => {
    expect(extractContent([1, 2])).toBeNull();
  });
});
