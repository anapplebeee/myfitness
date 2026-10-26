<script setup lang="ts">
/**
 * 同步面板：端点配置、手动同步、冲突提示。
 *
 * 当前版本只做"手动触发 + 明确状态反馈"，不做后台自动同步——
 * 自动同步涉及后台调度与电量策略，放 M3。
 */
import { computed, ref } from 'vue';
import {
  backoffMs,
  INITIAL_SYNC_STATE,
  detectConflict,
  httpTransport,
  pullSnapshot,
  pushSnapshot,
  type ConflictCopy,
  makeConflictCopy,
  type SyncState,
} from '../domain/sync';
import { buildSnapshot, snapshotHash, type Snapshot } from '../domain/snapshot';
import { store } from '../store/appStore';
import { useToast } from '../composables/useToast';
import { isConfigured, loadSyncSettings, saveSyncSettings } from '../store/deviceSettings';
import { listConflicts, markResolved, saveConflict } from '../store/conflictStore';
import { hasSyncedBefore, loadSyncState, saveSyncState } from '../store/syncStateStore';

const { push } = useToast();

// 初始值来自设备配置层，视图不直接碰 localStorage
const initial = loadSyncSettings();
const endpoint = ref(initial.endpoint);
const token = ref(initial.token);
/*
 * 从存储恢复同步状态。
 *
 * 原来每次都重置为 INITIAL_SYNC_STATE，导致 remoteRevision=0、
 * lastSyncedHash=null，detectConflict 永远偏向 fast_forward，
 * 真实的本地改动会被远端静默覆盖。这是数据安全问题，不是体验问题。
 */
const sync = ref<SyncState>(loadSyncState());
const busy = ref(false);
const remoteCleared = ref(false);
const confirmReinitialize = ref(false);
const lastMessage = ref<string | null>(null);
const conflict = ref<{ kind: string; message: string; remoteRevision: number } | null>(null);
const pendingConflict = ref<ConflictCopy | null>(null);

const configured = computed(() => isConfigured({ endpoint: endpoint.value, token: token.value }));

function saveConfig(): void {
  saveSyncSettings({ endpoint: endpoint.value, token: token.value });
  push('已保存同步设置', 'success');
}

