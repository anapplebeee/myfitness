# Android App 打包与发布

- 日期：2026-10-22
- 状态：工程已生成，**尚未出包**（本机无 JDK / Android SDK）
- 相关：`docs/02-architecture.md`（分层）、`docs/03-plugin-architecture.md`（扩展点）

---

## 0. 决策记录

| 项 | 结论 | 理由 |
|---|---|---|
| 方案 | **Capacitor 7**（WebView 壳 + 原生桥） | 复用现有 95% 代码；PWA 与 App 同源，一份代码两种交付 |
| 不选 React Native | — | 需要重写全部 UI，而当前没有蓝牙/健康数据的硬需求；等真需要再评估（届时领域逻辑层可复用） |
| 不选 Flutter / 原生 | — | 同上，且要维护两套实现 |
| 平台 | Android 优先 | 国内可侧载，无需商店与资质；iOS 需要 macOS + Xcode + $99/年 |
| 分发 | 侧载（APK），保留上架可能 | 包名 `com.tieguan.fit`、签名位、隐私政策位已留好 |
| 原生能力 | 暂不引入 | 需要时以 Capacitor 插件形式增量加（本地通知、状态栏、App 事件） |

**已知代价**：若将来上 iOS App Store，审核指南 4.2 要求「不能只是把网站包一层」，纯壳会被拒。这条不影响 Android 侧载，但会影响 iOS 上架策略（见 §6）。

---

## 1. 工程结构

```
（源码 —— 唯一真相，双击 index.html 仍可用）
index.html
css/  js/  icons/  manifest.webmanifest  sw.js

（Web / 自托管部署）
server.js
data/                    服务端数据（自动生成）

（新增：手机打包链路）
package.json             Capacitor 依赖与三条脚本
capacitor.config.json    appId / appName / webDir
scripts/make-www.js      把源码整理成 www/（只拷运行时资产）
www/                     ← 产物，勿手改
android/                 ← 产物（npx cap add android 生成，图标与启动图已定制）
```

**原则：`www/` 与 `android/` 都是产物，不要在里面改代码。** 改完前端必须重新同步（§2），否则壳里跑的还是旧版本——这是"改了没生效"最常见的原因。

`make-www.js` 只拷 `index.html / manifest / css / js / icons`，**故意不拷** `server.js`、`sw.js`、`docs/`、`data/`、`node_modules/`，并在结束时校验必需文件是否存在（缺一个就退出码 1）。

---

## 2. 三条命令

```bash
npm run www           # 重建 www/（改前端后单独跑）
npm run sync          # www/ + cap sync android（推入 Android 工程）
npm run open:android  # 用 Android Studio 打开 android/
```

首次已完成：`npm install` → `npx cap add android` → `npm run sync`。

---

## 3. 打包环境

**本机现状（2026-10-22 检查）**：无 `java`、无 `ANDROID_HOME`、无 `gradle`、无 `adb`，只有 Node 22。

Capacitor 7 要求：**JDK 21**、**compileSdk 35**、minSdk 23。

两条路：

