/**
 * 同步服务端的类型声明。
 * 服务端实现是 .mjs（独立于前端构建、可单独部署），
 * 这里为测试提供最小类型，避免测试文件退化成 any。
 */

export interface SyncServerOptions {
  dataDir?: string;
  token?: string | null;
  maxSnapshotBytes?: number;
  now?: () => number;
}

export interface SyncServerStore {
  datasetId: string | null;
  revision: number;
  snapshot: unknown | null;
  snapshotHash: string | null;
  updatedAt: string | null;
}

export interface SyncServer {
  server: unknown;
  load(): Promise<void>;
  state: SyncServerStore;
  listen(port: number, host?: string): Promise<{ port: number }>;
  close(): Promise<void>;
  reset(): void;
}

export function createSyncServer(options?: SyncServerOptions): SyncServer;

