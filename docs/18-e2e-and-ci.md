# 端到端测试与 CI 门禁

日期：2026-10-25；对应审核发现 P0-1（无 CI）与 P0-2（无 E2E）。

## 0. 解决的问题

审核报告指出的两个发布级阻塞：

| 问题 | 现状 |
|---|---|
| 273 项测试靠人工执行，提交无门禁 | 已建 GitHub Actions，push/PR 自动跑 |
| 14 个 Vue 组件零测试，界面回归靠一次性脚本 | 已建 13 项 Playwright E2E，覆盖三条关键路径 |

## 1. 为什么之前不测界面

此前有 11 个 `scripts/cdp-*.mjs`，看起来"测过"。问题在于：

- 硬编码端口与选择器，换环境即失效；
- 无断言汇总，靠人看输出；
- 跑完即弃，不能回归。

它们适合**一次性排查**，不能替代回归测试。E2E 的意义是"每次提交都跑同样的断言"。

## 2. 技术选择

| 决策 | 选择 | 理由 |
|---|---|---|
| 框架 | Playwright | 自带 trace/screenshot、webServer 编排、并行；本项目已有浏览器使用经验 |
| 浏览器 | 本地用系统 Edge（`channel: 'msedge'`），CI 用 Chromium | 避免下载数百 MB；`E2E_CHANNEL` 环境变量切换 |
| 被测产物 | **构建后的 `dist`**，不是 dev server | 测真实产物才能发现构建期问题 |
| 服务器复用 | **不复用**（`reuseExistingServer: false`） | 见 §5 的踩坑 |

## 3. 覆盖范围

| 文件 | 用例 | 覆盖 |
|---|---|---|
| `e2e/training.spec.ts` | 5 | 首屏可用、从今日页开始训练并记录一组、空白训练加计时动作、动作面板搜索、刷新后数据仍在 |
| `e2e/transfer.spec.ts` | 5 | 导出信封可解析、datasetId 一致、非法文件被拒且不写入、导入前预览不写入、清空需二次确认 |
| `e2e/sync.spec.ts` | 3 | 测试连接、上传后服务端确有数据且二次同步显示已是最新、错误口令不误报成功 |

同步 E2E **启动真实服务端**（`spawn` 子进程 + 随机端口 + 临时数据目录），不 mock。原因是同步的价值在端到端契约（条件头、幂等、datasetId 绑定），mock 掉服务端就只能验证客户端自说自话。

## 4. 测试辅助的关键约定

`e2e/helpers.ts` 的 `resetApp()` 每个用例都清 IndexedDB + localStorage 再重载。理由：种子数据会写入 `datasetId`，用例之间若共享存储，datasetId 漂移会让同步相关断言失去意义。

## 5. 踩过的坑（值得记住）

| 坑 | 现象 | 结论 |
|---|---|---|
| 复用了残留服务器 | 改了源码但测试仍失败/通过，`dist` 构建时间早于源码 | 本地残留进程占 4173 时，`reuseExistingServer: true` 会测到**过期产物**。已改为 `false` |
| 同名按钮 | 今日页与训练页都有"空白训练" | `getByRole('button', { name })` 会跨页命中，必须限定作用域（`.train .btn--block`） |
| DataView 不是分段 | `.data__id` 找不到 | 数据管理是独立路由，需先切"数据"分段再点"导出、导入与备份" |
| 模板结构被破坏 | 切到训练页后 `main` 为空、`seg count: 3` | 手工改 `<template v-else>` 会破坏条件链，导致整块不渲染且**无报错** |

最后一条最危险：Vue 不会为"条件链断裂"报错，页面只是空白。这是为什么需要 E2E——单元测试和 typecheck 都发现不了。

## 6. 门禁

`.github/workflows/verify.yml`：

```
unit job:  checkout → setup-node 22 → npm ci --ignore-scripts
           → typecheck（应用）→ typecheck（E2E）→ test → build
e2e  job:  依赖 unit → 装 Chromium → playwright test（E2E_CHANNEL=chromium）
           → 失败时上传 playwright-report / test-results
```

本地等价命令：`npm run verify`（四项静态与单测）+ `npm run test:e2e`。

## 7. 验证记录

| 项 | 结果 |
|---|---|
| 应用 typecheck | exit 0 |
| E2E typecheck | exit 0 |
| 单元测试 | 273 项通过 |
| E2E | **39 项通过**（2.9 分钟） |
| 构建 | 成功，gzip 83.78 KB |

### 变异验证

为确认 E2E 真能守住行为，做了两次变异：

| 变异 | 结果 |
|---|---|
| 把 `startLive(session.id)` 换成注释（复现历史 bug） | 被 **typecheck 拦截**（`startLive` 未使用，TS6133） |
| 把 `startSessionFromDay(day.id)` 返回值强制为 null | **1 项失败**，正是"从今日页开始训练"用例，其余 4 项通过 |

第一次变异被类型检查拦住是个好信号：类型系统本身就在防这类回归。第二次证明 E2E 能在运行期抓住逻辑回归。

## 8. 局限

| 项 | 现状 |
|---|---|
| 覆盖广度 | 39 项覆盖训练、导入导出、同步、过敏原、引导、空状态、模板编辑、周目标；**饮食记录、教练趋势交互、设置变更、同步冲突仍无 E2E** |
| 视觉回归 | 无截图对比，样式错乱不会被发现 |
| 无障碍 | 无 axe 等自动检查 |
| 真机 | 仅桌面 Chromium/Edge，未在移动端设备或真机跑 |
| 性能 | 无加载时间/内存断言 |
| 冲突路径 | 同步只测顺利路径，多设备冲突未在 E2E 覆盖 |

