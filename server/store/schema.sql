-- 商业云 PostgreSQL 结构（生产路径）
--
-- 状态：**未在任何环境执行过**。当前可运行的实现是 server/store/file.mjs（单机、
-- 整份原子提交），它满足"当前版本 + 上一版本 + revision + 幂等回执同事务"的语义，
-- 但无法水平扩展、也没有跨故障域复制。上生产前必须换成本结构，并重新跑
-- server/test 的全部契约用例（把 store 端口换成 PG 适配器，路由层不用改）。
--
-- 与文件实现的三处关键差异：
-- 1. 串行化：文件实现用进程内 keyed lock；这里必须用
--    `pg_advisory_xact_lock(hashtext(account_id))`，否则多实例同时写会静默覆盖。
-- 2. 台账复制：删除台账必须与账号停用同事务，并且在返回"已受理"前完成
--    跨故障域同步复制（同步备库 / quorum commit）。单机 fsync 不满足 §5.2。
-- 3. 快照存储：大字段建议 TOAST + 压缩；64 MiB 上限需实测（CB-A16）。

BEGIN;

CREATE TABLE accounts (
  account_id       text PRIMARY KEY,
  email_normalized text NOT NULL,
  email_verified   boolean NOT NULL DEFAULT true,
  status           text NOT NULL CHECK (status IN ('active', 'deleted')),
  created_at       timestamptz NOT NULL,
  last_verified_at timestamptz,
  deleted_at       timestamptz,
  deletion_job_id  text
);
-- 同一邮箱只保留一个活跃账号；注销后重新注册会插入新行，历史行保留供审计
CREATE UNIQUE INDEX accounts_active_email
  ON accounts (email_normalized) WHERE status = 'active';

CREATE TABLE device_sessions (
  session_id  text PRIMARY KEY,
  account_id  text NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  device_name text NOT NULL,
  created_at  timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL,
  revoked_at  timestamptz,
  revoked_reason text
);
CREATE INDEX device_sessions_account ON device_sessions (account_id);

CREATE TABLE refresh_tokens (
  token_hash  text PRIMARY KEY,          -- 只存不可逆摘要
  session_id  text NOT NULL REFERENCES device_sessions (session_id) ON DELETE CASCADE,
  account_id  text NOT NULL,
  created_at  timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  replaced_by text
);

CREATE TABLE otp_challenges (
  challenge_id text PRIMARY KEY,
  email_normalized text NOT NULL,
  purpose      text NOT NULL CHECK (purpose IN ('login', 'delete_dataset', 'delete_account')),
  digest       text NOT NULL,            -- HMAC(服务端密钥, challenge_id:code)
  attempts     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  consumed_reason text
);
CREATE INDEX otp_challenges_email ON otp_challenges (email_normalized, purpose, created_at DESC);

CREATE TABLE recent_auth (
  token_id    text PRIMARY KEY,
  account_id  text NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  purpose     text NOT NULL,
  digest      text NOT NULL,
  created_at  timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE TABLE cloud_datasets (
  account_id     text PRIMARY KEY REFERENCES accounts (account_id) ON DELETE CASCADE,
  dataset_id     text NOT NULL,
  epoch          integer NOT NULL,
  status         text NOT NULL CHECK (status IN ('never_initialized', 'active', 'deleted')),
  revision       integer NOT NULL DEFAULT 0,
  snapshot       jsonb,
  snapshot_hash  text,
  schema_version integer,
  rule_version   integer,
  updated_at     timestamptz,
  deletion_id    text,
  deleted_at     timestamptz,
  delete_by      timestamptz
);

CREATE TABLE snapshot_versions (
  version_id    text PRIMARY KEY,
  account_id    text NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  dataset_id    text NOT NULL,
  epoch         integer NOT NULL,
  revision      integer NOT NULL,
  snapshot      jsonb NOT NULL,
  snapshot_hash text NOT NULL,
  schema_version integer NOT NULL,
  rule_version  integer NOT NULL,
  created_at    timestamptz NOT NULL
);
-- 列表查询：某账号 30 天内最新的 N 条
CREATE INDEX snapshot_versions_account ON snapshot_versions (account_id, created_at DESC);

CREATE TABLE idempotency_receipts (
  account_id   text NOT NULL,
  method       text NOT NULL,
  path         text NOT NULL,
  idem_key     text NOT NULL,
  request_hash text NOT NULL,
  status       integer NOT NULL,
  body         jsonb NOT NULL,
  headers      jsonb NOT NULL DEFAULT '{}'::jsonb,
  operation    text,
  created_at   timestamptz NOT NULL,
  expires_at   timestamptz NOT NULL,
  PRIMARY KEY (account_id, method, path, idem_key)
);
CREATE INDEX idempotency_expiry ON idempotency_receipts (expires_at);

CREATE TABLE delete_jobs (
  job_id       text PRIMARY KEY,
  account_hash text NOT NULL,
  status_digest text NOT NULL,          -- 客户端状态凭证的摘要
  accepted_at  timestamptz NOT NULL,
  online_purged_at timestamptz,
  purge_by     timestamptz NOT NULL,
  backup_purge_at timestamptz NOT NULL,
  status       text NOT NULL
);

-- 删除台账：只保留阻止复活与审计所需的最小标识，不含业务正文
CREATE TABLE delete_ledger (
  seq          bigint PRIMARY KEY,
  at           timestamptz NOT NULL,
  kind         text NOT NULL,
  account_hash text,
  deletion_id  text,
  ref          text,
  prev_hash    text,
  hash         text NOT NULL
);

CREATE TABLE audit_events (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL,
  action       text NOT NULL,
  outcome      text NOT NULL,
  account_hash text,
  request_id   text,
  meta         jsonb
);

COMMIT;

-- 写入模板（每次写都必须在同一事务里完成）：
--
--   BEGIN;
--   SELECT pg_advisory_xact_lock(hashtext($account_id));
--   -- 1) 查幂等回执（同键同请求返回原结果；异请求 409）
--   -- 2) 校验 epoch 与 If-Match 对应的 revision
--   -- 3) 校验快照（服务端独立重算 SHA-256）
--   -- 4) 写 snapshot_versions（上一版本）、更新 cloud_datasets、写幂等回执
--   -- 5) 需要时写 delete_ledger
--   COMMIT;
--
-- 删除/注销额外要求：台账写入与账号停用同事务，且提交前完成跨故障域同步复制；
-- 复制失败必须返回失败，不能给用户"已受理"。
