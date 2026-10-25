<script setup lang="ts">
/**
 * AI 教练面板。
 *
 * 设计原则（来自 00:24 与 AC-AI01~04）：
 * - AI 是**可选**的：没配置也能用全部记录功能，这里只提示"去配置"
 * - 首次外发必须显式确认，并写清数据会发给哪个域名
 * - 模型输出永远先变成"草稿"，经业务校验后才可采纳，采纳前不改任何事实
 * - 失败要说清原因和下一步，不能只弹"出错了"
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import { store } from '../store/appStore';
import { useToast } from '../composables/useToast';
import { businessDate } from '../domain/units';
import {
  PROVIDER_PRESETS,
  endpointHost,
  isAiConfigured,
  loadAiSettings,
  maskKey,
  saveAiSettings,
  type AiProvider,
  type AiSettings,
} from '../store/aiSettings';
import { AI_TIMEOUT_MS, callModel, type ChatMessage } from '../domain/ai-client';
import { buildAiContext, renderContext } from '../domain/ai-context';
import { parseDraft, validateDraft, type Draft, type DraftValidation } from '../domain/ai-draft';
import { canAdopt } from '../domain/ai-adopt';

const { push } = useToast();

const settings = ref<AiSettings>(loadAiSettings());
const configured = computed(() => isAiConfigured(settings.value));

const showConfig = ref(false);
const draftSettings = ref<AiSettings>({ ...settings.value });
const confirmingEgress = ref(false);

const question = ref('');
const busy = ref(false);
const answer = ref('');
const draft = ref<Draft | null>(null);
const validation = ref<DraftValidation | null>(null);
const draftFingerprint = ref('');
const nonce = ref('');
const adoptedNonces = ref<Set<string>>(new Set());
const errorText = ref('');

let controller: AbortController | null = null;

const SYSTEM_PROMPT = [
  '你是力量训练助手。你只能基于给定数据回答，不要编造数字。',
  '数据分【实际数据】与【计划数据】两部分；计划不等于已完成。',
  '标注为"未知"或列在【数据缺失】里的项目，你必须明确说不知道，不能用估计值替代。',
  '当用户要求调整训练安排时，用如下 JSON 输出建议（不要输出别的内容）：',
  '{"summary":"一句话说明","exercises":[{"exercise":"动作id或中文名","loadKg":数字或null,"reps":数字或null,"sets":数字或null,"reason":"理由"}],"weeklyGoal":数字或null}',
  '动作名必须来自动作库。不确定就少给几条，不要猜。',
].join('\n');

function openConfig(): void {
  draftSettings.value = { ...settings.value };
  confirmingEgress.value = false;
  showConfig.value = true;
}

function applyProvider(p: AiProvider): void {
  draftSettings.value.provider = p;
  const preset = PROVIDER_PRESETS[p];
  if (preset.endpoint) {
    draftSettings.value.endpoint = preset.endpoint;
    draftSettings.value.model = preset.model;
  }
  // 换端点必须重新确认外发
  confirmingEgress.value = false;
}

const host = computed(() => endpointHost(draftSettings.value.endpoint));

function confirmAndSave(): void {
  const e = draftSettings.value.endpoint.trim();
  const m = draftSettings.value.model.trim();
  const k = draftSettings.value.apiKey.trim();
  if (!e || !m || !k) {
    push('端点、模型名、Key 都要填', 'error');
    return;
  }
  try {
    const u = new URL(e);
    if (!/^https?:$/.test(u.protocol)) throw new Error('protocol');
  } catch {
    push('端点必须是完整的 http(s) 地址', 'error');
    return;
  }

  // 首次外发、或端点变了，都要用户再确认一次
  const needConfirm = !settings.value.egressConfirmed || settings.value.confirmedEndpoint !== e;
  if (needConfirm && !confirmingEgress.value) {
    confirmingEgress.value = true;
    return;
  }

  draftSettings.value.egressConfirmed = true;
  draftSettings.value.confirmedEndpoint = e;
  settings.value = { ...draftSettings.value };
  saveAiSettings(settings.value);
  showConfig.value = false;
  confirmingEgress.value = false;
  push('AI 配置已保存', 'success');
}

function clearAll(): void {
  settings.value = {
    ...settings.value,
    apiKey: '',
    egressConfirmed: false,
    confirmedEndpoint: '',
  };
  saveAiSettings(settings.value);
  showConfig.value = false;
  push('已清除 Key', 'success');
}

/** 构造要发的消息：系统提示 + 上下文 + 用户问题。 */
function buildMessages(userText: string): ChatMessage[] {
  const ctx = buildAiContext(store.state, businessDate());
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: renderContext(ctx) },
    { role: 'user', content: userText },
  ];
}

