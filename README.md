# 铁馆 · 健身记录与饮食辅助

当前状态：**新版前端已实现（M1 训练闭环可运行），服务端与 Android 壳仍为旧 demo**。旧 demo 的 `js/`、`css/`、`server.js`、`sw.js` 不再被新版页面引用，允许推翻或删除；`android/` 工程尚未适配新构建产物。

## 快速开始

```bash
npm install          # 首次安装依赖
npm run dev          # 开发服务器
npm run build        # 类型检查 + 生产构建到 dist/
npm test             # 领域层单元测试（27 项）
npm run preview      # 预览 dist/（需先 build）
```

构建产物是纯静态文件，可直接部署为 PWA。数据全部保存在浏览器 IndexedDB（失败时回落 localStorage），不需要账号或网络。

## 开发基线

从[v1产品范围](docs/00-v1-baseline.md)开始阅读。目标是可靠、快速的力量训练记录，配合实际中餐饮食与体重趋势；AI可选，核心记录无需账号、Key或网络。

| 文档 | 内容 |
|---|---|
| [00 · v1范围与决策](docs/00-v1-baseline.md) | 必做/后置、用户定位、M0–M3、文档权威 |
| [02 · 架构](docs/02-architecture.md) | 分层、本地事务、同步协议、冲突、安全、迁移 |
| [11 · 数据模型](docs/11-data-model.md) | 实体、单位、引用、状态、不变量、demo导入 |
| [09 · 周目标与打卡](docs/09-checkin-model.md) | 顺延、豁免、补录、周结算、固定示例 |
| [12 · 验收](docs/12-v1-acceptance.md) | 功能追踪、领域/协议/端到端/真机门禁 |
| [05 · 交互](docs/05-ui-design.md) | 四tab、训练现场、饮食、冲突与通用状态 |
| [07 · 营养](docs/07-nutrition-and-adaptation.md) | 实际摄入、完整度、初始目标、算法边界 |
| [03 · 模块扩展](docs/03-plugin-architecture.md) | 端口和版本化内容包，无插件平台 |
| [04 · Android与PWA](docs/04-android-app.md) | 交付、生命周期、升级与发布证据 |
| [13 · 需求与架构分析](docs/13-requirements-architecture-analysis.md) | 评审意见：M0 阻塞项、同步契约、容量实测与执行顺序（不定义范围） |
| [17 · 前端实现](docs/17-frontend-implementation.md) | 设计系统、页面结构、状态模型、已知边界 |
| [内容授权](docs/content/licensing.md) | 开源动作库评估、Unlicense 采用理由、ODbL 为何不采用 |
| [QA 验收](docs/qa/2026-10-24-acceptance.md) | 逐提交验收、实测数据、发现的问题与放行建议 |
| [阶段审核](docs/qa/2026-10-25-stage-review.md) | 计划 vs 实际、门禁状态、P0/P1 问题清单 |
| [E2E 与 CI](docs/18-e2e-and-ci.md) | Playwright 覆盖范围、门禁配置、踩过的坑 |
| [产品评审](docs/qa/2026-10-25-product-review.md) | 实测数据、是否达到预期、优化优先级 |
| [迭代流程](docs/process/development-workflow.md) | 六条硬性规则、检查清单、评审要点 |
| [变更日志](CHANGELOG.md) | 做了什么、已知限制 |
| [参与开发](CONTRIBUTING.md) | 环境、三条最易踩的规则、验证门槛 |
| [Android](docs/19-android.md) | Capacitor 链路、检查脚本、环境前置、仍未做的事 |
| [Android 真机验证](docs/20-android-device-testing.md) | 一键冒烟脚本、设备准备、必须人工确认的项 |
| [设计研究](docs/21-design-research.md) | 对照 Hevy/Strong/limelog 的差距清单与落地情况 |
| [视觉审计](docs/22-visual-audit.md) | 多视口自动审计、致命/观察分级、局限 |

## 实施计划

评审之后开始排期时，从[实施计划](docs/14-implementation-plan.md)进入。计划类文档不定义产品范围，范围仍以 00 为准。

| 文档 | 内容 |
|---|---|
| [14 · 实施计划](docs/14-implementation-plan.md) | 阶段与里程碑、WBS、9 个垂直切片、20 周排期、G0–G6 门禁、风险与缩放 |
| [15 · 测试方案](docs/15-test-plan.md) | D/C/E/P/R 分层、夹具、专项测试、覆盖率门槛、证据格式 |
| [16 · 验收追踪](docs/16-ac-traceability.md) | F01–F12 → AC → Test ID → 证据路径，含待补 AC 清单 |
| [ADR 索引](docs/adr/README.md) | 0001 构建/TS、0002 测试/CI、0003 IDB、0004 同步协议、0005 Android、0006 密钥/日志 |

## 代码结构

```
src/
  domain/       纯领域层：类型、单位换算、口径判定与统计（无 DOM/存储依赖）
  content/      内置动作库（44 个动作 / 3 套模板）与食物库（47 种）
  store/        IndexedDB 持久化端口、应用状态、种子数据
  views/        今日 / 训练 / 饮食 / 教练 / 我的
  components/   训练直播页、导航、图表、提示
  styles/       设计令牌、基础样式、组件样式
  composables/  休息计时、Toast、沉浸模式
```

## 第一版范围

- 模板/自建计划、逐组训练、计时恢复、换动作、历史更正和进步反馈。
- 手工/搜索/常吃/可选文字解析的实际饮食记录，体重与初始营养目标。
- 可解释的周目标和日历，顺延不减少目标，豁免无额度，真实训练可补录。
- 事务性本地保存、完整JSON导入导出、可选单人多设备自托管同步。
- Android与HTTPS PWA；完整离线、错误、更新和隐私说明。

自适应TDEE、自动睡眠/伤病调负荷、油量后台学习、视频、拍照、BLE、社交、多用户、插件平台、付费系统和专属竞品CSV导入后置。具体边界以00为准。

## demo参考

现有index.html/js/css/server.js/android仅供观察旧流程与数据来源，不是新架构约束。旧运行方式、模型配置与目录说明保存在[历史demo README](docs/archive/2026-10-23-pre-baseline/README-demo.md)，其中“已验证”“密钥不上传”等陈述不是当前v1保证；密钥和同步缺陷见评审。

新版本不要求双击file://零构建；本轮未新增重构代码或运行命令，不宣称APK/PWA验收通过。现有数据不自动覆盖或升级，未来按11号规范显式导入；旧餐次勾选不能转换为实际摄入，旧勾选不能伪造逐组事实。

## 历史分析

[01 openGym调研](docs/01-research-opengym.md)、[06旧缺口分析](docs/06-gap-analysis.md)、[08市场复核](docs/08-market-review.md)、[10产品架构评审](docs/10-product-architecture-review.md)保留为背景，不定义当前范围。原02/03/04/05/07/09已[归档](docs/archive/2026-10-23-pre-baseline/INDEX.md)。

文档完成不等于业务实现完成；正式v1必须通过12号文档全部门禁。






