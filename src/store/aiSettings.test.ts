import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearAiSettings,
  endpointHost,
  isAiConfigured,
  loadAiSettings,
  maskKey,
  PROVIDER_PRESETS,
  saveAiSettings,
  type AiSettings,
} from './aiSettings';

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    _map: map,
  };
}

let storage: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  storage = fakeStorage();
  globalThis.localStorage = storage as unknown as Storage;
});

afterEach(() => {
  clearAiSettings();
});

function valid(): AiSettings {
  return {
    provider: 'deepseek',
    endpoint: PROVIDER_PRESETS.deepseek.endpoint,
    model: 'deepseek-chat',
    apiKey: 'sk-test-1234567890abcdef',
    egressConfirmed: true,
    confirmedEndpoint: PROVIDER_PRESETS.deepseek.endpoint,
  };
}

describe('AC-AI01 · 密钥存储边界', () => {
  it('保存后能读回', () => {
    saveAiSettings(valid());
    const back = loadAiSettings();
    expect(back.apiKey).toBe('sk-test-1234567890abcdef');
    expect(back.model).toBe('deepseek-chat');
  });

  it('密钥存在独立键，不在 AppState 使用的键里', () => {
    saveAiSettings(valid());
    const keys = [...storage._map.keys()];
    expect(keys).toContain('tieguan.ai.settings');
    // AppState 的键是 tieguan.v2.state，密钥绝不能出现在那里
    expect(keys.some((k) => k.includes('v2.state'))).toBe(false);
  });

  it('存储损坏时回到空配置且不抛错', () => {
    storage.setItem('tieguan.ai.settings', '{bad json');
    expect(() => loadAiSettings()).not.toThrow();
    expect(loadAiSettings().apiKey).toBe('');
  });

  it('写入失败不抛错（隐私模式）', () => {
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
      removeItem: () => undefined,
      clear: () => undefined,
    } as unknown as Storage;
    expect(() => saveAiSettings(valid())).not.toThrow();
  });

  it('未配置 Key 时不算已配置', () => {
    const s = { ...valid(), apiKey: '' };
    expect(isAiConfigured(s)).toBe(false);
  });
});

describe('AC-AI01 · 首次外发确认', () => {
  it('未确认时不算已配置', () => {
    expect(isAiConfigured({ ...valid(), egressConfirmed: false })).toBe(false);
  });

  it('端点变更后必须重新确认', () => {
    const s = { ...valid(), endpoint: 'https://evil.example.com/v1/chat' };
    // egressConfirmed 仍是 true，但 confirmedEndpoint 还是旧端点
    expect(isAiConfigured(s)).toBe(false);
  });

  it('确认的端点与当前端点一致才算已配置', () => {
    const s = valid();
    expect(isAiConfigured(s)).toBe(true);
    expect(isAiConfigured({ ...s, confirmedEndpoint: 'https://other.example.com' })).toBe(false);
  });

  it('缺模型名不算已配置', () => {
    expect(isAiConfigured({ ...valid(), model: '   ' })).toBe(false);
  });

  it('缺端点不算已配置', () => {
    expect(isAiConfigured({ ...valid(), endpoint: '' })).toBe(false);
  });
});

describe('AC-AI01 · 密钥不外泄', () => {
  it('掩码只露首尾各 4 位', () => {
    expect(maskKey('sk-test-1234567890abcdef')).toBe('sk-t••••cdef');
  });

  it('短 Key 完全遮蔽', () => {
    expect(maskKey('abc123')).toBe('••••');
  });

  it('空 Key 返回空串', () => {
    expect(maskKey('')).toBe('');
  });

  it('掩码结果不含完整密钥', () => {
    const full = 'sk-proj-abcdefghijklmnop';
    const masked = maskKey(full);
    expect(masked).not.toBe(full);
    expect(masked.includes('ghijklmn')).toBe(false);
  });

  it('端点主机名提取用于确认文案', () => {
    expect(endpointHost('https://api.deepseek.com/chat/completions')).toBe('api.deepseek.com');
  });

  it('非法 URL 原样返回而不是抛错', () => {
    expect(() => endpointHost('not-a-url')).not.toThrow();
  });
});

describe('AC-AI01 · 预设', () => {
  it('三家预设都有端点与模型', () => {
    expect(PROVIDER_PRESETS.openai.endpoint).toContain('openai.com');
    expect(PROVIDER_PRESETS.deepseek.endpoint).toContain('deepseek.com');
    expect(PROVIDER_PRESETS.custom.endpoint).toBe('');
  });

  it('未知 provider 回落到 deepseek 预设', () => {
    storage.setItem('tieguan.ai.settings', JSON.stringify({ provider: 'unknown', apiKey: 'k' }));
    expect(loadAiSettings().provider).toBe('deepseek');
  });
});

describe('AC-AI01 · 清除', () => {
  it('清除后 Key 为空', () => {
    saveAiSettings(valid());
    clearAiSettings();
    expect(loadAiSettings().apiKey).toBe('');
  });
});
