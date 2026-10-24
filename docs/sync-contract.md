# 同步契约 v1（快照 · 条件写 · 幂等）

版本：1.0；日期：2026-10-25；状态：**契约冻结（G0 阻塞 #8 #9 #10 关闭）**
上位文档：[02 架构](02-architecture.md) 第 3 节；数据模型见 [11](11-data-model.md)；验收见 [12](12-v1-acceptance.md) AC-S01–S09。

本文回答三个此前未定、会导致返工的问题：**快照如何物化并规范化**、**datasetId 如何绑定与删除**、**幂等与条件写的先后顺序**。同时给出 32 MiB 上限的实测决策。

## 1. 快照物化

### 1.1 什么进入快照

快照是"能完整重建用户可见数据"的最小集合，由 [11:118-127] 的设备私有表反向定义：

**进入快照**

| 实体 | 说明 |
|---|---|
| Dataset | id、createdAt、accountingTimezone |
| Profile | 全部字段（过敏/限制确认状态一并） |
| WorkoutSession + SessionExercise + SetRecord | 含 tombstone（`deletedAt` 非空者**保留**） |
| PlannedOccurrence | 含 disposition 与 dispositionReason |
| WeekGoal | 含 adjustments 审计数组 |
| PlanVersion / 自建模板 | 含 daysSnapshot |
| BodyMeasurement | 体重 |
| FoodLog + FoodLogItem | 以 `foodLogId` 关联，扁平化输出 |
| NutritionTargetVersion / NutritionPolicy 引用 | 含 inputsSnapshot |
| AuditEvent | 追加不可变 |

**不进入快照**

| 数据 | 原因 |
|---|---|
| Secret（模型 Key、同步 token） | 设备密钥存储，绝不进业务快照与日志 |
| LocalOutbox / SyncCheckpoint / ConflictCopy | 设备私有同步状态 |
| Draft | 未确认输入，恢复但不参与统计 |
| DevicePreferences | 显示单位等本机偏好 |
| CommandReceipt / SyncLease | 本地去重与租约 |
| 派生投影（DaySummary、PR 缓存） | 可从事实 + ruleVersion 重建 |

### 1.2 物化规则

快照不是"数据库导出"，而是**确定性投影**：

1. **集合排序**：每个实体数组按 `id` 字典序升序排列（不是创建时间）。排序必须在哈希前完成，否则两台设备顺序不同会算出不同哈希。
2. **引用完整性**：SessionExercise 内联于 Session，SetRecord 内联于 SessionExercise；FoodLogItem 扁平化到 `records.foodLogItems[]` 并用 `foodLogId` 关联。内联避免跨实体引用悬空。
3. **tombstone 保留**：删除的会话带 `deletedAt` 留在快照里。**不能**用"从数组移除"表达删除——那会让另一台设备把旧数据当成新数据写回（复活）。同理 occurrence 的 `cancelled` 必须保留。
4. **不写入派生值**：容量、PR、周完成数一律不存，接收端用 `ruleVersion` 重算。
5. **浮点与整数**：重量统一为克（整数），营养统一为 decigram（整数），时间戳统一 ISO 8601 带时区（UTC `Z`）。禁止写入本地化格式。
6. **null 与缺失区分**：字段值 `null` 表示"明确无值"（如未记录次数），字段缺失表示"该版本无此字段"。两者哈希不同，序列化时必须保留 `null`。

### 1.3 canonical 序列化

与 [11:133] 的导出信封共用同一实现（`src/domain/transfer.ts` 的 `canonicalize` / `canonicalJson`）：

- 对象键按字典序递归排序；
- **数组保持原序**（数组顺序本身有语义，且已按 1.2 规则排好）；
- `undefined` 字段整体省略，`null` 保留；
- 不输出空白与换行；
- 数字用 JSON 默认表示，不输出 `-0`（统一转 `0`）。

**哈希**：对 `canonicalJson(snapshot)` 取 SHA-256，输出小写 hex。当前客户端用 FNV-1a 做完整性检查（足够发现截断），**同步场景必须用 SHA-256**，因为要跨设备比对且需抗碰撞。

`snapshotHash` 的作用有三处，缺一不可：

