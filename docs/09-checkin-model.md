# v1 周目标、打卡与重算规范

版本：1.0；2026-10-23；状态：待实现。替代原四态与60%/80%算法。范围见[00](00-v1-baseline.md)，实体见[11](11-data-model.md)，测试见[12](12-v1-acceptance.md)。

## 1. 计划、执行、统计分离

计划描述安排；会话记录实际训练；打卡是派生结果，没有额外“点打卡才算练过”的动作。训练次数、训练天数、周目标完成数分别展示，不把训练和饮食混算。连续周可隐藏，无欠账和惩罚提示。

## 2. 周与时间

按 Dataset.accountingTimezone，周一00:00至下周一00:00，键为周一日期 weekStart。会话业务日期固定为开始日；跨午夜不拆两天，换设备时区不重归历史。v1不支持修改数据集记账时区，误录日期可显式更正。

不依赖后台准点执行任务：启动、恢复前台、写入事实或完成同步后，按当前时钟更新投影。过去周为已结算，仍允许补录后重算。

## 3. 周目标定义

创建每周安排时，原始计划发生项数为 N，生成唯一 WeekGoal：
- originalPlannedCount=N 固定，保留原始承诺。
- minimumTarget=T 默认N，用户可在预览/周目标入口选1..N；N=0时T=0。
- 周中调目标需要原值、新值、原因、时间和稳定事件ID，不暗用80%阈值。
- 新增/取消未来计划需预览调整后的目标，不静默改原始N。

目标调整事件记录 beforeOccurrenceIds、afterOccurrenceIds、beforeMinimum、afterMinimum、reason、recordedAt，按序应用且不可重复。调整后的项目集合为S，去除excused/cancelled后数量为A；有效最低目标 K=min(当前minimumTarget,A)。

计划换版仅影响生效日后未开始项目：取消旧未来项目并建立新项目，记一次调整；已开始/完成项目和历史会话保持。历史目标允许显式更正并重算，保留审计记录。minimumTarget提高只能在新A范围内；降低到0只允许A=0，通过取消/豁免表达休整，不能暗藏零目标。

## 4. 顺延、豁免与取消

| 操作 | 处理 | 对目标的影响 |
|---|---|---|
| 周内顺延 | 同一ID更新scheduledDate，保留originalDate | 不改变A或K；原日显示移至日期，目标日显示项目 |
| 豁免 | disposition=excused，记录原因 | 从A排除，K重算，不记完成 |
| 取消 | disposition=cancelled，记录原因及调整 | 从A排除，保留原计划与审计 |
| 恢复 | disposition=scheduled | A/K重算；历史日恢复后不能直接算完成 |

豁免原因：生病、伤病、出差、工作、主动休息、其他；无限额，允许可选说明，不阻止真实情况表达。

顺延仅限同一记账周；跨周不搬训练债务，可豁免或保留原周未完成，下周另建项目，两周目标变化均可见。同一会话不计两周。

已有active/paused/completed关联会话时不能直接顺延、取消或豁免：先结束或解除关联并确认影响，保留会话事实，不借更改计划抹掉训练。

## 5. 完成条件与匹配

有效完成会话：status=completed，且至少一个completed工作组；或显式确认的selfReported/legacyReported补录。草稿、放弃、只有热身不算完成。

正常结束前处理所有未录计划组，可明确跳过；显示实际组数/计划组数。用户明确选择“本次计入周目标”才满足关联项目，低于计划也可确认，但不伪装全部组完成；取消原隐式60%门槛。

每会话最多满足一个项目，每项目最多一场有效会话。以session.occurrenceId及goalCreditConfirmed为权威，项目端不重复保存关联。相同datasetId，session.businessDate必须处于项目weekStart的周内；无计划训练正常计次数/天数，可手动匹配本周未满足项目，否则不增加周目标完成数。

一天两场：次数2、天数1；如明确匹配不同项目，周完成数可为2。未录组补录不计算容量或PR。

## 6. 补录、编辑与删除

任何过去日期允许补录真实训练，不限制7天；不能完成未来训练。可录逐组或确认实际练过但无组记录。backfilledAt只表示录入晚，不自动降低事实可信度。

