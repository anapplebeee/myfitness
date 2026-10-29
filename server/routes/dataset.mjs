/**
 * 云数据集路由：条件写、幂等、版本、替换、重新启用、清空。
 *
 * 写入顺序严格按 §4.2，不能调整：
 *   认证 → 限大小 → 算请求哈希 → 事务内查幂等 → 查代次 → 查条件 → 校验快照 → 提交
 *
 * 为什么幂等必须排在条件之前：
 * 一次成功的 PUT 会把 revision 推进 1，客户端收到响应前断网重试时，
 * 它手里的 If-Match 已经过期（412）。若不先查幂等，重试永远失败，
 * 客户端要么放弃（丢同步）要么绕过条件（静默覆盖）——两种都不可接受。
 */
import { recordAudit } from '../audit.mjs';
import { consumeRecentAuth } from '../auth/sessions.mjs';
import { fail } from '../domain/errors.mjs';
import { emailFingerprint, newId } from '../domain/ids.mjs';
import { measureSnapshot, validateSnapshot } from '../domain/snapshot.mjs';
import { conditionalHeader, datasetEtag, deletionEtag, parseIfMatch } from '../http/io.mjs';
import { appendLedger } from '../store/ledger.mjs';
import {
  archiveCurrentVersion,
  listVersions,
  lookupReceipt,
  pruneVersions,
  purgeExpired,
  requireIdempotencyKey,
  requestFingerprint,
  saveReceipt,
} from './helpers.mjs';

const DATASET_PATH = '/api/cloud/v1/dataset';
const REPLACE_PATH = '/api/cloud/v1/dataset/replace';
const REINIT_PATH = '/api/cloud/v1/dataset/reinitialize';

/** 账号刚建立时数据集记录就该存在；这里兜底，避免密钥冲突导致整支路由空指针。 */
function ensureDataset(state, accountId) {
  let dataset = state.datasets[accountId];
  if (!dataset) {
    dataset = {
      accountId,
      datasetId: newId('ds'),
      epoch: 1,
      status: 'never_initialized',
      revision: 0,
      snapshot: null,
      snapshotHash: null,
      schemaVersion: null,
      ruleVersion: null,
      updatedAt: null,
      deletionId: null,
      deletedAt: null,
    };
    state.datasets[accountId] = dataset;
  }
  return dataset;
}

/** 对外视图：deleted 时绝不回任何快照内容。 */
function publicDataset(dataset, { includeSnapshot = true } = {}) {
  if (dataset.status === 'deleted') {
    return {
      status: 'deleted',
      datasetId: null,
      epoch: dataset.epoch,
      deletionId: dataset.deletionId,
      deletedAt: dataset.deletedAt,
      deleteBy: dataset.deleteBy ?? null,
      etag: deletionEtag(dataset),
    };
  }
  if (dataset.status === 'never_initialized') {
    return {
      status: 'never_initialized',
      datasetId: dataset.datasetId,
      epoch: dataset.epoch,
      revision: 0,
      etag: datasetEtag(dataset),
    };
  }
  return {
    status: 'active',
    datasetId: dataset.datasetId,
    epoch: dataset.epoch,
    revision: dataset.revision,
    snapshotHash: dataset.snapshotHash,
    schemaVersion: dataset.schemaVersion,
    ruleVersion: dataset.ruleVersion,
    updatedAt: dataset.updatedAt,
    etag: datasetEtag(dataset),
    ...(includeSnapshot ? { snapshot: dataset.snapshot } : {}),
  };
}

function replayResponse(receipt) {
  return {
    status: receipt.status,
    body: receipt.body,
    headers: { ...receipt.headers, 'Idempotent-Replay': 'true' },
  };
}

/**
 * @param {ReturnType<import('../http/router.mjs').createRouter>} router
 */
