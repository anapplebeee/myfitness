/**
 * 存储层测试：原子提交、事务回滚、台账篡改检测。
 *
 * 这些性质无法从 HTTP 层观察到，但它们决定"数据会不会莫名其妙少一条"，
 * 所以单独测，而且直接测文件。
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { appendLedger, verifyLedger } from '../store/ledger.mjs';
import { IntegrityError, createFileStore } from '../store/file.mjs';
import { createMemoryStore } from '../store/memory.mjs';

/** @type {string} */
let dir;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lianji-cloud-'));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('文件存储', () => {
  it('提交后重新打开数据仍在', async () => {
    const path = join(dir, 'persist');
    const first = await createFileStore({ dir: path });
    await first.transaction(['k'], (state) => {
      state.accounts.acc1 = { accountId: 'acc1', status: 'active' };
      appendLedger(state, { at: '2026-10-29T02:00:00.000Z', kind: 'dataset_update' });
      return { result: null };
    });
    await first.close();

    const second = await createFileStore({ dir: path });
    const accounts = await second.read((state) => Object.keys(state.accounts));
    const ledger = await second.read((state) => state.ledger.length);
    await second.close();

    assert.deepEqual(accounts, ['acc1']);
    assert.equal(ledger, 1);
  });

  it('事务抛错不留半截状态', async () => {
    const path = join(dir, 'rollback');
    const store = await createFileStore({ dir: path });

    await assert.rejects(
      store.transaction(['k'], (state) => {
        state.accounts.leak = { accountId: 'leak' };
        throw new Error('boom');
      }),
      /boom/,
    );

    const accounts = await store.read((state) => Object.keys(state.accounts));
    assert.deepEqual(accounts, []);
    await store.close();
  });

  it('同一 key 的事务串行执行', async () => {
    const store = createMemoryStore();
    await store.transaction(['counter'], (state) => {
      state.accounts.counter = { value: 0 };
      return { result: null };
    });

    await Promise.all(
      Array.from({ length: 20 }, () =>
        store.transaction(['counter'], (state) => {
          state.accounts.counter.value += 1;
          return { result: null };
        }),
      ),
    );

    const value = await store.read((state) => state.accounts.counter.value);
    assert.equal(value, 20);
  });

  it('不同 key 的事务不会互相等待出死锁', async () => {
    const store = createMemoryStore();
    await store.transaction(['a', 'b'], (state) => {
      state.accounts.a = { value: 0 };
      state.accounts.b = { value: 0 };
      return { result: null };
    });

    await Promise.all([
      store.transaction(['a', 'b'], (state) => {
        state.accounts.a.value += 1;
        return { result: null };
      }),
      store.transaction(['b', 'a'], (state) => {
        state.accounts.b.value += 1;
        return { result: null };
      }),
    ]);

    const snapshot = await store.read((state) => ({ ...state.accounts }));
    assert.equal(snapshot.a.value, 1);
    assert.equal(snapshot.b.value, 1);
  });
});

describe('台账完整性', () => {
  it('哈希链连续时校验通过', async () => {
    const store = createMemoryStore();
    await store.transaction(['k'], (state) => {
      appendLedger(state, { at: '2026-10-29T02:00:00.000Z', kind: 'dataset_delete', deletionId: 'del1' });
      appendLedger(state, { at: '2026-10-29T02:01:00.000Z', kind: 'account_delete', ref: 'job1' });
      return { result: null };
    });
    const result = await store.read((state) => verifyLedger(state));
    assert.equal(result.ok, true);
  });

  it('篡改任意一条台账后拒绝启动', async () => {
    const path = join(dir, 'tamper');
    const store = await createFileStore({ dir: path });
    await store.transaction(['k'], (state) => {
      appendLedger(state, { at: '2026-10-29T02:00:00.000Z', kind: 'dataset_delete', deletionId: 'del1' });
      return { result: null };
    });
    await store.close();

    const dbPath = join(path, 'db.json');
    const parsed = JSON.parse(await readFile(dbPath, 'utf8'));
    parsed.ledger[0].ref = 'forged';
    await writeFile(dbPath, JSON.stringify(parsed), 'utf8');

    await assert.rejects(createFileStore({ dir: path }), (error) => {
      assert.ok(error instanceof IntegrityError);
      assert.equal(error.code, 'LEDGER_UNVERIFIED');
      return true;
    });
  });

  it('状态文件损坏时拒绝启动，不静默当空库', async () => {
    const path = join(dir, 'corrupt');
    const store = await createFileStore({ dir: path });
    await store.close();
    await writeFile(join(path, 'db.json'), '{"accounts": {', 'utf8');

    await assert.rejects(createFileStore({ dir: path }), (error) => {
      assert.ok(error instanceof IntegrityError);
      return true;
    });
  });
});
