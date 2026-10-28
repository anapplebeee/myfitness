# 发布阻塞项修复报告（2026-10-28）

> 对应评审：商业 App 标准评审（P0 × 3、P1 × 2、发布门禁 × 1）。
> 本轮只做「数据与发布阻塞」，产品闭环（渐进建议、饮食全天模型、体验模式、提醒能力矩阵）留到下一轮。

## 结论

| 优先级 | 问题 | 状态 |
|---|---|---|
| P0 | 旧品牌迁移覆盖新库 | **已修** |
| P0 | 饮水/提醒未贯穿备份与同步 | **已修** |
| P0 | 后移能移动已完成项目 | **已修** |
| P1 | PWA 离线未交付 | **已修**（SW 注册 + 断网冷启动） |
| P1 | 网页提醒未按时调度 | **已修**（前台轮询，不再用插件 Web 实现） |
| 门禁 | `npm run verify` 失败 | **已修**（e2e 类型 + 测试并发偶发 EPERM） |

验证：`npm run verify` 全绿；单测 64 文件 / 1140 用例；APK 23/23 通过。

---

## P0-1 迁移覆盖新库

**根因**：`loadState` 把「新 IDB、localStorage、旧库」三个来源并行读取，旧库读到就无条件 `idbPut` 到新库。
复现路径：新库有 NEW → 旧库读到 OLD → 新库被写成 OLD → 第二次读取退回旧数据。

**改法**（`src/store/repository.ts`）：

- 先读新库两个来源；**只要有一个有数据，就直接返回最新的一份，完全不读旧库**；
- 两个来源都明确为空、且读取无错误时，才读旧库并搬一次；
- 读取失败（可能是临时错误）不触发迁移，沿用原来的「无法读取」报错；
- 旧库保持原样，不删除。

**回归测试**：`src/store/repository-migration.test.ts`
- 新库有数据 → `shouldMigrateLegacy(false)`
- 新库为空 → `true`
- 读取失败 → `false`

## P0-2 饮水/提醒未贯穿备份与同步

**根因**：`pickRecords` 没有 water；`applyExternalSnapshot` 有 water 字段却没赋值；reminders 两头都没有。

**改法**：

- 导出 `records` 增加 `water` / `waterGoalMl` / `reminders`；
- `replace` 导入逐字段恢复（旧文件缺字段时保留本地）；
- `merge` 导入按条目 id 合并饮水，目标/提醒以文件为准；
- 远端快照应用补 `assign('water' | 'waterGoalMl' | 'reminders')`；
- 同步快照 `records` 增加 `reminders`（换机后按新设置重新排程）。

**回归测试**：
- `src/domain/transfer-water.test.ts`：导出含三项；replace 恢复 900ml；merge 合并 w1+w2；
- `src/store/appStore-snapshot.test.ts`：远端 900ml / 2500ml / 20:00 写入本机（原缺陷复现路径）。

## P0-3 后移移动已完成项目

**根因**：新后移入口只看 `disposition === 'scheduled'`，没有接收关联会话；已完成项目的 disposition 仍是 scheduled。

**改法**（`src/domain/shift.ts`）：

- `previewShift` / `applyShift` 接收 `sessions`；
- 复用 `canDispose`（进行中/暂停不可改计划），并补「已完成会话」判定；
- 已发生事实留在原位；`day` 模式整天都完成时明确拒绝：`这一天已完成，不能后移`；
- `tail` 模式允许跳过已完成项，只推后面还能动的安排；
- store 两个方法都传 `state.sessions`；界面提示「N 项已完成，未移动」。

**回归测试**（`shift.test.ts`）：已完成项不移动且 `locked=1`；整天完成时拒绝并给出原因。

## P1-4 PWA 离线

**改法**：

- 新增 `public/sw.js`：安装时预缓存 `/`、`/index.html` **以及 index.html 引用的入口 JS/CSS**；静态资源运行时缓存；导航网络优先、断网回退外壳；
- `main.ts`：仅 `import.meta.env.PROD` 且**非原生**环境注册（原生 assets 已在 APK 内，缓存会让版本落后）；
- 版本切换用 `CACHE` 常量 + `skipWaiting`/`clients.claim`。

**实测**（`vite preview` + Playwright）：
- `getRegistrations().length = 1`，页面受控；
- 缓存 `lianji-shell-v1` 共 7 条；
- **断网刷新**：`.shell` / `.topbar` 仍渲染，console errors = 0。

## P1-5 网页提醒调度

**根因**：网页端也走插件 `schedule.on`，而插件 Web 实现不按这个形式延时（23:59 的计划会立即触发）。

**改法**：

- 网页端不再调用插件排程，改为**前台每 20 秒轮询** + `Notification` API + `visibilitychange` 立即补查；
- 纯判定抽到 `dueReminders(now, settings, waterTotal)`，按分钟命中；
- 已触发记录写 localStorage（key=日期-类型-时刻，保留 3 天），避免同一分钟重复弹；
- 原生端保留 `schedule.on`（App 关闭也能响）。

**测试**：`dueReminders` 4 项（09:00 命中、09:01 不触发、19:00 训练、关闭后不触发）。

## 发布门禁

- `e2e/data-safety.spec.ts` 内联类型补 `kind`，`typecheck:e2e` 通过；
- 测试偶发 `Errors 1 error` 的根因是 **多个 worker 并发写同一个 SSR 缓存文件导致 EPERM**，改为 `fileParallelism: false` 串行执行，并把测试 TEMP 固定到项目内 `.tmp/`；
- 连跑 3 次：64 文件 / 1140 用例 / 0 错误。

---

## 本轮未做（按评审建议留到下一轮产品闭环）

- 渐进建议（来源、理由、可拒绝）、热身按本次工作重量；
- 训练中替换/增删动作的「原计划 / 实际执行 / 完成比例」三份留存；
- 饮食全天记录模型（未记录 / 部分 / 全天确认）、按目标估计的标注、营养目标版本与生效日期；
- 常吃整餐、复制昨天、编辑现有记录；
- 体验模式与真实数据隔离；
- 提醒的平台能力矩阵、通知点击落点、训练日/休息日区分；
- 隐私说明与权限/字段对齐、诊断导出、试用指标。

## 发布流程仍需人工确认

- 本轮**未做 Android 真机验收**（手机已拔线），APK 已构建待装；
- 包名已改为 `app.lianji.fit`，旧安装（`com.tieguan.fit`）不能覆盖升级，正式发布前必须准备「导出 → 安装 → 导入」的迁移说明。