export function registerDatasetRoutes(router) {
  /* ---------- 读取当前数据集 ---------- */
  router.get(DATASET_PATH, async (ctx) => {
    const identity = await ctx.authenticate();
    const dataset = await ctx.store.read((state) => {
      const record = state.datasets[identity.accountId];
      return record ? { ...record } : null;
    });
    if (!dataset) throw fail.notFound();
    const body = publicDataset(dataset);
    return { status: 200, body, headers: { ETag: body.etag } };
  });

  /* ---------- 条件写 ---------- */
  router.put(DATASET_PATH, async (ctx) => {
    const identity = await ctx.authenticate();
    const key = requireIdempotencyKey(ctx.req);
    const body = await ctx.json();

    // 体积先于一切：不能让一个 1 GiB 的快照进事务
    const measured = measureSnapshot(body?.snapshot, ctx.config.maxSnapshotBytes);
    const epochInput = Number.isInteger(body?.epoch) ? body.epoch : null;
    const ifMatch = conditionalHeader(ctx.req, 'if-match');
    const ifNone = conditionalHeader(ctx.req, 'if-none-match');
    if (!ifMatch && !ifNone) {
      throw fail.conditionRequired('更新需要 If-Match，初始化需要 If-None-Match: *');
    }
    if (ifMatch && ifNone) {
      throw fail.conditionRequired('If-Match 与 If-None-Match 不能同时出现');
    }

    const requestHash = requestFingerprint({
      method: 'PUT',
      path: DATASET_PATH,
      epoch: epochInput,
      ifMatch,
      ifNoneMatch: ifNone,
      hash: measured.hash,
    });

    return ctx.store.transaction(
      [`account:${identity.accountId}`, `dataset:${identity.accountId}`],
      (state) => {
        purgeExpired(state, ctx.now);

        const replay = lookupReceipt(state, {
          accountId: identity.accountId,
          method: 'PUT',
          path: DATASET_PATH,
          key,
          requestHash,
        });
        if (replay) return { result: replayResponse(replay) };

        const dataset = ensureDataset(state, identity.accountId);

        if (epochInput !== null && epochInput !== dataset.epoch) {
          throw fail.conflict('EPOCH_MISMATCH', `数据集代次已变化，当前代次为 ${dataset.epoch}`);
        }
        if (dataset.status === 'deleted') {
          throw fail.conflict('DATASET_DELETED', '云端数据已清空，需要重新启用');
        }

        const initializing = dataset.status === 'never_initialized';
        if (initializing) {
          if (ifNone?.trim() !== '*') {
            throw fail.precondition('CONDITION_MISMATCH', '云端尚无数据，请使用 If-None-Match: *');
          }
        } else if (ifNone) {
          // 云端已有数据时再用 `If-None-Match: *`：这是"以为自己是第一个"的典型误用
          throw fail.precondition('DATASET_EXISTS', '云端已有数据，不能再次初始化');
        } else {
          const current = datasetEtag(dataset);
          const matches = parseIfMatch(ctx.req) ?? [];
          if (!matches.includes(current)) {
            throw fail.precondition('REVISION_CHANGED', '云端版本已变化，请重新读取后再写');
          }
        }

        const validated = validateSnapshot({
          raw: body.snapshot,
          maxBytes: ctx.config.maxSnapshotBytes,
          assignDatasetId: initializing ? dataset.datasetId : undefined,
          expectDatasetId: initializing ? undefined : dataset.datasetId,
          precomputed: measured,
        });

        if (initializing) {
          dataset.status = 'active';
          dataset.revision = 1;
        } else {
          archiveCurrentVersion(state, dataset, ctx.now);
          dataset.revision += 1;
        }
        dataset.snapshot = validated.snapshot;
        dataset.snapshotHash = validated.hash;
        dataset.schemaVersion = validated.snapshot.schemaVersion;
        dataset.ruleVersion = validated.snapshot.ruleVersion;
        dataset.updatedAt = ctx.now.toISOString();
        pruneVersions(state, identity.accountId, ctx.now, ctx.config);
        ctx.touches.apply(state);

        const view = publicDataset(dataset, { includeSnapshot: false });
        const headers = { ETag: view.etag };
        saveReceipt(
          state,
          {
            accountId: identity.accountId,
            method: 'PUT',
            path: DATASET_PATH,
            key,
            requestHash,
            status: 200,
            body: view,
            headers,
            operation: initializing ? 'initialize' : 'update',
          },
          { now: ctx.now, config: ctx.config },
        );
        recordAudit(state, {
          at: ctx.now.toISOString(),
          action: initializing ? 'dataset.initialize' : 'dataset.update',
          outcome: 'ok',
          accountHash: emailFingerprint(identity.accountId),
          requestId: ctx.requestId,
          meta: {
            revision: dataset.revision,
            epoch: dataset.epoch,
            bytes: validated.bytes,
            clientHashMismatch: validated.clientHashMismatch,
          },
        });

        return { result: { status: 200, body: view, headers } };
      },
    );
  });

  /* ---------- 历史版本 ---------- */
  router.get('/api/cloud/v1/dataset/versions', async (ctx) => {
    const identity = await ctx.authenticate();
    const versions = await ctx.store.read((state) =>
      listVersions(state, identity.accountId, ctx.now, ctx.config),
    );
    return { status: 200, body: { versions } };
  });

  router.get('/api/cloud/v1/dataset/versions/{versionId}', async (ctx) => {
    const identity = await ctx.authenticate();
    const version = await ctx.store.read((state) => state.versions[ctx.params.versionId] ?? null);
    // 他人版本一律 404：不透露"这个版本存在但不属于你"
    if (!version || version.accountId !== identity.accountId) throw fail.notFound();
    return { status: 200, body: { ...version } };
  });

  /* ---------- 用本机替换云端（换 datasetId 与代次） ---------- */
  router.post(REPLACE_PATH, async (ctx) => {
    const identity = await ctx.authenticate();
    const key = requireIdempotencyKey(ctx.req);
    const body = await ctx.json();
    const measured = measureSnapshot(body?.snapshot, ctx.config.maxSnapshotBytes);
    const ifMatch = conditionalHeader(ctx.req, 'if-match');
    if (!ifMatch) throw fail.conditionRequired('替换云端需要 If-Match 当前版本');
    const epochInput = Number.isInteger(body?.epoch) ? body.epoch : null;
    const requestHash = requestFingerprint({
      method: 'POST',
      path: REPLACE_PATH,
      epoch: epochInput,
      ifMatch,
      ifNoneMatch: null,
      hash: measured.hash,
    });

    return ctx.store.transaction(
      [`account:${identity.accountId}`, `dataset:${identity.accountId}`],
      (state) => {
        purgeExpired(state, ctx.now);
        const replay = lookupReceipt(state, {
          accountId: identity.accountId,
          method: 'POST',
          path: REPLACE_PATH,
          key,
          requestHash,
        });
        if (replay) return { result: replayResponse(replay) };

        const dataset = ensureDataset(state, identity.accountId);
        if (dataset.status !== 'active') {
          throw fail.precondition('DATASET_NOT_ACTIVE', '只有在云端已有数据时才需要替换');
        }
        if (epochInput !== null && epochInput !== dataset.epoch) {
          throw fail.conflict('EPOCH_MISMATCH', `数据集代次已变化，当前代次为 ${dataset.epoch}`);
        }
        const matches = parseIfMatch(ctx.req) ?? [];
        if (!matches.includes(datasetEtag(dataset))) {
          throw fail.precondition('REVISION_CHANGED', '云端版本已变化，请重新读取后再替换');
        }

        const previousDatasetId = dataset.datasetId;
        // 旧数据进历史版本，用户仍可恢复（CB-A25）
        archiveCurrentVersion(state, dataset, ctx.now);

        const newDatasetId = newId('ds');
        const validated = validateSnapshot({
          raw: body.snapshot,
          maxBytes: ctx.config.maxSnapshotBytes,
          assignDatasetId: newDatasetId,
          precomputed: measured,
        });

        dataset.datasetId = newDatasetId;
        dataset.epoch += 1;
        dataset.revision = 1;
        dataset.snapshot = validated.snapshot;
        dataset.snapshotHash = validated.hash;
        dataset.schemaVersion = validated.snapshot.schemaVersion;
        dataset.ruleVersion = validated.snapshot.ruleVersion;
        dataset.updatedAt = ctx.now.toISOString();
        pruneVersions(state, identity.accountId, ctx.now, ctx.config);
        ctx.touches.apply(state);

        const view = { ...publicDataset(dataset, { includeSnapshot: false }), previousDatasetId };
        const headers = { ETag: view.etag };
        saveReceipt(
          state,
          {
            accountId: identity.accountId,
            method: 'POST',
            path: REPLACE_PATH,
            key,
            requestHash,
            status: 200,
            body: view,
            headers,
            operation: 'replace',
          },
          { now: ctx.now, config: ctx.config },
        );
        appendLedger(state, {
          at: ctx.now.toISOString(),
          kind: 'dataset_replace',
          accountHash: emailFingerprint(identity.accountId),
          ref: newDatasetId,
        });
        recordAudit(state, {
          at: ctx.now.toISOString(),
          action: 'dataset.replace',
          outcome: 'ok',
          accountHash: emailFingerprint(identity.accountId),
          requestId: ctx.requestId,
          meta: { previousDatasetId, epoch: dataset.epoch },
        });

        return { result: { status: 200, body: view, headers } };
      },
    );
  });

  /* ---------- 删除后重新启用 ---------- */
  router.post(REINIT_PATH, async (ctx) => {
    const identity = await ctx.authenticate();
    const key = requireIdempotencyKey(ctx.req);
    const body = await ctx.json();
    const measured = measureSnapshot(body?.snapshot, ctx.config.maxSnapshotBytes);
    const ifMatch = conditionalHeader(ctx.req, 'if-match');
    if (!ifMatch) throw fail.conditionRequired('重新启用需要删除代次令牌（If-Match）');
    const requestHash = requestFingerprint({
      method: 'POST',
      path: REINIT_PATH,
      epoch: null,
      ifMatch,
      ifNoneMatch: null,
      hash: measured.hash,
    });

    return ctx.store.transaction(
      [`account:${identity.accountId}`, `dataset:${identity.accountId}`],
      (state) => {
        purgeExpired(state, ctx.now);
        const replay = lookupReceipt(state, {
          accountId: identity.accountId,
          method: 'POST',
          path: REINIT_PATH,
          key,
          requestHash,
        });
        if (replay) return { result: replayResponse(replay) };

        const dataset = ensureDataset(state, identity.accountId);
        if (dataset.status !== 'deleted') {
          throw fail.conflict('DATASET_NOT_DELETED', '只有已清空的云端数据才能重新启用');
        }
        const matches = parseIfMatch(ctx.req) ?? [];
        if (!matches.includes(deletionEtag(dataset))) {
          throw fail.precondition('DELETION_TOKEN_STALE', '删除代次已变化，请重新读取云端状态');
        }

        const newDatasetId = newId('ds');
        const validated = validateSnapshot({
          raw: body.snapshot,
          maxBytes: ctx.config.maxSnapshotBytes,
          assignDatasetId: newDatasetId,
          precomputed: measured,
        });

        dataset.datasetId = newDatasetId;
        dataset.epoch += 1;
        dataset.status = 'active';
        dataset.revision = 1;
        dataset.snapshot = validated.snapshot;
        dataset.snapshotHash = validated.hash;
        dataset.schemaVersion = validated.snapshot.schemaVersion;
        dataset.ruleVersion = validated.snapshot.ruleVersion;
        dataset.updatedAt = ctx.now.toISOString();
        dataset.deletionId = null;
        dataset.deletedAt = null;
        dataset.deleteBy = null;
        ctx.touches.apply(state);

        const view = publicDataset(dataset, { includeSnapshot: false });
        const headers = { ETag: view.etag };
        saveReceipt(
          state,
          {
            accountId: identity.accountId,
            method: 'POST',
            path: REINIT_PATH,
            key,
            requestHash,
            status: 201,
            body: view,
            headers,
            operation: 'reinitialize',
          },
          { now: ctx.now, config: ctx.config },
        );
        appendLedger(state, {
          at: ctx.now.toISOString(),
          kind: 'dataset_reinitialize',
          accountHash: emailFingerprint(identity.accountId),
          ref: newDatasetId,
        });
        recordAudit(state, {
          at: ctx.now.toISOString(),
          action: 'dataset.reinitialize',
          outcome: 'ok',
          accountHash: emailFingerprint(identity.accountId),
          requestId: ctx.requestId,
          meta: { epoch: dataset.epoch },
        });

        return { result: { status: 201, body: view, headers } };
      },
    );
  });

  /* ---------- 清空云端 ---------- */
  router.delete(DATASET_PATH, async (ctx) => {
    const identity = await ctx.authenticate();
    const key = requireIdempotencyKey(ctx.req);
    const recentAuth = ctx.req.headers['x-recent-auth'];
    const ifMatch = conditionalHeader(ctx.req, 'if-match');
    if (!ifMatch) throw fail.conditionRequired('清空云端需要 If-Match 当前版本');

    const requestHash = requestFingerprint({
      method: 'DELETE',
      path: DATASET_PATH,
      epoch: null,
      ifMatch,
      ifNoneMatch: null,
      hash: null,
    });

    return ctx.store.transaction(
      [`account:${identity.accountId}`, `dataset:${identity.accountId}`],
      (state) => {
        purgeExpired(state, ctx.now);
        const replay = lookupReceipt(state, {
          accountId: identity.accountId,
          method: 'DELETE',
          path: DATASET_PATH,
          key,
          requestHash,
        });
        if (replay) return { result: replayResponse(replay) };

        const dataset = ensureDataset(state, identity.accountId);
        if (dataset.status === 'deleted') {
          throw fail.conflict('DATASET_DELETED', '云端数据已经清空');
        }
        const matches = parseIfMatch(ctx.req) ?? [];
        if (!matches.includes(datasetEtag(dataset))) {
          throw fail.precondition('REVISION_CHANGED', '云端版本已变化，请重新读取后再清空');
        }
        consumeRecentAuth(state, {
          token: typeof recentAuth === 'string' ? recentAuth : '',
          accountId: identity.accountId,
          purpose: 'delete_dataset',
          now: ctx.now,
        });

        const deletionId = newId('del');
        dataset.status = 'deleted';
        dataset.epoch += 1;
        dataset.deletionId = deletionId;
        dataset.deletedAt = ctx.now.toISOString();
        dataset.deleteBy = new Date(ctx.now.getTime() + 86_400_000).toISOString();
        dataset.revision = 0;
        dataset.snapshot = null;
        dataset.snapshotHash = null;
        dataset.schemaVersion = null;
        dataset.ruleVersion = null;
        dataset.updatedAt = null;

        // 历史版本一并删除：清空即清空，不留"可恢复"的口子
        for (const [id, version] of Object.entries(state.versions)) {
          if (version.accountId === identity.accountId) delete state.versions[id];
        }

        const view = publicDataset(dataset);
        appendLedger(state, {
          at: ctx.now.toISOString(),
          kind: 'dataset_delete',
          accountHash: emailFingerprint(identity.accountId),
          deletionId,
          ref: null,
        });
        saveReceipt(
          state,
          {
            accountId: identity.accountId,
            method: 'DELETE',
            path: DATASET_PATH,
            key,
            requestHash,
            status: 202,
            body: view,
            headers: {},
            operation: 'delete',
          },
          { now: ctx.now, config: ctx.config },
        );
        recordAudit(state, {
          at: ctx.now.toISOString(),
          action: 'dataset.delete',
          outcome: 'accepted',
          accountHash: emailFingerprint(identity.accountId),
          requestId: ctx.requestId,
          meta: { epoch: dataset.epoch },
        });

        return { result: { status: 202, body: view } };
      },
    );
  });
}
