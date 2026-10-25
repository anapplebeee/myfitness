# 待研究问题

按时间倒序。每条包含：现象、已排除的可能、影响、下一步。

---

## Q-001 · 浏览器直连第三方模型端点被 CORS 拦截

**记录日期**：2026-10-26
**状态**：**待研究**（用户明确表示"后面再研究"，本次不解决）
**影响范围**：AI 教练（BYOK）能否在浏览器/PWA 中真正可用

### 现象

配置 `http://127.0.0.1:7863/v1` 后，浏览器发起请求被拦截：

```
Access to fetch at 'http://127.0.0.1:7863/v1/chat/completions'
from origin 'http://127.0.0.1:4173' has been blocked by CORS policy:
Response to preflight request doesn't pass access control check:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

### 已确认的事实（实测，不是推测）

| 验证 | 结果 |
|---|---|
| PowerShell 直接 POST 到 7863 | ✅ 200，模型正常返回 |
| 浏览器内 fetch 直连 7863 | ❌ `TypeError: Failed to fetch` |
| 7863 的 `OPTIONS` 预检 | ❌ `405 Method Not Allowed` |
| 7863 的 POST 响应头 | ❌ 无 `Access-Control-Allow-Origin` |
| 浏览器经 7864 代理（带 CORS 头） | ✅ 200，返回"收到" |

**结论**：服务端本身完全正常，问题只在响应头缺 `Access-Control-Allow-Origin`。

### 已排除的可能

- ❌ 不是网络不通（PowerShell 能通）
- ❌ 不是 Key 无效（同 Key 直连可用）
- ❌ 不是模型名错误（`cn:step-5-preview` 在 `/v1/models` 中存在）
- ❌ 不是代码 bug（代码走代理就成功）

### 可选解法（待决策）

| 方案 | 优点 | 缺点 |
|---|---|---|
| A. 服务端加 CORS 头 | 最干净，一劳永逸 | 需要 7863 那侧的控制权 |
| B. 网关/反向代理加头 | 生产环境常见做法 | 同样需要部署侧配合 |
| C. 客户端走自己的后端中转 | 不依赖第三方配置 | **数据过我们服务器，与 BYOK 隐私承诺冲突** |
| D. 放弃浏览器端 BYOK，只支持 Android | 真机 WebView 可配置放行 | 缩小了适用范围 |

### 关键认知

> **"有正式域名"不等于"能直连"**。决定性因素是响应头，不是域名。
> 生产环境能通，通常是因为前面那层网关（nginx/Caddy）加了 CORS 头，
> 而不是域名本身有什么特殊性。

### 当前处置

本机联调使用 `scripts/cors-proxy.mjs`（7864 → 7863），**仅用于开发验证，不进产品**。

> **2026-10-26 补充**：已用该代理完成真实模型联调（cn:step-5-preview），
> 证明客户端代码对真实模型是成立的；问题纯粹在服务端的 CORS 配置。

产品侧已有改进：请求失败时错误文案会明确提到"CORS 头"这个常见原因，而不是笼统的"网络失败"。

### 下一步

1. 确认目标用户实际会填哪些端点，这些端点是否支持 CORS
2. 若不支持，评估方案 A/B 是否可控
3. 若都不可控，重新评估 BYOK 是否仍是正确选择（可能回到"我们的后端中转 + 明确告知"）

