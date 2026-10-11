# Spike R-9 · provider 钩子链路验证（P2）

|  |  |
| --- | --- |
| 日期 | 2026-10-11 |
| 状态 | **源码层已判定；运行时探针已完成（2026-10-11，全部符合预期）** |
| 结论 | **R-9 原命题证伪 → 按预案切路线 A**（自行拉起子代理；虚拟拓扑与 UI 不受影响） |

## 1 · 验证命题

报告 §7.1.3 的高置信度推断：官方 `spawnTeammate` 会把 provider 忠实透传到 concourse 注册的 provider，
从而让我们在该钩子里注入 `agentOptions`（model / reasoningEffort / toolFilter），
实现"复用官方 roster/邮箱"与"逐顶点模型定档"兼得（路线 C 的成立前提）。

## 2 · 源码证据链（文件:行号）

**① provider 透传链本身成立。**官方 tool-agent-team 把配置 provider 传给服务层：

- `dsh-experimental-tool-agent-team/lib/index.js:290` — `provider: context === "fork" ? config.forkProvider : config.freshProvider`（配置键默认值 :17-18 为 spawn/fork）
- `dsh-experimental-agent-team/lib/index.js:573-575` — TeamService 调 `ctx.subagents.startContinuable({ childId, provider: request.provider, label, request: { prompt, parent: root }, signal })`

**② 但透传的 request 里没有 agentOptions。**TeamService 组装的 request 只有 `{prompt, parent}`（同上 :575-578）。
SpawnTeammateRequest 类型本身也不含 model / reasoningEffort / agentOptions 字段。

**③ continuable 路径上，provider 钩子无法注入 agentOptions。**宿主 startContinuable 的实现：

- `dsh-subagent/lib/index.js:1671-1700` — `startContinuable(spec)`：`spec.request` 是 `Omit<SubagentStartRequest,'label'|'signal'|'outputSchema'>`，
  **支持** agentOptions / persona / toolFilter / maxDepth；但 agentOptions 由**调用方**提供，
  管理器只做 `resolveChildAgentOptions(parent, request.agentOptions, childDepth)` 解析。
- 同文件 :1697 — provider 的 continuable 钩子是 `prepareContinuable({sessionId, parent, signal})`，
  其返回 `ContinuableCreateSpec`（seed），**只贡献上下文种子，不能影响 agentOptions**。
- `SubagentStartRequest.agentOptions` 文档（types.d.ts）："Requires SubagentCapabilities.agentOptions；
  in-process providers merge them over the parent Agent's options **when they create the child**"——
  即在 continuable 路径下"创建 child"的是宿主管理器而非 provider，provider 无此注入点。

**④ 先例的旁证。**dsh-subagent-profile 的 provider（`lib/core/profile-provider.mjs:122,244-249`）：
它的 agentOptions 注入发生在 **one-shot `start()`** 路径（自己 `parent.ctx.agents.create({...})`），
而 `prepareContinuable: async () => ({})` 是空实现——与该插件 README 自述"continuable 模式丢弃 preset 与 reasoningEffort"互为印证（报告 §4.2 U-13 ③）。

## 3 · 判定

| 子命题 | 判定 |
| --- | --- |
| 第三方 provider 可注册、名字被官方链路透传 | ✅ 成立 |
| 经官方 spawnTeammate 路径注入逐顶点 agentOptions | ❌ **证伪**（请求面无此字段，continuable 钩子无此能力） |
| 路线 A（自行 `ctx.subagents.startContinuable({provider, request:{…, agentOptions, toolFilter}})`）拿到完整逐顶点控制 | ✅ 源码面成立（SubagentStartRequest 字段齐备），待运行时确认 |

## 4 · 决议：切路线 A（预案内，无需另行报批）

DEVELOPMENT_PLAN.md §5/P2 已预授权："证伪 → 立即切换到自行拉起子代理的路线 A 组织层"。

路线 A 对 P3 的范围影响：

| 原路线 C（复用官方） | 路线 A（自建组织层） |
| --- | --- |
| 复用官方 roster / 邮箱 / CAS 任务 DAG | concourse 自有：顶点注册表（continuable 子代理）· 邮箱 · 任务板 · 持久化 |
| 闸门权威判定在收件箱准入（第②层，语义等价服务层） | **我们拥有邮箱本体**——闸门天然落在数据写入口，NFR-9 更干净 |
| R-1 官方基座漂移风险（experimental） | **结构性消除**：只依赖 `ctx.subagents` 稳定面，不依赖 experimental 包 |
| substrate.ts 薄适配器 + 降级路径 | 仍需薄适配（`host/substrate.ts` 收敛全部 `ctx.subagents/ctx.llm` 调用），但面更小 |
| contextMode spawn/fork（官方 provider 提供 seed） | MVP 只支持 spawn；fork（父日志前缀 seed）推迟到 P5，需自研 prepareContinuable 返 seed |

