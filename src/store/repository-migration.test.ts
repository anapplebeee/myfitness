import { describe, expect, it } from 'vitest';
import { shouldMigrateLegacy } from './repository';

describe('shouldMigrateLegacy', () => {
  it('新库已有数据时绝不迁移：旧库不能覆盖新版本里的记录', () => {
    // 回归用例：原实现无条件把旧库写进新库，
    // 实测"先读到 NEW，随后新库被写成 OLD，第二次读取退回旧数据"。
    expect(shouldMigrateLegacy(true, false)).toBe(false);
  });

  it('新库为空且读取正常时才迁移', () => {
    expect(shouldMigrateLegacy(false, false)).toBe(true);
  });

  it('读取失败时不迁移：读取错误不等于新库为空', () => {
    expect(shouldMigrateLegacy(false, true)).toBe(false);
  });
});
