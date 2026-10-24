# ADR-0002：测试栈、覆盖率与 CI

- 状态：提议
- 日期：2026-10-24
- 决策人：Tech Lead + QA（待签字）
- 关联：02:8、12:9、15 测试方案、14 §8 G1

## 背景

12:9 定义了 D/C/E/P/R 五层，但仓库无测试、无 CI、无夹具。AC-A01、AC-D01/D02、AC-S05/S06 需要故障注入与时钟注入，没有基础设施就无法执行。测试方案见 [15](../15-test-plan.md)。

## 决定

1. **单测/契约**：Vitest（Node 环境），`environment: 'node'`；需要 DOM 的视图测试单独用 `jsdom`。
2. **IDB 替身**：`fake-indexeddb`，并在其上封装可注入的 `storageFaults`（配额、abort、blocked、slow）。
3. **E2E**：Playwright（Chromium 桌面 + Pixel 5 模拟 + 真机 Android Chrome）。
4. **真机**：adb 脚本 + 人工清单；脚本负责安装、强杀、清数据、截图、拉日志。
5. **覆盖率**：v8 provider；门槛见 15 §7（领域 90%、契约状态 100%、AC 100% 有记录）。
6. **CI**：
   - PR：`lint` → `tsc --noEmit` → `vitest run --coverage`（D+C）。
   - 每晚：`playwright test`（E）+ 三年夹具性能抽样。
   - 发布：全量 + 真机 + 证据归档。
7. **依赖锁定**：`package.json` 精确版本（去掉 `^`），提交 `package-lock.json`；CI 用 `npm ci`；Node 版本写入 `.nvmrc` 与 `engines`。
8. **测试命名**：`T-<AC>-<序号><层级>`，文件名与用例标题一致，便于 16 号追踪。
9. **夹具**：`test/fixtures/` 下版本化；三年生成器 `test/fixtures/generate-3y.ts`，固定 seed，输出校验和。

## 替代方案

| 方案 | 不选原因 |
|---|---|
| Jest | ESM/TS 配置成本高；Vitest 与 Vite 同栈 |
| Cypress | 移动端与多上下文支持弱于 Playwright |
| 只做手工测试 | AC-D01/D02/S05/S06 不可复现 |
| 只做单测不做 E2E | 关键旅程（导入导出、冲突、离线）无法验证 |

## 后果

- 正面：AC 可自动回归；故障注入可重复；证据可归档。
- 负面：CI 时间增加（预估 D+C <3 分钟，E <10 分钟）；需要维护夹具。
- 风险：E2E 不稳定；用 `data-testid` 与固定时钟降低波动。

## 验收

- PR 上故意破坏一个领域规则，CI 失败并指向具体 AC。
- 注入配额耗尽，AC-D02 用例通过且不产生虚假成功。
- 三年夹具生成两次，校验和一致。
- `npm ci` 在干净环境可复现构建。
