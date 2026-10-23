# v1 领域数据模型与不变量

版本：1.0；2026-10-23；状态：待实现的规范。范围见 [00](00-v1-baseline.md)，统计规则见 [09](09-checkin-model.md)，协议见 [02](02-architecture.md)。

## 1. 通用约定

- ID 为生成后不变的 UUID；跨设备合并不按数组下标、名称或日期充当实体 ID。
- 所有事实实体含 `id, createdAt, updatedAt, revision, deletedAt?`。时间戳为 UTC ISO8601，revision 为本实体单调递增整数；时钟不用于判断哪个副本应该获胜。
- `datasetId` 标识单人数据集；本地不同数据集分区存储。v1 没有家庭、成员和角色模型；服务端 token 只授权一个数据集。
- `businessDate` 为 YYYY-MM-DD；`accountingTimezone` 为 IANA 时区，在数据集创建时取设备时区。事实创建时固定业务日期和使用的时区。旅行或设备设置变更不重归历史；v1 不支持修改数据集记账时区，误记可显式更正业务日期。
- 周为记账时区的周一至周日，键用该周周一日期 `weekStart`，不混用自然年与 ISO 周编号。
- 负荷统一以十进制定点 `loadGrams` 保存，显示可选 kg/lb，转换按 1lb=453.59237g 四舍五入至克；次数正整数，时长整数秒，距离整数米，能量整数 kcal，营养素定点 0.1g。
- RPE 可空，1–10 且步长 0.5；重量允许 0，负值无效。字段边界集中在 schema 中；普通记录的范围限制与营养处方限制分别维护。
- 事实默认不按时间删除。删除用 tombstone 参与同步；备份轮转与显式恢复策略见 02。派生统计可丢弃后重建。

## 2. 实体与引用

| 实体 | 关键字段 | 规则 |
|---|---|---|
| Dataset | id, schemaVersion=1, accountingTimezone, createdAt | 新模型版本与 demo 的 v:1 无关；导出带 format 名称区分 |
| Profile | displayName?, experience?, equipmentIds[], restrictions[], dietaryRestrictionsStatus, allergies[], nutritionInputs? | 未填写不等于无限制；当前体重从测量派生，不能有独立可漂移副本 |
| ExerciseDefinition | id, name, aliases[], origin, definitionVersion, trackingMode, equipmentIds[], movementPattern, muscleIds[], loadConvention, cues[], alternatives[] | origin=builtin/custom；模式 load_reps/reps/duration/distance_duration；有历史后改变模式创建新版本 |
| PlanTemplate | id, title, source, contentVersion, eligibility, days[], progressionPolicy, licenseRef | 内置审核或用户自建；模板不包含执行事实 |
| PlanVersion | id, templateId?, effectiveDate, archivedAt?, inputsSnapshot, daysSnapshot[], progressionPolicySnapshot | 生效后不可原地编辑；更改产生新版本；历史引用永久保留 |
| PlannedOccurrence | id, planVersionId, weekStart, originalDate, scheduledDate, workoutSnapshot, disposition | disposition=scheduled/excused/cancelled；顺延不是状态，是日期变更；fulfilledBySessionId仅是从会话引用派生的查询值，不双向存储事实 |
| WeekGoal | id, weekStart, originalPlannedCount, minimumTarget, adjustments[] | 同一周唯一；详见 09，原始计划数不可事后修改；调整有审计记录 |
| WorkoutSession | id, occurrenceId?, goalCreditConfirmed, status, startedAt, endedAt?, businessDate, accountingTimezone, activeDurationSeconds, restEndsAt?, completionBasis, note?, backfilledAt? | status=active/paused/completed/discarded；completionBasis=sets/selfReported/legacyReported；occurrenceId是匹配的唯一权威引用，goalCreditConfirmed仅由用户确认写入；结束事实不会因计划更新消失 |
| SessionExercise | id, sessionId, exerciseId, definitionVersion, definitionSnapshot, order, replacedFromId?, plannedSetsSnapshot[] | 替代后新建记录，原已完成组保留原动作；替代旧动作的未完成组转为 skipped，不转移负荷 |
| SetRecord | id, sessionExerciseId, kind, status, loadGrams?, reps?, durationSeconds?, distanceMeters?, rpe?, completedAt? | kind=warmup/work；status=planned/completed/skipped；字段组合由动作模式校验 |
| BodyMeasurement | id, kind=weight, valueGrams, businessDate, measuredAt?, source, note? | v1 每天一个有效体重；同日更新同实体；导入同日不同值列为冲突；补旧记录不改变最新测量 |
| FoodLog | id, businessDate, consumedAt?, slot, items[], note?, source, confirmedAt | slot=breakfast/lunch/dinner/snack/other；只保存用户确认的实际；餐单引用另存，不能自动成为摄入 |
| FoodLogItem | id, foodId?, dataVersion?, label, quantity, unit, grams?, preparation?, kcal, proteinDecigrams, carbDecigrams?, fatDecigrams?, method, sourceRef?, uncertainty?, originalText? | method=label/weighed/database/estimated/manual；无“绝对精确”标记；手工总量可作为单项保存 |
| FoodDefinition | id, name, aliases[], dataVersion, preparation, edibleBasis, nutrientsPer100g, sourceRef | 内置只读内容；用户自定义有独立ID和来源，不能改内置ID所代表的旧数据 |
| FoodPreference | id, foodId?, logItemSnapshot?, favorite, preferredQuantity?, preferredUnit? | 收藏或显式保存的份量偏好，可同步；最近记录从FoodLog派生，不后台学习油量 |
| NutritionDay | id, businessDate, completeness, confirmedAt? | completeness=missing/partial/complete/confirmedFasting；有记录后默认 partial；添加/改删餐次后使 complete 失效，需重新确认 |
| NutritionTargetVersion | id, effectiveDate, kcal, proteinDecigrams, carbDecigrams?, fatDecigrams?, source, policyVersion?, inputsSnapshot, acceptedAt | source=manual/formula；同一日期仅一个生效目标；未来算法不纳入 v1 |
| MealPlan | id, targetVersionId?, meals[], dietaryRestrictionsSnapshot, contentVersion, acceptedAt | 参考餐单，可选；照餐单吃需显式确认后复制为独立 FoodLog |
| Recommendation | id, kind, inputsRef, proposedPatch, status, reason, providerVersion? | status=draft/accepted/rejected/expired；采纳前校验当前实体版本；不保存成隐式自动执行指令 |
| Conversation / Message | id, role, text, createdAt, contextRefs?, provider? | 单会话；密钥不在消息；历史长时默认仅保留最近 200 条，导出覆盖当前保留内容，裁剪前提示策略 |
| LegacyActivity | id, businessDate, title, originalPayload, sourceImportId | demo 勾选项只保留为旧记录；不能伪造成真实组记录 |
| AuditEvent | id, commandId, entityType, entityId, beforeRevision?, afterRevision, patchSummary, reason?, recordedAt | 追加不可变；记录计划/目标/日期/关联/删除等更正，revision及审计与业务事实同事务提交；不记录密钥 |

