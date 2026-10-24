# 内容授权与开源库评估

版本：1.0；日期：2026-10-24；状态：**决策记录**
关联：[11 数据模型](../11-data-model.md)（内容包要求）、[content 清单](README.md)（交付范围）

## 0. 结论

| 问题 | 结论 |
|---|---|
| 动作能否引用开源库 | **能，已接入**。选用 free-exercise-db，Unlicense（公有领域），可商用、无传染性 |
| 能引用多少 | 上游 876 条，**只收录 61 条**有可靠中文名的动作，其余不收录 |
| 食物库能否用 Open Food Facts | **不建议**用于默认分发包：ODbL 要求衍生数据库以同授权共享 |
| 是否影响现有 AC | 新增 `AC-C04 内容包授权合规`，已实现并有测试 |

## 1. 候选库评估

| 库 | 授权 | 规模 | 可用性 | 结论 |
|---|---|---|---|---|
| [free-exercise-db](https://github.com/yuhonas/free-exercise-db) | **Unlicense**（公有领域） | 876 条，JSON，含器械/肌群/要领 | 字段结构清晰，英文 | **采用** |
| [wger](https://wger.readthedocs.io/) | CC-BY-SA 4.0 | 数百条 | 需自建服务，数据质量参差 | 不采用（传染性授权 + 运维成本） |
| [Open Food Facts](https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/license-be-on-the-legal-side/) | **ODbL 1.0**（数据库）+ DbCL（内容） | 百万级商品 | 数据丰富 | **不用于默认分发** |
| [USDA FoodData Central](https://fdc.nal.usda.gov/) | 美国联邦政府作品，公有领域 | 数十万条 | 英文食物名，西餐为主 | 备选（中餐覆盖不足） |

### 1.1 为什么 ODbL 不能随便用

ODbL 的"相同方式共享"具有传染性：如果把它作为数据库的一部分分发，衍生数据库也要以 ODbL 发布。对本项目的实际影响：

- 用户数据（训练/饮食记录）若与 ODbL 数据混合，可能被要求整体以 ODbL 授权；
- 与"用户数据归用户"的产品立场冲突；
- 商用需额外评估。

**处置**：不把 Open Food Facts 放进默认分发包。若将来需要条码扫描，作为**运行时可选联网查询**功能，并按 ODbL 要求署名，不写入本地数据库快照。

## 2. 采用方式

### 2.1 只收录有可靠中文名的动作

上游 876 条中，绝大多数没有通用中文名。尝试过的两种自动化方案都不可接受：

| 方案 | 结果 | 问题 |
|---|---|---|
| 部分匹配翻译 | 671 条译出 496 条 | 语义丢失：`Ab Crunch Machine`→"卷腹"、`Anti-Gravity Press`→"推举" |
| 严格逐词翻译 | 671 条译出 176 条 | 词序错乱："背飞鸟弹力带"、"杠铃臀臀桥"、"辅助拉上" |

因此改为**人工确认白名单**：只收录语义明确、中文名在健身圈通用的 61 个动作。未收录的动作不是数据有问题，而是本包暂不提供可靠中文名——**宁可少，不可错**。

### 2.2 字段映射

| 本项目字段 | 来源 | 说明 |
|---|---|---|
| name | 人工确认 | 不使用机器翻译 |
| group | 上游 `primaryMuscles[0]` 经映射 | 17 个上游肌群 → 8 个项目肌群 |
| equipment | 上游 `equipment` 经映射 | body only→自重、cable/machine→器械 |
| mode / load | 人工确认 | 平板支撑→计时；划船机→距离；引体→自重次数 |
| cues | **留空** | 上游要领是英文，中文界面里显示会不一致；由内容审核补写 |
| source | 自动写入 | 记录 upstreamId / license / url |

### 2.3 包结构与校验

包文件：`src/content/packs/exercises-ext.json`，含 `packageId`、`version`、`license{id,url,attribution,upstream,upstreamSha256,notice,modifications}`、`checksum`（对规范化内容做 SHA-256）。

生成脚本：`scripts/build-exercise-pack.mjs`，可复现。

运行时校验（`validatePacks`）：

- 必须带 packageId / 正整数 version / license.id / attribution / checksum；
- **授权必须在允许列表**（Unlicense、CC0-1.0、MIT、Apache-2.0、BSD-3-Clause），CC-BY-SA、ODbL、GPL 一律拒绝；
- 动作 ID 不得重复；
- 动作名不得为纯英文（中文界面一致性）。

上述规则都有测试覆盖（`packs.test.ts`，18 项）。

## 3. 界面呈现

"我的 → 数据"页新增"内容来源与授权"卡片，显示：包名、版本、动作数、授权标识、授权链接、上游署名、授权说明。这是 11:45 要求 `attribution` 的落地。

## 4. 局限与后续

| 项 | 现状 | 建议 |
|---|---|---|
| 中文名覆盖 | 61 / 876（7%） | 由内容审核按使用频次逐步补，每批需人工确认 |
| 动作要领（cues） | 扩展包留空 | 需中文撰写，不能直接用英文原文 |
| 图片 | 未采用 | 上游图片未逐一核实版权，暂不引入 |
| 动作替代关系 | 未映射 | 上游无此字段，需人工补 |
| 食物库 | 自建 47 条 | 若扩到条码级，需重新评估授权与数据来源 |

## 5. 判定

引用开源动作库**可行且已落地**，前提是：选无传染性授权的库、只收录有可靠中文名的子集、保留完整授权元数据、并在界面署名。把英文名或机器错译塞进中文界面，比不提供更糟。
