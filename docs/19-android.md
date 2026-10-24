# Android 打包链路

日期：2026-10-25；对应阶段审核 P0 发现「Android 链路完全断开」。

## 0. 修复前的事实

| 检查项 | 状态 |
|---|---|
| `package.json` 有 `@capacitor/*` | **无** |
| `capacitor.config.json` 的 `webDir` | `www`，**目录不存在** |
| 实际构建产物 | `dist` |
| `android/app/src/main/assets/public` | **不存在** |
| 45 个 android 文件被 Git 跟踪 | 从未成功构建过 |

结论：链路在物理上不可用，任何"真机验证"都无法进行。

## 1. 修复内容

| 项 | 修复 |
|---|---|
| 依赖 | 安装 `@capacitor/core`、`@capacitor/android`、`@capacitor/cli`（8.5.3） |
| `webDir` | `www` → **`dist`**（与构建产物一致） |
| 背景色 | `#f2f5f2`（旧绿）→ **`#F2F0EA`**（设计系统） |
| 调试开关 | 显式 `webContentsDebuggingEnabled: false`（发布默认关闭） |
| 资产同步 | `npx cap sync android` 成功，`assets/public` 生成 8 个文件 |

## 2. 验证方式

`scripts/check-android.mjs` 做 16 项配置检查，可重复执行：

```bash
npm run android:check
```

| 分组 | 检查项 |
|---|---|
| 依赖 | core / android / cli 三个包 |
| 配置 | appId、appName、webDir 存在、**webDir 与产物一致**、背景色 |
| 产物 | `assets/public` 存在、含 index.html、含打包 JS |
| Gradle | wrapper 存在、版本可解析、`capacitor.settings.gradle` |
| 原生 | MainActivity 存在且继承 `BridgeActivity` |
| 环境 | JDK 可用、Android SDK 已配置（**只报告，不判定失败**） |

这条检查防的是历史上那类问题：**配置指向不存在的目录，却长期无人发现**。

## 3. 本机环境的真实限制

**本机没有 JDK，也没有 Android SDK**，因此**无法在本机编译 APK**。

```
WARN  [环境] JDK 可用  — 未安装：无法在本机编译 APK
WARN  [环境] Android SDK 已配置  — 未设置 ANDROID_HOME
```

这意味着：

- ✅ 依赖、配置、资产同步**已打通**，`npm run android:sync` 可用
- ❌ **没有编译验证过 APK**，也没有真机安装验证
- ❌ G3「两厂商真机冒烟」**仍未完成**

必须区分这两件事：**链路可构建 ≠ 已构建成功**。文档与验收表中不得混淆。

## 4. 出 APK 的前置条件

需要以下环境之一：

| 方式 | 要求 |
|---|---|
| 本地 | JDK 21（Capacitor 8 要求）+ Android SDK + `ANDROID_HOME` |
| CI | 使用 `android-actions/setup-android` 或预装 SDK 的 runner |
| 本地 Android Studio | 打开 `android/` 目录直接构建 |

命令：

```bash
npm run android:sync       # 构建前端并同步到 android
cd android && ./gradlew assembleDebug
```

Gradle wrapper 为 8.11.1，AGP 8.7.2，Java 21。

## 5. 仍未做

| 项 | 说明 |
|---|---|
| 签名配置 | 未配置 release keystore |
| 图标与启动图 | 沿用旧资源，未按新设计系统重做 |
| 深链接 / 返回键行为 | 未处理 Android 返回键 |
| 安全区适配 | 未在真机验证刘海与手势区 |
| 数据备份排除 | `android:allowBackup` 未显式关闭（AC-C07 要求） |
| 真机性能 | 未测 24.7 MiB 快照解析与 IndexedDB 写入耗时 |
| 编译验证 | **未做，本机无 JDK/SDK** |

## 6. 结论

Android 链路从「完全断开、无人发现」修复为「配置完整、资产可同步、有自动检查」。

但**不能称"Android 已完成"**：没有编译过 APK，没有真机验证。按 12 号 AC，相关项只能标"部分通过"。
