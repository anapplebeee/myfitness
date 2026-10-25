# Android 打包链路

日期：2026-10-25；对应阶段审核 P0 发现「Android 链路完全断开」。

**当前状态：已真正编译出 APK（16/16 校验通过），未做真机安装验证。**

## 0. 修复前的事实

| 检查项 | 状态 |
|---|---|
| `package.json` 有 `@capacitor/*` | **无** |
| `capacitor.config.json` 的 `webDir` | `www`，**目录不存在** |
| 实际构建产物 | `dist` |
| `android/app/src/main/assets/public` | **不存在** |
| 45 个 android 文件被 Git 跟踪 | **从未成功构建过** |

## 1. 修复过程（含两次真实编译失败）

### 1.1 配置修复

| 项 | 修复 |
|---|---|
| 依赖 | 安装 `@capacitor/core`、`@capacitor/android`、`@capacitor/cli`（8.5.3） |
| `webDir` | `www` → **`dist`** |
| 背景色 | `#f2f5f2`（旧绿）→ **`#F2F0EA`** |
| 调试开关 | `webContentsDebuggingEnabled: false` |
| 资产同步 | `npx cap sync android` 成功 |

### 1.2 第一次编译失败：Kotlin 重复类

```
Duplicate class kotlin.io.path.PathsKt found in modules
  kotlin-stdlib-1.8.22.jar
  kotlin-stdlib-jdk7-1.6.21.jar
```

原因：Capacitor 8 依赖 `kotlin-stdlib:1.8.22`，而 Cordova 插件模块拉入 `kotlin-stdlib-jdk7/jdk8:1.6.21`。Kotlin 1.8 起 jdk7/jdk8 已并入主 stdlib，两者同时存在即重复类。

**第一次处置（不彻底）**：移除 `capacitor-cordova-android-plugins` 模块。本项目没有 Cordova 插件，模块本可不要。但编译仍失败——1.6.21 来自其他传递依赖。

**最终处置**：在根 `build.gradle` 强制对齐：

```groovy
configurations.all {
    resolutionStrategy {
        force 'org.jetbrains.kotlin:kotlin-stdlib:1.8.22'
        force 'org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.8.22'
        force 'org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.8.22'
        force 'org.jetbrains.kotlin:kotlin-stdlib-common:1.8.22'
    }
}
```

**为什么不降主 stdlib**：降级会与 Capacitor 8 不兼容。把 jdk7/jdk8 拉到 1.8.22（该版本是空壳 POM）才是正确方向。

### 1.3 编译成功

```
BUILD SUCCESSFUL in 1m 42s
59 actionable tasks: 21 executed, 38 up-to-date
```

产物：`android/app/build/outputs/apk/debug/app-debug.apk`，**3.99 MB**。

## 2. APK 校验结果（18/18）

`node scripts/build-android.mjs`：

| 项 | 结果 |
|---|---|
| JDK 可用 | PASS — Temurin 21.0.12 |
| Android SDK 可用 | PASS — `%LOCALAPPDATA%\Android\Sdk` |
| SDK platform | PASS — android-35 |
| build-tools | PASS — 34.0.0, 35.0.0 |
| `local.properties` | PASS |
| cap sync | PASS |
| gradle assembleDebug | PASS |
| APK 已生成 | PASS — app-debug.apk |
| APK 大小 | PASS — 3.99 MB |
| APK 含前端 index.html | PASS |
| APK 含打包 JS | PASS |
| APK 含 manifest | PASS |
| 包名 | PASS — `com.tieguan.fit` |
| 应用名 | PASS — 铁馆 |
| targetSdk | PASS — 35 |
| minSdk | PASS — 23 |
| allowBackup 为 false（AC-C09） | PASS |
| 备份排除规则已配置 | PASS |

**APK 内确实包含前端产物**（`assets/public/assets/index-*.js`、`index.html`、icons、manifest），不是空壳。

## 3. 两个脚本的分工

| 脚本 | 需要 JDK/SDK | 作用 |
|---|---|---|
| `npm run android:check` | 否 | 16 项静态配置检查，能在没有 SDK 的机器上发现"webDir 指向不存在目录"这类问题 |
| `npm run android:build` | 是 | 真编译 + APK 内容校验 |

静态检查防的是配置错误；只有真编译能证明"能出包"。两者都要有。

## 4. 环境前置（本机已就位）

| 组件 | 版本 | 来源 |
|---|---|---|
| JDK | Temurin 21.0.12 | `winget install EclipseAdoptium.Temurin.21.JDK` |
| Android cmdline-tools | 146.5 MB | dl.google.com |
| platform | android-35 | sdkmanager |
| build-tools | 35.0.0 | sdkmanager |
| Gradle | 8.11.1（wrapper） | 自动下载 |
| AGP | 8.7.2 | 工程配置 |

Capacitor 8 要求 Java 21。

## 5. CI

`.github/workflows/verify.yml` 新增 `android` job：

```
needs: unit
→ setup-java 21（temurin）
→ android-actions/setup-android
→ 写 local.properties
→ node scripts/build-android.mjs
→ 上传 app-debug.apk 产物
```

## 6. 仍未做（必须明确）

| 项 | 状态 |
|---|---|
| **真机安装与冒烟** | **未做**——没有连接任何设备。一键脚本与操作手册见 [20 真机验证](20-android-device-testing.md) |
| 模拟器验证 | 未做——未创建 AVD |
| release 签名 | 未配置 keystore |
| 图标与启动图 | 沿用旧资源，未按新设计系统重做 |
| Android 返回键行为 | **已实现**：WebView 可后退则后退，否则退出 |
| 安全区适配 | 未在真机验证刘海/手势区 |
| `android:allowBackup` | **未显式关闭**（AC-C09 要求排除 IDB 与密钥备份） |
| 真机性能 | 未测 24.7 MiB 快照解析与 IndexedDB 写入 |

## 7. 结论

Android 链路从「完全断开、无人发现」修复为「**能真正编译出可安装的 APK**」，并有 16 项自动校验。

但**不能称"Android 已完成"**：

- 没有在任何设备上安装运行过
- 返回键、安全区、备份排除都未处理
- 按 12 号 AC，G3「两厂商真机冒烟」**仍未完成**

正确表述是：**打包链路打通，真机验证未开始。**





