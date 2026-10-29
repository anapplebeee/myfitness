# 商业云后端（`/api/cloud/v1`）

零依赖 Node 20+ 模块化单体。设计基线见 [docs/28-commercial-backend-mvp.md](../docs/28-commercial-backend-mvp.md)，
实施说明与差距清单见 [docs/29-cloud-backend-implementation.md](../docs/29-cloud-backend-implementation.md)。

**当前状态：内测实现。** 通过 54 项契约测试；不满足对外发布门禁（原因见 docs/29 §5）。

## 跑起来

```bash
# 开发（默认数据目录 var/cloud，自动派生开发密钥）
npm run server

# 指定端口与数据目录
CLOUD_PORT=8787 CLOUD_DATA_DIR=./var/cloud npm run server

# 开发时想真收验证码（写入本地 JSONL，仅开发用）
CLOUD_MAILER=file npm run server
# → .tmp/cloud-mail.jsonl，每行一条 {to, code, purpose}

# 契约测试
npm run test:server
```

生产环境会**拒绝启动**，除非：

```bash
CLOUD_TOKEN_SECRET=<32+ 字符随机>
CLOUD_OTP_SECRET=<32+ 字符随机>
CLOUD_MAILER=webhook
CLOUD_MAIL_WEBHOOK_URL=https://<邮件服务商>
CLOUD_HOST=0.0.0.0
```

## 配置

| 变量 | 默认 | 说明 |
|---|---|---|
| `CLOUD_PORT` / `CLOUD_HOST` | `8787` / `127.0.0.1` | 监听地址 |
| `CLOUD_DATA_DIR` | `var/cloud` | 文件存储目录（`db.json`） |
| `CLOUD_TOKEN_SECRET` | 开发密钥 | 访问令牌签名；生产必填 |
| `CLOUD_OTP_SECRET` | 开发密钥 | 验证码 HMAC 摘要；生产必填 |
| `CLOUD_ACCESS_TTL_SECONDS` | `900` | 访问令牌有效期 |
| `CLOUD_REFRESH_TTL_DAYS` | `30` | 刷新令牌有效期 |
| `CLOUD_OTP_TTL_SECONDS` | `600` | 验证码有效期 |
| `CLOUD_OTP_MAX_ATTEMPTS` | `5` | 单次挑战允许的错误次数 |
| `CLOUD_MAX_SNAPSHOT_BYTES` | `67108864` | 快照上限（规范化 UTF-8 字节） |
| `CLOUD_MAX_BODY_BYTES` | 快照上限 + 1 MiB | 请求体封装上限 |
| `CLOUD_MAILER` | `null` | `null` / `file` / `webhook` |
| `CLOUD_TRUST_PROXY` | 关 | 只有设为 `1` 才读 `X-Forwarded-For` |

## 接口

| 方法与路径 | 说明 |
|---|---|
| `POST /auth/code` | 发验证码。`{email, purpose?}`，`purpose` ∈ `login` / `delete_dataset` / `delete_account`。**响应与是否注册无关**，始终 202。 |
| `POST /auth/verify` | 校验并建会话。非 `login` 用途额外返回 `recentAuthToken`（10 分钟、单次、绑定用途）。 |
| `POST /auth/refresh` | 轮换刷新令牌；旧令牌重放 → 撤销整条会话。 |
| `POST /auth/logout` | 撤销当前设备会话。 |
| `GET /devices` · `DELETE /devices/{id}` | 设备列表与撤销；他人设备一律 404。 |
| `GET /dataset` | `never_initialized` / `active` / `deleted`；`active` 带快照与强 ETag。 |
| `PUT /dataset` | 初始化 `If-None-Match: *`；更新 `If-Match: <etag>`。必须带 `Idempotency-Key`。 |
| `GET /dataset/versions` · `/{versionId}` | 30 天内最多 10 个可恢复版本；他人版本 404。 |
| `POST /dataset/replace` | 用本机替换云端：换 `datasetId`、推进 `epoch`，旧数据进历史。 |
| `POST /dataset/reinitialize` | 仅 `deleted` 可用，`If-Match` 用删除代次令牌。 |
| `DELETE /dataset` | 清空云端：需 `X-Recent-Auth`（`delete_dataset`）+ `If-Match` + 幂等键。 |
| `DELETE /account` | 注销：需 `X-Recent-Auth`（`delete_account`）+ 状态凭证。 |
| `GET /account/deletion` | 无登录查询删除状态，`X-Status-Token` 只回有限字段。 |
| `GET /health` | 存活探针，不含任何用户数据。 |

写入顺序固定为：认证 → 限大小 → 算请求哈希 → 事务内查幂等 → 查代次 → 查条件 → 校验快照 → 提交。
**幂等先于条件**是刻意设计：成功写入会推进 revision，客户端断网重试时旧 `If-Match` 必然 412，
若先查条件则重试永远失败。

## 安全实现要点

| 主题 | 做法 |
|---|---|
| 验证码 | 6 位 `crypto.randomInt`；HMAC(服务端密钥, `challengeId:code`) 摘要；10 分钟、单次、5 次错误；同邮箱同用途只保留一个有效挑战 |
| 令牌 | 访问 15 分钟（HMAC 签名，非 JWT 库）；刷新 30 天，服务端只存 SHA-256 摘要，每次使用轮换；重放即撤销会话 |
| 授权 | 只认认证上下文；`accountId`、`datasetId` 等客户端字段一律不作为依据 |
| 撤销 | 每个受保护请求都查会话状态，不等令牌过期 |
| 数据隔离 | 他人资源统一 404，避免"存在但不属于你"的探测 |
| 幂等 | 作用域 `账号|方法|路径|键`，7 天；同键异请求 409 |
| 日志 | 只有请求 id / 路径 / 状态码 / 耗时；审计用账号指纹，无邮箱、无验证码、无业务正文 |
| 台账 | 删除台账与业务状态同一份原子写；哈希链可在启动时校验，不连续直接拒绝启动 |
| 响应头 | 全部 `Cache-Control: no-store`、`X-Content-Type-Options: nosniff` |

## 存储

- `store/memory.mjs`：测试用。
- `store/file.mjs`：单机部署用。整份状态原子提交（临时文件 → fsync → rename → fsync 目录），
  失败即整份回滚；文件损坏或台账断链时**故障关闭**，不以空库启动。
- `store/schema.sql`：PostgreSQL 生产结构（**尚未执行**）。换 PG 时只需替换 store 端口实现，
  路由层不动；但必须补 `pg_advisory_xact_lock` 串行化与跨故障域台账复制。

## 已知限制

1. 单进程单实例：文件存储 + 进程内锁，不能水平扩展。
2. 每次写入克隆整份状态（含快照）：64 MiB 快照下的耗时与内存**未实测**（CB-A16）。
3. 运维备份、跨故障域台账复制、灾备演练**未实现**（CB-A17 / A23 未通过）。
4. 只覆盖后端；客户端登录、授权开启、绑定预览、冲突合并**尚未接入**（docs/28 第 7 节第 4 步）。
5. 无 CORS 支持：按"同源部署"设计，跨域 PWA 需要另行评审。
