# 参与开发

## 快速开始

```bash
npm install --ignore-scripts --cache .npm-cache
npm run dev          # 开发服务器
npm run verify       # typecheck×2 + 单测 + 构建（提交前必跑）
npm run test:e2e     # Playwright（本地用系统 Edge）
```

环境：Node 22。`--ignore-scripts` 是必需的：本仓库依赖的 postinstall 在部分环境会因权限失败。

## 改代码前先读

1. [开发迭代流程](docs/process/development-workflow.md) —— 硬性规则与检查清单
2. [00 基线](docs/00-v1-baseline.md) —— 产品承诺与不做什么
3. [02 架构](docs/02-architecture.md) —— 分层与端口
4. [12 验收](docs/12-v1-acceptance.md) —— **写 AC 编号前必须在这里查原文**

## 三条最容易踩的规则

**AC 编号先查后填。** 本项目已连续两次把编号按自己的理解写错。编号错的追溯表比没有更糟。

**视图不碰存储与网络。** `views/` 和 `components/` 不得直接使用 `localStorage`、`indexedDB`、`fetch`。密钥类数据放 `store/deviceSettings.ts`，业务数据走 `store/`。

**删除用墓碑，不移除数组。** 从数组移除在同步时会被另一台设备"复活"。

## 提交

一个逻辑改动一个提交：功能 + 测试 + 文档。提交信息说明"改了什么"与"为什么"，不只是"改了什么"。

## 验证门槛

`npm run verify` 与 `npm run test:e2e` 必须全绿。界面改动没有 E2E 时，在提交信息里写明原因。

## 文档地图

见[流程文档 §7](docs/process/development-workflow.md#7-文档地图)。

## 现状

**未发布**，M1 只能称"试用版"。当前 P0 阻塞：Android 链路未打通、G0 内容审核未签字。详见 [CHANGELOG](CHANGELOG.md) 的已知限制与 [阶段审核](docs/qa/2026-10-25-stage-review.md)。
