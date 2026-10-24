# v1 前端实现说明

版本：1.0；日期：2026-10-24；状态：**实现说明，不定义产品范围**。范围、模型、周规则、验收分别以 [00](00-v1-baseline.md)、[11](11-data-model.md)、[09](09-checkin-model.md)、[12](12-v1-acceptance.md) 为唯一权威。本文记录新版前端的技术选型、设计系统、页面结构、状态模型与已知边界。

## 1. 技术栈

| 项 | 选择 | 理由 |
|---|---|---|
| 框架 | Vue 3.5 单文件组件 + `<script setup>` | 组件化、类型友好、产物小（gzip 约 51KB） |
| 语言 | TypeScript 5.7，`strict` + `noUncheckedIndexedAccess` | 领域层可被类型约束，减少运行时错误 |
| 构建 | Vite 6 | 开发热更新快，产物为纯静态文件 |
| 测试 | Vitest 3 | 与 Vite 同源，领域纯函数测试零配置 |
| 样式 | 原生 CSS + 设计令牌（无 UI 框架） | 完全控制视觉，避免组件库默认样式拖累 |
| 持久化 | IndexedDB（回落 localStorage） | 本地优先，无账号无网络 |

> 关于"前端用 HTML 是否落后"：浏览器最终渲染的永远是 HTML/CSS。真正决定工程质量的是组件化、类型与可测试性，而不是是否手写标签。旧 demo 的问题在于 `innerHTML` 字符串拼接 + 全局可变 state，本次已整体替换。

## 2. 设计系统

### 2.1 视觉方向

"铁馆" 取意力量房：石灰白纸感底色（`#F2F0EA`）配墨黑（`#111411`），强调色用荧光柠檬绿（`#C9F53F`），次要强调用陶土橙（`#E2572C`）。整体偏纸质与器械感，避免健身 App 常见的荧光渐变与深色霓虹。

### 2.2 令牌（`src/styles/tokens.css`）

- 颜色：纸/墨/柠檬/陶土/天蓝五组，含 soft 变体。
- 圆角：`--radius-xl 30px` / `lg 24px` / `md 18px` / `sm 12px`。
- 阴影：`--shadow-card`（极轻）、`--shadow-float`（浮层）、`--shadow-lime`（主按钮）。
- 动效：`--ease-out`、`--ease-spring`，并全局尊重 `prefers-reduced-motion`。

### 2.3 排版

- 标题用负字距（`-0.045em`）营造紧凑感，数字统一 `font-variant-numeric: tabular-nums` 防止跳动。
- 层级：`.display` / `.h1` / `.h2` / `.h3` / `.label` / `.body` / `.small` / `.tiny`。
- 所有正文使用系统字体栈，中文优先 PingFang SC / HarmonyOS Sans SC。

### 2.4 组件（`src/styles/components.css`）

卡片（含 `--ink`/`--lime`/`--flat`/`--dashed` 变体）、按钮（primary/lime/ghost/outline/danger + sm/lg/block）、chip、分段控件、输入、浮层（sheet）、Toast、进度条、环形进度、统计块。

## 3. 页面结构

导航为六个入口，底部浮动胶囊导航（移动端图标+文字，≥760px 横向排列）。

| 页面 | 文件 | 核心内容 |
|---|---|---|
| 今日 | `views/TodayView.vue` | 墨黑主视觉（周完成环）、今日计划、本周七日节奏（来自真实发生项）、累计训练与体重趋势、今日饮食进度、最近训练 |
| 训练 | `views/TrainView.vue` | 计划/历史/动作库三段切换；模板日列表、换模板、历史汇总、44 动作检索 |
| 训练直播 | `components/LiveWorkout.vue` | 逐组录入（重量×次数）、完成/跳过、休息倒计时、换动作、加组、结束总结（含"计入周目标"确认）；进入后隐藏底部导航（沉浸模式） |
| 周目标 | `views/PlanView.vue` | 周切换、目标卡（原始 N / 调整后 A / 最低目标 K / 连续达标周）、日历 8 状态、项目明细、豁免/取消/恢复/顺延、最低目标调整 |
| 饮食 | `views/FoodView.vue` | 今日摄入环、蛋白进度、四餐分栏、食物搜索（47 种）、按份量换算、手工录入、删除 |
| 教练 | `views/CoachView.vue` | 累计容量、力量榜 Top5、每动作最近 6 次柱状趋势、渐进建议 |
| 我的 | `views/ProfileView.vue` | 体重曲线、BMI、记录列表、记体重、数据说明、偏好设置、进入数据管理 |
| 数据 | `views/DataView.vue` | 记录概览、导出下载/复制、导入校验与预览、合并/替换、自动备份恢复、清空本机 |

## 4. 状态与数据

