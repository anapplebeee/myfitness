# 铁馆 · 补充测试与缺陷修复报告

日期：2026-10-26
范围：`src/domain`、`src/store` 单元测试补充 + 测试实证确认的真实缺陷修复
验证命令：`npx vitest run`、`npx vue-tsc --noEmit`、`npx tsc -p tsconfig.e2e.json`、`npx vite build`

---

## 1. 结果总览

| 指标 | 补充前 | 补充后 |
|---|---|---|
| 单元测试文件 | 27 | 41 |
| 测试用例 | 562 | **915**（+353） |
| domain 层行覆盖 | 89.26% | **96%+**（多数模块 95–100%） |
| snapshot.ts | 56.14% | **100%** |
| sync.ts | 78.54% | **100%** |
| metrics.ts | 55.76% | **98.72%** |
| week.ts | 83.76% | **95.49%** |
| transfer.ts | 92.18% | **95.28%** |
| amend.ts | 94.06% | **99.23%** |
| 分支覆盖 | 78.87% | **84.59%** |
| 函数覆盖 | 67.88% | **74.35%** |

全量验证状态：**915 passed / 0 failed**，typecheck（app + e2e）通过，生产构建通过。

---

## 2. 先修掉一个阻塞性问题

补充测试开始前，`npm test` 在覆盖率模式下有 2 个套件直接失败：

```
src/domain/sync.ts:385: ERROR: Expected ":" but found "buildSnapshot"
```

`snapshotFor()` 引用了从未定义、也从未导入的 `ACCOUNTING_TIMEZONE`，导致 `sync.ts` 编译失败，`sync.test.ts` 与 `syncStateStore.test.ts` 整体无法加载。这是提交进仓库的编译错误，普通 `vitest run` 因缓存偶然能过，`--coverage` 必现。

修复：在 `sync.ts` 中定义并导出该常量（`'Asia/Shanghai'`），与 `transfer.ts` 的导出默认时区一致。

---

## 3. 测试实证确认并修复的缺陷

以下每一项都先写失败测试、确认复现、再修代码，最后回归通过。

### 3.1 CRITICAL — 删除的训练仍计入全部统计

三个独立审查收敛到同一处，测试以 10/10 全失败实证：

- `week.ts` 的 `computeWeek` 会话循环没有 `deletedAt` 过滤
- `week.ts` 的 `isValidCompletedSession` / `metrics.ts` 的 `isValidCompleted` 同样不检查 tombstone
- `week.ts` 的 `dayState` 把已删除场次渲染成 `done`
- `week.ts` 的 `canDispose` / `plan.ts` 的 `hasStartedSession` 被已删除会话阻塞

后果：用户删掉一场训练，周目标完成数、训练天数、最佳成绩、日历"已完成"标记全部不变，`SessionDetailView` 上"这场训练已删除，不计入任何统计"的提示与事实相反。

修复：在 `isValidCompleted`、`isValidCompletedSession`、`computeWeek` 会话循环、`dayState`、`canDispose`、`hasStartedSession` 六处显式过滤 tombstone。测试文件：`src/domain/tombstone-stats.test.ts`（10 例）。

### 3.2 CRITICAL — 导入丢目标与重复记录

- **merge 模式（默认）完全丢弃 `goals`**：未提交的改动给信封加了 `goals` 字段并只在 replace 分支处理，merge 返回对象从未设置它。用户导出再导入，目标静默消失。
- **replace 导入旧版导出会清空 `goals`**：`Array.isArray(undefined) === false` → `goalList = []`。
- **merge 不去重文件内部重复项**：六个去重集合都只从本地状态构建、循环里从不插入，于是一个自相矛盾的文件（两条同 id 会话、两条同日体重）会被全部追加，`latestWeight` 之后任取一条。
- **`added` 统计漏三类实体**：只累加 sessions/weights/foods，导入 10 条安排显示"新增 0"。

修复：`transfer.ts` merge 与 replace 分支都按目标类型去重后合并 `goals`；六个去重结构在循环内同步插入；`added` 改为按各实体增量计算。测试文件：`src/domain/transfer-safety.test.ts`（18 例）。