async function ask(): Promise<void> {
  const q = question.value.trim();
  if (!q) {
    push('先写一个问题', 'error');
    return;
  }
  if (!configured.value) {
    openConfig();
    return;
  }

  busy.value = true;
  errorText.value = '';
  answer.value = '';
  draft.value = null;
  validation.value = null;
  controller = new AbortController();

  const fingerprint = store.aiStateFingerprint();
  const r = await callModel({
    endpoint: settings.value.endpoint,
    apiKey: settings.value.apiKey,
    model: settings.value.model,
    messages: buildMessages(q),
    signal: controller.signal,
  });

  busy.value = false;
  controller = null;

  if (!r.ok) {
    errorText.value = r.message;
    push(r.message, 'error');
    return;
  }

  answer.value = r.content;

  // 模型可能给的是普通回答，也可能是可采纳的 JSON 建议
  const d = parseDraft(r.content);
  if (d) {
    const v = validateDraft(d, store.state.profile);
    draft.value = d;
    validation.value = v;
    draftFingerprint.value = fingerprint;
    nonce.value = `ai_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}

function cancelAsk(): void {
  controller?.abort();
}

const staleness = computed(() => {
  if (!draft.value) return false;
  return store.aiStateFingerprint() !== draftFingerprint.value;
});

function adopt(): void {
  if (!validation.value || !draft.value) return;
  const outcome = canAdopt({
    draft: draft.value,
    draftFingerprint: draftFingerprint.value,
    currentFingerprint: store.aiStateFingerprint(),
    adoptedNonces: adoptedNonces.value,
    nonce: nonce.value,
    acceptedCount: validation.value.accepted.length,
    now: new Date().toISOString(),
  });

  if (!outcome.ok) {
    push(outcome.message, 'error');
    return;
  }

  // 只采纳周目标这类"计划"变更；训练记录必须用户自己去练、去记
  if (draft.value.weeklyGoal && draft.value.weeklyGoal !== store.state.weeklyGoal) {
    store.adoptAiWeeklyGoal(draft.value.weeklyGoal);
  }

  adoptedNonces.value = new Set([...adoptedNonces.value, nonce.value]);
  push('已采纳建议', 'success');
}

const canAdoptNow = computed(
  () => Boolean(validation.value?.adoptable) && !staleness.value && !adoptedNonces.value.has(nonce.value),
);

function reset(): void {
  question.value = '';
  answer.value = '';
  draft.value = null;
  validation.value = null;
  errorText.value = '';
}

onBeforeUnmount(() => controller?.abort());
</script>

<template>
  <section class="card ai">
    <div class="row between">
      <div>
        <p class="label">AI 教练</p>
        <p class="tiny ai__sub">用你自己的 Key，直接连模型服务。数据不经过我们。</p>
      </div>
      <button class="btn btn--ghost btn--sm" @click="openConfig">
        {{ configured ? '设置' : '配置' }}
      </button>
    </div>

    <!-- 未配置：说清楚为什么可选，以及不配置也能用 -->
    <div v-if="!configured" class="ai__gate">
      <p class="small">
        不配置也能记录训练、饮食和体重。配置后可以让模型根据你的历史给建议。
      </p>
      <p class="tiny ai__note">
        Key 只存在这台设备，不会同步、不会导出。你可以随时清除。
      </p>
      <button class="btn btn--lime btn--block" style="margin-top: 10px" @click="openConfig">
        配置模型
      </button>
    </div>

    <template v-else>
      <p class="tiny ai__who">
        {{ PROVIDER_PRESETS[settings.provider].label }} · {{ settings.model }} · {{ maskKey(settings.apiKey) }}
      </p>

      <label class="tiny" style="display: block; margin-top: 12px">想问什么</label>
      <textarea
        v-model="question"
        class="input ai__input"
        rows="3"
        placeholder="例如：这周深蹲要不要加重量？"
      />

      <div class="row gap-8" style="margin-top: 10px">
        <button v-if="!busy" class="btn btn--lime btn--sm" :disabled="!question.trim()" @click="ask">
          问教练
        </button>
        <button v-else class="btn btn--ghost btn--sm" @click="cancelAsk">取消</button>
        <button v-if="answer || errorText" class="btn btn--ghost btn--sm" @click="reset">清空</button>
        <span v-if="busy" class="tiny ai__busy">正在请求（最长 {{ AI_TIMEOUT_MS / 1000 }} 秒）…</span>
      </div>

      <p v-if="errorText" class="ai__error">{{ errorText }}</p>

      <!--
        有草稿时不再显示原始 JSON：
        结构化内容已经在下面的草稿区用人类可读的形式呈现，
        再把 JSON 摊出来只会让用户看到一堆括号。
      -->
      <div v-if="answer && !draft" class="ai__answer">
        <p class="label">回答</p>
        <p class="small ai__text">{{ answer }}</p>
      </div>

      <!-- 草稿：校验结果必须可见，被拒的项要说清原因 -->
      <div v-if="draft && validation" class="ai__draft">
        <p class="label">建议草稿</p>
        <p v-if="draft.summary" class="small ai__summary">{{ draft.summary }}</p>

        <div v-if="validation.accepted.length" class="ai__items">
          <p class="tiny" style="margin-bottom: 6px">可采纳</p>
          <div v-for="(it, i) in validation.accepted" :key="i" class="ai__item">
            {{ it.exercise }}
            <span v-if="it.sets"> · {{ it.sets }} 组</span>
            <span v-if="it.loadKg !== null"> · {{ it.loadKg }}kg</span>
            <span v-if="it.reps !== null"> × {{ it.reps }}</span>
          </div>
        </div>

        <div v-if="validation.rejected.length" class="ai__items ai__items--bad">
          <p class="tiny" style="margin-bottom: 6px">已拒绝（不会写入）</p>
          <div v-for="(it, i) in validation.rejected" :key="i" class="ai__item ai__item--bad">
            {{ it.message }}
          </div>
        </div>

        <p v-if="staleness" class="ai__stale">
          生成建议后你的数据有更新，这份建议可能已过时。请重新生成再采纳。
        </p>

        <button
          class="btn btn--lime btn--block"
          style="margin-top: 10px"
          :disabled="!canAdoptNow"
          @click="adopt"
        >
          {{ adoptedNonces.has(nonce) ? '已采纳' : '采纳建议' }}
        </button>
        <p class="tiny ai__note" style="margin-top: 8px">
          采纳只会改"周训练目标"这类计划项。训练记录仍然要你自己练、自己记。
        </p>
      </div>
    </template>

    <!-- 配置面板 -->
    <Transition name="sheet">
      <div v-if="showConfig" class="sheet" @click.self="showConfig = false">
        <div class="sheet__panel">
          <div class="sheet__head">
            <div>
              <p class="label">模型配置</p>
              <h2 class="h2">用你自己的 Key</h2>
            </div>
            <button class="icon-btn" aria-label="关闭" @click="showConfig = false">✕</button>
          </div>

          <div class="seg" style="margin-bottom: 14px">
            <button
              v-for="(preset, key) in PROVIDER_PRESETS"
              :key="key"
              class="seg__item"
              :class="{ 'is-on': draftSettings.provider === key }"
              @click="applyProvider(key as AiProvider)"
            >
              {{ preset.label }}
            </button>
          </div>

          <label class="tiny">端点地址</label>
          <input v-model="draftSettings.endpoint" class="input" placeholder="https://…/chat/completions" />

          <label class="tiny" style="display: block; margin-top: 10px">模型名</label>
          <input v-model="draftSettings.model" class="input" placeholder="deepseek-chat" />

          <label class="tiny" style="display: block; margin-top: 10px">API Key</label>
          <input v-model="draftSettings.apiKey" class="input" type="password" placeholder="sk-…" />

          <!-- 首次外发确认：必须明确说清发给谁 -->
          <div v-if="confirmingEgress" class="ai__consent">
            <p class="small">
              每次提问时，会把你的训练与饮食摘要发送到
              <strong>{{ host }}</strong>。
            </p>
            <p class="tiny" style="margin-top: 6px">
              不发送姓名、数据集 ID、同步口令。Key 只存在本机。
            </p>
            <div class="row gap-8" style="margin-top: 10px">
              <button class="btn btn--ghost btn--sm" @click="confirmingEgress = false">取消</button>
              <button class="btn btn--lime btn--sm" @click="confirmAndSave">确认并保存</button>
            </div>
          </div>

          <button v-else class="btn btn--lime btn--block" style="margin-top: 16px" @click="confirmAndSave">
            保存配置
          </button>

          <button
            v-if="settings.apiKey"
            class="btn btn--ghost btn--block"
            style="margin-top: 8px"
            @click="clearAll"
          >
            清除已保存的 Key
          </button>
        </div>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.ai__sub {
  margin-top: 3px;
  color: var(--text-2);
}

.ai__gate {
  margin-top: 12px;
  padding: 14px;
  border-radius: 16px;
  background: rgba(17, 20, 17, 0.035);
}

.ai__note {
  margin-top: 6px;
  color: var(--text-3);
  line-height: 1.5;
}

.ai__who {
  margin-top: 10px;
  color: var(--text-3);
}

.ai__input {
  margin-top: 6px;
  width: 100%;
  resize: vertical;
  min-height: 76px;
  line-height: 1.5;
  padding: 10px 12px;
  font-size: 14px;
}

.ai__busy {
  color: var(--text-3);
  align-self: center;
}

.ai__error {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--clay-soft);
  color: var(--clay);
  font-size: 13px;
  line-height: 1.5;
}

.ai__answer {
  margin-top: 14px;
}

.ai__text {
  margin-top: 6px;
  white-space: pre-wrap;
  line-height: 1.6;
}

.ai__draft {
  margin-top: 14px;
  padding: 13px;
  border-radius: 16px;
  background: rgba(17, 20, 17, 0.04);
}

.ai__summary {
  margin-top: 4px;
  color: var(--text-2);
}

.ai__items {
  margin-top: 10px;
}

.ai__items--bad {
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

.ai__item {
  padding: 7px 10px;
  border-radius: 10px;
  background: rgba(201, 245, 63, 0.12);
  font-size: 13px;
  margin-bottom: 6px;
}

.ai__item--bad {
  background: var(--clay-soft);
  color: var(--clay);
  line-height: 1.45;
}

.ai__stale {
  margin-top: 10px;
  padding: 9px 11px;
  border-radius: 10px;
  background: var(--clay-soft);
  color: var(--clay);
  font-size: 12px;
  line-height: 1.5;
}

.ai__consent {
  margin-top: 14px;
  padding: 13px;
  border-radius: 14px;
  background: rgba(201, 245, 63, 0.14);
  border: 1px solid rgba(17, 20, 17, 0.08);
}

.ai__consent strong {
  font-weight: 700;
}
</style>