额外收益：官方 spawnTeammate 的"成员间通信必须经官方邮箱"约束不再适用——concourse 邮箱自带
顶点间路由（经根代理邻接边中转），收件侧闸门与 wake 控制完全自主。

代价：官方做扎实的那一半（持久日志回放、崩溃恢复对账、CAS）需要自建简化版。
MVP 口径：JSONL 追加日志 + 启动时回放（§4.6 官方"日志为唯一真源"同款思路的极简实现）。

## 5 · 运行时探针（P2 执行项，确认性质）

虽然源码证据已充分，仍按计划在 scratch profile 做运行时确认（防"读的包版本与运行时不一致"）：

1. **探针甲（确认证伪）**：注册 provider `concourse-probe`，其 prepareContinuable 记录入参键集；
   scratch profile 挂官方 agent-team profile 包 + tool-agent-team 配置 `freshProvider: concourse-probe`；
   会话内调 spawn_teammate → 断言子会话 descriptor.provider === 'concourse-probe'
   且子代理路由 = 父继承（无注入发生）。
2. **探针乙（确认路线 A）**：直接 `ctx.subagents.startContinuable({provider:'concourse-probe',
   request:{prompt, parent, agentOptions:{model, reasoningEffort}, toolFilter:{deny:[…]}})` →
   断言子会话 descriptor.agentModel / agentReasoningEffort / toolFilter 与指定一致。
3. **附带验证（§9.3 ②③）**：`ctx.tools.guard()` 对官方 scoped 工具的覆盖（路线 A 下仅作参考）；
   maxActiveSubagents / maxDepth 配置覆盖方式与超限行为（feed 计划期容量校验）。

探针产物：`docs/spikes/probe/`（最小插件 + 断言脚本）+ 本文件 §6 的运行时记录。

## 6 · 运行时记录

执行环境：scratch profile `r9probe`（`~/.dsh/profiles/r9probe`，由 headless 模板派生，
不影响 web/desktop profile）；探针插件 `docs/spikes/probe/`（link 安装）+
官方 `@deepseek-ai/dsh-experimental-agent-team` / `-tool-agent-team@0.2.0-rc.2`，
tool-agent-team 配置 `freshProvider: concourse-probe`。落盘 `%TEMP%/concourse-probe.jsonl`。

**探针甲（确认证伪）— ✅ 符合预期**
headless 会话内 `spawn_teammate` 成功创建队友并收到 "OK"；探针落盘显示
provider 的 `prepareContinuable` 入参键集为 `["sessionId","parent","signal"]`，
`hasAgentOptions:false`、`hasToolFilter:false`——continuable 路径上 provider
只能贡献 seed，无法注入 agentOptions。R-9 证伪在运行时坐实。

**探针乙（确认路线 A）— ✅ 符合预期**
`ctx.subagents.startContinuable({provider:'concourse-probe', request:{…,
agentOptions:{model:'deepseek-chat', reasoningEffort:'low'}, toolFilter:{deny:['pwsh']}}})`
被完整接受，子代理（childId `eb8d3b6b-…`）真实运行并回复 "OK"。
负面对照：`model:'concourse-nonexistent-model-xyz'` 时子代理创建后失败离场
（`ff5716a7-…`），证明 model 字段端到端落入子代理路由而非被静默忽略。

**附带验证（§9.3）**
- maxDepth / maxActiveSubagents：dsh-subagent 插件 Config 项（lib/types/index.js:76-77），
  默认 1 / 8、volatile、可按 profile patch 对 id `subagent` 覆盖；超限 fail-loud
  （`SubagentDepthError`），并发由 pool.reserve 上限闸门。供 feed 计划期容量校验引用。
- `ctx.tools.guard()` 对官方 scoped 工具的覆盖：路线 A 不依赖官方 scoped 工具链，
  未做单独运行时验证（参考项，关闭）。

**探针自身修复记录（施工中发现）**
1. 缺 `export const inject = ['subagents','tools']` → `cannot get property "subagents"
   without inject`，插件未激活。
2. `ctx.tools.register` 收裸对象抛错 → 插件激活回滚，连带 provider 注册被 effect
   撤销（表现为下游 `NO_PROVIDER`，极具迷惑性）。改用 `defineTool`（`@deepseek-ai/dsh-tools`），
   output schema 需闭合对象（`additionalProperties:false`）。
   **教训（已写入 P3 约束）：concourse 插件必须声明 inject；工具一律 defineTool；
   apply 中任何一步抛错会导致整个插件 effect 回滚。**

scratch profile `r9probe` 保留备查；如需清理：`dsh plugin --profile r9probe remove …`
后删除 `~/.dsh/profiles/r9probe`。
