/**
 * 文件存储：单机部署用，零外部依赖。
 *
 * 提交方式：临时文件 → fsync → rename 覆盖 → fsync 目录。
 * rename 在同一文件系统上是原子的，所以读取方要么看到旧整份，要么看到新整份，
 * 不会读到半个 JSON——这是"当前版本、上一版本、revision、幂等回执同事务"的
 * 最低成本实现。
 *
 * 刻意选择**故障关闭**：db.json 解析失败或台账链断裂时直接拒绝启动。
 * 若这时悄悄以空库启动，用户看到的"云端为空"会导致下次上传把删除过的数据
 * 重新写回去；宁可服务不可用，也不能让删除被复活（§5.2）。
 */
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createKeyedLock } from './lock.mjs';
import { verifyLedger } from './ledger.mjs';
import { createState } from './state.mjs';

/** 台账不可信：启动失败，不做只读降级，避免被人当成"正常空库"。 */
export class IntegrityError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'IntegrityError';
    this.code = 'LEDGER_UNVERIFIED';
    this.details = details;
  }
}

async function fsyncDir(dir) {
  try {
    const handle = await open(dir, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Windows 不支持对目录 fsync（EISDIR/EPERM）；rename 的原子性仍然成立，
    // 只是掉电时可能丢失"最后一条目录项"，可接受并在文档中标注。
  }
}

/**
 * @param {{ dir: string }} options
 */
export async function createFileStore({ dir }) {
  const dbPath = join(dir, 'db.json');
  await mkdir(dir, { recursive: true });

  let state;
  try {
    const raw = await readFile(dbPath, 'utf8');
    state = JSON.parse(raw);
    // 旧版本文件可能缺少新集合：补齐但不覆盖已有数据
    state = { ...createState(), ...state };
  } catch (error) {
    if (error.code === 'ENOENT') {
      state = createState();
    } else if (error instanceof SyntaxError) {
      throw new IntegrityError('云端状态文件损坏，服务拒绝启动', { path: dbPath, cause: error.message });
    } else {
      throw error;
    }
  }

  const integrity = verifyLedger(state);
  if (!integrity.ok) {
    throw new IntegrityError('删除台账连续性校验失败，服务拒绝启动', { path: dbPath, ...integrity });
  }

  const lock = createKeyedLock();
  let closed = false;

  async function commit(next) {
    const temp = `${dbPath}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
    const payload = JSON.stringify(next);
    const handle = await open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(payload, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temp, dbPath);
    } catch (error) {
      await unlink(temp).catch(() => {});
      throw error;
    }
    await fsyncDir(dirname(dbPath));
  }

  return {
    kind: 'file',
    path: dbPath,
    async read(fn) {
      return fn(state);
    },
    async transaction(keys, fn) {
      if (closed) throw new Error('存储已关闭');
      return lock.run(keys, async () => {
        const draft = structuredClone(state);
        const { result, persist = true } = await fn(draft);
        if (persist) {
          await commit(draft);
          state = draft;
        }
        return result;
      });
    },
    async close() {
      closed = true;
    },
    debugState() {
      return state;
    },
  };
}
