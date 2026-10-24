# ADR-0005：Android 工具链与平台行为

- 状态：提议
- 日期：2026-10-24
- 决策人：Tech Lead（待签字）
- 关联：02:88/104、04:7–29、12:109–118、13 号 3.5

## 背景

04 号要求"Capacitor/SDK/JDK 版本、最低系统版本在实现启动 ADR 固定"，但当前仓库 `android/` 是 demo：`allowBackup="true"`、无 `networkSecurityConfig`、`androidScheme: "https"`、minSdk 23/targetSdk 35、Capacitor `^7.0.0` 浮动。13 号指出：备份会把 WebView IDB 上云、LAN 自托管在 Android 上因明文/证书不可用、origin 变更会等于换库。

## 决定

1. **工具链**：JDK 21、Android Gradle Plugin 8.x、compileSdk 35、targetSdk 35、minSdk 26（Android 8.0）。低于 26 不承诺；理由：WebView 版本与 IDB/OPFS 行为可预测性。
2. **Capacitor**：锁定精确版本（如 `7.4.x`），`androidScheme: "https"` 保持不变，**hostname 固定为 `localhost`**；任何变更视为数据库命名空间变更，必须走迁移 ADR。
3. **WebView 下限**：Android System WebView ≥ 120；启动时检测并提示升级，不阻断本地记录。
4. **备份**：
   - `android:allowBackup="false"`；如需设备迁移，使用 `dataExtractionRules` 仅允许导出**用户主动导出的 JSON**，排除 `databases/`、`app_webview/`、SharedPreferences 中的密钥。
   - 卸载/换机前提示"本地数据将删除，请先导出"。
5. **网络安全**：
   - 默认只允许 HTTPS；`networkSecurityConfig` 禁止明文（`cleartextTrafficPermitted="false"`）。
   - 自托管 LAN 二选一（由 PM 在 G0 拍板）：
     - **A（推荐）**：公网域名 + 有效证书 + ACME；Android 直接信任。
     - **B**：本地 CA + `networkSecurityConfig` 信任锚点 + 用户安装证书说明；仅限高级用户。
   - 自签证书不作为默认路径；不提供"忽略证书错误"开关。
6. **安全存储**：token/模型 Key 存 Android Keystore 支持的 EncryptedSharedPreferences（或 Capacitor Secure Storage 插件），失败时降级为"不保存"，不写明文。
7. **权限**：仅 `INTERNET`；不申请相机、麦克风、蓝牙、健康、通知。
8. **生命周期**：后台/锁屏前已提交记录可恢复；休息计时用持久化时间戳；返回键先关弹层再退出子页；常亮为可关闭偏好。
9. **签名与发布**：固定 keystore（不入库），记录证书指纹与包校验和；versionCode 单调递增；升级保留数据。
10. **构建**：`npm run build` → `cap sync android` → `gradlew assembleRelease`；CI 产出 APK 与 SHA-256。

## 替代方案

| 方案 | 不采用原因 |
|---|---|
| 保持 allowBackup=true | 隐私承诺冲突；换机恢复后 Keystore 解不开 |
| 允许明文 HTTP | 用户会全局开 cleartext，安全性更差 |
| minSdk 23 | WebView 版本过旧，IDB/OPFS 行为不可控 |
| 原生重写 UI | 成本高，02 已定 Capacitor 复用 |

## 后果

- 正面：备份与网络边界清晰；origin 稳定；权限最小。
- 负面：LAN 自托管需要证书方案，用户配置成本上升；minSdk 26 放弃部分旧设备。
- 风险：本地 CA 方案对普通用户不友好；需在 05 号补配置引导。

## 验收

- AC-P01 两厂商安装/升级
- AC-P04 权限与返回/键盘/常亮
- AC-C07 备份排除
- 真机验证：飞行模式冷启动；LAN 自托管连接（按选定方案）。
