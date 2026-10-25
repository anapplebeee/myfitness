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
  type ConflictCopy,
  makeConflictCopy,
  type SyncState,
} from '../domain/sync';
import { buildSnapshot, snapshotHash } from '../domain/snapshot';
import { store } from '../store/appStore';
import { useToast } from '../composables/useToast';
import { isConfigured, loadSyncSettings, saveSyncSettings } from '../store/deviceSettings';
import { listConflicts, markResolved, saveConflict } from '../store/conflictStore';

const { push } = useToast();

// 初始值来自设备配置层，视图不直接碰 localStorage
const initial = loadSyncSettings();
const endpoint = ref(initial.endpoint);
const token = ref(initial.token);
const sync = ref<SyncState>({ ...INITIAL_SYNC_STATE });
const busy = ref(false);
const lastMessage = ref<string | null>(null);
const conflict = ref<{ kind: string; message: string; remoteRevision: number } | null>(null);
const pendingConflict = ref<ConflictCopy | null>(null);

const configured = computed(() => isConfigured({ endpoint: endpoint.value, token: token.value }));

function saveConfig(): void {
  saveSyncSettings({ endpoint: endpoint.value, token: token.value });
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
        // 冲突时立刻把双方都存成副本：用户无论选哪边，
        // 另一边都能事后取回。只弹提示而不留档等于没实现。
        const copy = makeConflictCopy(
          remote.revision ?? 0,
          remote.snapshot,
          snap,
          crypto.randomUUID(),
        );
        saveConflict({ ...copy, resolution: 'unresolved' });
        pendingConflict.value = copy;
        conflict.value = {
          kind: verdict.kind,
          message: verdict.message,
          remoteRevision: remote.revision ?? 0,
        };
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

const savedConflicts = ref(listConflicts());

function refreshConflicts(): void {
  savedConflicts.value = listConflicts();
}

/** 保留远端：用远端快照覆盖本地，并标记冲突已解决。 */
function keepRemote(): void {
  const c = pendingConflict.value;
  if (!c) {
    conflict.value = null;
    return;
  }
  const err = store.applyExternalSnapshot(c.remoteSnapshot);
  if (err) {
    push(err, 'error');
    return;
  }
  markResolved(c.id, 'kept_remote');
  sync.value.remoteRevision = c.remoteRevision;
  sync.value.lastSyncedHash = null;
  sync.value.inflightKey = null;
  conflict.value = null;
  pendingConflict.value = null;
  refreshConflicts();
  lastMessage.value = '已用远端版本覆盖本地';
  push('已保留远端版本', 'success');
}

/**
 * 保留本地：把本地推上去（force），远端那份已存为副本。
 * 必须 force，否则 pushSnapshot 会因 hash 与 lastSyncedHash 相同而跳过上传。
 */
async function keepLocal(): Promise<void> {
  const c = pendingConflict.value;
  if (!c) {
    conflict.value = null;
    return;
  }
  busy.value = true;
  try {
    const t = httpTransport({ endpoint: endpoint.value.trim(), token: token.value.trim() });
    sync.value.remoteRevision = c.remoteRevision;
    const key = crypto.randomUUID();
    const localHash = await snapshotHash(c.localSnapshot);
    const result = await pushSnapshot(t, c.localSnapshot, sync.value, {
      idempotencyKey: key,
      force: true,
    });
    if (result.ok) {
      markResolved(c.id, 'kept_local');
      sync.value.remoteRevision = result.revision ?? c.remoteRevision + 1;
      sync.value.lastSyncedHash = result.snapshotHash ?? localHash;
      sync.value.ackedGeneration = sync.value.generation;
      conflict.value = null;
      pendingConflict.value = null;
      refreshConflicts();
      lastMessage.value = `已保留本地版本 · revision ${sync.value.remoteRevision}`;
      push('已保留本地版本', 'success');
    } else {
      lastMessage.value = result.message ?? '上传失败';
      push(result.message ?? '上传失败', 'error');
    }
  } finally {
    busy.value = false;
  }
}

/** 从任意一份冲突副本取回远端版本。 */
function restoreRemote(id: string): void {
  const c = savedConflicts.value.find((x) => x.id === id);
  if (!c) return;
  const err = store.applyExternalSnapshot(c.remoteSnapshot);
  if (err) {
    push(err, 'error');
    return;
  }
  markResolved(id, 'kept_remote');
  refreshConflicts();
  sync.value.lastSyncedHash = null;
  lastMessage.value = '已取回冲突副本中的远端版本';
  push('已取回远端版本', 'success');
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
        为避免覆盖，本次没有写入任何一方。两边都已存成副本，选哪边都能事后取回另一边。
      </p>
      <p class="tiny" style="margin-top: 4px">
        远端 revision {{ conflict.remoteRevision }}
      </p>
      <div class="row gap-8" style="margin-top: 10px">
        <button class="btn btn--ghost btn--sm" :disabled="busy" @click="keepRemote">保留远端</button>
        <button class="btn btn--lime btn--sm" :disabled="busy" @click="keepLocal">保留本地</button>
      </div>
    </div>

    <div v-if="savedConflicts.length" class="syn__saved">
      <p class="label">冲突副本</p>
      <p class="tiny" style="margin-top: 4px">
        共 {{ savedConflicts.length }} 份。保留本地时，远端那份会留下来，可随时取回。
      </p>
      <div v-for="c in savedConflicts.slice(0, 3)" :key="c.id" class="syn__copy">
        <span class="tiny">{{ c.createdAt.slice(0, 16).replace('T', ' ') }} · rev {{ c.remoteRevision }}</span>
        <button class="btn btn--ghost btn--sm" @click="restoreRemote(c.id)">取回远端版本</button>
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
.syn__saved {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.syn__copy {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 12px;
  background: rgba(17, 20, 17, 0.03);
}
</style>








