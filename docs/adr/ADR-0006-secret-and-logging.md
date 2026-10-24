# ADR-0006：密钥存储、token 生命周期与日志脱敏

- 状态：提议
- 日期：2026-10-24
- 决策人：Tech Lead + 安全评审（待签字）
- 关联：02:86–90/112、04:18/29、12:101–102、13 号 3.5

## 背景

02 号要求"密钥与业务分离、token 不进快照/导出/上下文/日志"，但没有定义 token 熵、服务端存储方式、轮换、撤销、分权与日志脱敏清单。13 号指出：一次 XSS 或备份泄露即可永久读删全部历史。

## 决定

### 1. 密钥分类

| 类型 | 存储位置 | 是否同步 | 是否导出 |
|---|---|---|---|
| 模型 API Key | Android Keystore / 浏览器会话（不持久化明文） | 否 | 否 |
| 同步 token | 同上 | 否 | 否 |
| 数据加密密钥（如需） | 平台安全存储 | 否 | 否 |

Web 端明确告知：同源脚本可读，无法提供与原生相同的保护；建议用户使用独立 token 并定期轮换。

### 2. 同步 token

- 生成：32 字节 CSPRNG，base64url（43 字符）；首次配置由服务端生成并仅显示一次。
- 服务端只存 `sha256(token)`，比较使用常量时间；不存明文。
- 作用域：单数据集单用户；v1 不引入多用户。
- 分权（v1 最小集）：`read`、`write`、`delete` 三个 scope；默认 token 含 read+write，delete 需单独确认的高权限 token。
- 轮换：支持生成新 token 并保留旧 token 24h 宽限；界面显示"上次使用时间/IP"。
- 撤销：按设备撤销；撤销后该 token 立即失效。
- 限速：认证失败 5 次/分钟/IP，超出 429 并延迟。

### 3. 日志与诊断

- 统一 `Logger` 端口，字段白名单：时间、级别、模块、事件码、requestId、revision、generation、错误码、耗时。
- 禁止记录：token、API Key、Authorization 头、完整请求体、食物名、体重值、聊天正文、导入原文。
- 脱敏规则：任何疑似 32+ 字符随机串替换为 `[redacted]`；URL 查询参数全量剥离。
- 保留：本地 7 天滚动；用户可导出诊断包（自动脱敏），导出前预览。
- 错误上报：默认关闭；开启时只发事件码与堆栈（去除路径），不发业务正文。

### 4. 渲染与 XSS

- 所有用户/模型/导入文本一律 `textContent`；禁止 `innerHTML` 拼接（lint 规则）。
- PWA 响应头 CSP：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' <配置的模型/同步域>; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`。
- Capacitor 壳内用 `<meta http-equiv="Content-Security-Policy">` 等价配置（原生无法加响应头）。
- Markdown 若启用，只允许白名单标签，禁 `href="javascript:"`。

### 5. 导出与分享

- 导出文件不含任何密钥；导出前扫描并断言 0 命中。
- 分享用系统分享面板；不自动上传第三方。

## 替代方案

| 方案 | 不采用原因 |
|---|---|
| token 存 localStorage | 同源脚本可读；XSS 直接泄露 |
| token 放 URL | 会进日志/Referer（02:53 已禁） |
| 不设轮换 | 泄露后无法补救 |
| 全量日志便于排查 | 健康数据泄露风险高于收益 |

## 后果

- 正面：泄露面收敛；可撤销；日志可审计。
- 负面：轮换与设备管理增加 UI；CSP 可能影响内联样式（需评估）。
- 风险：Capacitor 壳内 CSP 与插件冲突；需在 S0 验证。

## 验收

- AC-C02 导出/日志/上下文 0 密钥
- AC-C05 CSP 与 XSS 套件
- AC-C06 token 轮换/撤销/分权
- 手工：撤销 token 后旧设备同步返回 401；轮换宽限期内旧 token 仍可用。
