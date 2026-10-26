# 铁馆 · 健身记录与饮食辅助

**当前状态（2026-10-26）**

- 前端已完成 **Vue 3 + Vite + TypeScript** 重写，`src/` 为唯一实现；PWA 可直接部署，Capacitor Android 壳已适配新构建（`webDir: 'dist'`，`applicationId com.tieguan.fit`，`versionCode 2` / `versionName 1.1`）。
- 旧版 demo（`js/`、`css/`、`server.js`、`sw.js`、`android/www`）已在重写中**删除**；根目录 `index.html` 是 Vite 入口，不是旧 demo。
- 数据安全六项修复已落地（详见 [QA 数据安全](docs/qa/2026-10-26-data-safety-fixes.md)）：落盘前脱离 Vue Proxy 的固定快照、IndexedDB 与 localStorage 双副本带设备保存序号、损坏数据进入恢复阻塞界面、同步以共同基线哈希保护本地修改。
- 测试：**962 个单元用例（47 个测试文件）全部通过**，Playwright E2E **88 项（16 个文件）**；CI 门禁 `verify.yml`（`typecheck` + `typecheck:e2e` + `test` + `build`）。
- 已知缺口：① **自适应 TDEE 未实现**——仅有静态 `BMR × 活动系数` 估算，按 [00 · v1 基线](docs/00-v1-baseline.md) D06 后置；② **AI 教练 BYOK 在浏览器/PWA 受 CORS 拦截**（[24 · 待研究问题](docs/24-open-questions.md) Q-001，用户明确"后面再研究"）；③ v1 验收（[12 · 验收](docs/12-v1-acceptance.md)）尚未全部点亮。

## 快速开始

```bash
npm install          # 首次安装依赖（Node >= 20）
npm run dev          # 开发服务器
npm run build        # 类型检查 + 生产构建到 dist/
npm test             # 领域层单元测试（47 文件 / 962 用例）
npm run test:e2e     # Playwright 端到端（16 文件 / 88 项）
npm run verify       # CI 同款门禁：typecheck + typecheck:e2e + test + build
npm run preview      # 预览 dist/（需先 build）
```

构建产物是纯静态文件，可直接部署为 PWA。数据以 **IndexedDB 为主、localStorage 双副本**保存在本机（带设备保存序号，读取取较新副本），不需要账号或网络；可选单人多设备自托管同步。

## 开发基线

从 [v1 产品范围](docs/00-v1-baseline.md) 开始阅读。目标是可靠、快速的力量训练记录，配合实际中餐饮食与体重趋势；AI 可选，核心记录无需账号、Key 或网络。

| 文档 | 内容 |
|---|---|
| [00 · v1范围与决策](docs/00-v1-baseline.md) | 必做/后置、用户定位、M0–M3、文档权威、决策台账 |
| [02 · 架构](docs/02-architecture.md) | 分层、本地事务、同步协议、冲突、安全、迁移 |
| [11 · 数据模型](docs/11-data-model.md) | 实体、单位、引用、状态、不变量、demo 导入 |
| [09 · 周目标与打卡](docs/09-checkin-model.md) | 顺延、豁免、补录、周结算、固定示例 |
| [12 · 验收](docs/12-v1-acceptance.md) | 功能追踪、领域/协议/端到端/真机门禁 |
| [12 · 补充测试与缺陷修复](docs/12-supplementary-test-report.md) | 562→919→962 演进与实证缺陷修复记录 |
| [05 · 交互](docs/05-ui-design.md) | 四 tab、训练现场、饮食、冲突与通用状态 |
| [07 · 营养](docs/07-nutrition-and-adaptation.md) | 实际摄入、完整度、初始目标、算法边界 |
| [03 · 模块扩展](docs/03-plugin-architecture.md) | 端口和版本化内容包，无插件平台 |
| [04 · Android与PWA](docs/04-android-app.md) | 交付、生命周期、升级与发布证据 |
| [13 · 需求与架构分析](docs/13-requirements-architecture-analysis.md) | 评审意见：M0 阻塞项、同步契约、容量实测与执行顺序 |
| [17 · 前端实现](docs/17-frontend-implementation.md) | 设计系统、页面结构、状态模型、已知边界 |
| [23 · AI 教练](docs/23-ai-coach.md) | BYOK 方案、密钥边界、草稿校验、采纳流程 |
| [24 · 待研究问题](docs/24-open-questions.md) | BYOK CORS 等未决项（按时间倒序） |
| [同步契约](docs/sync-contract.md) | 快照·条件写·幂等，已冻结（G0 阻塞关闭） |
| [内容授权](docs/content/licensing.md) | 开源动作库评估、Unlicense 采用理由、ODbL 为何不采用 |
| [QA 验收](docs/qa/2026-10-24-acceptance.md) | 逐提交验收、实测数据、发现的问题与放行建议 |
| [阶段审核](docs/qa/2026-10-25-stage-review.md) | 计划 vs 实际、门禁状态、P0/P1 问题清单 |
| [产品评审](docs/qa/2026-10-25-product-review.md) | 实测数据、是否达到预期、优化优先级 |
| [数据安全修复](docs/qa/2026-10-26-data-safety-fixes.md) | 六项修复契约与验证 |
| [E2E 与 CI](docs/18-e2e-and-ci.md) | Playwright 覆盖范围、门禁配置、踩过的坑 |
| [Android](docs/19-android.md) | Capacitor 链路、检查脚本、环境前置、仍未做的事 |
| [Android 真机验证](docs/20-android-device-testing.md) | 一键冒烟脚本、设备准备、必须人工确认的项 |
| [设计研究](docs/21-design-research.md) | 对照 Hevy/Strong/limelog 的差距清单与落地情况 |
| [视觉审计](docs/22-visual-audit.md) | 多视口自动审计、致命/观察分级、局限 |
| [迭代流程](docs/process/development-workflow.md) | 六条硬性规则、检查清单、评审要点 |
| [变更日志](CHANGELOG.md) | 做了什么、已知限制 |
| [参与开发](CONTRIBUTING.md) | 环境、三条最易踩的规则、验证门槛 |
| [ADR 索引](docs/adr/README.md) | 0001 构建/TS、0002 测试/CI、0003 IDB、0004 同步协议、0005 Android、0006 密钥/日志 |