| 用途 | 说明 |
|---|---|
| 变更检测 | 与 `baseSnapshotHash` 相同则无需上传，避免空转 |
| 幂等比对 | 同 Idempotency-Key 但 hash 不同 → 409，而非静默覆盖 |
| 冲突判定 | 三方比对（本地/远端/共同基线）时作为身份标识 |

## 2. datasetId 绑定与删除

### 2.1 绑定

- `datasetId` 在数据集创建时生成一次（`ds_<时间戳36><随机>`），此后**永不改变**，随快照上传。
- 服务端存储 `(datasetId, revision, snapshot, snapshotHash)`，其中 `datasetId` 是主键的一部分。**一个服务实例只服务一个数据集**：`PUT` 携带的 `datasetId` 与已存值不一致时返回 409 `DATASET_MISMATCH`，不覆盖。
- 这样防的是：用户误把 A 数据集的备份推到自己 B 数据集的服务器，导致两套数据互相覆盖。
- 首次 `PUT` 时服务端记录 `datasetId`；后续 `PUT`/`GET`/`DELETE` 都必须匹配。

### 2.2 删除（tombstone 语义分两层）

| 层次 | 含义 | 实现 |
|---|---|---|
| 记录级删除 | 用户删除某场训练 | 实体带 `deletedAt`，**保留在快照内** |
| 数据集级删除 | 用户清空远端 | `DELETE /api/dataset` 删除服务端整份快照与备份，成功 204 |

关键规则：

- **记录级删除绝不能靠"从快照移除"**。移除后，另一台仍持有旧数据的设备下次 `PUT` 会把它写回来（复活）。
- `DELETE /api/dataset` 之后，服务端 `revision` 归零、`datasetId` 清空。此时旧设备的 outbox 若仍 pending，下次 `PUT` 带 `If-None-Match: *` 会**成功**——这是**有意设计**：用户清了远端，本地数据重新上传是符合预期的；界面必须在清空时明确提示"远端数据将重新上传，除非同时清空本机"。
- 服务端删除前保留一份备份（`backup.json`），保留 7 天。

## 3. 幂等与条件写的顺序

这是最容易写错的部分：顺序错了会出现"412 但已写入"或"幂等命中但数据是旧的"。

### 3.1 服务端 PUT 的固定顺序

```
1. 认证 → 401
2. 读取 Idempotency-Key；缺失 → 428
3. 在幂等表中查找该 key
   ├─ 命中且 requestHash 相同 → 200，返回原 status/revision（不再执行任何写）
   ├─ 命中且 requestHash 不同 → 409 IDEMPOTENCY_CONFLICT
   └─ 未命中 → 继续
4. 解析 body；非法 JSON → 400
5. 校验 schema / 引用 / 单位 → 422
6. 校验大小 → 413
7. 校验 datasetId 绑定 → 409 DATASET_MISMATCH
8. 校验条件头
   ├─ 无 If-Match 且无 If-None-Match → 428
   ├─ If-None-Match: * 且已存在 → 412
   └─ If-Match 与当前 revision 不符 → 412
9. 【同一事务内】备份旧快照 → 写新快照 → revision+1 → 写幂等记录
10. 返回 200 {revision, snapshotHash}
```

**为什么幂等查找必须在条件校验之前**：网络超时后客户端用同一 key 重试，此时服务端已提交、revision 已 +1。若先校验条件，客户端的 `If-Match` 仍是旧 revision，会得到 412——客户端会误判为冲突，而实际上它自己的写已经成功。先查幂等表可正确返回原结果。

**为什么第 9 步必须同事务**：备份、写快照、revision 递增、幂等记录四件事任一失败都要整体回滚，否则会出现"revision 涨了但快照没更新"或"幂等记录写了但数据没写"。

### 3.2 幂等记录

```
{ key, datasetId, requestHash, responseStatus, responseRevision, snapshotHash, createdAt }
```

- `requestHash` = SHA-256(canonicalJson({ method, path, datasetId, body }))，用于区分"同键同请求"与"同键异内容"。
- 保留 7 天；超期后同键重试会当作新请求执行，因此客户端不应在 7 天后复用同一 key。
- 幂等按 `key` 主键，**不按** `(key, datasetId)`：一个 key 全局唯一，避免跨数据集串用。

### 3.3 GET

