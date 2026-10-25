# Android 真机验证指南

日期：2026-10-25；对应 G3 门槛「两厂商真机冒烟」。
前置：[19 Android](19-android.md)（打包链路已打通，APK 可编译）。

> **没有可用模拟器**：本机账户不在管理员组，无法安装虚拟化驱动，AVD 组件已卸载。
> 真机验证必须用实体设备。详见 [22 视觉审计 §9](22-visual-audit.md)。

## 0. 当前状态

| 项 | 状态 |
|---|---|
| 打包链路 | **已打通**，`app-debug.apk` 4.26 MB，18/18 校验通过 |
| 真机安装 | **未做**——无可用设备 |
| 真机冒烟 | **未做** |
| 返回键 | **已实现**（WebView 可后退则后退，否则退出） |
| 安全区适配 | **未验证**——需真机确认刘海与手势区 |

这份文档是给你（或任何有设备的人）执行真机验证的操作手册。

## 1. 设备准备（一次性）

1. 手机「设置 → 关于手机 → 连续点击版本号 7 次」开启开发者模式
2. 「设置 → 系统 → 开发者选项 → **USB 调试**」打开
3. 用**支持数据传输**的数据线连电脑
4. 手机上弹出「允许 USB 调试吗？」→ 勾选「一律允许」→ 允许

**数据线是常见坑**：很多随手机附带的线只能充电，不能传数据。换一根试。

## 2. 一键冒烟

```bash
npm run android:build     # 若无 APK 或想重新编译
npm run android:smoke     # 等设备 60 秒，自动安装并冒烟
```

可选参数：

```bash
npm run android:smoke -- --wait 180    # 等设备更久
npm run android:smoke -- --keep        # 跑完保留安装
```

## 3. 脚本做了什么

| 步骤 | 检查 |
|---|---|
| 等设备 | 识别 `device` / `unauthorized` 状态并给出对应提示 |
| 环境信息 | 读取机型、Android SDK 版本、屏幕分辨率 |
| 安装 | `adb install -r -t`，失败时输出原始错误 |
| 清数据 | `pm clear`，保证是首次启动 |
| 启动 | `am start` + 等 4 秒 |
| 存活 | `pidof` + `dumpsys activity` 确认前台 |
| 截图 | `01-launch`（应显示引导页） |
| 崩溃检测 | logcat 中 `FATAL EXCEPTION` / `AndroidRuntime` |
| WebView 错误 | logcat 中 chromium 报错、`net::ERR_*` 资源加载失败 |
| 走引导 | 三次点击 + 三次截图 |
| 各标签页 | 依次点击 5 个标签并截图（`05-today` … `09-coach`） |
| 内存 | `dumpsys meminfo`，断言 < 400 MB |

截图输出到 `shots/android/`。

## 4. 必须人工确认的项

脚本只能验证"没崩、能跑"，以下必须人眼看截图或上手操作：

| 项 | 为什么脚本测不了 |
|---|---|
| **安全区** | 刘海屏、手势条是否遮挡底部标签栏 |
| **字体渲染** | 中文字体在 WebView 里是否与桌面一致 |
| **触控手感** | 按钮点击区域是否够大、滚动是否顺畅 |
| **软键盘遮挡** | 输入重量时键盘是否挡住保存按钮 |
| **返回键行为** | 从详情页按返回是否回到上一页而非退出 |
| **离线可用** | 开飞行模式后能否继续记录 |
| **深色/浅色** | 系统主题切换后配色是否正常 |

## 5. 已知的适配风险

| 风险 | 原因 | 真机时重点看 |
|---|---|---|
| 底部标签栏被手势条遮挡 | 未设 `viewport-fit=cover` 的 `env(safe-area-inset-bottom)` 兜底 | 底部 5 个标签是否完整可点 |
| 输入框被键盘顶起 | 未做键盘避让 | 记录一组时"完成"按钮是否可点 |
| 绝对路径资源 404 | `index.html` 用 `/assets/...`，依赖 Capacitor 的 `https://localhost` 映射 | 首屏是否白屏 |
| IndexedDB 在隐私模式受限 | WebView 无隐私模式，但存储配额可能不同 | 能否正常保存与刷新后仍在 |

**绝对路径这条已做静态验证**：APK 内 `assets/public/index.html` → `https://localhost/` → `/assets/x.js` 映射到 `assets/public/assets/x.js`，路径一致。但只有真机能确认。

## 6. 两厂商覆盖

按 00:75 要求，G3 需**两厂商**冒烟。建议：

| 品牌 | 关注点 |
|---|---|
| 小米 / Redmi | MIUI 对后台与存储的限制较严 |
| 华为 / 荣耀 | 无 GMS，WebView 版本可能较旧 |
| OPPO / vivo | 手势导航适配 |
| 三星 | 屏幕比例多样 |

每台设备跑一次 `npm run android:smoke`，截图归档到 `docs/evidence/W18/<机型>/`。

## 7. 失败时怎么排查

| 现象 | 排查 |
|---|---|
| `未检测到可用设备` | 换数据线、确认 USB 调试、手机上点允许 |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | 先 `adb uninstall com.tieguan.fit` |
| `INSTALL_FAILED_TEST_ONLY` | 用 `-t` 参数（脚本已带） |
| 白屏 | 看 `adb logcat \| findstr chromium`，多为资源 404 |
| 启动即退 | 看 `adb logcat \| findstr FATAL` |
| 中文乱码 | 检查 WebView 版本，`adb shell dumpsys webviewupdate` |

## 8. 结论口径

**在真机跑通之前，Android 只能称"能编译出 APK"，不能称"可用"。**

G3 门槛（两厂商真机冒烟、无 P0/P1）**未达成**。

