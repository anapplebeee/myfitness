# 插件与扩展点设计：让「现在不做」不等于「以后做不了」

- 版本：v1 设计稿
- 日期：2026-10-22
- 状态：**设计，待评审**（不含实现）
- 关系：`docs/02-architecture.md` 的补充章节；解决其中 §1.2「非目标」的后悔成本问题

---

## 0. 一句话结论

多用户 / 家庭共享 / 社交在 v1 **不实现**，但必须现在把**三个接缝**留出来：**身份（AuthProvider）**、**数据作用域（Scope）**、**能力注册表（Registry）**。三者加起来的一次性成本是「一次数据封装迁移 + 一个 20 行注册表」，远低于事后补认证与拆数据带来的重写成本。

同时必须承认：**抽象本身有成本**。本文的取舍原则是——

> 只为「已经存在两个真实实现」的接口做抽象；只有一个实现的接口，只写接口签名，不做实现层。

（例：存储层已经有 localStorage 与 HTTP 两个实现 → 值得抽象；认证层只有一个「单用户」实现 → 只留接口。）

---

## 1. 先把「插件」拆成四个层级

「插件化」在讨论里经常指四种完全不同的东西，成本差一个数量级。必须先分清：

| 层级 | 形态 | 现在的例子 | 是否需要改 core | 成本 |
|---|---|---|---|---|
| **L1 数据包** | 纯资源文件，按约定格式被读取 | 食物营养成分表、动作 SVG 素材、训练计划模板 | 否（只要读取器存在） | 极低 |
| **L2 接口实现** | 实现一个已定义接口，替换/扩展某个能力 | `StorageAdapter.local` / `.http`、`ModelProvider`、`SyncStrategy` | 否（注册即可） | 低 |
| **L3 能力模块** | 自带身份、数据作用域、可能带页面与迁移 | 家庭共享、passkey 登录、社交分享 | **是**（需要 scope 与路由） | 中 |
| **L4 动态插件** | 运行时从网络加载代码、沙箱隔离、插件市场 | — | 是（且是安全反模式） | 高，**明确不做** |

**本设计的覆盖范围：L1 + L2 做进 core 的稳定契约，L3 提供合法接入位，L4 明确拒绝。**

拒绝 L4 的理由不是懒：这是 PWA + 纯静态环境，没有可靠的脚本隔离（`eval` / 动态 `import` 无法约束 DOM 与存储访问），插件市场还会引入签名与供应链问题。L4 的收益（第三方生态）远小于风险，且与「数据在自己手里」的定位冲突。

---

## 2. 扩展点全景

```
                        ┌──────────────────────────────┐
                        │        视图层 views/          │
                        │  ┌────────────┐ ┌──────────┐ │
                        │  │ 内置页面    │ │ 插件槽位  │ │  ← uiSlot 钩子
                        │  └────────────┘ └──────────┘ │
                        └───────────────┬──────────────┘
                                        │
                        ┌───────────────▼──────────────┐
                        │      应用层 store.js          │
                        │   ┌──────────────────────┐   │
                        │   │ Hook 总线（有序、隔离）│   │  ← beforeSave / afterSave
                        │   └──────────────────────┘   │     planGenerated / checkinCreated
                        └───┬───────────────┬──────────┘
                            │               │
        ┌───────────────────▼───┐       ┌───▼──────────────────────────┐
        │ 领域层 core/ engine   │       │ 能力注册表 Registry           │
        │ 纯函数，不感知插件     │       │  storage │ auth │ scope       │
        └───────────────────────┘       │  policy  │ model │ sync       │
                                        └───┬──────────────────────────┘
                                            │ 每个能力 = 一个接口
              ┌─────────────────────────────┼─────────────────────────────┐
              ▼                             ▼                             ▼
    ┌───────────────────┐        ┌───────────────────┐        ┌───────────────────┐
    │ StorageAdapter    │        │ AuthProvider      │        │ ModelProvider     │
    │ local / http      │        │ single(内置)       │        │ OpenAI 兼容        │
    │ [插件: s3, webdav]│        │ [插件: passkey]   │        │ [插件: 本地推理]    │
    └───────────────────┘        └─────────┬─────────┘        └───────────────────┘
                                           │
                                ┌──────────▼──────────┐
                                │ ScopeResolver       │  ← 多用户/家庭的唯一接缝
                                │ 默认: 恒等 local     │
                                └──────────┬──────────┘
                                           │
                                ┌──────────▼──────────┐
                                │ AccessPolicy        │  ← 客户端只做 UI 提示
                                │ 服务端独立再判一次    │     服务端才是安全边界
                                └─────────────────────┘
```

