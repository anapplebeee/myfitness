# 架构决策记录（ADR）

本目录记录**实现级**的技术决策：构建、测试、存储、协议、平台、安全。产品范围与业务语义不在这里决定——那属于 [00](../00-v1-baseline.md)、[02](../02-architecture.md)、[09](../09-checkin-model.md)、[11](../11-data-model.md)。

## 规则

- 一份 ADR 只回答一个决策，包含：背景、决定、替代方案、后果、状态。
- 状态取值：`提议` → `接受` → `废止`（被新 ADR 取代时注明编号）。
- 接受后的 ADR 不可原地改写语义；改变决定要新开 ADR。
- ADR 与 02/11/12 冲突时，先改文档再改 ADR，不允许 ADR 偷偷改业务契约。
- 实施顺序见 [14 实施计划](../14-implementation-plan.md)：ADR 必须在 G1（W2 末）前全部接受。

## 清单

| 编号 | 决策 | 状态 | 阻塞的里程碑 |
|---|---|---|---|
| [ADR-0001](ADR-0001-build-and-typescript.md) | 构建工具、TypeScript、模块边界与 lint 规则 | 提议 | G1 |
| [ADR-0002](ADR-0002-test-and-ci.md) | 测试栈、覆盖率、CI 与依赖锁定 | 提议 | G1 |
| [ADR-0003](ADR-0003-indexeddb-schema-and-migration.md) | IndexedDB schema、索引、迁移、配额与多标签页 | 提议 | G1 |
| [ADR-0004](ADR-0004-sync-wire-protocol.md) | 自托管同步 v2：版本化、实例与代次、删除防复活 | 提议（已形成设计决议，待实施验收） | G5 |
| [ADR-0005](ADR-0005-android-toolchain-and-platform.md) | Android 工具链、androidScheme、备份、网络安全配置、安全存储 | 提议 | G5 |
| [ADR-0006](ADR-0006-secret-and-logging.md) | 密钥存储、token 生命周期、日志脱敏与诊断导出 | 提议 | G1 |

## 待开 ADR（按需）

| 主题 | 触发条件 |
|---|---|
| 快照压缩/分片 | 容量 spike 显示 >26 MiB 或上传 >60s |
| 冲突副本 GC | 冲突副本占用超过配额阈值 |
| 内容包签名与发布 | 内容清单 v1 定稿后 |
| PWA 更新策略细化 | SW 原子更新实现评审时 |
| 性能预算与降级 | 4GB 下界机未达标时 |
