# SparkyFitness 对标分析

日期：2026-10-26
对象：[CodeWithCJ/SparkyFitness](https://github.com/CodeWithCJ/SparkyFitness)（6,477 stars，活跃维护，TypeScript）

分析方式：读 README、`package.json`、目录结构、CI 工作流、AI 工具目录，
与本地仓库逐项对照。**不做功能堆砌式对标**，只记录"该学什么、为什么、代价多大"。

---

## 0. 一句话结论

两者是**不同的产品**，不是同一产品的两个实现：

| | SparkyFitness | 铁馆（本项目） |
|---|---|---|
| 定位 | 自托管的家庭健康数据中心 | 单机优先的力量训练记录工具 |
| 数据归属 | 自己的服务器（Docker/Helm/Nix） | 设备本地，快照可同步到任意端点 |
| 广度 | 营养/睡眠/水分/禁食/情绪/用药/周期 | 力量训练 + 饮食 + 目标 |
| AI | 43 个工具，服务端代理 | 无工具调用，BYOK 直连 |

所以**不能按功能列表追赶**。真正值得学的是三件与产品定位无关的事。

---

## 1. 它的技术选型（事实）

monorepo（pnpm workspace）：

| 包 | 技术 |
|---|---|
| `SparkyFitnessFrontend` | React 19 + Vite 8 + Tailwind 4 + Radix UI + zustand + TanStack Query |
| `SparkyFitnessServer` | Node + Express 系 + better-auth（OIDC/Passkey/MFA/TOTP） |
| `SparkyFitnessMobile` | （独立移动端） |
| `SparkyFitnessGarmin` | Garmin FIT SDK 接入 |
| `shared` | 前后端共享类型与常量 |

关键依赖：`ai@7` + `@ai-sdk/*` 三家模型、`@modelcontextprotocol/sdk`（MCP server）、`zod@4`、`date-fns`。

**它同时支持 20 种语言**（Weblate 托管翻译）。

---

## 2. 值得学的第一件事：AI 工具化

### 它的做法

`SparkyFitnessServer/ai/tools/` 下 **43 个工具文件**，每个把一类业务能力暴露成模型可调用的工具：

- `workoutPlanTools.ts` —— 生成/调整训练计划
- `foodPhotoEstimateSink.ts` / `visionTools.ts` —— 拍照估算热量
- `exerciseStatsTools.ts` / `progressTools` —— 查历史与进步
- `truncation.ts` / `pagination.ts` —— **上下文裁剪与分页**
- `unitConversion.ts` / `dates.ts` / `errors.ts` —— 工具共用基础设施

还有 `modelCapabilities.ts`（不同模型能力适配）和 `providerDispatch.ts`（厂商分发）。

### 我们的现状

`src/domain/ai-*.ts` 共 752 行，是**单轮问答**：

```
buildAiContext → renderContext → callModel → parseDraft → validateDraft → 用户确认后写入
```

优点是很扎实（纯函数校验、注入防护、过期指纹、绝不自动写入），
但它只能回答"根据我给你的一段数据，你建议我练什么"。

### 差距的实质

> 它的 AI 能**自己查**数据（"我上个月深蹲涨了多少" → 调工具查）；
> 我们的 AI 只能**被喂**数据（上下文里塞什么就只看得到什么）。

这是能力层级差异，不是实现细节差异。

### 值不值得做

**值得，但要分清两步：**

| 步骤 | 代价 | 收益 |
|---|---|---|
| 1. 让 AI 能查历史（只读工具） | 中：需本地工具注册表 + 结果截断 | 高：回答准确度质变 |
| 2. 让 AI 能写数据（写工具） | 高：需确认流、权限、审计 | 中：已有 draft→确认 流程可复用 |

**我的判断**：先做只读工具（`querySessions` / `queryExerciseStats` / `queryGoals` 三五个足够）。
写操作维持现有"生成草案 → 用户确认"模式，不要给模型直接写权限。

参考它的 `truncation.ts` 思路：工具返回值必须**服务端截断**，
否则一次查三年数据就把上下文撑爆——这个坑它踩过。

---

## 3. 值得学的第二件事：CI 的路径过滤

### 它的做法

`ci-tests.yml` 先用 `dorny/paths-filter` 检测哪个包变了，再决定跑哪些 job：

```yaml
changes:
  outputs:
    frontend: ${{ steps.filter.outputs.frontend }}
    server: ${{ steps.filter.outputs.server }}
    migrations: ${{ steps.filter.outputs.migrations }}
```

还专门有一组 `migrations` 过滤：**改数据库迁移文件才跑迁移集成测试**。

### 我们的现状

`.github/workflows/verify.yml` 3 个 job（unit / e2e / android），
任何 push 到任何分支都全量跑。

### 差距

我们仓库小（24k 行），全量跑并不慢，**这个问题现在不痛**。
但 `on: push: branches: ['**']` 意味着**每个临时分支都跑 E2E + Android 出包**，浪费明显。

### 值不值得做

**小改就够**（成本半小时）：

1. `push` 只跑 `main`，其他分支靠 `pull_request` 触发
2. E2E 和 Android 加 `paths-ignore`：只改 `docs/**` 或 `**.md` 时跳过

不建议照搬它的多包路径过滤——我们是单包，过度设计。

---

## 4. 值得学的第三件事：README 的自省声明

它在自己写的对比表下面加了一句：

> This table is written by the project being compared, so read it that way.

这句话成本为零，但直接建立信任。它甚至写明"如果哪个格子对我们的竞品不公平，欢迎提 issue，把我们写得更差的修正同样欢迎"。

我们的 README 目前是纯功能陈述。可以考虑加一节"这个项目不做什么"——
比"我们有什么"更能说明产品边界。

---

## 5. 不该学的

| 它的做法 | 为什么不学 |
|---|---|
| React + Radix + Tailwind 全家桶（60+ 依赖） | 我们的 Vue 3 零 UI 依赖是**优势**：包体小、无供应链风险。为了"看起来现代"引入 60 个包是负收益 |
| 服务端代理 AI（多租户） | 我们是 BYOK + 本地直连，密钥不经过任何服务器。这是隐私优势，不要为了"功能多"退回去 |
| Docker/Helm/Nix 部署矩阵 | 我们是单机 PWA + APK，没有运维面 |
| 20 种语言的翻译基建 | 单用户中文产品，翻译基建是纯成本 |
| 27 个 GitHub 工作流 | 大量是 issue 机器人/release 自动化，开源社区运营需要，我们不需要 |
| 家庭多用户 + 7 级权限 | 架构级改动（状态模型、同步、UI 全要重做），且违背"单机优先"定位 |

---

## 6. 我们反而更强的地方

对照后确认，以下几处不必自卑：

| 维度 | 我们 | 它 |
|---|---|---|
| 数据模型严谨度 | 周目标 N/A/K 三值模型、tombstone 删除、验收编号可追溯到规范行号 | 未见同级别规范文档 |
| 离线能力 | IndexedDB + localStorage 双副本、本地优先 | 服务端为中心 |
| 密钥安全 | BYOK，密钥永不进 AppState/快照/导出 | 服务端持有 |
| 测试密度 | 962 单测 + 88 E2E，domain 层 96% 覆盖 | 有测试，但未见覆盖率数据 |
| 依赖面 | 12 个依赖 | 60+ |

---

## 7. 如果要动手，顺序建议

| 优先级 | 事项 | 理由 |
|---|---|---|
| P1 | AI 只读工具（3–5 个） | 唯一的能力层级差距，且能复用现有 draft 确认流 |
| P2 | CI 触发条件收紧 | 半小时，立刻省 CI 时长 |
| P3 | README 补"不做什么" | 半小时，明确产品边界 |
| — | 其余全部 | 不做，与定位冲突 |

**不建议现在做的**：任何为了"对齐功能数量"的改动。
它是家庭健康中心，我们是力量训练工具，功能列表本来就该不同。
