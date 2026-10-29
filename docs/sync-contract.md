# 单人自托管同步契约 v2（设计目标）

版本：2.0；日期：2026-10-28；状态：**设计决议，尚未实现和验收**。v2 是不兼容的目标协议；旧客户端和旧服务不能标称支持 v2。商业云见 [28](28-commercial-backend-mvp.md)。
上位文档：[02 架构](02-architecture.md) 第 3 节；数据模型见 [11](11-data-model.md)；验收见 [12](12-v1-acceptance.md) AC-S01–S09。

> 决议：本文是自托管同步的唯一线协议权威；[ADR-0004](adr/ADR-0004-sync-wire-protocol.md) 中的旧 v1 提议已由本文取代。当前客户端只识别 apiVersion=1，旧测试曾允许删除后重新上传；这是实现差距，不是 v2 的行为。不得直接将现有服务宣称为防复活的 v2 服务。

2026-10-26 客户端安全修复是 v1 历史证据，见[回归证据](qa/2026-10-26-data-safety-fixes.md)，不能替代 v2 契约测试。v2 检查点至少绑定服务地址、实例 ID、代次、数据集 ID 与共同基线；首次读取非空远端且没有共同基线须预览，远端落本机成功后才能记录基线。

本文定义目标快照、数据集绑定和删除、条件写与幂等顺序，以及待验证的容量门禁。历史测量不是当前实现或上线通过的证明。

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

v2 选择兼容当前 JavaScript 实现 `src/domain/transfer.ts` 的序列化方式作为目标；跨语言实现必须用固定测试向量复现其输出，不能只按下述文字猜测。导出信封的校验算法与同步哈希各自版本化，不能直接改写旧文件的校验算法：

- 对象递归按 JavaScript `Object.keys(...).sort()` 重建后再按 `JSON.stringify` 输出；数字索引键最终遵循 JavaScript 的属性枚举顺序，其他键按 UTF-16 码元排序；
- **数组保持原序**（数组顺序本身有语义，且已按 1.2 规则排好）；
- `undefined` 字段整体省略，`null` 保留；
- 不输出空白与换行；
- 有限数字使用 ECMAScript `JSON.stringify` 表示，`-0` 输出 `0`；schema 拒绝非有限数、数组 `undefined` 及其他非 JSON 值；字符串不做 NFC 或时间格式的隐式转换，语义校验另行规定。

上述是 v2 目标规则，不保证现有自托管服务已实现全部校验；跨平台测试向量（含数字索引键、Unicode、指数、`-0`、null、缺省、数组顺序）是实施门禁。

**哈希**：对 `canonicalJson(snapshot)` 取 SHA-256，输出小写 hex。当前客户端用 FNV-1a 做完整性检查（足够发现截断），**同步场景必须用 SHA-256**，因为要跨设备比对且需抗碰撞。

`snapshotHash` 的作用有三处，缺一不可：

| 用途 | 说明 |
|---|---|
| 变更检测 | 与 `baseSnapshotHash` 相同则无需上传，避免空转 |
| 幂等比对 | 同 Idempotency-Key 但 hash 不同 → 409，而非静默覆盖 |
| 冲突判定 | 三方比对（本地/远端/共同基线）时作为身份标识 |

## 2. datasetId 绑定与删除

### 2.1 绑定

- `datasetId` 在数据集创建时生成一次，此后不改变，随快照上传；须使用足够随机的稳定 ID，具体生成方案实施前冻结并覆盖碰撞测试。
- 服务端存储 `(datasetId, revision, snapshot, snapshotHash)`，其中 `datasetId` 是主键的一部分。**一个服务实例只服务一个数据集**：`PUT` 携带的 `datasetId` 与已存值不一致时返回 409 `DATASET_MISMATCH`，不覆盖。
- 这样防的是：用户误把 A 数据集的备份推到自己 B 数据集的服务器，导致两套数据互相覆盖。
- 首次 `PUT` 时服务端记录 `datasetId`；后续写入和删除必须匹配；`GET` 返回已绑定的 ID，客户端核对并拒绝不同数据集的静默覆盖。

### 2.2 删除（tombstone 语义分两层）

| 层次 | 含义 | 实现 |
|---|---|---|
| 记录级删除 | 用户删除某场训练 | 实体带 `deletedAt`，**保留在快照内** |
| 数据集级删除 | 用户清空远端 | `DELETE /api/dataset` 删除服务端整份快照与备份，成功 204 |

