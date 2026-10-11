# 决议 D-P2 · R-9 证伪后的路线选择（P2 出口）

|  |  |
| --- | --- |
| 日期 | 2026-10-11 |
| 状态 | 已决议 |
| 依据 | `docs/spikes/R-9-provider-hook.md`（源码证据链 §2 + 运行时探针 §6） |

## 决议

**Go：路线 A（自建组织层）**。放弃复用官方 experimental agent-team 的 roster/邮箱/任务 DAG，
concourse 自行经 `ctx.subagents.startContinuable` 拉起逐顶点子代理，并自建顶点注册表、
邮箱（权威收件箱准入，NFR-9）、任务板与 JSONL 持久化。

## 依据要点

1. 源码面：官方 `spawnTeammate` request 只带 `{prompt, parent}`，continuable 钩子
   `prepareContinuable` 仅贡献 seed（dsh-experimental-agent-team/lib/index.js:573-575、
   dsh-subagent/lib/index.js:1671-1700）。
2. 运行时（scratch profile r9probe）：探针甲落盘 `prepareContinuable` 入参键集
   `["sessionId","parent","signal"]`，无 agentOptions/toolFilter；探针乙证实
   `startContinuable` 的 agentOptions（model/reasoningEffort）+ toolFilter 端到端生效
   （负面对照：不存在模型名 fail-loud）。
3. 结构性收益：R-1（experimental 漂移）风险消除——只依赖 `ctx.subagents` 稳定面。

## 代价（已接受）

官方持久日志回放 / 崩溃恢复对账 / CAS 需自建极简版：JSONL 追加日志 + 启动回放（MVP 口径）。
contextMode 仅支持 spawn；fork 推迟 P5。

## 探针教训（P3 硬约束）

- 插件必须 `export const inject`；缺失即静默不激活。
- 工具一律 `defineTool`（output schema 闭合对象）；`ctx.tools.register` 收裸对象会抛错，
  且**激活失败导致整个插件 effect 回滚**（provider 注册被一并撤销，下游报 NO_PROVIDER，极具迷惑性）。
