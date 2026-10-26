# ADR-0003：IndexedDB schema、索引、迁移与配额

- 状态：提议
- 日期：2026-10-24
- 决策人：Tech Lead（待签字）
- 关联：02:9/33/39/98、11:8/80/86、12:69–71

## 背景

> 2026-10-26实现说明：本文后续分实体/事务/outbox结构仍为提议，不等于当前已实现。当前修复使用原有DB v1的state/app快照：写入前JSON物化去除全部Vue代理，设备副本附加单调保存序号 __persistedAt；两副本读取较新者，字段从业务状态剔除。写入串行、至少一份成功才返回成功、双失败报错。未知业务版本和读取错误阻塞启动，禁止自动播种。详见[修复记录](../qa/2026-10-26-data-safety-fixes.md)。本次不宣称完成跨标签页租约、分表迁移或业务/outbox同事务门禁。

02:9 规定 IndexedDB 为默认存储，但未定义 object store、索引、迁移、配额、多标签页与租约。13 号指出：三年数据快照 24.7–35.3 MiB，IDB 驱逐与迁移备份位置会直接影响"数据不丢"承诺。

## 决定

1. **数据库**：`tieguan`，`version = schemaVersion`；每个数据集一个逻辑分区，使用 `datasetId` 前缀键或独立 DB（二选一，见下）。
2. **分区方式**：**单 DB + `datasetId` 字段 + 复合索引**（不采用每数据集一 DB，避免连接数爆炸与迁移复杂）。所有事实 store 的主键为 `[datasetId, id]`，索引均带 `datasetId` 前缀。
3. **Object stores**（v1）：
   | store | 主键 | 索引 |
   |---|---|---|
   | `datasets` | `id` | — |
   | `profiles` | `[datasetId, id]` | `datasetId` |
   | `exercises` | `[datasetId, id]` | `datasetId, name` |
   | `planTemplates` | `[datasetId, id]` | `datasetId` |
   | `planVersions` | `[datasetId, id]` | `datasetId, effectiveDate` |
   | `occurrences` | `[datasetId, id]` | `datasetId, weekStart`, `[datasetId, scheduledDate]` |
   | `weekGoals` | `[datasetId, weekStart]` | `datasetId` |
   | `sessions` | `[datasetId, id]` | `datasetId, businessDate`, `[datasetId, status]` |
   | `sessionExercises` | `[datasetId, id]` | `[datasetId, sessionId]` |
   | `sets` | `[datasetId, id]` | `[datasetId, sessionExerciseId]`, `[datasetId, completedAt]` |
   | `bodyMeasurements` | `[datasetId, id]` | `[datasetId, businessDate]` |
   | `foodLogs` | `[datasetId, id]` | `[datasetId, businessDate]` |
   | `foodLogItems` | `[datasetId, id]` | `[datasetId, foodLogId]` |
   | `nutritionDays` | `[datasetId, businessDate]` | `datasetId` |
   | `nutritionTargets` | `[datasetId, id]` | `datasetId, effectiveDate` |
   | `recommendations` | `[datasetId, id]` | `datasetId, status` |
   | `messages` | `[datasetId, id]` | `datasetId, createdAt` |
   | `audits` | `[datasetId, id]` | `[datasetId, entityType, entityId]` |
   | `outbox` | `datasetId` | — |
   | `checkpoints` | `datasetId` | — |
   | `conflicts` | `[datasetId, id]` | `datasetId, createdAt` |
   | `drafts` | `[datasetId, key]` | — |
   | `receipts` | `[datasetId, commandId]` | — |
   | `lease` | `datasetId` | — |
4. **事务**：所有写经 `LocalRepository.transaction()`；事务体内**禁止 await 非 IDB Promise**（lint 规则 + code review）；返回 `CommitResult` 四态。
5. **迁移**：`onupgradeneeded` 逐版执行 `migrations[n]`；迁移前把当前快照写入 OPFS（`navigator.storage.getDirectory()`）并校验；失败保持旧库并进入只读诊断模式；未来版本拒绝写。
6. **多标签页**：`BroadcastChannel('tieguan')` 广播失效；`versionchange` 时关闭连接并提示刷新；`onblocked` 显示"请关闭其他页面"。
7. **租约**：`lease` 存 `holderId, expiresAt, fencingToken`；TTL 30s，每 10s 续期；写入前校验 token，过期可接管。
8. **配额**：
   - 启动时 `navigator.storage.estimate()`；剩余 < 2×当前快照 → 提示导出并暂停同步。
   - 首次进入训练前请求 `navigator.storage.persist()`；被拒时在"我的"显示持久化状态与建议。
   - `QuotaExceededError` 统一映射为 `storageError`，保留输入，不清理历史。
9. **驱逐检测**：启动读取 `datasets` 元数据与 `checkpoint`，若本地有配对但数据缺失 → 进入"本地数据缺失"恢复流程，禁止自动用远端覆盖（02:37）。
10. **备份**：升级/替换导入前写 OPFS 快照；保留最近 2 份，校验失败不继续。

## 替代方案

| 方案 | 不采用原因 |
|---|---|
| 每数据集一 DB | 连接与迁移复杂，多标签页阻塞风险高 |
| 原生 SQLite（Capacitor 插件） | 双后端维护成本；02:9 要求先验证 IDB |
| localStorage | 容量与事务不满足 |
| 不分区，单数据集 | 与 11:9 多数据集冲突 |

## 后果

- 正面：索引覆盖主要查询；迁移与备份路径明确；配额可观测。
- 负面：复合主键使部分查询需带 `datasetId`；OPFS 兼容性需真机验证（Android WebView 版本）。
- 风险：WebView 不支持 OPFS 时降级为 IDB 备份；需在 ADR 接受前实测。

## 验收

- AC-D01：强杀 20 次恢复。
- AC-D02：配额/中断注入，四态正确。
- AC-D03：迁移中途失败保持旧库；未来 schema 拒写。
- 三年数据：录组 P95 ≤300ms，90 天查询 P95 ≤500ms。
