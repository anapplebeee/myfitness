# ADR-0004：同步线协议

- 状态：提议
- 日期：2026-10-24
- 决策人：Tech Lead（待签字）
- 关联：02:49–82、11:80–92、12:82–90、13 号 3.3

## 背景

02 号定义了 apiVersion=1 的四个端点与错误码，但未定义：canonical JSON（幂等与三方比对都依赖它）、datasetId 绑定、DELETE 墓碑、幂等与条件写的校验顺序、GET 条件读、CORS 预检与 `Expose-Headers`。13 号指出这些不冻结，客户端会与 404/409/412/428 互相打架。

## 决定

### 1. Canonical JSON（`application/vnd.tieguan.canonical+json`）

- 对象键按 UTF-16 码元升序排列；数组保持语义顺序（有序字段）或按 `id` 升序（无序集合：`equipmentIds`、`cues`、`aliases`、`muscleIds`）。
- 数字：整数直接输出；小数用最短往返表示；禁止 `-0`；RPE 用一位小数。
- 字符串：NFC 规范化；不转义非 ASCII；`\n` 统一为 `\n`。
- 空值：缺省字段不输出；显式 `null` 仅用于有语义的字段（如 `deletedAt` 不使用 null，改用缺省）。
- 时间：UTC ISO8601 毫秒精度，`Z` 结尾。
- 哈希：SHA-256，十六进制小写；`snapshotHash` 与导出 `checksum` 使用同一算法。

### 2. datasetId 绑定

- `GET /api/dataset` 返回 `Dataset` 对象，其中 `id` 为服务端绑定的数据集 ID。
- 首次 `PUT` 必须带 `Idempotency-Key` 与 `If-None-Match: *`；服务端写入时绑定 `Dataset.id`。
- 后续 `PUT` 若 `Dataset.id` ≠ 已绑定 ID → `422 DATASET_ID_MISMATCH`，不写入。
- 客户端收到 `DATASET_ID_MISMATCH` 时进入"数据集不匹配"流程：只允许导出本地、打开为独立数据集或显式合并，不允许 adopt revision。

### 3. DELETE 墓碑

- `DELETE` 成功后写 `datasetTombstone{datasetId, deletedAt, revision}`，保留 **90 天**（可配置）。
- 墓碑期内 `GET` 返回 `404 DATASET_DELETED`（与 `DATASET_EMPTY` 区分）；`PUT` 带旧 revision 或 `If-None-Match:*` 均返回 `409 DATASET_DELETED`。
- 重新初始化必须由用户显式确认，并携带 `X-Tieguan-Reinitialize: true` 与新的 `Idempotency-Key`；服务端记录审计。
- 墓碑过期后视为 `DATASET_EMPTY`，但服务端保留删除审计日志（不含业务正文）。

### 4. 幂等与条件写的顺序

服务端在**同一事务**内按以下顺序校验：

1. 认证（401/403）。
2. 请求体大小（413）与 JSON 解析（400）。
3. schema/引用校验（422）。
4. 幂等键查询：同键同请求 → 返回原响应（200/204）；同键异内容 → `409 IDEMPOTENCY_KEY_REUSED`。
5. 条件校验：缺条件 428；`If-Match` 不匹配或 `If-None-Match:*` 已存在 → 412（墓碑场景见 §3）。
6. 写入：保存旧版备份 → 写新快照/revision → 写幂等结果。

幂等记录保留 7 天；超期请求不重放，客户端需先 `GET` 核对 `snapshotHash`，一致则视为成功，不一致进入冲突。

### 5. GET 条件读

- `GET` 支持 `If-None-Match`，命中返回 `304` 与 `ETag`，无正文。
- `ETag` 为强校验值：`"rev-<revision>-<snapshotHash 前 16 位>"`。
- 响应头：`Cache-Control: no-store`、`ETag`、`X-Tieguan-Api-Version: 1`、`X-Tieguan-Max-Snapshot-Bytes`。
- 无 pending 时客户端仍每 24h 或前台恢复时做一次条件读，用于发现远端变更。

### 6. CORS

- 允许来源：同源 + 显式配置的 Capacitor 来源（`https://localhost`、`capacitor://localhost`）。
- `OPTIONS` 返回：`Access-Control-Allow-Methods: GET, PUT, DELETE, OPTIONS`；`Allow-Headers: Authorization, Content-Type, If-Match, If-None-Match, Idempotency-Key, X-Tieguan-Reinitialize`；`Expose-Headers: ETag, X-Tieguan-Api-Version, X-Tieguan-Max-Snapshot-Bytes`；`Max-Age: 600`。
- 错误响应同样带 CORS 头，避免浏览器把 4xx 显示为网络错误。

### 7. 错误码表

| HTTP | code | 含义 |
|---|---|---|
| 400 | `INVALID_JSON` | 解析失败 |
| 401 | `UNAUTHORIZED` | 缺/错 token |
| 403 | `FORBIDDEN` | token 无权访问该数据集 |
| 404 | `DATASET_EMPTY` | 从未初始化 |
| 404 | `DATASET_DELETED` | 已删除且在墓碑期 |
| 409 | `IDEMPOTENCY_KEY_REUSED` | 同键异内容 |
| 409 | `DATASET_DELETED` | 对已删除数据集写入 |
| 412 | `PRECONDITION_FAILED` | 条件不匹配 |
| 413 | `PAYLOAD_TOO_LARGE` | 超过上限 |
| 422 | `SCHEMA_INVALID` / `REFERENCE_INVALID` / `DATASET_ID_MISMATCH` | 校验失败 |
| 428 | `PRECONDITION_REQUIRED` | 缺条件头 |
| 500/503 | `STORAGE_ERROR` / `UNAVAILABLE` | 存储/服务不可用 |

## 替代方案

| 方案 | 不采用原因 |
|---|---|
| 实体级增量同步 | v1 规模不需要，复杂度高（D07） |
| LWW | 会静默丢记录（02:70） |
| 无墓碑直接清空 | 离线设备会复活数据（13 号 5） |
| 弱 ETag | `If-Match` 要求强校验 |

## 后果

- 正面：客户端/服务端可用同一套契约测试；错误可解释；冲突可复现。
- 负面：canonical 实现成本；墓碑需要清理任务。
- 风险：canonical 规则若与 JSON 库默认行为不同，需专门测试（键排序、NFC、数字格式）。

## 验收

- AC-S06 全部错误码
- AC-S09 32MiB 边界
- AC-S08 删除不复活
- 契约测试：同一逻辑对象在不同键序/空格/中文转义下哈希一致。