实测与证据另存于 `docs/evidence/`（W06/W09/W11/W15/W16/W17 等）。

## 实施计划

评审之后开始排期时，从 [实施计划](docs/14-implementation-plan.md) 进入。计划类文档不定义产品范围，范围仍以 00 为准。

| 文档 | 内容 |
|---|---|
| [14 · 实施计划](docs/14-implementation-plan.md) | 阶段与里程碑、WBS、9 个垂直切片、20 周排期、G0–G6 门禁、风险与缩放 |
| [15 · 测试方案](docs/15-test-plan.md) | D/C/E/P/R 分层、夹具、专项测试、覆盖率门槛、证据格式 |
| [16 · 验收追踪](docs/16-ac-traceability.md) | F01–F12 → AC → Test ID → 证据路径，含待补 AC 清单 |

## 代码结构

```
src/
  domain/        纯领域层：类型、单位换算、营养口径、同步契约、快照哈希（无 DOM/存储依赖）
  content/       内置动作库（42 本地 + 62 扩展包 = 104 动作 / 12 套模板）与食物库（50 种）
  store/         IndexedDB + localStorage 双副本持久化、应用状态、仓库、同步状态
  views/         今日 / 训练 / 计划 / 数据 / 我的 + 教练 / 目标面板
  components/    训练直播页、导航、图表、提示、动作演示、月历、迷你曲线
  composables/   休息计时、Toast、沉浸模式、返回栈、边缘滑动返回
  styles/        设计令牌、基础样式、组件样式
  assets/        图标、manifest 等资源
  types/         跨层共享类型
```

## 第一版范围

- 模板/自建计划、逐组训练、计时恢复、换动作、历史更正和进步反馈。
- 手工/搜索/常吃/可选文字解析的实际饮食记录，体重与初始营养目标。
- 可解释的周目标和日历，顺延不减少目标，豁免无额度，真实训练可补录。
- 事务性本地保存、完整 JSON 导入导出、可选单人多设备自托管同步。
- Android 与 HTTPS PWA；完整离线、错误、更新和隐私说明。

## 未来规划

以下以 [00 · v1 基线](docs/00-v1-baseline.md) §3.1 的"明确后置"清单为权威来源，按优先级分层。括号内标注当前状态。

### 近期（v1.1 收尾与缺口补齐）
- **点亮 v1 验收门禁**：`docs/12` 的端到端/真机门禁尚未全部通过，需逐项闭环。
- **自适应 TDEE 落地**（[07 · 营养](docs/07-nutrition-and-adaptation.md) §6.2 的第二件核心）：当前仅有静态 `BMR × 活动系数` 估算；需基于实际体重/训练反馈自动调目标，按 D06 验证真实输入质量后再启用。
- **AI 教练 BYOK 的 CORS 方案定夺**（[24 · Q-001](docs/24-open-questions.md)）：在 A（端点加 CORS 头）/ B（网关加头）/ C（后端中转，与 BYOK 隐私承诺冲突）/ D（仅 Android 可用）之间决策；本机联调用 `scripts/cors-proxy.mjs`，不进产品。

### 中期（体验增强）
- 拍照 / 条码识别食物（[00](docs/00-v1-baseline.md) 后置项"拍照识别"）。
- 动作演示视频 / 动画（接 free-exercise-db 后目前只有文字提示与图示）。
- BLE 心率带直连 + 健康平台接入（小米/华为/Apple Watch 不开放标准协议，走健康数据导入）。
- 超级组编排、自动递减组流程。
- 油量后台学习（基于记录自动校正动作负荷估计）。

### 远期 / 明确后置（不阻塞 v1）
- 睡眠 / HRV 自动调负荷。
- 社交 / 家庭 / 多用户、运行时插件平台。
- 云托管账号与付费结算（商业模式未验证，不将"买断""唯一中餐库"作已定宣传）。
- iOS 上架、微信小程序。
- 深色模式、多语言界面。
- Hevy / Strong 专属 CSV 导入。

## 历史分析

[01 openGym调研](docs/01-research-opengym.md)、[06旧缺口分析](docs/06-gap-analysis.md)、[08市场复核](docs/08-market-review.md)、[10产品架构评审](docs/10-product-architecture-review.md) 保留为背景，不定义当前范围。原 02/03/04/05/07/09 已 [归档](docs/archive/2026-10-23-pre-baseline/INDEX.md)。

文档完成不等于业务实现完成；正式 v1 必须通过 [12 · 验收](docs/12-v1-acceptance.md) 全部门禁。