---

## 3. 能力接口（契约草案）

> 下列签名是**契约设计**，用 TypeScript 写只为表达精确，不代表引入 TS 或引入构建步骤。

### 3.1 存储

```ts
interface StorageAdapter {
  readonly id: string
  configure(env: Env): 'local' | 'remote'
  load(scope: ScopeRef): Promise<StateEnvelope | null>
  save(scope: ScopeRef, state: StateEnvelope): Promise<SaveResult>
  flush(scope: ScopeRef): void
  describe(): string            // 设置页展示用
}
```

约束：**永远不抛异常**（失败降级 + 提示）；**不解释 state 内容**（对存储层是不透明 blob）。

### 3.2 身份

```ts
interface Identity {
  id: string
  displayName?: string
  roles: string[]              // 例：['owner'] / ['member'] / ['guest']
  kind: 'person' | 'anonymous'
}

interface AuthProvider {
  readonly id: string
  getIdentity(): Promise<Identity | null>
  signIn?(opts?: unknown): Promise<Identity>
  signOut?(): Promise<void>
  onChange(cb: (id: Identity | null) => void): () => void
}
```

内置实现 `SingleUserProvider` 恒返回 `{ id: 'local', roles: ['owner'] }`——**这就是 v1 不引入任何认证的代价：一个 10 行实现**。

关键：core 只依赖 `identity.id` 与 `roles`，**不关心**背后是 passkey、basic auth 还是 OAuth。

### 3.3 作用域（多用户 / 家庭共享的唯一接缝）

```ts
type ScopeRef = {
  id: string                   // 'local' | 'user:<uid>' | 'household:<hid>' | 'share:<token>'
  kind: 'personal' | 'household' | 'shared'
}

interface ScopeResolver {
  resolve(identity: Identity | null): ScopeRef
}
```

默认实现：`resolve() => ({ id: 'local', kind: 'personal' })`。

**这是整份设计里最值钱的一个抽象**：数据分桶由它决定，插件只要换掉它，就能把「一个人一份数据」变成「一户一份数据」或「一人一份 + 共享计划」。

### 3.4 访问策略

```ts
interface AccessPolicy {
  can(action: 'read' | 'write' | 'share', scope: ScopeRef, identity: Identity | null): boolean
}
```

**红线（写进代码注释与评审清单）**：

> 客户端 `AccessPolicy` 只用于「显示/隐藏按钮」，**永不作为安全边界**。真正的隔离必须在服务端 API 层再判一次。插件化认证若只在客户端做，等于把隔离降级成装饰。

### 3.5 模型提供方

```ts
interface ModelProvider {
  readonly id: string
  listModels(): Promise<ModelInfo[]>
  chat(req: { messages: Msg[]; stream: true; signal?: AbortSignal }): AsyncIterable<Chunk>
}
```

安全约束：**API Key 由 core 代持**，插件申请的是 `llm:call` 能力，拿不到密钥原文。这样第三方模型插件无法顺手把 Key 外传。

### 3.6 同步策略

```ts
interface SyncStrategy {
  readonly id: string
  onLoad(local: StateEnvelope, remote: StateEnvelope | null): { state: StateEnvelope; conflict?: ConflictInfo }
  onSavePlan(remoteRevision: string | null): { allowed: boolean; needForce?: boolean }
}
```

内置：`lastWriteWins`（v1）。后续可替换为 `optimisticLock`（v2 计划）或字段级合并，**替换时视图层零改动**。

---

### 3.7 设备（BLE 与健康数据）

```ts
interface DeviceReading {
  kind: 'heartRate' | 'weight' | 'steps' | 'sleep'
  value: number            // bpm / kg / 步 / 分钟
  at: number               // 时间戳
  source: string           // 'ble:polar-h10' | 'health:apple' | 'manual'
}

interface DeviceProvider {
  readonly id: string
  capabilities(): Array<'heartRate' | 'weight'>   // 这个实现能提供什么
  scan?(onFound: (d: DiscoveredDevice) => void): Promise<void>
  connect?(deviceId: string): Promise<void>
  onReading(cb: (r: DeviceReading) => void): () => void   // 返回取消订阅
  disconnect?(): Promise<void>
}
```

设计要点：

