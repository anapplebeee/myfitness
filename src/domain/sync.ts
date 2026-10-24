/**
 * 同步客户端：outbox 模型、条件写、退避重试、冲突检测。
 * 契约见 docs/sync-contract.md §3、§5。
 *
 * 设计约束（来自 02:33-35）：
 * - 同数据集至多一个在途请求
 * - 成功只确认该请求实际发送的 generation，更晚的本地写仍 pending
 * - 响应丢失时用相同幂等键重试
 */

import { buildSnapshot, checkSnapshotSize, snapshotHash, type Snapshot } from './snapshot';
import type { AppState } from './types';

export type SyncStatus = 'idle' | 'pending' | 'syncing' | 'synced' | 'conflict' | 'blocked' | 'error';

export interface SyncState {
  status: SyncStatus;
  /** 本地单调递增；每次写业务数据 +1 */
  generation: number;
  /** 已成功上传到的 generation */
  ackedGeneration: number;
  /** 远端 revision；0 表示远端为空 */
  remoteRevision: number;
  /** 上次上传时的快照哈希，用于变更检测 */
  lastSyncedHash: string | null;
  /** 在途请求的幂等键，响应丢失时复用以避免重复写 */
  inflightKey: string | null;
  inflightGeneration: number | null;
  lastError: string | null;
  lastErrorCode: string | null;
  retryCount: number;
  lastAttemptAt: string | null;
  /** 服务端公布的上限 */
  maxSnapshotBytes: number;
}

export const INITIAL_SYNC_STATE: SyncState = {
  status: 'idle',
  generation: 0,
  ackedGeneration: 0,
  remoteRevision: 0,
  lastSyncedHash: null,
  inflightKey: null,
  inflightGeneration: null,
  lastError: null,
  lastErrorCode: null,
  retryCount: 0,
  lastAttemptAt: null,
  maxSnapshotBytes: 32 * 1024 * 1024,
};

export interface SyncConfig {
  endpoint: string;
  token: string;
}

/** 可重试的错误码：网络错误、5xx、503。 */
const RETRYABLE = new Set(['NETWORK', 'INTERNAL', 'SERVICE_UNAVAILABLE']);

export function isRetryable(code: string | null): boolean {
  return code !== null && RETRYABLE.has(code);
}

/** 指数退避：1s, 2s, 4s, 8s, 16s, 30s 封顶，带抖动。 */
export function backoffMs(attempt: number, jitter = Math.random()): number {
  const base = Math.min(1000 * 2 ** Math.max(0, attempt - 1), 30000);
  return Math.round(base * (0.8 + jitter * 0.4));
}

export interface PushResult {
  ok: boolean;
  status: number;
  code?: string;
  message?: string;
  revision?: number;
  snapshotHash?: string;
  /** 是否应保留 pending 等待重试 */
  retry: boolean;
  /** 是否需要人工处理（冲突/上限） */
  needsAttention: boolean;
}

export interface PullResult {
  ok: boolean;
  status: number;
  snapshot?: Snapshot;
  revision?: number;
  code?: string;
  message?: string;
  notModified?: boolean;
}

export interface SyncTransport {
  put(
    body: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; json: unknown; etag: string | null }>;
  get(headers: Record<string, string>): Promise<{ status: number; json: unknown; etag: string | null }>;
  remove(headers: Record<string, string>): Promise<{ status: number; json: unknown }>;
  health(): Promise<{ status: number; json: unknown }>;
}

export function httpTransport(config: SyncConfig): SyncTransport {
  const base = config.endpoint.replace(/\/$/, '');
  const auth = { authorization: `Bearer ${config.token}` };
  return {
    async put(body, headers) {
      const res = await fetch(`${base}/api/dataset`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...auth, ...headers },
        body,
      });
      const text = await res.text();
      return { status: res.status, json: safeJson(text), etag: res.headers.get('etag') };
    },
    async get(headers) {
      const res = await fetch(`${base}/api/dataset`, { headers: { ...auth, ...headers } });
      const text = await res.text();
      return { status: res.status, json: safeJson(text), etag: res.headers.get('etag') };
    },
    async remove(headers) {
      const res = await fetch(`${base}/api/dataset`, {
        method: 'DELETE',
        headers: { ...auth, ...headers },
      });
      const text = await res.text();
      return { status: res.status, json: safeJson(text) };
    },
    async health() {
      const res = await fetch(`${base}/api/health`);
      const text = await res.text();
      return { status: res.status, json: safeJson(text) };
    },
  };
}

function safeJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 从错误响应中取 code/message。 */
function errorOf(json: unknown): { code: string; message: string } {
  const j = json as { error?: { code?: string; message?: string } } | null;
  return {
    code: j?.error?.code ?? 'UNKNOWN',
    message: j?.error?.message ?? '未知错误',
  };
}

/**
 * 推送快照。调用方负责在成功后更新 SyncState。
 * 关键：响应丢失（网络错误/超时）时保留 inflightKey，下次复用以保证幂等。
 */
