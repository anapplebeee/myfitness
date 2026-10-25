/**
 * AI 模型配置：用户自带 Key（BYOK）。
 *
 * 架构约束（02:27，与 deviceSettings 同源）：
 * 密钥属于**设备私有数据**，绝不能进 AppState——
 * AppState 会被物化进同步快照与导出文件，密钥一旦进去就会：
 *   1. 被上传到用户自己的同步服务器
 *   2. 出现在导出的 JSON 里
 *   3. 出现在冲突副本里
 * 因此独立存 localStorage，且导出/同步代码永远不会读到它。
 *
 * 安全边界（必须在界面上说清）：
 * - Key 只存在这台设备的浏览器存储里
 * - 调用模型时由浏览器直连用户填写的端点，不经过我们的服务器
 * - 清理浏览器数据会一并删除 Key
 */

export type AiProvider = 'openai' | 'deepseek' | 'custom';

export interface AiSettings {
  provider: AiProvider;
  /** 完整端点，例如 https://api.openai.com/v1/chat/completions */
  endpoint: string;
  model: string;
  apiKey: string;
  /** 用户是否已确认过"数据会发给该端点"。首次外发前必须为 false。 */
  egressConfirmed: boolean;
  /** 确认时记录的端点；端点变了要重新确认。 */
  confirmedEndpoint: string;
}

const KEY = 'tieguan.ai.settings';

/** 各家的默认配置，减少用户填错。 */
export const PROVIDER_PRESETS: Record<AiProvider, { endpoint: string; model: string; label: string }> = {
  openai: {
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
  },
  deepseek: {
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-chat',
  },
  custom: {
    label: '自定义（OpenAI 兼容）',
    endpoint: '',
    model: '',
  },
};

const EMPTY: AiSettings = {
  provider: 'deepseek',
  endpoint: PROVIDER_PRESETS.deepseek.endpoint,
  model: PROVIDER_PRESETS.deepseek.model,
  apiKey: '',
  egressConfirmed: false,
  confirmedEndpoint: '',
};

export function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const p = JSON.parse(raw) as Partial<AiSettings>;
    const provider: AiProvider =
      p.provider === 'openai' || p.provider === 'deepseek' || p.provider === 'custom' ? p.provider : 'deepseek';
    return {
      provider,
      endpoint: typeof p.endpoint === 'string' ? p.endpoint : PROVIDER_PRESETS[provider].endpoint,
      model: typeof p.model === 'string' ? p.model : PROVIDER_PRESETS[provider].model,
      apiKey: typeof p.apiKey === 'string' ? p.apiKey : '',
      egressConfirmed: p.egressConfirmed === true,
      confirmedEndpoint: typeof p.confirmedEndpoint === 'string' ? p.confirmedEndpoint : '',
    };
  } catch {
    // 存储损坏时回到空配置，不抛错：AI 是可选功能，不能阻断本地记录
    return { ...EMPTY };
  }
}

export function saveAiSettings(next: AiSettings): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        provider: next.provider,
        endpoint: next.endpoint.trim(),
        model: next.model.trim(),
        apiKey: next.apiKey.trim(),
        egressConfirmed: next.egressConfirmed,
        confirmedEndpoint: next.confirmedEndpoint,
      }),
    );
  } catch {
    // 隐私模式/配额满时静默失败，AI 不可用但本地记录不受影响
  }
}

export function clearAiSettings(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 忽略 */
  }
}

/**
 * 是否配置完成、可以发起调用。
 *
 * 注意 egressConfirmed 的要求：
 * 端点变更后必须重新确认——用户同意"发给 api.openai.com"不等于
 * 同意"发给某个陌生地址"，这是 AC-AI01 的核心。
 */
export function isAiConfigured(s: AiSettings): boolean {
  if (!s.endpoint.trim() || !s.model.trim() || !s.apiKey.trim()) return false;
  return s.egressConfirmed && s.confirmedEndpoint === s.endpoint.trim();
}

/** 掩码显示 Key，界面与日志都只能看到这个。 */
export function maskKey(key: string): string {
  const k = key.trim();
  if (!k) return '';
  if (k.length <= 8) return '••••';
  return `${k.slice(0, 4)}••••${k.slice(-4)}`;
}

/**
 * 生成端点的主机名，用于外发确认文案。
 * 只取 host，不暴露完整 URL 里的 token 类参数。
 */
export function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}