### 4.1 分层

```
domain/   纯函数，无 DOM / 存储 / 真实时钟
content/  静态内容（动作、模板、食物）
store/    repository（IDB 端口）+ appStore（响应式状态）
views/    只读 store，通过 store 方法修改
```

### 4.2 关键约束

- `store.state` 对外是 `readonly`，视图不能直接改写。
- 每次修改后 120ms 防抖落盘，同时写 localStorage 与 IndexedDB（前者作为兜底）。
- 读取失败不阻塞 UI：`init()` 有 1200ms 超时，IndexedDB 打不开时回落种子数据，界面始终可用。
- 休息计时保存的是绝对结束时间戳，切后台再回前台按当前时间重算，不依赖后台定时器。

### 4.3 口径（与 09/11 对齐）

- **有效训练**：状态 `completed` 且至少一个 `work` + `completed` 组；热身组、跳过组、放弃场次均不计。
- **容量**：仅累加已完成工作组的 `loadGrams × reps`。
- **计划组数**：按 `targetSets` 求和，不按实际录入组数。
- **周完成**：周一为周首，区间左闭右开，只计被唯一满足的计划项目（`occurrenceId` + `goalCreditConfirmed`），不是会话总数。
- **最低目标**：`K = min(minimumTarget, A)`，A 为排除豁免/取消后的可执行数；原始 N 永不改写。
- **状态**：`unplanned → paused → upcoming → ongoing → achieved/notAchieved`，优先级固定。
- **连续达标**：achieved 加 1、notAchieved 归零、paused/unplanned 跳过、ongoing/upcoming 不参与。
- **上次记录**：按 `startedAt` 取最近一次有效场次的同动作工作组，可排除当前场次。
- **e1RM**：Epley，仅 1–10 次有效，超出返回 `null` 而非猜测。

### 4.4 周计划命令

计划改动一律走 `domain/plan.ts` 的纯函数命令，界面只负责调用与展示：

| 命令 | 行为 | 约束 |
|---|---|---|
| 豁免 | `disposition=excused` + 原因，从 A 排除 | 有未结束关联会话时禁止 |
| 取消 | `disposition=cancelled` + 原因，保留审计 | 同上 |
| 恢复 | 回到 `scheduled`，A/K 重算 | 历史日恢复不自动算完成 |
| 顺延 | 只改 `scheduledDate`，保留 `originalDate` | 仅限同一周内，跨周请豁免 |
| 调整最低目标 | 记录 before/after 与原因 | 不超过当前 A；降到 0 仅 A=0 |
| 换模板 | 取消生效日后未开始项目、建新项目、记一次调整 | 已完成/已开始项目不动，原 N 不变 |

**计入周目标**：训练结束时默认勾选状态为"未勾选"，用户勾选并确认后写入 `occurrenceId` + `goalCreditConfirmed`。可选项只列本周**尚未被满足**的项目，避免一场训练顶掉已有记录。

## 5. 内容库

| 库 | 规模 | 说明 |
|---|---|---|
| 动作 | 44 个，8 个肌群 | 含器械、要领、替代动作；跟踪模式以 `load_reps` 为主 |
| 模板 | 3 套 | 全身 2 次/周、全身 3 次/周、上下肢 4 次/周，含渐进规则与版本号 |
| 食物 | 47 种，7 个分组 | 每 100g 热量与三大营养素，附常用份量（如"一碗 200g"） |

内容为可替换的静态模块，后续按 [03](03-plugin-architecture.md) 的版本化内容包方向演进。

## 6. 已验证行为

用无头浏览器 + CDP 真实点击验证（`scripts/cdp-check.mjs`、`cdp-plan.mjs`、`cdp-credit.mjs`、`cdp-s23.mjs`）：

- 从模板开始训练 → 预填 4 组 × 2 个输入框（共 8 个），预填值来自上次记录。
- 填 100kg × 5 并完成 → 该组变为"已保存"，休息计时自动启动（3:00），支持 +30s / 跳过。
- 换动作面板列出 24 个可选动作，确认只影响本次训练。
- 周目标页：豁免未完成项后，显示"原始 4 项 → 调整后 3 项 · 最低目标 3 项"，日历出现豁免徽标，目标编辑上限同步降为 3。
- 已完成项目不可再豁免/取消，只提示"改动计划不会抹掉训练事实"。
- 训练结束勾选"计入周目标"并确认 → 周目标从 2/4 变为 3/4，训练次数同步 +1。
- 模板改版：改组数后保存弹出「生成 v2」确认，确认后版本徽标变为 v2。
- 历史更正：改一组后显示「已更正」，容量从 8828 kg 重算为 10.4k kg。
- 删除后显示墓碑提示与恢复入口；补录可勾选「只确认练过，不记组」。
- 六个页面在 430×932 与桌面宽度下均正常渲染。