### 3.3 HIGH — 替换导入的备份写了却找不回来

`appStore.applyImportPreview` 先写 `state.lastBackupKey = backupKey`，紧接着 `Object.assign(state, result.state)` 用 `result.state` 里的旧值（首次替换时为 `null`）把它覆盖回去。localStorage 里备份确实在，`latestBackup()` 永远返回 `null`，"恢复到替换前"入口从此消失。

修复：先用局部变量保存备份键，`Object.assign` 之后再赋值。

### 3.4 HIGH — 畸形 JSON 让导入界面永久卡住

`previewImport` 只校验 `records` 是对象，不校验每个字段是数组。`records.sessions = {}` 会让 `for...of` 抛 `TypeError`，而 `DataView` 的读取回调没有 catch，`busy` 永远停在"正在读取…"，用户只能刷新页面。

修复：逐个字段校验数组类型，非数组统一拦成 `not_envelope`。

### 3.5 HIGH — 删掉 checksum 字段即可免检

`if (typeof env.checksum === 'string')` 没有 else 分支。把 `checksum` 键整个删掉，文件就能带着"无 issues"通过，等于给手工改动过的文件留了一条免检通道。

修复：字段缺失与非字符串同样记 `checksum_mismatch`（保持非致命，不阻断合并的设计口径不变）。

### 3.6 HIGH — 两组互相矛盾的"合法组"标准

`updateSet` 只校验 `loadGrams` 和 `reps`，`durationSeconds: -5`、`distanceMeters: 2.5` 都能通过，却在 `tracking.validateSetForExercise` 判为无效。而 `isWorkingSet` 只看 `kind + status`，这些脏数据照样计入 `completedWorkingSets` 和周统计。

同时 `changeSessionDate` 与 `skipRemainingSets` 没有任何场次状态守卫：可以把一场进行中的训练改到别的日期，可以批量跳过一个已放弃场次的组。

修复：`updateSet` 补齐时长/距离校验并拒绝已放弃场次、拒绝把已完成组改回 `planned`；`changeSessionDate` 拒绝 active/paused/discarded；`skipRemainingSets` 加 deletedAt/discarded 守卫并写入 `editedAt` 留痕。测试文件：`src/domain/fixes-regression.test.ts`（40 例）。

### 3.7 MEDIUM — 渐进建议写死配重、趋势被空日期短路

- `suggestProgression` 的 deload 分支硬编码 `Math.round(x/2500)*2500`，配重 5000 的动作建议值永远低一档。所有既有测试都传 2500，所以不可见。改为按传入的 `incrementGrams` 取整。
- `loadTrend` 的 `if (s.businessDate && s.status !== 'completed')` 用 `&&` 短路，`businessDate` 为空的未完成场次会被放进趋势。
- `MODE_META.distance_duration.countsStrength = true` 与 `bestSet` 对该模式一律返回 `null` 自相矛盾。
- `liveSessions` 不过滤 `discarded`，而它直接驱动可编辑列表，用户能编辑自己已放弃的训练。
- `e1rm` 不校验 `reps` 为 `NaN`，返回 `NaN` 而非 `null`。

以上均已修复，并在 `fixes-regression.test.ts` 中锁定。

---

## 4. 新增测试文件（14 个，353 例）