### 2.1 数据来源与内容包

内置动作、模板、食物数据包具有 `packageId, version, licenseRef, attribution, checksum`；用户记录引用版本并保存当时展示与计算所需快照，数据包更新不会改写已记录的营养或动作。

模板渐进建议基于本动作最近可比较的完成会话：用户确认达到模板上限后，按模板增量提出建议；未达标保持，历史不足不猜重量；建议不自动修改已录组。单位和负荷约定不匹配则不比较。

PlanVersion.daysSnapshot须包含周几、动作定义版本、目标组类型/组数/重复区间、休息秒数和最小可用负荷增量；progressionPolicySnapshot须包含达标条件、失败保持条件、适用比较键和规则版本，不能只存自由文本。

日程按已确认周安排产生唯一发生项（planVersionId+weekStart+slotId去重），预建未来4周；前台启动不足4周时补建，命令幂等。未来WeekGoal按该周实际项目数初始化，最低目标取用户计划设定且不超过项目数；计划生效周仅包含生效日及以后新安排。历史空白不自动补造成未完成，计划变更按09显式调整，不覆盖旧周。

### 2.2 负荷与指标

`loadConvention` 明确 totalExternal/perImplement/bodyweight/added/assistance；perImplement 附 `implementCount`。显示必须写清“单只”或“总重量”。总外部容量仅对外部负荷可定义的可比较工作组计算：总外部负荷 × 次数；自重/辅助不强行归入同一容量。

PR 的比较键包含 exerciseId、definitionVersion、trackingMode、loadConvention、implementCount。v1 支持最大外部负荷 PR、同负荷次数 PR；首次为基线，不视为突破。e1RM 仅 totalExternal/perImplement 的 1–10 次完成工作组，使用 Epley：总外部 kg×(1+reps/30)，标明估算和公式版本；其他模式显示原始趋势。历史编辑/删除后重算；通知按会话/组/PR 类型去重。

