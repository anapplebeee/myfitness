# 真机验收记录：Redmi 24129PN74C / Android 16（HyperOS）

日期：2026-10-29；构建：`lianji-debug-20261029-v1.2.apk`（前端哈希 `C5IafYaC`，后续通知修复后重建）；
设备：Redmi 24129PN74C，Android 16，1200×2670 @520dpi；包名 `app.lianji.fit`，versionName 1.2。

## 1. 怎么驱动的

`adb shell input tap` 与 `adb shell pm grant` 在这台机器上都被 HyperOS 拒绝：

```
java.lang.SecurityException: Injecting input events requires the caller ... INJECT_EVENTS
java.lang.SecurityException: grantRuntimePermission: Neither user 2000 nor current process has GRANT_RUNTIME_PERMISSIONS
```

所以交互一律走 **WebView CDP**（`adb forward` + `Runtime.evaluate` 点 DOM），
截图用 `Page.captureScreenshot`。这也是项目 `scripts/android-cdp.mjs` 早就记录的结论。

## 2. 结果

| 项 | 结果 | 证据 |
|---|---|---|
| 安装 / 冷启动 | 通过 | 首页正常渲染，无崩溃、无 console error |
| 示例数据标识 | 通过 | 顶栏虚线「示例数据」常驻 |
| 今日页 → 训练现场 | 通过 | hero「继续训练 / 空白训练」，进入后头部显示「训练中 · 已保存 HH:mm」 |
| 热身 / 工作组分區 | 通过 | 共 8 行，热身 4 行独立样式 |
| 完成热身组 | 通过 | 休息计时出现，工作组计数不增加（0/0/4，符合"只统计工作组"） |
| 只完成热身组时结束 | 通过 | 被拦下并提示「至少完成一个工作组才能结束」 |
| 完成工作组 | 通过 | 计数变 1，`set--completed` 与 `live__counts` 一致 |
| 结束训练面板 | 通过 | 出现「继续练 / 确认结束」 |
| 确认结束 + 落盘 | 通过 | 回到今日页显示「今天部分完成 / 未计入周目标」；`localStorage` 最后一场 `status=completed`、完成组 2、`endedAt` 有值 |
| 放弃（更多 → 放弃这场训练 → 确认放弃） | 通过 | 二次确认后回到列表，未留半场 |
| 五个标签切换 | 通过 | 训练 / 周目标 / 饮食 / 教练 / 我的 均渲染 |
| 通知权限状态 | **默认拒绝** | `POST_NOTIFICATIONS: granted=false`；`pm grant` 被拒，需用户在系统弹窗点「允许」 |
| 休息结束通知（**前台**） | 通过 | 通知栏出现「休息结束 / 可以开始下一组了」；修复 `allowWhileIdle` 后复测仍通过 |
| 休息结束通知（**切后台**） | **失败** | 闹钟到点后从 AlarmManager 消失，通知栏无任何记录；两次实验一致 |
| 运行期日志 | 干净 | 无 FATAL、无 JS error |

## 3. 后台通知失败的分析

两次实验：

| 排程方式 | `dumpsys alarm` 里的类型 | 到点结果 |
|---|---|---|
| 原始：`schedule: { at }` | `RTC`，flags `0x1`，无 `allowWhileIdle` | 闹钟消失，无通知 |
| 修复后：`schedule: { at, allowWhileIdle: true }` | `RTC_WAKEUP`，flags `0x5`（与喝水提醒一致） | 闹钟消失，仍无通知 |

结论分两层：

1. **`allowWhileIdle` 缺失是确定的缺陷**：插件默认排非唤醒的 `RTC` 闹钟，Doze 下不唤醒设备。
   提醒类通知一直传了这个参数，休息通知漏了——已修（`src/composables/useRestNotification.ts`）。
2. **修完仍不响**，说明 HyperOS 还有一层后台限制：闹钟被消费但通知没落到通知栏。
   MIUI/HyperOS 对后台应用的「通知」与「自启动」有独立开关，仅授予 Android 运行时权限不够。
   需要在系统设置里为「练迹」打开自启动/后台弹出，才可能让后台通知落地。
   这一点**未在本轮验证通过**（需要手动点系统设置，adb 无权限注入）。

日志侧旁证：切后台瞬间插件报 `Capacitor: Couldn't save last LocalNotifications's Plugin schedule call`；
周期日志里该应用长期处于 `state=0, restricter=1` 的受限状态。

## 4. 产品层面的处理建议

| 方案 | 说明 | 成本 |
|---|---|---|
| 引导用户开自启动 | 首次开启训练提醒时提示去系统设置，附截图步骤 | 低，但依赖用户操作 |
| 训练期间前台服务 | 用 `ForegroundService` 保活 + 常驻通知显示剩余休息时间，锁屏可见 | 中，需要原生插件或自写 |
| 兜底文案 | 明确写「后台提醒可能需要系统允许自启动」，不给"一定能响"的承诺 | 低 |

当前文案（`我的 → 设置 → 提醒`）写的是「装成 Android App 后关闭也能提醒」，**在这台设备上不成立**，
属于过度承诺，应改成"允许自启动/后台运行后可在后台提醒"。

## 5. 顺带修掉的问题

`LiveWorkout.vue:361-362` 里 `rest.start(ex.restSeconds);` 写了两遍（合并残留），已删掉重复行。

## 6. 未覆盖

- 锁屏（而非仅后台）场景：本轮只做到按 Home 切后台，未做真实锁屏。
- 弱网 / 断网冷启动（本版本只用本地数据，未接云）。
- 长时间后台后进程被杀再拉起，训练会话能否恢复。
- 通知点击跳转落点。