- `GET /api/dataset`：无快照 → 404 `DATASET_EMPTY`；有 → 200，带 `ETag: "<revision>"`。
- 带 `If-None-Match: "<revision>"` 且相同 → **304**，无 body。
- 响应头 `Cache-Control: no-store`，并 `Access-Control-Expose-Headers: ETag, X-Api-Version`，否则浏览器端 JS 读不到 ETag，条件读失效。
- `GET /api/health` 只返回 `{ok, apiVersion, maxSnapshotBytes}`，**不泄露** `stateExists`、文件路径、数据集 id。

### 3.4 DELETE

- 需认证 + `If-Match: "<revision>"` + `Idempotency-Key`。
- 条件不符 → 412；缺条件 → 428；成功 → 204。
- 幂等：同 key 重复 DELETE 返回 204（不报错）。

## 4. 32 MiB 上限决策

### 4.1 实测数据（本次会话先前测量）

按 [11] 字段构造三年数据集：600 会话 / 36,000 组 / 4,000 餐（16,000 条目）/ 1,100 体重。

| 场景 | 快照大小（UTF-8） | 占 32 MiB |
|---|---|---|
| 基线（无审计） | 24.69 MiB | 77% |
| 每 10 组一条审计 | 25.74 MiB | 80% |
| 每组一条审计 | **35.27 MiB** | **110%（超限）** |
| 精简字段 | 18.52 MiB | 58% |

gzip 后基线 3.18 MiB。`JSON.stringify` 404ms / `JSON.parse` 368ms，堆约 162MB。

### 4.2 决策

**保持 32 MiB 作为请求/响应体上限，但增加三条硬约束：**

1. **AuditEvent 不逐组记录**。审计只记计划/目标/日期/关联/删除等**结构性更正**，不记每一次组数据修改。这直接把最坏情况从 35.27 MiB 拉回 25.74 MiB 以内。
2. **服务端上限可配置，并在 `GET /api/health` 公布** `maxSnapshotBytes`。客户端预检时用服务端公布值而非硬编码 32 MiB。
3. **超限不裁剪**。超限时保持本地数据与 pending 状态，提示用户"数据量超出同步上限"，给出导出备份的出路，绝不静默丢弃历史。

**为什么不改用 gzip 传输**：gzip 会把 24.7 MiB 压到 3.2 MiB，看似解决了问题，但引入新的契约面（协商、压缩炸弹防护、流式解压上限）。v1 先用"审计瘦身 + 可配置上限"解决，把 gzip 列入 P2 优化，前提是前两项不够用。

**验收口径**：AC-P08 的"快照在 32 MiB 内不裁剪"现在可度量——用固定夹具生成三年数据，断言 `canonicalJson(snapshot).length ≤ maxSnapshotBytes`。

## 5. 错误码

| 码 | 场景 | 客户端行为 |
|---|---|---|
| 400 | 非法 JSON | 不重试，报错 |
| 401 | 认证失败 | 提示重新配对 |
| 403 | 无权限 | 不重试 |
| 404 | `DATASET_EMPTY` | 首次上传 |
| 409 | `IDEMPOTENCY_CONFLICT` / `DATASET_MISMATCH` | 不重试，需人工处理 |
| 412 | 条件失败 | 拉取远端、三方比对、生成冲突副本 |
| 413 | 超限 | 不重试，提示导出 |
| 422 | schema/引用/单位错误 | 不重试，报错 |
| 428 | 缺条件头 | 客户端 bug，修复后重试 |
| 500 | 服务端错误 | 指数退避重试 |
| 503 | 维护中 | 退避重试 |

## 6. 与既有实现的衔接

| 已实现 | 位置 | 本次补充 |
|---|---|---|
| canonical 序列化 | `src/domain/transfer.ts` | 复用，新增 SHA-256 版本 |
| 导出信封 | 同上 | 快照 = 信封的 `records` 部分 |
| datasetId | `AppState.datasetId` | 已有，绑定规则见 §2 |
| 记录级 tombstone | `Session.deletedAt` | 已有，快照保留规则见 §1.2 |

## 7. 遗留

- 冲突三方 UI（本地/远端/基线）未实现，见 S7 剩余工作。
- 配对流程（二维码/口令）未实现。
- token 轮换与分权未实现（见 ADR-0006）。