## 3. 训练状态与事实完整性

- 每数据集最多一个 active/paused 会话；跨设备离线产生多个不丢弃，合并前由用户结束/保留为历史或放弃其中会话。
- active↔paused；active/paused→completed 或 discarded。完成/放弃后不能悄悄恢复为 active；编辑历史是新 revision。
- 正常完成至少有一个完成工作组；结束时未录计划组需明确标记 skipped，再显示完成确认。热身组不满足有效训练条件。
- selfReported 补录允许没有逐组数据，要求日期、标题及明确“实际练过”确认；作为报告事实计训练次数/天数，显示“未录组”，不计算容量或 PR。
- 放弃训练保留已记录事实供查看，但不计完成次数、天数和 PR；用户可显式将其更正为 completed，必须满足上述条件。
- 一次会话最多匹配一个 occurrence，一个 occurrence 最多被一次会话满足。用户完成低于计划的训练时，明确确认“本次计入周目标”并留可选说明；不存在隐式 60% 阈值。
- 会话开始后业务日期固定为开始日；跨午夜不重复计。补录/更正日期后重算旧周与新周，按 09 的匹配边界处理。

## 4. 饮食一致性

FoodLog 总量由 items 相加派生；NutritionDay 统计只汇总有效 FoodLog。missing/partial 不展示为完整全天缺口，confirmedFasting 必须显式确认且无有效食物条目。后续添加食物时自动转 partial。

手工热量/蛋白记录允许缺碳水脂肪，不反推为 0。只有三项均完整时检查 4P+4C+9F 与总 kcal 的一致性，超出 max(50kcal, 目标热量×5%) 时提示核对；标签数据可说明保留原值。自动生成的目标必须满足内部一致性，不靠抬高碳水下限制造矛盾。

## 5. 派生与设备私有数据

| 数据 | 是否同步/导出 | 说明 |
|---|---|---|
| DaySummary、WeekSummary、PR、当前体重 | 否 | 可从事实与规则版本重建；导出可含非权威摘要，导入忽略摘要 |
| LocalOutbox | 否 | deviceId、generation、baseRemoteRevision、snapshotHash、pending；与业务事务一起写 |
| SyncCheckpoint | 否 | acknowledgedGeneration、remoteRevision、baseSnapshot、lastSuccessAt、error；共同基线快照与远端版本成对保存，本机确认，不能由远端覆盖 |
| ConflictCopy | 单独可导出，不混入主快照 | 本地/远端/共同基线三份，附远端 revision 与生成时间 |
| Draft | 否 | 输入草稿、AI 未确认输出；恢复但不进入统计 |
| Secret | 否 | 模型 Key、同步 token；独立设备密钥存储，不写业务日志、普通备份、模型上下文 |
| DevicePreferences | 否 | 显示单位、页面位置、屏幕常亮偏好 |
| CommandReceipt / SyncLease | 否 | 本地commandId去重结果，以及数据集同步租约持有人/到期时间；与事实或同步检查点同事务维护，失效租约可安全接管 |

同步业务快照包括 Dataset 与第 2 节事实实体及必要内容快照；不包括所有上表设备数据。outbox 是持久化“待上传最新快照”的意图，不承诺每个本地操作都单独上传一次。

## 6. 导出、导入与 demo 数据

标准导出信封：`{format:'tieguan-export', schemaVersion:1, exportedAt, dataset:{...}, records:{...}, contentRefs:[...]}`。checksum 针对约定的规范化序列化内容计算，用于完整性检查，不作为认证。

导入先限大小/解析/schema/引用/单位/冲突校验，再预览。默认合并：同 ID 同内容忽略，同 ID 异内容冲突保留双方；新 ID 同日体重冲突、同周目标冲突需处理。不同 datasetId 不直接混入，允许作为独立数据集打开，或者显式转换后合并并显示来源。确认后单事务提交，失败完全回滚；替换模式先自动备份。

demo 导入单独识别 `{v:1, profile,...}`，不把旧 v 当新 schema：体重转 BodyMeasurement；计划转草稿模板；日程与勾选转 LegacyActivity；旧 checkin 转 legacyReported 会话只在用户逐项确认实际训练后计统计，默认仅旧记录展示；餐次勾选不转实际摄入；双线程聊天按时间合并；Key 不导入、不写日志；原文件和旧 localStorage key 保持不变。未来版本拒绝写入且不覆盖现有数据。
