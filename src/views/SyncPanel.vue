<script setup lang="ts">
/**
 * 同步面板：端点配置、手动同步、冲突提示。
 *
 * 当前版本只做"手动触发 + 明确状态反馈"，不做后台自动同步——
 * 自动同步涉及后台调度与电量策略，放 M3。
 */
import { computed, ref } from 'vue';
import {
  INITIAL_SYNC_STATE,
  backoffMs,
  detectConflict,
  httpTransport,
  pullSnapshot,
  pushSnapshot,
  type SyncState,
} from '../domain/sync';
import { buildSnapshot, snapshotHash } from '../domain/snapshot';
import { store } from '../store/appStore';
import { useToast } from '../composables/useToast';

const { push } = useToast();

const endpoint = ref(localStorage.getItem('tieguan.sync.endpoint') ?? '');
const token = ref(localStorage.getItem('tieguan.sync.token') ?? '');
const sync = ref<SyncState>({ ...INITIAL_SYNC_STATE });
const busy = ref(false);
const lastMessage = ref<string | null>(null);
const conflict = ref<{ kind: string; message: string } | null>(null);

const configured = computed(() => endpoint.value.trim().length > 0 && token.value.trim().length > 0);

function saveConfig(): void {
  localStorage.setItem('tieguan.sync.endpoint', endpoint.value.trim());
  localStorage.setItem('tieguan.sync.token', token.value.trim());
  push('已保存同步设置', 'success');
}

function currentSnapshot() {
  return buildSnapshot(store.state, { ruleVersion: 1, accountingTimezone: 'Asia/Shanghai' });
}

async function testConnection(): Promise<void> {
  if (!configured.value) {
    push('先填写地址与口令', 'error');
    return;
  }
  busy.value = true;
  try {
    const t = httpTransport({ endpoint: endpoint.value.trim(), token: token.value.trim() });
    const h = await t.health();
    if (h.status === 200) {
      const j = h.json as { apiVersion?: number; maxSnapshotBytes?: number };
      sync.value.maxSnapshotBytes = j.maxSnapshotBytes ?? sync.value.maxSnapshotBytes;
      lastMessage.value = `服务端可用 · apiVersion ${j.apiVersion} · 上限 ${((j.maxSnapshotBytes ?? 0) / 1024 / 1024).toFixed(0)} MiB`;
      push('连接正常', 'success');
    } else {
      lastMessage.value = `服务端返回 ${h.status}`;
      push('连接失败', 'error');
    }
  } catch (e) {
    lastMessage.value = e instanceof Error ? e.message : '连接失败';
    push('连接失败', 'error');
  } finally {
    busy.value = false;
  }
}