function currentSnapshot() {
  return JSON.parse(JSON.stringify(buildSnapshot(store.state, { ruleVersion: 1, accountingTimezone: 'Asia/Shanghai' }))) as Snapshot;
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

async function syncNow(allowReinitialize = false): Promise<void> {
  if (busy.value) return;
  if (!configured.value) { push('先填写地址与口令', 'error'); return; }
  busy.value = true;
  if (!(await store.flush())) {
    busy.value = false;
    push(store.saveError.value ?? '本机数据尚未保存', 'error');
    return;
  }
  conflict.value = null;
  const endpointKey = endpoint.value.trim().replace(/\/$/, '');
  sync.value = loadSyncState();
  const knownService = sync.value.serviceEndpoint === endpointKey;
  const syncedBefore = hasSyncedBefore(sync.value);
  if (sync.value.serviceEndpoint && !knownService) {
    sync.value = { ...INITIAL_SYNC_STATE };
  }
  const baseHash = knownService ? sync.value.lastSyncedHash : null;
  const snap = currentSnapshot();
  const sentGeneration = store.generation.value;
  sync.value.generation = sentGeneration;
  const t = httpTransport({ endpoint: endpointKey, token: token.value.trim() });
  try {
    const health = await t.health();
    if (health.status !== 200 || (health.json as { apiVersion?: number } | null)?.apiVersion !== 1) {
      throw new Error('服务协议不兼容，本次未读取或上传数据');
    }
    // 每次读取真实远端；不以旧服务revision的304跳过首次配对检查。
    const remote = await pullSnapshot(t, { ...sync.value, remoteRevision: 0 });
    if (!remote.ok) throw new Error(remote.message ?? '无法确认远端状态，本次未上传');
    const localHash = await snapshotHash(snap);
    if (await snapshotHash(currentSnapshot()) !== localHash) {
      throw new Error('同步期间本地数据已变化，请重新同步');
    }
    if (remote.snapshot) {
      remoteCleared.value = false;
      const remoteHash = await snapshotHash(remote.snapshot);
      const verdict = detectConflict({ localHash, remoteHash, baseHash,
        localDirty: baseHash === null || localHash !== baseHash });
      if (verdict.kind === 'fast_forward') {
        const err = store.applyExternalSnapshot(remote.snapshot);
        if (err) throw new Error(err);
        const appliedGeneration = store.generation.value;
        if (!(await store.flush())) {
          store.restoreBackup();
          throw new Error(store.saveError.value ?? '远端数据尚未保存本机');
        }
        sync.value.remoteRevision = remote.revision ?? 0;
        sync.value.lastSyncedHash = remoteHash;
        sync.value.serviceEndpoint = endpointKey;
        sync.value.generation = store.generation.value;
        sync.value.ackedGeneration = appliedGeneration;
        lastMessage.value = '已从远端拉取最新数据';
        return;
      }
      if (verdict.kind === 'diverged') {
        const copy = makeConflictCopy(remote.revision ?? 0, remote.snapshot, snap, crypto.randomUUID());
        saveConflict({ ...copy, resolution: 'unresolved' });
        if (!listConflicts().some((c) => c.id === copy.id)) throw new Error('无法保存冲突副本，本次未替换数据');
        pendingConflict.value = copy;
        conflict.value = { kind: verdict.kind, message: verdict.message, remoteRevision: remote.revision ?? 0 };
        lastMessage.value = verdict.message;
        refreshConflicts();
        return;
      }
      sync.value.remoteRevision = remote.revision ?? 0;
      if (localHash === remoteHash) {
        sync.value.lastSyncedHash = remoteHash;
        sync.value.serviceEndpoint = endpointKey;
        sync.value.ackedGeneration = sentGeneration;
        sync.value.inflightKey = null;
        sync.value.inflightHash = null;
        lastMessage.value = '已是最新版本';
        return;
      }
    } else if (remote.code === 'DATASET_EMPTY') {
      if (syncedBefore && !allowReinitialize) {
        remoteCleared.value = true;
        confirmReinitialize.value = false;
        lastMessage.value = '远端数据已清空，已停止上传；本机记录保持不变';
        return;
      }
      sync.value.remoteRevision = 0;
    } else { throw new Error('无法确认远端状态，本次未上传'); }

    const key = sync.value.inflightHash === localHash && sync.value.inflightKey
      ? sync.value.inflightKey : crypto.randomUUID();
    sync.value.inflightKey = key;
    sync.value.inflightHash = localHash;
    sync.value.inflightGeneration = sentGeneration;
    sync.value.serviceEndpoint = endpointKey;
    if (!saveSyncState(sync.value)) throw new Error('无法保存同步检查点，本次未上传');
    const result = await pushSnapshot(t, snap, sync.value, { idempotencyKey: key });
    if (!result.ok) {
      sync.value.status = result.retry ? 'pending' : 'blocked';
      if (result.retry) sync.value.retryCount += 1;
      lastMessage.value = result.message ?? '上传失败';
      if (result.retry) lastMessage.value += '；稍后可重试（' + Math.round(backoffMs(sync.value.retryCount) / 1000) + 's）';
      return;
    }
    sync.value.remoteRevision = result.revision ?? sync.value.remoteRevision + 1;
    sync.value.lastSyncedHash = result.snapshotHash ?? localHash;
    sync.value.ackedGeneration = sentGeneration;
    sync.value.generation = store.generation.value;
    sync.value.inflightKey = null;
    sync.value.inflightHash = null;
    sync.value.status = await snapshotHash(currentSnapshot()) === localHash ? 'synced' : 'pending';
    remoteCleared.value = false;
    confirmReinitialize.value = false;
    lastMessage.value = '已上传 · revision ' + sync.value.remoteRevision + (sync.value.status === 'pending' ? '；仍有本地新记录待同步' : '');
    push('同步完成', 'success');
  } catch (e) {
    sync.value.status = 'error';
    lastMessage.value = e instanceof Error ? e.message : '同步失败';
    push(lastMessage.value, 'error');
  } finally {
    sync.value.generation = store.generation.value;
    saveSyncState(sync.value);
    busy.value = false;
  }
}

const savedConflicts = ref(listConflicts());

function refreshConflicts(): void {
  savedConflicts.value = listConflicts();
}

/** 保留远端：用远端快照覆盖本地，并标记冲突已解决。 */
async function keepRemote(): Promise<void> {
  const c = pendingConflict.value;
  if (!c || busy.value) return;
  busy.value = true;
  try {
    const expected = await snapshotHash(c.localSnapshot);
    if (await snapshotHash(currentSnapshot()) !== expected) throw new Error('本地数据已变化，请重新同步后选择');
    const t = httpTransport({ endpoint: endpoint.value.trim(), token: token.value.trim() });
    const latest = await pullSnapshot(t, { ...sync.value, remoteRevision: 0 });
    if (!latest.ok || latest.revision !== c.remoteRevision || !latest.snapshot ||
        await snapshotHash(latest.snapshot) !== await snapshotHash(c.remoteSnapshot)) {
      throw new Error('远端数据已变化，请重新同步后选择');
    }
    if (await snapshotHash(currentSnapshot()) !== expected) throw new Error('本地数据已变化，请重新同步后选择');
    const err = store.applyExternalSnapshot(c.remoteSnapshot);
    if (err) throw new Error(err);
    const appliedGeneration = store.generation.value;
    if (!(await store.flush())) {
      store.restoreBackup();
      throw new Error(store.saveError.value ?? '未能保存远端数据');
    }
    markResolved(c.id, 'kept_remote');
    sync.value.remoteRevision = c.remoteRevision;
    sync.value.lastSyncedHash = await snapshotHash(c.remoteSnapshot);
    sync.value.serviceEndpoint = endpoint.value.trim().replace(/\/$/, '');
    sync.value.generation = store.generation.value;
    sync.value.ackedGeneration = appliedGeneration;
    sync.value.inflightKey = null;
    conflict.value = null;
    pendingConflict.value = null;
    refreshConflicts();
    lastMessage.value = '已用远端版本覆盖本地';
  } catch (e) { push(e instanceof Error ? e.message : '保存失败', 'error'); }
  finally { saveSyncState(sync.value); busy.value = false; }
}

async function keepLocal(): Promise<void> {
  const c = pendingConflict.value;
  if (!c || busy.value) return;
  busy.value = true;
  try {
    const hash = await snapshotHash(c.localSnapshot);
    if (await snapshotHash(currentSnapshot()) !== hash) throw new Error('本地数据已变化，请重新同步后选择');
    if (!(await store.flush())) throw new Error(store.saveError.value ?? '本地数据尚未保存');
    const sentGeneration = store.generation.value;
    const t = httpTransport({ endpoint: endpoint.value.trim(), token: token.value.trim() });
    sync.value.remoteRevision = c.remoteRevision;
    const result = await pushSnapshot(t, c.localSnapshot, sync.value, { idempotencyKey: crypto.randomUUID(), force: true });
    if (!result.ok) throw new Error(result.message ?? '上传失败');
    markResolved(c.id, 'kept_local');
    sync.value.remoteRevision = result.revision ?? c.remoteRevision + 1;
    sync.value.lastSyncedHash = result.snapshotHash ?? hash;
    sync.value.serviceEndpoint = endpoint.value.trim().replace(/\/$/, '');
    sync.value.ackedGeneration = sentGeneration;
    sync.value.inflightKey = null;
    conflict.value = null;
    pendingConflict.value = null;
    refreshConflicts();
    lastMessage.value = '已保留本地版本 · revision ' + sync.value.remoteRevision;
  } catch (e) { push(e instanceof Error ? e.message : '上传失败', 'error'); }
  finally { sync.value.generation = store.generation.value; saveSyncState(sync.value); busy.value = false; }
}

async function restoreRemote(id: string): Promise<void> {
  const c = savedConflicts.value.find((x) => x.id === id);
  if (!c || busy.value) return;
  const err = store.applyExternalSnapshot(c.remoteSnapshot);
  if (err || !(await store.flush())) { push(err ?? store.saveError.value ?? '保存失败', 'error'); return; }
  markResolved(id, 'kept_remote');
  refreshConflicts();
  sync.value.lastSyncedHash = null;
  saveSyncState(sync.value);
  lastMessage.value = '已取回冲突副本中的远端版本';
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
        <input :disabled="busy" v-model="endpoint" class="input" placeholder="http://192.168.1.10:8787" />
      </label>
      <label class="syn__field">
        <span class="tiny">口令</span>
        <input :disabled="busy" v-model="token" class="input" type="password" placeholder="与服务端 SYNC_TOKEN 一致" />
      </label>
    </div>

    <div class="row gap-8" style="margin-top: 12px">
      <button class="btn btn--ghost btn--sm" :disabled="busy" @click="saveConfig">保存</button>
      <button class="btn btn--ghost btn--sm" :disabled="busy" @click="testConnection">测试连接</button>
      <button class="btn btn--lime btn--sm" :disabled="busy || !configured" @click="syncNow()">
        {{ busy ? '同步中…' : '立即同步' }}
      </button>
    </div>

    <p v-if="lastMessage" class="tiny syn__msg">{{ lastMessage }}</p>
    <div v-if="remoteCleared" class="syn__cleared">
      <label><input v-model="confirmReinitialize" type="checkbox" /> 我确认用本机记录重新建立远端数据</label>
      <button class="btn btn--ghost" :disabled="busy || !confirmReinitialize" @click="syncNow(true)">重新建立远端</button>
    </div>

    <div v-if="conflict" class="syn__conflict">
      <p class="h3">请选择保留本地还是远端</p>
      <p class="tiny">{{ conflict.message }}</p>
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