编辑、删除/恢复、日期或关联更正后，重算受影响旧周/新周及之后连续周。日期移出原关联周时必须同时解除关联，提示匹配新周项目。所有更正保留审计；删除用tombstone，不能只改统计。

## 7. 日历状态

| 状态/徽标 | 判定 |
|---|---|
| done | 当天有有效完成会话，显示次数、无计划/补录标记 |
| in_progress | 当天开始的active/paused会话 |
| partial | 有未完成组事实或discarded会话，无有效完成会话 |
| excused | 当天有豁免项目，即使同时训练也保留原因徽标 |
| missed | 历史日期仍有未满足、未豁免/取消、未顺延的项目 |
| scheduled | 今天或未来仍有待完成项目 |
| rest | 无有效安排也无执行事实 |
| moved | originalDate与scheduledDate不同的安排徽标，非执行状态 |

主显示优先：done > in_progress > partial > missed > scheduled > excused > rest。一天完成一项漏一项，仍显示“另有1项未完成”；其他徽标并存。取消项目在详情/审计保留。不存在用单一“四态”表达全部事实的要求。

## 8. 结算函数

~~~text
computeWeek(weekStart, goal, occurrences, sessions, now, ruleVersion):
  S = 目标调整后的项目集合（按ID去重）
  active = S中disposition == scheduled
  A = active数量
  K = min(goal.currentMinimumTarget, A)
  D = active中被本周有效完成会话唯一满足的项目数
  actualSessions = 本周所有有效完成会话（按ID去重）
  trainingDays = actualSessions不同businessDate数量
  if goal不存在，或S为空且originalPlannedCount==0:
    status = unplanned
  else if K==0: status = paused
  else if now < 本周开始: status = upcoming
  else if now < 本周结束: status = ongoing
  else: status = D>=K ? achieved : notAchieved
  targetReached = K>0 && D>=K
  full = A>0 && D==A
  return {originalPlanned, adjustedPlanned:A, minimumTarget:K,
          completedOccurrences:D, actualSessionCount, trainingDays,
          excusedCount, cancelledCount, targetReached, full, status}
~~~

goal不存在时K=0。本周已够目标仍为ongoing，可显示“本周已达标（进行中）”，不提前累计连续周。

连续达标周按已结束周升序折叠：achieved加1，notAchieved归0，paused/unplanned保持不增加，ongoing/upcoming不参与。文案是“连续达标的有目标周，休整和无目标周跳过”，不称连续日历周。

累计训练天数从全部有效会话不同业务日期派生，禁止totalDays+=done。相同输入、时钟与规则版本重复计算必须一致；缓存带sourceRevision/ruleVersion，事实更正后失效。

## 9. 固定验收示例

| ID | 输入 | 预期 |
|---|---|---|
| W01 | N=4,T=4，周三移周六，完成3项 | A4/K4/D3，周末未达标 |
| W02 | N4/T4，豁免1项，完成其余3项 | A3/K3/D3，achieved/full，显示原4调整3 |
| W03 | N4/T3，无豁免，完成3项 | achieved，full=false |
| W04 | N4，全豁免 | A0/K0，paused，连续数不加 |
| W05 | 无计划，同一天2场 | unplanned，次数2/天数1 |
| W06 | 同一会话重复结束或同步 | 次数1，同一项目最多满足1次 |
| W07 | 已结算未达标周补录后满足目标 | 改为achieved，后续连续周重算，总天数不重复 |
| W08 | 已达标周删除关键会话 | notAchieved，后续连续周重算 |
| W09 | 周日23:50开始，周一00:30结束 | 只计周日及其周 |
| W10 | 只有热身组 | 不计有效完成和周目标 |
| W11 | 本周未结束但目标已满足 | ongoing且targetReached，连续周暂不增加 |
| W12 | 同日两项，完成一项漏一项 | done并显示漏项，D1 |
| W13 | 换模板保留已完成，取消未来2项新增1项 | 原N不变，A按新集合，调整事件只应用一次 |
| W14 | 设备从上海改纽约 | 历史日期/周全部不变 |
| W15 | 取消豁免或更改最低目标 | 依据新事实重算，展示调整前后，不暗改 |
| W16 | 会话更正日期移到另一周 | 解除旧关联，旧周/新周及连续周重算 |
