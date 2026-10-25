/**
 * E2E 用的假模型服务端。
 *
 * 为什么需要它：AI 功能的端到端价值在于
 * "配置 → 发请求 → 解析 → 校验 → 采纳"这条链路，
 * 把模型换成 mock 才能稳定复现各种失败分支（401/429/500/超时/非法JSON）。
 *
 * 该服务**只用于测试**，监听 127.0.0.1，不参与任何生产构建。
 *
 * 用法：
 *   PORT=8899 node scripts/fake-ai-server.mjs
 *   请求体里的 model 字段决定返回什么：
 *     model = 'ok'         → 返回一条合法建议
 *     model = 'plain'      → 返回普通文字（非 JSON）
 *     model = 'bad-shape'  → 返回结构不符的 JSON
 *     model = 'huge'       → 返回越界数值（999kg）
 *     model = 'no-equip'   → 返回需要器械的动作
 *     model = 'empty'      → 返回空内容
 *   也可用 HTTP 状态触发错误：请求头 X-Fake-Status
 */

import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 8899);
const TOKEN = process.env.FAKE_AI_TOKEN ?? 'test-key-123';

const draftOk = {
  summary: '建议下肢日加一点重量',
  exercises: [
    { exercise: 'bb-squat', loadKg: 105, reps: 5, sets: 4, reason: '上次完成度好' },
    { exercise: 'rdl', loadKg: 90, reps: 8, sets: 3, reason: '维持容量' },
  ],
  weeklyGoal: null,
};

const draftHuge = {
  summary: '直接加到极限',
  exercises: [{ exercise: 'bb-squat', loadKg: 999, reps: 5, sets: 3, reason: '用户要求' }],
  weeklyGoal: 999,
};

const draftNoEquip = {
  summary: '用器械练腿',
  exercises: [{ exercise: 'leg-press', loadKg: 200, reps: 10, sets: 3 }],
  weeklyGoal: null,
};

/**
 * 统一响应，带 CORS 头。
 *
 * 为什么必须有：BYOK 方案里浏览器**直连**模型端点，
 * 这一定是跨域请求。真实的 OpenAI / DeepSeek 官方接口都返回 CORS 头，
 * 但自建或代理端点未必——那类情况下用户会看到"网络请求失败"。
 */
function reply(res, status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Fake-Status',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  });
  res.end(text);
}

function wrap(content) {
  return { choices: [{ message: { role: 'assistant', content } }] };
}

const server = createServer(async (req, res) => {
  // CORS 预检：浏览器直连第三方 API 必然先发 OPTIONS
  if (req.method === 'OPTIONS') {
    reply(res, 204, '');
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    reply(res, 200, { ok: true });
    return;
  }

  if (req.method !== 'POST') {
    reply(res, 405, { error: 'method not allowed' });
    return;
  }

  // 收集请求体
  let raw = '';
  for await (const chunk of req) raw += chunk;

  // 鉴权：验证 Bearer
  const auth = req.headers.authorization ?? '';
  if (auth !== `Bearer ${TOKEN}`) {
    reply(res, 401, { error: { message: 'invalid api key' } });
    return;
  }

  // 允许测试通过头强制状态码
  const forced = req.headers['x-fake-status'];
  if (typeof forced === 'string') {
    const code = Number(forced);
    if (code === 429) {
      reply(res, 429, { error: { message: 'rate limited' } });
      return;
    }
    if (code >= 500) {
      reply(res, code, { error: { message: 'server error' } });
      return;
    }
    if (code === 400) {
      reply(res, 400, { error: { message: 'bad model' } });
      return;
    }
  }

  let parsed = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    reply(res, 400, { error: 'bad json' });
    return;
  }

  const model = String(parsed.model ?? '');
  const lastUser = String(parsed.messages?.filter?.((m) => m.role === 'user')?.slice?.(-1)?.[0]?.content ?? '');

  // 根据 model 决定返回什么，便于测试各分支
  if (model === 'plain') {
    reply(res, 200, wrap('多练腿，注意恢复。'));
    return;
  }
  if (model === 'bad-shape') {
    reply(res, 200, { foo: 'bar' });
    return;
  }
  if (model === 'empty') {
    reply(res, 200, wrap('   '));
    return;
  }
  if (model === 'huge') {
    reply(res, 200, wrap(JSON.stringify(draftHuge)));
    return;
  }
  if (model === 'no-equip') {
    reply(res, 200, wrap(JSON.stringify(draftNoEquip)));
    return;
  }
  if (model === 'slow') {
    // 用于验证取消：永不响应
    await new Promise((r) => setTimeout(r, 120_000));
    reply(res, 200, wrap('too late'));
    return;
  }
  if (model === 'echo-prompt') {
    // 用于验证注入：把用户输入原样当建议回传
    reply(res, 200, wrap(lastUser));
    return;
  }

  // 默认：合法建议
  reply(res, 200, wrap(JSON.stringify(draftOk)));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`fake ai server on http://127.0.0.1:${PORT}`);
});