| 方式 | 步骤 | 适合 |
|---|---|---|
| **A. Android Studio**（推荐） | 装 [Android Studio](https://developer.android.com/studio)（自带 JDK 与 SDK）→ 打开 `android/` 目录 → 等 Gradle 同步完成 | 一次到位，之后都能在 IDE 里跑真机调试 |
| **B. 命令行** | 装 JDK 21 → 装 `cmdline-tools` → `sdkmanager "platforms;android-35" "build-tools;35.0.0" "platform-tools"` → 设 `ANDROID_HOME` | 服务器/CI、不想装 IDE |

---

## 4. 出包

### 4.1 Debug APK（自用首选，立刻能装）

```bash
cd android
./gradlew assembleDebug        # Windows: gradlew.bat assembleDebug
```

产物：`android/app/build/outputs/apk/debug/app-debug.apk`

或者在 Android Studio 里：`Build → Build Bundle(s)/APK(s) → Build APK(s)`。

安装：`adb install -r app-debug.apk`，或把 APK 传到手机点击安装（需在系统设置里允许「未知来源」）。

### 4.2 Release APK（签名、可长期覆盖升级）

```bash
keytool -genkey -v -keystore tieguan.keystore -alias tieguan \
  -keyalg RSA -keysize 2048 -validity 10000
```

在 `android/app/build.gradle` 里配置 `signingConfigs.release` 后：

```bash
./gradlew assembleRelease
```

> ⚠️ **签名密钥必须离线备份**。丢了就无法对已安装的应用做覆盖升级，只能换包名重发（用户数据全部丢失）。`*.keystore` 与密码不要进仓库。

### 4.3 版本号规则

| 字段 | 规则 |
|---|---|
| `versionCode` | 每次发版 +1，**只增不减**（Android 用它判断"能不能覆盖安装"） |
| `versionName` | 语义化 `1.0.0`、`1.1.0` |

---

## 5. 手机连自建服务（关键一条）

App 默认只存本机（WebView 的 localStorage）。要用起 `node server.js` 那套：

1. 电脑上启动 `node server.js`（默认 8787），确保手机与电脑同一网段
2. App → 设置 → 数据 → **自托管服务地址** 填 `http://<电脑内网IP>:8787/api`
3. 点「保存并重载」

**坑在这里**：Android 9+ 默认禁止明文 HTTP。填了地址连不上，通常是这个原因，而不是代码坏了。两种解法：

- **推荐**：用 Caddy / nginx 给服务端加 HTTPS 反代（顺便解决公网访问）
- **仅内网自用**：在 `android/app/src/main/AndroidManifest.xml` 的 `<application>` 上加
  `android:usesCleartextTraffic="true"`，然后重新 `npm run sync` + 重打包

> 该开关会让整个 App 接受明文流量，**上架前必须去掉**。

---

## 6. 蓝牙（BLE）接入

**先说能不能做到**：心率带可以，手环不行。原因是协议，不是技术难度。

| 设备 | 直连 | 说明 |
|---|---|---|
| 标准心率带（Polar H10 / Garmin HRM / Wahoo TICKR） | ✅ | 标准 GATT：心率服务 `0x180D`，测量特征 `0x2A37`（Notify），电量 `0x180F/0x2A19` |
| 标准体重秤 | ⚠️ | 标准 `0x181D` 存在，消费级产品少见 |
| 小米 / 华为 体脂秤 | ❌ 多数 | 私有协议，需厂商 SDK |
| 小米 / 华为 手环手表 | ❌ | 不开放标准 GATT 实时心率，需厂商健康平台授权 |
| Apple Watch | ❌ | 无开放 GATT；HealthKit 只能本机授权读取 |

所以「连手环读心跳」这条需求，正确做法是**健康数据导入**（用户在手环 App 里授权同步），而不是 BLE 直连。UI 上必须写清楚（见 `docs/05-ui-design.md` 稿八）。

### 6.1 插件与配置

```bash
npm i @capacitor-community/bluetooth-le     # 与 Capacitor 7 匹配的 v7.x
npx cap sync android
```

- 只用 `BleClient` 包装类，不要直接 import 插件类（社区明确不推荐）。
- 扫描按服务过滤（`services: ['0000180d-…']`）比全量扫描省电且快。
- 心率解码要点：`0x2A37` 首字节是 flags，`flags & 0x1` 决定心率是 UINT8 还是 UINT16 小端；`flags & 0x4`/`0x2` 是接触检测位。

### 6.2 Android 权限（Android 12+ 必须运行时申请）

```xml
<uses-permission android:name="android.permission.BLUETOOTH_SCAN"
    android:usesPermissionFlags="neverForLocation" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<!-- Android 11 及以下还需要 BLUETOOTH / BLUETOOTH_ADMIN / ACCESS_FINE_LOCATION -->
<uses-feature android:name="android.hardware.bluetooth_le" android:required="false" />
```

⚠️ **`required` 必须是 `false`**：插件默认写成 `true`，会让 Google Play 对无 BLE 的设备隐藏你的应用。心率是可选功能，不能因此丢掉整个设备覆盖。

### 6.3 iOS（将来做 iOS 时）

`ios/App/App/Info.plist` 必须加：

```xml
<key>NSBluetoothAlwaysUsageDescription</key>
<string>连接心率带以在训练中显示实时心率</string>
```

需要在锁屏后继续读数，还要加 `UIBackgroundModes → bluetooth-central`。缺 UsageDescription 会直接崩溃，不是「弹不出来」那么轻。

### 6.4 模拟器验证不了

模拟器与仿真器没有可用蓝牙射频。这个功能**必须在真机 + 真设备**上测，且心率带要沾湿电极、贴合皮肤才会广播——"扫不到设备"很多时候是没戴好。

---

## 7. 以后要上架，需要什么

| 项 | 说明 |
|---|---|
| 包名 | 沿用 `com.tieguan.fit`，**不要改**（换包名 = 新 App，老用户数据不继承） |
| 软件著作权 | 国内商店基本都要，办理约 1–4 周 |
| **App 备案** | 工信部要求（2023 年起），需要服务器与主体资质 |
| 隐私政策 | 必须：数据存本地、模型 Key 由用户自备、不采集个人信息 |
| 开发者资质 | 多数国内商店要求企业主体；个人开发者可选渠道有限 |
| 功能差异 | 纯 WebView 壳可能被判"功能单薄"；建议先补原生增值点（训练提醒、后台计时可见、主屏小组件）再上 |

---

## 8. 已知未验证项

| 项 | 状态 | 说明 |
|---|---|---|
| Gradle 构建 | ❌ 未跑通 | 本机无 SDK，属"工程就绪、差环境" |
| 图标 / 启动图实际显示 | ⚠️ 已生成未上机 | 5 个密度 × 3 种图标 + layer-list 启动图 |
| `colors.xml` 补全 | ⚠️ 未过 AAPT | **Capacitor 7 模板缺 `@color/colorPrimary`，构建会报 resource not found；已补 `values/colors.xml`**，需首次构建确认 |
| 壳内 localStorage 持久化 | ⚠️ 未实测 | WebView 内 localStorage 随 App 数据；**卸载即丢**，建议开自托管或定期导出备份 |
| 返回键行为 | ⚠️ 未处理 | 当前按返回键会直接退出 App；待加 history 拦截（先进「今日」→ 关弹层 → 再退出） |
| 状态栏颜色 / 沉浸式 | ⚠️ 未处理 | 需 `@capacitor/status-bar` 插件对齐品牌色 |

---

## 9. 下一步（按性价比）

1. **装 Android Studio → `gradlew assembleDebug` 出第一个包**（验证 §7 的前三项）
2. 返回键拦截 + 状态栏配色（半小时，体验差别明显）
3. `@capacitor/local-notifications`：训练提醒与组间休息（这是"原生"最直接的价值）
4. 数据安全兜底：首次启动引导用户配置自托管或设置导出提醒（WebView 数据比浏览器更脆弱）