领域层单元测试 **146 项**（7 个测试文件）：W01–W16 固定示例全覆盖，加有效训练判定、容量、组数、训练天数、e1RM、最佳记录、上次记录、单位换算、时长格式、业务日期、周首计算；计划的生成/幂等/换模板/目标调整/顺延约束；模板校验与版本化；补录、改期、墓碑删除、单组更正、渐进建议。

### 6.1 S2 模板编辑与版本化

- `domain/template.ts`：校验（组数/次数/休息/重复星期/未知动作/空训练日）、增删训练日、增删改排序动作、版本号递增。
- `views/TemplateEditorView.vue`：全屏编辑器，可改名称/说明/渐进规则、每天的名称与星期、每个动作的组数/次数区间/休息。
- 保存逻辑：内容有变化才升版本；正在使用的模板改版会先弹确认，说明"只重排今天及以后未开始的安排，已完成不受影响"。
- 支持基于内置模板复制成可编辑副本、新建空白模板。

### 6.2 S3 历史更正与补录

| 能力 | 实现要点 |
|---|---|
| 更正单组 | `updateSet` 校验重量与次数（1–100），写 `editedAt`；已删除场次拒绝编辑 |
| 更正日期 | `changeSessionDate` 保留本地时分，跨周时自动解除项目关联并提示重新匹配 |
| 删除 | `tombstone` 写 `deletedAt`，统计与列表按此过滤，可恢复；不物理删除事实 |
| 未录组 | `skipRemainingSets` 显式标记跳过，`pendingSetCount` 提示还剩几组 |
| 补录 | `buildBackfill` 允许任意过去日期（不限制 7 天），拒绝未来日期 |
| 自报完成 | `completionBasis='selfReported'`，计入次数与周目标，但不计容量与 PR（09:50） |
| 进步反馈 | `suggestProgression` 达上限加配重、连续两次低于下限减 10%、否则保持 |

### 6.3 S6 导入导出与备份

导出信封按 11:133：`{format:'tieguan-export', schemaVersion:1, exportedAt, datasetId, dataset, records, contentRefs, checksum}`。

**canonical 序列化（关闭契约阻塞 8）**：`canonicalize()` 递归按键字典序排列，数组保序，忽略 `undefined`。checksum 与冲突比对都基于它的输出，避免 `JSON.stringify` 键序不稳定造成的假冲突。哈希用 FNV-1a 32 位加长度后缀，仅作完整性检查，不作认证。

| 能力 | 实现要点 |
|---|---|
| 导出 | 剔除 tombstone 场次与设备私有数据（密钥、同步状态、草稿） |
| 导入校验 | 顺序固定：大小(16MiB) → JSON → 信封 → schemaVersion → checksum → datasetId → 引用/单位 → 冲突 |
| 未来版本 | `schemaVersion` 高于当前直接拒绝并提示升级，不尝试兼容 |
| 合并 | 同 ID 同内容跳过，同 ID 异内容**保留本地**不覆盖，新 ID 追加；体重按日期去重 |
| 替换 | 先自动备份到 localStorage 再整体替换，失败可恢复 |
| 数据集隔离 | 不同 `datasetId` 只警告不混入，避免把别人的数据合并进来 |
| 清空本机 | 重置为种子状态，保留 datasetId，并明确提示"远端数据不会删除" |

关键修复：种子数据原先只进内存不落盘，导致每次刷新生成新 `datasetId`，用户自己导出的备份下次导入会被判为"另一个数据集"。现在首次 seeded 后立即持久化。

## 7. 已知边界（未实现，按 14 号排期推进）

| 缺口 | 影响 | 计划 |
|---|---|---|
| 冲突与同步 | 无配对、无服务端协议 | S7 |
| AI 教练 | 教练页是本地统计建议，没有模型调用 | S5 |
| 动作跟踪模式 | 仅力量型 `load_reps`，无计时/距离/自重/辅助模式 | S4 |
| 服务端与 Android | `server.js`、`sw.js`、`android/` 仍是旧 demo | S7 / S8 |
| 无障碍 | 有基础语义与焦点样式，未做完整读屏与对比度审计 | S8 |
| 审计事件 | 更正/调整只记时间戳，未建独立 AuditEvent 表 | S7 |

## 8. 本地开发命令

```bash
npm run dev        # 开发
npm run typecheck  # 仅类型检查
npm run build      # 类型检查 + 构建
npm test           # 单元测试
node scripts/serve.mjs dist 4173   # 无 vite 的静态服务（用于截图验证）
```

截图验证需先起本地服务，再用 `scripts/cdp-check.mjs` 通过 CDP 驱动。截图产物在 `shots/`，已加入 `.gitignore`。