1. **读数统一成 `DeviceReading` 流**，上层（训练浮层、体重记录）不关心来源是 BLE、Apple 健康还是手动输入。
2. `capabilities()` 决定 UI 显示什么——不能提供心率的实现就不该出现"实时心率"卡片，**不允许假按钮**。
3. 数据落库时**必须带 `source`**：手动录入的体重绝不能被设备读数覆盖（冲突时人工优先）。
4. `DeviceProvider` 只在原生壳里可用（Web 端 `scan` 直接返回不可用），因此它是**可选插件**而不是核心能力。

**协议现实的硬约束**（决定这个插件能做到什么程度）：

| 设备 | 直连可行性 | 依据 |
|---|---|---|
| 标准心率带（Polar H10 / Garmin HRM / Wahoo） | ✅ | 标准 GATT：`0x180D` + `0x2A37`（Notify）+ 电量 `0x180F/0x2A19` |
| 标准体重秤 | ⚠️ | 标准 `0x181D` 存在但消费级少见 |
| 小米 / 华为体脂秤 | ❌ 多数 | 私有协议，需厂商 SDK |
| 小米 / 华为手环手表 | ❌ | 不开放标准 GATT 实时心率，需厂商健康平台授权 |
| Apple Watch | ❌ | 无开放 GATT；HealthKit 仅本机授权读取 |

结论：**"连手环读心跳"这个需求，BLE 插件解决不了**。可行路径只有两条——① 推荐用户用手环配套 App 授权后导出/同步健康数据；② 支持标准心率带。UI 上必须把这条写清楚（见 05 号文档稿八）。

---

## 4. 数据形态：为作用域留位，但不提前加字段

### 4.1 信封（envelope）

现在 state 是「裸对象」。要支持多作用域，建议引入一层信封：

```jsonc
{
  "schemaVersion": 2,
  "scope": { "id": "local", "kind": "personal" },
  "data": { /* 现有 state 全部字段 */ },
  "meta": { "updatedAt": "2026-10-22T09:00:00Z", "revision": "sha256:…" }
}
```

v1 行为完全不变：只有一个 scope，`id` 恒为 `local`。但物理路径从
`data/state.json` → `data/scopes/local/state.json`，
多用户/家庭插件启用后自动变成 `data/scopes/user:<uid>/state.json`——**主数据结构零迁移**。

### 4.2 记录级归属：留位但不加字段

| 需求 | 做法 | 理由 |
|---|---|---|
| 一家人共享同一份训练与饮食 | scope 级隔离即可 | 覆盖 90% 场景 |
| 每人各自的计划，但共享部分（如家庭菜谱） | scope 内可选 `meta.ownerId` 字段 | **core 不解释**该字段，只有插件读写 |
| 社交（看朋友的计划） | **只读快照**，见 §6 | 实时联表会引入跨 scope 读权限，风险高 |

**不要现在就给 `plan` / `checkins` 加 `ownerId` 空字段**：v1 数据会变脏、迁移成本提前支付、而 scope 级隔离已经够用。字段留给插件自行写入，core 视而不见。

---

## 5. 插件形态

### 5.1 清单

```jsonc
{
  "id": "household",
  "name": "家庭共享",
  "version": "1.0.0",
  "apiVersion": "1.x",                        // 与 core 协商，不兼容直接拒绝加载
  "capabilities": ["auth", "scope", "policy"],// 占用哪些扩展位（同一位互斥）
  "requires": ["storage"],                    // 依赖的其他能力
  "permissions": ["identity:read", "scope:write", "storage:write"],
  "migrations": ["plugin:household:v1"]       // 自有迁移命名空间
}
```

### 5.2 注册与上下文

```js
App.plugins.register({
  manifest,
  setup(ctx) {
    const provider = createHouseholdAuth(ctx)   // 只能用 ctx，不得直接碰 localStorage
    ctx.provide('auth', provider)
    ctx.provide('scope', { resolve: (id) => ({ id: 'household:' + id.householdId, kind: 'household' }) })
    ctx.hook('afterSave', (state) => { /* 可选副作用 */ })
  }
})
```

`ctx` 是插件的**唯一门面**：`provide / require / hook / log / clock / rng`。没有 `ctx.storage.raw()` 这种逃生舱——否则隔离形同虚设。

### 5.3 生命周期与失败语义