关键规则：

- **记录级删除绝不能靠"从快照移除"**。移除后，另一台仍持有旧数据的设备下次 `PUT` 会把它写回来（复活）。
- 新服务持久化随机 `instanceId` 与当前随机 `epoch`；数据库状态为 `empty`、`active` 或 `deleted`。健康接口只公开版本及容量；认证 `GET /api/dataset` 在三种状态均返回实例和代次。`empty` 返回 404 `DATASET_EMPTY`，`deleted` 返回 410 `DATASET_DELETED` 及强 ETag `"<epoch>:deleted"`；`active` 返回快照和强 ETag。不得将普通 404 视为空。
- 响应结构固定：active 的 JSON 为 `{state:"active",instanceId,epoch,revision,snapshotHash,snapshot}`；empty/deleted 为 `{state,instanceId,epoch,error:{code}}`。状态信息不来自客户端提交。所有状态的错误响应也携带 `Cache-Control: no-store`；deleted 的状态令牌从 ETag 读取。
- 首次初始化：在认证读取 `empty` 后，经用户明确确认，以 `PUT` 携带 `If-None-Match: *`、`X-Instance-Id`、`X-Dataset-Epoch` 和幂等键；服务端逐项核验后绑定数据集。已有数据使用 `If-Match` 强 ETag 及同样的实例、代次和幂等键。强 ETag 为 `"<epoch>:<revision>"`，revision 不得跨代次比较。
- 删除：认证、`If-Match`、实例/代次及幂等键验证成功后，同一事务删除主快照、所有服务管理的历史备份和旧写入回执，持久化 `deleted` 状态及新随机 epoch，保留本次删除回执 7 天；成功返回 204。墓碑不按时间过期；旧设备旧 epoch 的读取后普通 PUT、`If-None-Match:*` 和旧写入重试均不得复活数据。删除前不另留服务管理的业务备份；用户另存文件不在服务控制范围内。
- 重新启用：用户明确预览并确认后，使用 `POST /api/dataset/reinitialize`，携带最新 deleted 状态 ETag、实例/代次、全新幂等键和新快照；事务内重新绑定并生成新随机 epoch。其他设备必须重新配对和预览。普通 PUT 一律不能初始化 deleted 状态。
- 如果服务数据目录被删除、克隆或从旧备份恢复，旧墓碑不能凭空保证存在。恢复前停止访问；创建新的 `instanceId` 和 epoch、保留恢复点前的删除信息并要求所有设备重新配对；无法确认删除状态时不允许自动恢复在线服务。客户端发现实例变化必须阻塞同步并保留本地。服务与元数据同时丢失时无法承诺消除所有旧副本，需让用户明确选择恢复范围。
- v2 客户端先通过健康接口确认 `apiVersion=2`，再认证读取状态。v1 客户端因版本不兼容不得同步；即使绕过健康检查，v2 服务也必须拒绝缺少实例/代次的写入（428）。服务端从 v1 迁移必须备份、显式导入并生成新实例，旧检查点不能自动沿用。

## 3. 幂等与条件写的顺序

这是最容易写错的部分：顺序错了会出现"412 但已写入"或"幂等命中但数据是旧的"。

### 3.1 服务端 PUT 的固定顺序

```
1. 认证 → 401；限制请求体大小 → 413；读取必须的 key、实例和代次 → 缺失 428
2. 解析请求体，计算覆盖方法、路径、实例、代次、条件和请求体的 requestHash；非法 JSON → 400
3. 在同一事务内检查实例和代次（不匹配 → 409），然后查幂等记录
   ├─ 命中且 requestHash 相同 → 200，返回原 status/revision（不再执行任何写）
   ├─ 命中且 requestHash 不同 → 409 IDEMPOTENCY_CONFLICT
   └─ 未命中 → 继续
4. 检查状态；deleted 的普通 PUT → 409 DATASET_DELETED
5. 校验 schema / 引用 / 单位 → 422
6. 校验 datasetId 绑定 → 409 DATASET_MISMATCH
7. 校验条件头
   ├─ 无 If-Match 且无 If-None-Match → 428
   ├─ If-None-Match: * 且已存在 → 412
   └─ If-Match 与当前 revision 不符 → 412
8. 【同一事务内】备份旧快照 → 写新快照 → revision+1 → 写幂等记录
9. 返回 200 {epoch, revision, snapshotHash} 和强 ETag
```

