# 练迹 · 训练与身体记录

> 原名「铁馆」。改名是因为定位从「健身房力量训练」扩展到更广的训练形式
> （自重、器械、计时、距离类都支持），不再局限于铁馆这一个场景。
> 内部标识（包名 app.lianji.fit、存储键 lianji.*）已同步更新，旧数据会自动迁移。

**当前状态（2026-10-27）**

- 前端已完成 **Vue 3 + Vite + TypeScript** 重写，`src/` 为唯一实现；PWA 可直接部署，Capacitor Android 壳已适配新构建（`webDir: 'dist'`，`applicationId com.tieguan.fit`，`versionCode 2` / `versionName 1.1`）。
- 旧版 demo（`js/`、`css/`、`server.js`、`sw.js`、`android/www`）已在重写中**删除**；根目录 `index.html` 是 Vite 入口，不是旧 demo。
- 数据安全六项修复已落地（详见 [QA 数据安全](docs/qa/2026-10-26-data-safety-fixes.md)）：落盘前脱离 Vue Proxy 的固定快照、IndexedDB 与 localStorage 双副本带设备保存序号、损坏数据进入恢复阻塞界面、同步以共同基线哈希保护本地修改。
- 新增**每日饮水**与**本地提醒**：饮水按条记录，今日页显示总量/目标进度与快捷添加；训练与喝水提醒在原生端用 `@capacitor/local-notifications`（App 关闭也能响），网页端在页面打开时生效。详见 [变更日志](CHANGELOG.md)。
- 测试：**1059 个单元用例（56 个测试文件）全部通过**，Playwright E2E **88 项（16 个文件）**；CI 门禁 `verify.yml`（`typecheck` + `typecheck:e2e` + `test` + `build`）。
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
- 每日饮水记录与目标；训练 / 喝水本地提醒（不依赖账号与服务器）。
- 可解释的周目标和日历，顺延不减少目标，豁免无额度，真实训练可补录。
- 事务性本地保存、完整 JSON 导入导出、可选单人多设备自托管同步。
- Android 与 HTTPS PWA；完整离线、错误、更新和隐私说明。

## 产品边界

这个项目在产品方向上已经调整过一次，所以这里写的是**当前**的边界，不是永久承诺。

### 坚持不变的

| 原则 | 说明 |
| --- | --- |
| 数据属于用户 | 训练记录默认只存本机；多设备同步走用户自己的端点，不经过我们的服务器 |
| 不卖数据 | 不做基于数据的广告投放，不出售或共享训练与身体数据 |
| 离线可用 | 无网络也能完整记录训练与饮食，联网不是使用前提 |
| AI 密钥不落服务器 | 自带密钥只存本机，调用时由设备直连用户填写的端点 |

### 随商业化推进而调整的

早先的版本写过"不做订阅内购、不做账号、不做社交"。随着产品向商业化方向演进，
这些不再是硬性排除项，而是**待定**：

| 方向 | 当前状态 |
| --- | --- |
| 付费模式 | 待定（买断 / 订阅 / 高级功能解锁都在评估） |
| 账号体系 | 待定；若要跨设备同步免部署，可能需要 |
| 社交与分享 | 已开始做**分享训练卡片**；不做公开排行榜 |
| 云端托管 | 待定；若提供，会与现有的"自带同步端点"并存而非替换 |

### 明确不做的

- **睡眠 / 情绪 / 用药 / 周期追踪**：这些需要医疗级严谨，做不到就不占位
- **公开排行榜与陌生人社交**：训练不是比赛，比较只会制造焦虑
- **自动抓取第三方健康平台的账号凭据**：涉及凭据托管，与"密钥只存本机"的取舍冲突

以下几件事是**有意为之**的取舍，不是缺陷：

- **AI 密钥只存本地**：代价是换设备要重填，收益是密钥永不离开这台设备
- **AI 不直接写数据**：模型只产出草案，用户逐条确认后才落库，模型出错不会污染训练事实
- **手工为主的饮食记录**：不接需要订阅的食物数据库，靠自定义食物与常吃列表，可离线

## 未来规划