| 阶段 | 做什么 | 失败时 |
|---|---|---|
| `register` | 声明清单、检查 `apiVersion` | 拒绝加载，**不静默降级**，设置页显示原因 |
| `setup` | `provide` 能力、注册钩子 | 回滚其已注册的能力，主流程继续 |
| `migrate` | 跑自己的迁移命名空间 | 中止并要求备份恢复，不允许半迁移状态 |
| `dispose` | 撤销钩子、释放资源 | 忽略，记日志 |

### 5.4 注册方式：静态，不做动态发现

- 插件在 `plugins/index.js` 里**显式列出**，由 `index.html` 按顺序加载。
- 开关来自 `localStorage['tieguan.plugins']`（JSON 数组）或构建期注入。
- 不做 URL 参数加载远程脚本——`?plugin=https://…` 等于任意代码执行入口。

---

## 6. 社交的特殊处理：只读快照，不做跨作用域读

社交是最容易把权限模型搞烂的功能。设计上切成两半：

| 部分 | 做法 | 数据形态 |
|---|---|---|
| **分享出去** | 用户主动「发布快照」：选一份计划 / 一段训练史，脱敏后生成只读快照 | `ShareGrant { token, fromScope, resources[], level:'read', expiresAt }` |
| **看别人的** | 通过 token 拉快照，落在 `share:<token>` 作用域，**只读** | 快照 JSON，不含体重、对话、API Key |
| **不做** | 实时读对方 state、评论/点赞/关注关系图 | — |

好处：权限判断从「跨用户读」退化为「持有 token 读一份静态数据」，服务端只需一个 `GET /api/share/:token`，不需要为社交重建整套 ACL。

脱敏是硬要求：快照白名单字段（计划、动作、组次），**不含**体重、体脂、对话历史、设置。

---

## 7. 钩子（流程扩展）

| 钩子 | 时机 | 允许做 | 禁止做 |
|---|---|---|---|
| `beforeSave(state)` | 落盘前 | 补字段、脱敏、校验（可 veto） | 网络请求、改其他 scope |
| `afterSave(state)` | 落盘后 | 记日志、触发本地通知 | 递归保存 |
| `planGenerated(plan)` | 计划生成后 | 追加备注、裁剪动作 | 改用户已确认的内容 |
| `checkinCreated(record)` | 打卡后 | 计算徽章、写插件自有字段 | 反向修改当天日程 |
| `uiSlot(name)` | 渲染插槽 | 返回 DOM 片段 | 全局 CSS 覆盖、操作其他组件 |

**执行语义**：同步、按注册顺序、单个钩子抛异常只记日志并跳过（不影响主流程）、总耗时超过 16 ms 记警告。

异步副作用（例如「打卡后推送到手机」）不允许挂在钩子上阻塞渲染，应进入事件队列由插件自行调度。

---

## 8. 现在要付的成本 vs 明确不做的事

### 8.1 现在付（一次性，合计约半天）

| 事项 | 产出 | 备注 |
|---|---|---|
| 引入信封 + `scope`，物理路径变成 `scopes/<id>/` | 多作用域的数据位 | 需要一次 v1→v2 迁移（单 scope，数据不变） |
| 把「身份」抽成 `AuthProvider`，内置 `SingleUserProvider` | 认证接缝 | 约 10 行 |
| `ScopeResolver` 默认恒等实现 | 家庭共享接缝 | 约 5 行 |
| `StorageAdapter` 接口定型（已有两个实现） | 存储可替换 | 已在 P0 落地 |
| 能力注册表 + 钩子总线 | 所有扩展位的挂载点 | 约 20–40 行 |
| 公共契约版本号 `apiVersion` | 插件兼容协商 | 一行常量 |

### 8.2 明确不做

- 动态加载插件代码 / 沙箱 / eval
- 插件市场、签名、权限弹窗
- 为「可能有人要」提前给每个实体加 `ownerId`
- 跨插件隐式依赖（A 依赖 B 的内部字段）
- 让插件接管迁移链（只能追加自己的命名空间）

---

## 9. 候选插件与落点

