# D-P3 · DSH 0.2.1-rc.2 运行时适配决议

日期：2026-10-18　状态：已实施（真机 headless 冒烟通过）

## 背景

本机 DSH 由 0.2.0-rc.2 升级到 0.2.1-rc.2。官方更新日志中与子智能体/Agent Team
相关的变更直接影响本插件的 host 层：

- **统一子代理执行与完成通知**：`startContinuable` 被 `startActivation` 取代；
  `SubagentActivation` 携带 `result` 与 `dispose()`，成为显式生命周期句柄。
- **`interrupt` 授权结构化**：`authority` 从裸 Agent 改为
  `{ kind:'ancestor', agent } | { kind:'user', parentSessionId }`。
- **provider capabilities 字段更替**：旧 `toolFilter`/`persona` 位移除，新增
  `agentPreset`；启动期 `SubagentStartRequest` 不再接受 `toolFilter`。
- **Agent Team 消息改直投 Inbox**（移除 outbox / 重试 / 去重）——本插件未使用
  其内部 API，无代码改动；收件箱准入由自有 inbox-gate 承担，不依赖 outbox 字段。
- **移除运行时 invariant 插件及 `./invariant` 导出**——本插件未引用，无影响。
- **兼容性判断优先按 `engines.dsh`**——本包补 `engines.dsh` 精确声明。

## 决议与实施

1. **`startActivation` 替代 `startContinuable`**（`src/host/substrate.ts`）
   - 装配 spec：`{ provider, label, request:{prompt,parent,agentOptions?,maxDepth?}, signal, delivery:'parent' }`。
   - `delivery:'parent'`：子代理终态结果投递给父模型，与官方 subagent 工具一致。
   - 以 `vertexId → activation` 表持有句柄；`interrupt` 先发宿主中断信号，再
     `activation.dispose()` 等待静默并释放（重复 interrupt 为幂等 no-op）。

2. **逐顶点 toolFilter 的替代实现（V-2 不降级）**
   - 0.2.1 起 start 期不再接受 `toolFilter`（仅冷恢复 descriptor 重放）。
   - 本层在 `startActivation` 成功后，经 `ctx.agents.get(childId).ctx.tools.restrict()`
     对子 Agent 作用域应用同一 restriction；**无法应用即 dispose 并 fail-loud**
     （`START_FAILED`），不留下无约束顶点。
   - 代价：restriction 在挂载后生效（毫秒级窗口），较 start 期声明略宽；
     真机冒烟中子代理随后正常回执，未观测到越权窗口行为。

3. **provider capabilities 对齐**
   - `{ agentOptions:true, agentPreset:false, outputSchema:false, depthLimit:true }`；
     `start`（one-shot）继续 fail-loud `CONTINUABLE_ONLY`。

4. **版本声明**
   - `peerDependencies` / `devDependencies` / `engines.dsh` 全部 0.2.1-rc.2；
     `inject` 增补 `agents`（cordis 对未声明属性取值会抛错，真机实证）。

5. **pnpm 11 构建脚本白名单**
   - 新运行时依赖 `koffi` 需要 install 脚本；pnpm 11 把白名单放在
     `pnpm-workspace.yaml`（`allowBuilds.koffi: true`），package.json 的 `pnpm` 字段已不被读取。

## 验证

- 单测/门禁：`pnpm verify` 全绿（44 文件 / 339 测试，pack-smoke 通过）。
- 真机 headless（profile `conc02`，0.2.1-rc.2）：
  - `team_status` 空列表正常返回；
  - T1a 链路 topology → plan → approve 成功：`w1` 经 `startActivation` 拉起，
    childId `c96e5d1f-…`，台账 5 行（submit/vertex-self/vertex-start/approve），
    self 根跳过；子代理按任务回执 `OK`。
  - `team_send`（smoke2）：lead→w1 投递经 inbox-gate 记录
    `comm/deliver`（tokens=3）与 `budget/consume` 台账，子代理冷恢复并回复 `PONG`
    ——`sendMessage(parent, childId, content, {signal})` 在新运行时下成立。
- 结论：宿主 API 适配成立；`toolFilter` restrict 路径在真机链路中未报错（fail-loud 未触发）。

## 遗留

- 顶点完成事件仍未回推 concourse 状态（原限制 1）——0.2.1 提供 `subagent/end`
  事件与 `waitForChildren`，P5 可用其做状态收敛。
- toolFilter 挂载窗口（见 2.）记录为已知限制。
