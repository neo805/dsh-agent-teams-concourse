# BRIDGE — 客户端插件 API 调研结论与数据桥口径（P4）

## 调研对象

- `@deepseek-ai/dsh-experimental-client-ui-agent-team@0.2.0-rc.2`（官方参考客户端插件，`lib/client.js`）
- `@deepseek-ai/dsh-client-ui-sidebar-right`（`lib/types/client/tab-registry.d.ts`、`contract/slots.d.ts`、`service.d.ts`）

## 客户端插件形态

- 客户端产物是独立 bundle，经 `window.__ModuleLoader__.load({ id, factory(require) })` 装载；
  入口导出 `apply(ctx)` 与 `inject`（cordis 依赖声明，web 平台）。
- React 18 由宿主 `require('react')` 提供；官方插件自绘内联 SVG / 纯 CSS 变量，不依赖宿主图标导出名。

## 右侧面板注册（两阶段）

1. `ctx.sidebarRightTabs.register(definition)`（服务名 `sidebarRightTabs`，`SidebarRightTabRegistry`）：
   静态类型定义 `{ id, kind, title, priority?, guide? }`；disposer 由 `ctx.effect` 托管。
2. `ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key, ... }, Component))`：
   keyed/session 作用域，**keyed slot 必填 `key`**（值取页型定义的 `id`），不是 `id` 字段；组件经 `inject.hooks.tabInfo` 拿到标签上下文。
   参考插件对 `conversation.session.header.actions` 的用法同款（`slots.inject` 包 `slots.register`）。
- 反模式（报告 §7.6.4）：`sidebar` / `rightbar` / `root` 为 single 已占用 slot，注册会遮蔽官方 UI，禁止触碰。

## 宿主侧 → 客户端数据桥

官方 agent-team 的口径：宿主侧把领域状态登记为**会话投影**（`ctx.sessionProjections.stateOf(session, 'agentTeam')`，
宿主包 `dsh-experimental-agent-team/lib/index.js:129`），客户端经 `ctx.sessions` 共享 Session store
读 `projectionsBySession[sessionId].values.agentTeam`——不走自定义 RPC。

## 本项目 MVP 口径（本阶段选定）

- **组件层纯 props**：`ConcourseView` / `PendingItem` / `PlanView` 在 `src/client/types.ts` 独立声明
  （与 service 的 `ConcourseRecord` / `Ledger.echoCounts` 字段对齐但零依赖），组件完整实现 + 测试。
- `src/client/index.ts` 的 `apply(ctx)` 完成面板注册（`sidebarRightTabs` + `sidebar.right.pane.tab`），
  面板体暂用空视图渲染占位。
- **留 TODO**：宿主侧（`src/index.ts`）尚未把 ConcourseService 快照登记为 `concourse` 会话投影，
  客户端面板体亦未消费投影；接线在 P7 完成，届时面板从 `ctx.sessions` 投影读取并转为 `ConcourseView`。
  选择理由：投影桥需要宿主侧装配改动 + 运行时验证，超出 P4「最小客户端 UI」范围；
  纯 props 口径下组件可完整 TDD，接线点单一（仅面板体的数据来源）。