| 候选 | 层级 | 需要的能力 | 现在能否接入 | 备注 |
|---|---|---|---|---|
| 自托管存储 `storage-http` | L2 | storage | ✅ 已有 | P0/P1 |
| 自定义模型端点 | L2 | model | ✅ 已有 | 目前是配置项，可升级成 provider |
| 中国食物成分表数据包 | L1 | —（只读资源） | ✅ 可 | 只需约定 `data/foods.v1.json` 格式 |
| 动作 SVG 素材包 | L1 | —（只读资源） | ✅ 可 | 需先确认素材许可 |
| 乐观锁同步 | L2 | sync | 需先有 `SyncStrategy` | P2 |
| WebDAV / S3 备份 | L2 | storage | 需先有 `StorageAdapter` 契约 | 低成本，高实用 |
| **家庭共享** | L3 | auth + scope + policy | 需 §8.1 全部落地 | 见 §10 验收 |
| **passkey 登录** | L3 | auth + 服务端 | 需 HTTPS | 仅公网部署有意义 |
| **只读分享 / 社交** | L3 | share + 路由 | 需 §6 快照模型 | 最后做 |
| **设备（BLE 心率带 / 体重秤）** | L3 | device（仅原生壳内可用） | 需 Capacitor BLE 插件 + 权限 | 只对标准 GATT 设备成立，见 §3.7 |

---

## 10. 怎么证明「插件化真的成立」（验收断言）

不是"写了接口就算插件化"。以下四条必须可执行：

1. **无侵入性**：写一个 `household-lite` 插件（只实现 `AuthProvider` + `ScopeResolver`），**不改 core 任何文件**，启用后两份数据分别落在 `data/scopes/household:a/` 与 `…:b/`，互相读不到。
2. **可回退**：关掉该插件后，数据仍能按 `local` scope 读回（不丢、不崩）。
3. **故障隔离**：让插件在 `setup` 与某个钩子里主动抛异常 → 主流程五个页面照常工作，设置页显示「家庭共享加载失败：<原因>」。
4. **契约稳定**：把 `apiVersion` 改成不兼容值 → core 拒绝加载并提示，**不出现半启用状态**。

这四条同时通过，才能说扩展点成立。建议作为 P2 阶段的合并门槛。

---

## 11. 风险

| # | 风险 | 影响 | 概率 | 缓解 |
|---|---|---|---|---|
| X1 | **过早抽象**：为不存在的能力铺接口，阅读成本与出错面上升 | 维护成本 | **高** | 只抽象已有两个实现的接口；本文列出的「现在不做」清单等价于防御 |
| X2 | scope 改造引发数据迁移事故 | 数据丢失 | 中 | 迁移前自动备份；v1→v2 只加信封不改内容 |
| X3 | 插件绕过 ctx 直接碰 localStorage / schema | 隔离失效 | 中 | 代码评审清单 + 契约测试（静态检查插件文件里是否出现 `localStorage` 字样） |
| X4 | 客户端做权限判断被当成安全边界 | 越权读 | 中 | §3.4 红线；服务端二次校验作为 P3 合并门槛 |
| X5 | 社交被做成实时跨 scope 读 | 权限模型崩坏 | 中 | §6 只读快照方案，明确否决实时方案 |
| X6 | 插件与 core 版本漂移 | 启动即崩 | 低 | `apiVersion` + 拒绝加载而非降级 |

---

## 12. 待决问题

| # | 问题 | 选项 | 建议 |
|---|---|---|---|
| Q6 | 是否现在引入信封 + `scope`（一次迁移换未来零迁移）？ | 是／等真做家庭共享时再改 | **是**。现在改只动一处，事后改要动存储、服务端路径、备份与同步 |
| Q7 | 插件注册：静态还是动态？ | 静态显式列表／运行时发现 | **静态**。无隔离环境下动态加载 = 任意代码执行 |
| Q8 | 家庭共享先做 scope 级还是记录级？ | scope 级／记录级 `ownerId` | **scope 级**，覆盖 90% 场景且不污染 v1 数据 |
| Q9 | 社交是否接受「只读快照、不做实时」？ | 接受／必须实时 | **接受**。实时会把 ACL 复杂度放大一个量级 |
| Q10 | `AuthProvider` 现在就抽出接口，还是等有第二个实现再抽？ | 现在（10 行）／以后 | **现在**。它是唯一「早抽成本极低、晚抽成本极高」的接口 |

---

## 13. 对 `02-architecture.md` 的修订说明

原文 §1.2 把「多用户 / 家庭共享 / 社交」列为非目标并标注「收益为负」。该表述不准确，应改为：

> **v1 不实现；但通过 `AuthProvider` + `ScopeResolver` 预留接缝，插件启用即可支持。现在实现的收益为负（无真实用户、引入认证与隔离复杂度），留接口的收益为正（一次封装迁移即可换未来零重写）。**
