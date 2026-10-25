# 证据 · AC-C09（Android 备份与换机不带走业务数据）

日期：2026-10-25；执行人：QA；层级：E（真实 APK 反编译校验）
关联：[19 Android](../../19-android.md)、[12 验收](../../12-v1-acceptance.md) §8

## 1. 问题

修复前 `AndroidManifest.xml` 为：

```xml
<application android:allowBackup="true" ...>
```

WebView 的 IndexedDB 里存着全部训练、饮食、体重记录，以及同步口令（`localStorage` 中的 `tieguan.sync.settings`）。

`allowBackup="true"` 意味着这些数据会随系统备份上传到用户的云端，并可在换机时迁移——与"数据只在本机"的产品承诺直接冲突。

## 2. 修复

```xml
<application
    android:allowBackup="false"
    android:fullBackupContent="@xml/backup_rules"
    android:dataExtractionRules="@xml/data_extraction_rules"
    ...>
```

| 文件 | 覆盖范围 |
|---|---|
| `res/xml/backup_rules.xml` | Android 11 及以下的 `full-backup-content` |
| `res/xml/data_extraction_rules.xml` | Android 12+ 的 `cloud-backup` 与 `device-transfer` |

两者都排除 `database`、`sharedpref`、`file/app_webview`、`file/databases`。

**为什么 `allowBackup=false` 之外还要规则文件**：部分厂商 ROM 可能忽略该属性；显式排除规则能表达意图并在被忽略时仍起保护作用。

## 3. 验证方法与结果

不看源码，直接反编译产出的 APK：

```bash
aapt dump xmltree app-debug.apk AndroidManifest.xml
```

输出：

```
A: android:allowBackup(0x01010280)=(type 0x12)0x0
A: android:fullBackupContent(0x010104eb)=@0x7f100000
A: android:dataExtractionRules(0x0101063e)=@0x7f100002
```

| 断言 | 结果 |
|---|---|
| `allowBackup` 为 `0x0`（false） | 通过 |
| `fullBackupContent` 指向资源 | 通过 |
| `dataExtractionRules` 指向资源 | 通过 |

这两条已写入 `scripts/build-android.mjs`，构建时自动校验（当前 18/18 通过）。

## 4. 局限

| 项 | 状态 |
|---|---|
| 卸载/换机提示 | **未做**——AC 要求的"卸载提示"尚未实现 |
| 真机验证 | **未做**——只验证了 APK 的 Manifest，未在设备上确认备份行为 |
| 厂商 ROM 差异 | 未测——不同 ROM 对 `allowBackup` 的遵循程度不同 |
| 密钥边界说明页 | 未做（AC-C02 相关） |

**结论**：备份排除本身已实现并有机器可验的证据；但整个 AC-C09 只能标"部分通过"，因为卸载提示未做、真机未验证。

## 5. 记录：一次编号错误

本项最初被我记为 `AC-C07`，而 `docs/12` 中根本没有这个编号——是我凭印象编的。

已修正为 `AC-C09`，并**先在 12 号定义表中登记**（§8），再写结果表。这是本项目第三次出现同类错误（AC-S01、AC-N02、AC-C07），已把"编号必须先在定义表登记"写进流程文档。