**为什么幂等查找必须在条件校验之前**：网络超时后客户端用同一 key 重试，此时服务端已提交、revision 已 +1。若先校验条件，客户端的 `If-Match` 仍是旧 revision，会得到 412——客户端会误判为冲突，而实际上它自己的写已经成功。先查幂等表可正确返回原结果。

**为什么第 8 步必须同事务**：备份、写快照、revision 递增、幂等记录四件事任一失败都要整体回滚；删除或代次更换优先于旧写回执，避免误报已同步。

### 3.2 幂等记录

```
{ key, datasetId, requestHash, responseStatus, responseRevision, snapshotHash, createdAt }
```

- `requestHash` = SHA-256(canonicalJson({ method, path, instanceId, epoch, ifMatch, ifNoneMatch, datasetId, body }))；缺省条件固定为 null，用于区分同键同请求与异请求。
- 保留 7 天；超期后同键重试会当作新请求执行，因此客户端不应在 7 天后复用同一 key。
- 幂等按 `key` 主键，**不按** `(key, datasetId)`：一个 key 全局唯一，避免跨数据集串用。

### 3.3 GET

- `GET /api/dataset` 的 empty、active 和 deleted 语义见 §2.2；active 时带 `If-None-Match` 且强 ETag 相同可返回 **304**，无 body。
- 响应头 `Cache-Control: no-store`，并 `Access-Control-Expose-Headers: ETag, X-Api-Version`，否则浏览器端 JS 读不到 ETag，条件读失效。
- `GET /api/health` 只返回 `{ok, apiVersion, maxSnapshotBytes}`，**不泄露** `stateExists`、文件路径、数据集 id。
- 跨域来源须显式允许；OPTIONS 允许 GET、PUT、DELETE、POST，以及 `Authorization, Content-Type, If-Match, If-None-Match, Idempotency-Key, X-Instance-Id, X-Dataset-Epoch`；错误响应也返回适用 CORS 头，不能通配授权来源。

### 3.4 DELETE

- 需认证、`If-Match`、实例/代次和 `Idempotency-Key`；原子删除与墓碑见 §2.2。
- 条件不符 → 412；缺条件 → 428；成功 → 204。
- 幂等：7 天内同删除 key、同请求在本次删除产生的 deleted 状态返回 204；这是核对旧 epoch 前的唯一例外，只查询匹配的删除回执且不执行写入。其他旧写操作不得因旧回执获成功；重新初始化后旧删除回执不得删除新数据。

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

1. **AuditEvent 不逐组记录**。审计只记计划/目标/日期/关联/删除等**结构性更正**，不记每一次组数据修改。旧夹具对应测量为 25.74 MiB，不能据此保证当前数据集的最坏情况。
2. **服务端上限可配置，并在 `GET /api/health` 公布** `maxSnapshotBytes`。客户端预检时用服务端公布值而非硬编码 32 MiB。
3. **超限不裁剪**。超限时保持本地数据与 pending 状态，提示用户"数据量超出同步上限"，给出导出备份的出路，绝不静默丢弃历史。

**为什么不改用 gzip 传输**：gzip 会把 24.7 MiB 压到 3.2 MiB，看似解决了问题，但引入新的契约面（协商、压缩炸弹防护、流式解压上限）。v1 先用"审计瘦身 + 可配置上限"解决，把 gzip 列入 P2 优化，前提是前两项不够用。

**验收口径**：按 AC-P08 使用固定三年数据夹具，断言 UTF-8 编码后的字节数不超过服务公布的上限；超过时保留本地数据。旧测量仅覆盖旧夹具，饮水、提醒等新增数据及设备内存需重新实测。

## 5. 错误码

| 码 | 场景 | 客户端行为 |
|---|---|---|
| 400 | 非法 JSON | 不重试，报错 |
| 401 | 认证失败 | 提示重新配对 |
| 403 | 无权限 | 不重试 |
| 404 | `DATASET_EMPTY` | 首次上传 |
| 410 | `DATASET_DELETED` | 停止上传，明确确认后才可重新初始化 |
| 409 | `IDEMPOTENCY_CONFLICT` / `DATASET_MISMATCH` / `INSTANCE_MISMATCH` / `EPOCH_MISMATCH` / `DATASET_DELETED` | 停止上传，重新核对或人工处理 |
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
