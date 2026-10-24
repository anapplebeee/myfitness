# ADR-0001：构建工具、TypeScript 与模块边界

- 状态：提议
- 日期：2026-10-24
- 决策人：Tech Lead（待签字）
- 关联：02:8、12:15 AC-A01、14 §5 S0

## 背景

02:8 已声明"TypeScript、模块化构建与自动化测试为工程基线"，但没有选型；仓库当前是 classic script + 手写拷贝（`scripts/make-www.js`），无 `tsconfig`、无模块边界约束，视图可直接访问全局可变 state（与 02:25 冲突）。G1 需要可重复构建与"领域不碰 DOM/存储"的自动检查。

## 决定

1. **构建**：Vite + TypeScript，输出静态资源到 `dist/`；PWA 与 Capacitor 共用同一产物。
2. **模块分层**（目录即边界）：
   ```
   src/domain/        纯函数：规则、单位、统计、结算；禁止 import DOM/存储/网络
   src/application/   命令/查询、事务编排、校验、幂等
   src/ports/         接口：LocalRepository、ModelProvider、PlatformServices、SyncTransport、ContentPackage
   src/adapters/      IndexedDB、HTTP、Capacitor、浏览器
   src/views/         页面与组件；只读查询 + 命令，不持可变实体
   src/content/       动作/模板/食物数据包（只读）
   ```
3. **TypeScript 严格模式**：`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`；领域层禁止 `any`（lint error）。
4. **Lint 规则**（ESLint + `eslint-plugin-boundaries` 或等价）：
   - `domain` 不得 import `adapters`/`views`/`application`；
   - `views` 不得 import `adapters` 的具体实现，只能经 `ports` 或应用服务；
   - 禁止 `innerHTML` 赋值（统一 `textContent` 或显式白名单渲染器）；
   - 禁止在 `domain` 使用 `Date.now()`/`new Date()`/`crypto.randomUUID()`，必须注入。
5. **路径别名**：`@domain/*`、`@app/*`、`@ports/*`、`@adapters/*`、`@views/*`，禁止跨层相对路径穿越。
6. **产物**：`dist/` 由 CI 生成并校验；`android/` 只接收 `cap sync` 的产物，不手工改 `assets/`。

## 替代方案

| 方案 | 不选原因 |
|---|---|
| 继续 classic script + 全局 `App` | 无法静态检查边界，AC-A01 不可自动验证 |
| React/Vue + 状态库 | 引入运行时与状态管理复杂度，v1 不需要；视图层可后续替换 |
| 纯 TS + 自研打包 | 维护成本高，无收益 |
| 保留双击 `file://` | 00:62 已取消该要求 |

## 后果

- 正面：边界可被 lint 与测试强制；类型错误在编译期暴露；PWA/Android 产物一致。
- 负面：需要一次性迁移成本；团队需熟悉 Vite/TS；构建步骤增加（但 00:62 已允许）。
- 风险：ESLint 边界规则误报导致绕过；需在 S0 用 3 个真实反例验证规则有效。

## 验收

- `npm run build` 可重复产出，CI 校验产物哈希。
- 故意在 `domain` 写 `document.querySelector` 时 CI 失败。
- 故意在视图直接调用 `IndexedDB` 时 CI 失败。
- AC-A01 的 D 用例可在无 DOM 环境运行。