export async function pushSnapshot(
  transport: SyncTransport,
  snapshot: Snapshot,
  sync: SyncState,
  options: { idempotencyKey: string; force?: boolean },
): Promise<PushResult> {
  const size = checkSnapshotSize(snapshot, sync.maxSnapshotBytes);
  if (!size.ok) {
    return {
      ok: false,
      status: 0,
      code: 'SNAPSHOT_TOO_LARGE',
      message: size.message,
      retry: false,
      needsAttention: true,
    };
  }

  const hash = await snapshotHash(snapshot);
  if (!options.force && hash === sync.lastSyncedHash && sync.remoteRevision > 0) {
    return { ok: true, status: 200, revision: sync.remoteRevision, snapshotHash: hash, retry: false, needsAttention: false };
  }

  const conditional: Record<string, string> = {};
  if (sync.remoteRevision === 0) {
    conditional['if-none-match'] = '*';
  } else {
    conditional['if-match'] = `"${sync.remoteRevision}"`;
  }

  const body = JSON.stringify(snapshot);
  let res;
  try {
    res = await transport.put(body, {
      ...conditional,
      'idempotency-key': options.idempotencyKey,
    });
  } catch (e) {
    // 网络层错误：可能已写入，保留幂等键以便重试
    return {
      ok: false,
      status: 0,
      code: 'NETWORK',
      message: e instanceof Error ? e.message : '网络错误',
      retry: true,
      needsAttention: false,
    };
  }

  if (res.status === 200) {
    const j = res.json as { revision?: number; snapshotHash?: string };
    return {
      ok: true,
      status: 200,
      revision: j?.revision,
      snapshotHash: j?.snapshotHash ?? hash,
      retry: false,
      needsAttention: false,
    };
  }

  const err = errorOf(res.json);
  if (res.status === 412) {
    return {
      ok: false,
      status: 412,
      code: 'PRECONDITION_FAILED',
      message: '远端已被其他设备更新',
      retry: false,
      needsAttention: true,
    };
  }
  if (res.status === 409) {
    return {
      ok: false,
      status: 409,
      code: err.code,
      message: err.message,
      retry: false,
      needsAttention: true,
    };
  }
  if (res.status === 413) {
    return {
      ok: false,
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: err.message || '数据超出同步上限',
      retry: false,
      needsAttention: true,
    };
  }
  if (res.status >= 500) {
    return {
      ok: false,
      status: res.status,
      code: err.code === 'UNKNOWN' ? 'INTERNAL' : err.code,
      message: err.message,
      retry: true,
      needsAttention: false,
    };
  }
  // 400/401/422/428：客户端问题，不重试
  return {
    ok: false,
    status: res.status,
    code: err.code,
    message: err.message,
    retry: false,
    needsAttention: res.status === 401,
  };
}

/** 拉取远端快照。 */
export async function pullSnapshot(
  transport: SyncTransport,
  sync: SyncState,
): Promise<PullResult> {
  try {
    const headers: Record<string, string> = {};
    if (sync.remoteRevision > 0) headers['if-none-match'] = `"${sync.remoteRevision}"`;
    const res = await transport.get(headers);
    if (res.status === 304) {
      return { ok: true, status: 304, notModified: true };
    }
    if (res.status === 404) {
      return { ok: true, status: 404, code: 'DATASET_EMPTY' };
    }
    if (res.status === 200) {
      return {
        ok: true,
        status: 200,
        snapshot: res.json as Snapshot,
        revision: Number((res.etag ?? '"0"').replace(/"/g, '')),
      };
    }
    const err = errorOf(res.json);
    return { ok: false, status: res.status, code: err.code, message: err.message };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      code: 'NETWORK',
      message: e instanceof Error ? e.message : '网络错误',
    };
  }
}

// ---------- 冲突检测 ----------

export type ConflictKind = 'none' | 'fast_forward' | 'local_ahead' | 'diverged';

export interface ConflictVerdict {
  kind: ConflictKind;
  /** 给用户看的说明 */
  message: string;
}

/**
 * 三方比对：本地 generation、远端 revision、共同基线（lastSyncedHash）。
 *
 * - 远端没变、本地变了 → 直接推
 * - 本地没变、远端变了 → 直接拉
 * - 都变了 → 分叉，需生成冲突副本
 */
export function detectConflict(args: {
  localHash: string;
  remoteHash: string | null;
  baseHash: string | null;
  localDirty: boolean;
}): ConflictVerdict {
  const { localHash, remoteHash, baseHash, localDirty } = args;

  if (remoteHash === null) {
    return { kind: 'local_ahead', message: '远端为空，可直接上传' };
  }
  if (!localDirty) {
    if (localHash === remoteHash) {
      return { kind: 'none', message: '已是最新' };
    }
    return { kind: 'fast_forward', message: '本地无改动，可拉取远端' };
  }
  if (localHash === remoteHash) {
    return { kind: 'none', message: '本地与远端内容一致' };
  }
  if (baseHash !== null && remoteHash === baseHash) {
    return { kind: 'local_ahead', message: '仅本地有改动，可上传' };
  }
  return { kind: 'diverged', message: '本地与远端都有改动，需要选择保留方式' };
}

/** 冲突副本：把远端版本另存，避免覆盖后无法找回。 */
export interface ConflictCopy {
  id: string;
  createdAt: string;
  remoteRevision: number;
  remoteSnapshot: Snapshot;
  localSnapshot: Snapshot;
}

export function makeConflictCopy(
  remoteRevision: number,
  remote: Snapshot,
  local: Snapshot,
  id: string,
): ConflictCopy {
  return {
    id,
    createdAt: new Date().toISOString(),
    remoteRevision,
    remoteSnapshot: remote,
    localSnapshot: local,
  };
}

/** 构造快照的便捷入口，供 store 调用。 */
export function snapshotFor(state: AppState, ruleVersion = 1): Snapshot {
  return buildSnapshot(state, {
    ruleVersion,
    accountingTimezone: state.profile ? 'Asia/Shanghai' : 'Asia/Shanghai',
  });
}