async function syncNow(): Promise<void> {
  if (!configured.value) {
    push('先填写地址与口令', 'error');
    return;
  }
  busy.value = true;
  conflict.value = null;
  const t = httpTransport({ endpoint: endpoint.value.trim(), token: token.value.trim() });
  const snap = currentSnapshot();

  try {
    const remote = await pullSnapshot(t, sync.value);
    const localHash = await snapshotHash(snap);

    if (remote.ok && remote.snapshot) {
      const remoteHash = await snapshotHash(remote.snapshot);
      const verdict = detectConflict({
        localHash,
        remoteHash,
        baseHash: sync.value.lastSyncedHash,
        localDirty: sync.value.generation > sync.value.ackedGeneration,
      });

      if (verdict.kind === 'fast_forward') {
        store.applyExternalSnapshot(remote.snapshot);
        sync.value.remoteRevision = remote.revision ?? sync.value.remoteRevision;
        sync.value.lastSyncedHash = remoteHash;
        lastMessage.value = '已从远端拉取最新数据';
        push('已更新到远端版本', 'success');
        busy.value = false;
        return;
      }
      if (verdict.kind === 'diverged') {
        conflict.value = { kind: verdict.kind, message: verdict.message };
        lastMessage.value = verdict.message;
        push('检测到冲突，需要选择', 'error');
        busy.value = false;
        return;
      }
      sync.value.remoteRevision = remote.revision ?? 0;
    } else if (remote.ok && remote.code === 'DATASET_EMPTY') {
      sync.value.remoteRevision = 0;
    }

    // 内容未变：pullSnapshot 已确认为最新，直接结束，避免无意义的上传
    if (sync.value.lastSyncedHash === localHash && sync.value.remoteRevision > 0) {
      sync.value.status = 'synced';
      sync.value.ackedGeneration = sync.value.generation;
      lastMessage.value = `已是最新 · revision ${sync.value.remoteRevision}`;
      push('已是最新版本');
      busy.value = false;
      return;
    }

    const key = sync.value.inflightKey ?? crypto.randomUUID();
    sync.value.inflightKey = key;
    const result = await pushSnapshot(t, snap, sync.value, { idempotencyKey: key });
    if (result.ok) {
      sync.value.remoteRevision = result.revision ?? sync.value.remoteRevision + 1;
      sync.value.lastSyncedHash = result.snapshotHash ?? localHash;
      sync.value.ackedGeneration = sync.value.generation;
      sync.value.inflightKey = null;
      sync.value.status = 'synced';
      sync.value.retryCount = 0;
      lastMessage.value = `已上传 · revision ${sync.value.remoteRevision}`;
      push('同步完成', 'success');
    } else {
      sync.value.lastError = result.message ?? null;
      sync.value.lastErrorCode = result.code ?? null;
      sync.value.status = result.needsAttention ? 'blocked' : result.retry ? 'pending' : 'error';
      if (result.retry) {
        sync.value.retryCount += 1;
        lastMessage.value = `上传失败，${Math.round(backoffMs(sync.value.retryCount) / 1000)}s 后可重试：${result.message}`;
      } else {
        lastMessage.value = result.message ?? '同步失败';
        if (result.status !== 412) push(result.message ?? '同步失败', 'error');
      }
    }
  } catch (e) {
    sync.value.status = 'error';
    sync.value.lastError = e instanceof Error ? e.message : '未知错误';
    lastMessage.value = sync.value.lastError;
    push('同步异常', 'error');
  } finally {
    busy.value = false;
  }
}

function useRemote(): void {
  conflict.value = null;
  push('已选择远端版本，请重新同步', 'default');
}
</script>

<template>
  <section class="card">
    <p class="label">同步</p>
    <p class="small" style="margin-top: 6px">
      把本机数据同步到你自己的服务器。数据不经过第三方，口令只存在本机。
    </p>

    <div class="syn">
      <label class="syn__field">
        <span class="tiny">服务地址</span>
        <input v-model="endpoint" class="input" placeholder="http://192.168.1.10:8787" />
      </label>
      <label class="syn__field">
        <span class="tiny">口令</span>
        <input v-model="token" class="input" type="password" placeholder="与服务端 SYNC_TOKEN 一致" />
      </label>
    </div>

    <div class="row gap-8" style="margin-top: 12px">
      <button class="btn btn--ghost btn--sm" :disabled="busy" @click="saveConfig">保存</button>
      <button class="btn btn--ghost btn--sm" :disabled="busy" @click="testConnection">测试连接</button>
      <button class="btn btn--lime btn--sm" :disabled="busy || !configured" @click="syncNow">
        {{ busy ? '同步中…' : '立即同步' }}
      </button>
    </div>

    <p v-if="lastMessage" class="tiny syn__msg">{{ lastMessage }}</p>

    <div v-if="conflict" class="syn__conflict">
      <p class="h3">本地与远端都有改动</p>
      <p class="tiny" style="margin-top: 4px">
        为避免覆盖，本次没有写入任何一方。请选择保留哪个版本，另一份会存为冲突副本。
      </p>
      <div class="row gap-8" style="margin-top: 10px">
        <button class="btn btn--ghost btn--sm" @click="useRemote">保留远端</button>
        <button class="btn btn--lime btn--sm" @click="conflict = null">保留本地</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.syn {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}

.syn__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.syn__msg {
  margin-top: 10px;
  line-height: 1.5;
  color: var(--text-2);
}

.syn__conflict {
  margin-top: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  background: #fdf6e3;
  color: #8a6d1f;
}
</style>