| 文件 | 例数 | 覆盖内容 |
|---|---|---|
| `tombstone-stats.test.ts` | 10 | CRITICAL：删除场次不参与任何统计 |
| `transfer-safety.test.ts` | 18 | CRITICAL/HIGH：导入丢目标、重复记录、备份指针、畸形 JSON、checksum 免检 |
| `fixes-regression.test.ts` | 40 | HIGH/MEDIUM：字段校验、状态守卫、配重取整、口径一致性 |
| `metrics-extra.test.ts` | 36 | `createSet`/`createSessionExercise` 死代码、`isEmptySession`、`lastExerciseSets`、`activeSession`、`streakWeeks` 等 |
| `snapshot-hash.test.ts` | 22 | 纯 JS SHA-256 与 `node:crypto` 逐字节对齐，含全部 padding 边界（55/56/57/63/64/65/119/120/127/128） |
| `amend-edge.test.ts` | 73 | `buildBackfill`、`changeSessionDate` 本地时分保留、`updateSet` 边界、`loadTrend`、`suggestProgression`、不可变性 |
| `plan-extra.test.ts` | 49 | 预建幂等、`switchTemplate` 生效日边界、命令校验、活跃会话拦截 |
| `week-daystate.test.ts` | 26 | `dayState` 七级优先级链、`dayStatesForWeek`、`statusLabel`、`targetNarrative` |
| `sync-transport.test.ts` | 10 | `httpTransport` 四个方法、鉴权头、非 JSON 响应 |
| `sync-edge.test.ts` | 16 | etag 解析（含弱 etag）、响应体异常、非 Error 抛出归一 |
| `snapshot-size.test.ts` | 9 | `checkSnapshotSize` 边界、MiB 文案、3 年数据集量级 |
| `week-boundary.test.ts` | 20 | 周日归属、跨月/跨年、`daysLeftInWeek`、`inWeek` 半开区间 |
| `units-boundary.test.ts` | 16 | `addDays` 闰年与远距离、单位换算往返、格式化边界 |
| `week-boundary` / `snapshot-size` 等 | — | 见上 |

---

## 5. 确认无问题的点

为避免把猜测当结论，以下几处经代码走查确认为**正确**，仅记录不留隐患：

- `currentWeekStart` 的周日处理：`(getDay() + 6) % 7`，`getDay() === 0` 时偏移 6，正确归属上一周。
- `volumeEligible` 逻辑方向：两个调用点（`metrics.ts` 容量计算与 `bestSet`）使用均正确，无反转。
- `addDays` 的 DST 处理：统一用 `T12:00:00` 作基准，跨时区不会偏移一天。
- 纯 JS SHA-256 实现：与 `node:crypto` 在 19 组输入上逐字节一致。
- `isValidCompletedSession` 的 `completionBasis` 处理：逻辑正确，只是 `week.test.ts` 未直接覆盖（`amend.test.ts` 已覆盖等价路径）。
- 周目标重算的"只下调不上调"：这是有意的设计——`plan.ts` 现按最近一次调整的 `reason` 区分"系统压缩"（可回升）与"用户主动调低"（不覆盖），口径见 `k-target.test.ts` 注释。

---

## 6. 仍未覆盖的部分与原因

| 位置 | 状态 | 原因 |
|---|---|---|
| `src/views/**`、`src/components/**`、`appStore.ts`、`repository.ts`、`seed.ts` | 0% | 依赖 DOM / IndexedDB / Vue 响应式，单测环境为 `node`；这部分由 `e2e/*.spec.ts`（Playwright）覆盖，未在本次范围执行 |
| `tracking.ts` 73% 分支 | 部分 | `setSummary` 的 lb 换算与缺失值占位、`validateSetForExercise` 的 `duration`/`distance_duration` 边界属展示层，生产由 Vue 测试覆盖 |
| `transfer.ts` 76% 分支 | 部分 | 剩余分支集中在非致命 issue 的组合路径 |

如需进一步提高，建议下一轮做两件事：给 `appStore.ts` 的导入/备份/清空路径补一个 jsdom 环境的集成测试（当前 C1 那类"写了却找不回来"的缺陷最容易在这里滋生），以及跑一次 `npm run test:e2e` 确认视图层未被本次 domain 改动影响。

---

## 7. 工作区提示

本次分析期间发现 `src/domain/plan.ts`、`transfer.ts`、`types.ts`、`SyncPanel.vue` 存在**非本次产生的未提交修改**（周目标 K 重算语义、`goals` 信封字段、`stableHash` 位宽等）。这些改动与本次修复有交集，已在它们的基础上继续修改并保持全量测试通过。提交前建议用 `git diff` 通读一遍，确认这些改动的归属与意图。
