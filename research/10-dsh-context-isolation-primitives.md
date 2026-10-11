# DSH 本体「上下文隔离 / 不回注 / 可丢弃」原语技术报告

> 目标：查清 DSH 0.2.0-rc.2 本体在这条能力轴上有哪些**原生原语**，为「一次性推理、结果不回注父上下文」类插件提供可调用 API 与限制清单。
>
> 证据口径：每条结论后附 `绝对路径:行号`，或标注「实测」并给出调用与返回。凡本地源码无法确证者一律进附录 A，不臆造 API 名。
>
> 包根目录简写：**`<PKG>` = `C:\Users\KEI.NEO\.dsh\profiles\node_modules\@deepseek-ai\`**（249 个包，0.2.0-rc.2）。第三方插件路径写全。
>
> 撰写约束：本次调研的父会话被授予的 `subagent` 工具因 `maxDepth 1` 失败，故**全部证据为一手读取**，无二手转述。

---

## 1. 一句话结论（九问速答表）

**能。** 让一次推理结果彻底不进父上下文，唯一干净的路径是 **绕过 `Agent`，直接调用 `ctx.llm.stream()` 走裸模型调用**（`<PKG>\dsh-llm\lib\types\index.d.ts:412`）。这条路径只经过适配器注册表与 `llm/stream` 瀑布，**完全不触碰 Session 日志、surface、inbox**，因此既不留 message、也不产生任何回注；官方 `dsh-compaction-basic` 的摘要调用正是这么做的（`<PKG>\dsh-compaction-basic\lib\types\summarizer.d.ts:46-56`）。

**次优但不彻底**的两个原语：
- `ctx.subagents.start(...)`：子代理跑在**自己的 Session** 里，一次性运行结束时驱动方**零写入父 session**（`<PKG>\dsh-subagent-in-process-driver\lib\index.js:161-252`）——只要插件**不把 `run.result` 当成工具结果返回给模型**，子代理的产出就永不进父上下文。代价是子代理的 log / token / UI 呈现都算在**子会话**名下。
- `agent.inject(message)`：**不是旁路**。它是持久化 inbox 条目（事件 `agent/inbox/inserted`，`<PKG>\dsh-agent\lib\types\runtime-types.d.ts:263-266`），文档明说「Cancellation or disposal may discard pending context」（同文件 `:201-209`）——可丢弃，但**计入上下文、出现在会话日志**。

**遮蔽（不回注的另一种形态）**：DSH 的 surface 替换原语是 `SessionOp = { op:'replace', startSeq, endSeq }`（`<PKG>\dsh-session\lib\types\types.d.ts:458-462`），**支持单条消息级遮蔽**（`startSeq === endSeq`，同文件 `:453-454`）。被遮蔽的内容**没被删除**——原文永远留在 append-only 日志里，只是「replacement copies stay model-only」（`<PKG>\dsh-session\lib\types\surface.d.ts:52-57`）。压缩块可恢复这件事由 `billion-context-dsh` 的 `decompress` 工具实现，**DSH 本体没有 `decompress` 原语**。

| # | 问题 | 结论 | 关键证据 |
|---|---|---|---|
| 1 | 子代理结果如何回流父上下文？ | **本体不会自动回注**；回注发生在「委派工具调用的工具结果」这一层。`ctx.subagents.start()` 全程零写父 session | `dsh-subagent-in-process-driver\lib\index.js:161-252` |
| 2 | `agent.inject` 是什么？ | `Agent.inject(message: UserMessage): void`，排队「model-facing context for the next pre-step」，不唤醒 driver；**持久 inbox**，可被取消/丢弃，**进模型上下文也进日志** | `dsh-agent\lib\types\runtime-types.d.ts:201-209`, `:263-292` |
| 3 | compaction / shadow / replace 原语 | 本体原语 = `SurfaceOp.replace`（surface 位置区间，可单节点）；底层实现为 `compaction/start`→`compaction/summary`→`user/message(replace)`→`compaction/end` 四事件事务 | `dsh-session\lib\types\types.d.ts:443-475`；`dsh-compaction\lib\types\types.d.ts:21-98` |
| 4 | ACP 压缩机制 | `ctx.compaction: CompactionEngine` 接缝（3 个抽象方法）；引擎实现可换。tier1/2/3 与 `verifiedReadings` 是**第三方 ACP 引擎**加的，非 DSH 本体 | `dsh-compaction\lib\types\index.d.ts:69,102-158`；`billion-context-dsh\dist\block-ledger.d.ts:34-49` |
| 5 | fork 语义 | `@Remote('fork') fork(request: SessionForkRequest): Promise<SessionForkValue>`；`{sessionId, atSeq?}`→`{sessionId}`；拷贝「cold-readable exact event prefix」到新 Session，lineage 走 `parentSessionId` | `dsh-api-session-controller\lib\types\types.d.ts:308-317`；`commands.js:202-239` |
| 6 | `sessionController.prompt` | `SessionPromptRequest{requestId, sessionId, mode:'queue'\|'steer', content, clientTimeZone?}` → `{accepted:true}`；queue=追加回合，steer=打断当前回合 | `dsh-api-session-controller\lib\types\types.d.ts:318-331` |
| 7 | 一次性 / 可丢弃执行单元？ | **有，且是本次调研的核心答案：`ctx.llm.stream(options)`**。裸模型调用，无 Session 参与 | `dsh-llm\lib\types\index.d.ts:412`；先例 `dsh-session-title-llm` |
| 8 | 上下文预算 / 裁剪 | 本体自带 `dsh-compaction-basic`（`thresholdRatio` 0.8、`headroomTokens` 65536、`retainRatio` 0.16）；`billion-context-dsh` 是**把 ACP 做成 CompactionEngine 后端**的第三方实现，自带 kernel 阈值 0.70/0.85 | `dsh-compaction-basic\lib\types\types.d.ts:8-27`；`billion-context-dsh\dist\index.d.ts:50-136` |
| 9 | tool result 大小裁剪 | 两级：`tool-result-pruner` 按**字符**（8192 触发 / 保 head 4096 + tail 1024）改写 surface；`spill-policy` 按**token**（`maxInlineTokens: 12500`）落盘并给路径 | `dsh-compaction-tool-result-pruner\lib\types\types.d.ts:5-13`；`dsh-spill-policy\lib\index.js:141,237-255` |

---

## 2. 子代理结果回流路径

### 2.1 服务面（可编程启动点）

`ctx.subagents` 的 Service Definition 在 `<PKG>\dsh-subagent\lib\types\index.d.ts`：

- `SubagentRuntime`（`:109`），声明合并挂在 `Context`（`:62-65`）；
- `start(name: string, request: SubagentStartRequest): Promise<SubagentRun>`——一次性运行；
- `startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart>`，其中 `ContinuableStart = { childId, messageId }`（`:142-157`）。

`SubagentRun`（`<PKG>\dsh-subagent\lib\types\types.d.ts:292-318`）：

```ts
{
  id: SessionId;
  localAgent: Agent | undefined;
  result: Promise<SubagentResult>;
  dispose(): Promise<void>;
}
```

`SubagentResult`（同文件 `:256-282`）：`{ output: ContentBlock[]; structured?; diagnostic?; stopReason }`，`stopReason ∈ 'completed' | 'aborted' | 'error' | 'max-tokens' | 'refusal'`。

`SubagentStartRequest`（同文件 `:136-192`）字段：`label / prompt / parent / signal / agentOptions / outputSchema / maxDepth / toolFilter / persona`。能力面 `SubagentCapabilities` 做 fail-loud 校验（`:112-128`）。

### 2.2 关键判据：一次子代理运行**不写父 session**

在进程内驱动实现 `<PKG>\dsh-subagent-in-process-driver\lib\index.js` 中：

- `startInProcessRun`（`:161-190`）：调用 `parent.ctx.agents.create({ sessionId: childId = randomUUID(), parentAgent: parent, meta: childSessionMeta, agentOptions: resolveChildAgentOptions(...), signal, setup })` 创建**子 Agent**；**整个文件没有任何一处写 `parent.session`**（这正是「本体不自动回注」的代码级证据）。
- `drivePublishedRun`（`:195-229`）：向子 Agent 投递 `child.followup(createUserMessage({ content: prompt, source: { kind: 'user' } }))`，然后 `await child.whenIdle()`。
- `readResult`（`:231-252`）：从**子会话自己的日志**里取结果——

  ```js
  const own = child.session.snapshotEvents(boundary);
  const lastEnd = foldConsumedWork(own).end;
  const output = finalAssistantOutput(own) ?? [];
  ```
- `toStopReason`（`:125-133`）：`completed / max-tokens / aborted` 直通，`blocked → 'refusal'`，其余 `'error'`。
- 结构化输出：`STRUCTURED_OUTPUT_TOOL = 'structured_output'`（`:21`）、指令常量（`:27`）、`attachStructuredRuntime`（`:36-109`）注册工具 + 作用域 systemPrompt 段。

**结论**：`ctx.subagents.start()` 返回的 `SubagentRun.result` 是一个**插件自己持有的 Promise**。它进不进父上下文，取决于**插件把不把它写回去**。

### 2.3 那「子代理摘要出现在父上下文」是怎么发生的？

答案在本体自带的委派工具 `<PKG>\dsh-tool-subagent\lib\types\index.d.ts:1-82`：

- 它是一个**模型工具**，`toolName` 默认 `'subagent'`；
- 配置项：`provider / toolName / modelSelectionSettings / enableRunInBackground（默认 true）/ backgroundMode（'one-shot' | 'continuable'，默认 one-shot）/ agentOptions / persona / toolFilter{allow,deny} / maxDepth（默认取宿主值 1）`；
- 文档原文：「**Foreground calls always dispose the run after collection.**」——前台调用收集完结果就销毁 run。

因此父上下文里出现的那条「子代理报告」，来自**这次工具调用的 tool result**（工具结果本身是 surface 事件，当然进上下文），而**不是** `ctx.subagents` 的回注行为。

> **可调用性结论（对插件最重要的三条）**
> 1. 插件直接 `await ctx.subagents.start(provider, { prompt, parent, outputSchema })`，把 `result.output` 存在自己模块里、**不让任何模型工具调用它** → 子代理产出**永不进父上下文**，只在子会话日志与 UI 里留痕。这已经满足「跑完就丢 + UI 留痕 + 不进模型上下文」。
> 2. 想要「只在 UI 留痕」但**不新增会话**：见第 8 节（`ctx.llm.stream()`）。
> 3. 若想「子代理产出可见于父会话日志但不可见于模型」：本体无直接原语，需要用第 3/4 节组合（先 append、再 replace 遮蔽）。

### 2.4 `dsh-tool-subagent-control` 是什么

`<PKG>\dsh-tool-subagent-control\lib\types\index.d.ts:1-19`：注册两个全局命名工具 `send_message` / `interrupt_agent`，是 `ctx.subagents.sendMessage()` / `.interrupt()` 的薄适配层，**不含自己的生命周期路由**。对「不回注」需求无帮助（它天然要产生 tool result）。

### 2.5 fork 型子代理是另一回事

`@deepseek-ai/dsh-subagent-fork-in-process` 注册 providerName 默认 `'fork'` 的 provider（`<PKG>\dsh-subagent-fork-in-process\lib\types\index.d.ts:1-19`）：子 Agent 的会话日志**以父会话日志的一段前缀为种子**（seed 截止到最后一个 turn/end）。它是「让子代理看见父上下文」，与「子代理结果不回注父上下文」正交。

---

## 3. `agent.inject`

### 3.1 定义与签名

`<PKG>\dsh-agent\lib\types\runtime-types.d.ts:201-209`（`interface Agent` 的声明合并）：

```ts
inject(message: UserMessage): void;
```

文档原文（逐字）：

> Queue model-facing context for the next pre-step without waking the driver. A running driver claims it at the nearest later step boundary; idle drivers leave it pending until follow-up or steering wakes them. It may miss a request whose pre-step already claimed its batch. Cancellation or disposal may discard pending context.

同文件同段（`:150-200`）的兄弟 API：

| 方法 | 行 | 语义要点 |
|---|---|---|
| `cancel(cause, options?)` | `:150-157` | 清空排队与 steering 工作（`keepInbox` 可保留），中止当前回合 |
| `whenIdle()` | `:158-164` | 等到整个 Agent 活动静默 |
| `runMaintenance<T>(task)` | `:165-174` | 从真正 idle 相位跑一件非回合维护任务；期间公开状态仍为 `idle`，唤醒输入留在 inbox |
| `send(message, target, wakeup)` | `:175-186` | 投递到指定 `InboxTarget`，`wakeup` 决定是否唤醒 |
| `followup(message)` | `:187-192` | 追加式追问 |
| `steer(message)` | `:193-200` | 打断式引导 |

### 3.2 它不是「旁路」，而是持久 inbox

`Inbox` 接口（同文件 `:41-82`）：`nextTurn / nextStep`（只读）、`clear()`、`append(target, message)`、`prepend`、`replace(messageId, newMessage): boolean`、`remove(messageId): boolean`、`splice(target, start, deleteCount, inserted)`。

配套事件（同文件）：

- `agent/inbox/inserted`（`:263-266`）——一条消息进入 live inbox；
- `agent/inbox/claimed`（`:277-281`）——消息在打开的回合内被取走；**若 proposed step 被 reject，这条消息就地终止：既不被 discard，也不再作为 `user/message` 重新发出，回合无 step 关闭**；
- `agent/inbox/discarded`（`:289-292`）——被丢弃。

相关瀑布：

- `agent/pre-step`（`:304-310`）`(payload{agent,messages,turn,step,signal}, next) => Promise<PreStepDecision>`；`PreStepDecision = { kind:'reject' } | { kind:'enter'; messages: UserMessage[]; startsRequestSeries?: true }`（`:92-99`）。**这是替换/追加「本步入场消息」的官方通道**。
- `agent/request`（`:327-332`）——文档明确：**「Model-visible content must use logged channels; this waterfall cannot mutate messages.」**（同文件 `:318-319`）。即：**不存在「偷偷改 prompt」的原语**。
- `agent/turn-stopping`（`:387-391`）串行。
- `agent.ctx`：agent-scoped，贡献随 Agent 销毁回退（`:148-149`）。

### 3.3 实际使用先例（重要：文档与实现不一致）

`billion-context-dsh` 的 nudge（「效率提示」）**并未**用 `agent.inject`。实现是 `agent/pre-step` 瀑布里返回到场消息：

```js
// C:\Users\KEI.NEO\.dsh\profiles\web\node_modules\billion-context-dsh\dist\index.js:9652-9672
ctx.on("agent/pre-step", async (payload, next) => {
  stripOrphanedSurfaceToolMessages(payload.agent.session);
  engine.resyncSettings();
  if (!engine.readSettingsSource().autoNudge) return next();
  const decision = await next();
  if (decision.kind === "reject") return decision;
  const window = await this.windowFor(payload.agent);
  const outcome = buildNudge(...);
  if (outcome === null) return decision;
  return { kind: "enter", messages: [...decision.messages, outcome.message] };
});
```

其类型层把 nudge 描述为「injected user message」（`billion-context-dsh\dist\nudge.d.ts:1-6`、`:23-26` `NudgeOutcome{message, emergency}`），README 也写作「向 `agent/pre-step` 注入 nudge」（其 README.md:250）。**「inject」在此是概念词，不是 `agent.inject()` API。** 对第三方插件作者而言，两条路都在，但语义不同：

| | `agent.inject(msg)` | `agent/pre-step` 返回到场消息 |
|---|---|---|
| 时机 | 任意时刻排队，下个 pre-step 领取 | 本步立即生效，可拒绝/替换 |
| 唤醒 | **不唤醒**；空闲时留在 pending 直到被 followup/steer 唤醒 | 只在已有的 pre-step 里发生（需先有唤醒源） |
| 是否进日志 | 是（inbox 事件；领取后成为 `user/message`） | 是（入场即写入 surface） |
| 可否丢弃 | 文档允许（取消/销毁可丢） | 由 `kind:'reject'` 拒绝 |
| 幂等/去重 | **本体不提供**；去重需插件自建（ACP 用 `lastNudgeTurn` / `emergencyNudges` 两个 Map 自己限流，见 `billion-context-dsh\dist\index.js:9662-9663` 与 `nudge.d.ts:92`） | 同 |
| 大小限制 | **本体无显式上限**（未在类型/文档中找到）；实际受模型窗口与宿主裁剪约束 → 附录 A | 同 |

> **要点**：`agent.inject` **不是**「no-refeed 旁路」。它确实是「no wake」，但内容**就是**模型可见上下文，且计入上下文预算。任何声称用 `inject` 做「不占上下文」的方案都是错的。

---

## 4. compaction · shadow · replace

### 4.1 本体原语：`SurfaceOp`

`<PKG>\dsh-session\lib\types\types.d.ts:443-462`（逐字）：

```ts
/** A message-producing event carrying its required surface operation. */
export type SurfaceEvent = SessionEvent<SurfaceEventType>;

export type SurfaceOp = 'append' | {
    op: 'replace';
    startSeq: SessionSeq;
    endSeq: SessionSeq;
};
```

文档要点（同文件 `:445-462`）：

- `'append'`：加到尾部，user/assistant/tool 消息的正常路径；
- `{ op:'replace', startSeq, endSeq }`：用本节点替换从 `startSeq`（含）到 `endSeq`（含）的 surface 节点；**两者都必须是当前 surface 上存在的节点**；**`startSeq === endSeq` 即替换单个节点**；本节点的 `SessionEvent.sourceEventSeqs` 必须包含**每一个**被遮蔽的 surface 节点；
- 文档明确：「**Used by compaction; any surface-replacing producer may use it.**」→ **这是对第三方插件开放的通用原语，不是 compaction 私有**。

只有 5 类事件可以承载 surface 元数据（同文件 `:442`）：

```ts
export type SurfaceEventType = 'system/message' | 'developer/message' | 'user/message' | 'assistant/message' | 'tool/result';
```

`SurfaceIntent`（`:467-475`）特别规定：`assistant/message` **禁止** `sourceEventSeqs`（它内嵌自己的 provider stream），其余四类可带。

### 4.2 提交入口：`Session.append`

`<PKG>\dsh-session\lib\types\index.d.ts:246`：

```ts
append<T extends SessionEventType>(
  type: T,
  data: SessionEventMap[T],
  ...opts: T extends SurfaceEventType ? [opts: SurfaceIntent<T>] : []
): SessionEvent<T>;
```

其校验（同文件 `:231-244`）是一道**硬门**：数据必须 losslessly JSON 可序列化（BigInt / function / symbol / undefined / -0 / 非有限数 / 循环引用 / 稀疏数组 / Map / Set / Date / 类实例全部拒绝），并且要满足「canonical surface contract（marker 形状与资格、唯一且更早的 source-event 引用、**位置替换有效性**、**完整的 shadowed-node 覆盖**）」。违反即在 append 点抛错，而不是等到落盘。

> 这意味着：**想用 replace 遮蔽一段 surface，你必须把那段 surface 的全部 seq 准确地列进 `sourceEventSeqs`，否则 append 直接失败。**

### 4.3 `replaceGeneration` / `contentGeneration`

`<PKG>\dsh-session\lib\types\surface.d.ts:117-125`：

```ts
export interface SessionSurface {
    readonly nodes: readonly SessionSeq[];
    readonly replaceGeneration: number;   // 已提交的位置替换的单调计数
    readonly contentGeneration: number;   // 已提交的替换 + 插件自有消息变更
}
```

`billion-context-dsh` 用它做乐观重试：`const generation = agent.session.surface.replaceGeneration;`（`dist/index.js:9689`）。

### 4.4 「真删了还是只对模型不可见、UI 仍可见？」

**只对模型不可见。UI（human transcript）仍可见；原文永远在 append-only 日志。**

`<PKG>\dsh-session\lib\types\surface.d.ts:50-63`（逐字）：

> Narrow an event to an append-origin surface event: one that entered the surface at its own log position and was never itself a replacement copy.
> The model-visible surface deliberately shadows replaced ranges, so it is the wrong source for a human transcript — a landed replacement would erase conversation the user already saw. **Append-origin events are that transcript's durable source material; replacement copies stay model-only.**

配套 API：`isAppendSurfaceEvent(event)`（`:61-63`）、`isReplacementSurfaceEvent(event)`（`:71-75`）；折叠结果 `SurfaceFoldResult{ nodes, replacements: SurfaceFoldReplacement[], projectedMessages }`（`:97-116`），其中 `SurfaceFoldReplacement{ seq, start, end, shadowedSeqs }`（`:97-107`）——**替换历史被完整保留，可审计**。

`foldSurface(events, projections?)`（`:141`）可离线重放；`Session.messageHistory` 的文档（`index.d.ts:285-299`）：「the surface is the single source of derived history … a compaction `replace` **deletes the shadowed nodes from the derivation**」，且带 CACHE（纯尾部增长 O(new nodes)，任一 replace 触发重建）。

### 4.5 可恢复吗？

- **本体**：溯源信息在（`sourceEventSeqs` + `SurfaceFoldReplacement` + 原文事件仍在日志），但**本体不提供任何 `decompress` / `restore` API**。本次检索未在 `<PKG>` 下找到名为 decompress/restore/shadow-restore 的官方原语。
- **第三方已实现**：`billion-context-dsh` 提供 `decompress({ blockId })` 模型工具，语义是「从日志只读恢复被遮蔽的原文」，并支持分页（`dist\region.d.ts:473-524`：`DEFAULT_DECOMPRESS_PAGE = 100` 条、`DEFAULT_DECOMPRESS_PAGE_CHARS = 7000`）。它的 `search_context` 也用同样的日志重建（`dist\tools.d.ts:182-191`）。
- **可恢复的边界**：`billion-context-dsh\dist\region.d.ts:100-116` `isExactSurfaceSpan` 警告：写入一个**不是**当前 surface 精确切片 `shadowedSeqs` 的 `compaction/summary` 事件，会让整个会话日志**永久不可加载**（issue #201）。所以「可恢复」的前提是替换写对了。

### 4.6 单条消息级遮蔽 vs 只能按 seq 区间

**两者都有，而且是同一个原语**：`startSeq === endSeq` 即单节点替换（`dsh-session\lib\types\types.d.ts:453-454`）。第三方 ACP 也走同一路径——`hideSurfaceSeqs(session, seqs, text?, priceEvent?)`（`billion-context-dsh\dist\region.d.ts:240`）把给定 seq 集合逐个替换成一条 user message，无文本时用固定 `PRUNE_NOTE = "(removed by context management)"`（同文件 `:239`）。它还被用于「隐藏 compress 工具的 call/result 对」（`hideCompressToolPair`，`:250`）与孤儿工具消息清理（`stripOrphanedSurfaceToolMessages`，`:264`）。

> **一句话**：DSH 的遮蔽原语粒度是**surface 位置区间**，单节点是区间长度 1 的特例；**没有「只按 seq 号大小」的区间语义**——surface 位置与 seq 号在替换后会失去单调对应（见 5.1）。

---

## 5. ACP 压缩机制

### 5.1 接缝：`ctx.compaction`

`<PKG>\dsh-compaction\lib\types\index.d.ts`（160 行）：

```ts
ctx.compaction: CompactionEngine        // :69
```

抽象类（`:102-158`）三个抽象方法：

| 方法 | 行 | 文档要点 |
|---|---|---|
| `compactIfNeeded(agent, trigger, signal): Promise<CompactionResult \| null>` | `:116` | `trigger ∈ 'pressure' \| 'context-overflow'`（`:25`） |
| `compactNow(agent, signal, sourceCommandId?): Promise<CompactionResult \| null>` | `:137` | 空闲会话强制压缩 |
| `compactRegion(start: SessionSeq, end: SessionSeq, agent, signal?): Promise<CompactionResult>` | `:157` | **强制**把一段 surface 节点压成一个 summary 节点 |

模块文档：「**Load one implementation per context as `ctx.compaction`.**」（`:69` 附近）。`ManualCompactionErrorCode = 'busy' \| 'cancelled' \| 'changed' \| 'summary' \| 'commit' \| 'persistence'`（`:27`）；错误瀑布 `compaction/summary-error`（`:85-90`）。

`compactRegion` 的文档含本次调研最关键的语义（逐字）：

> Forcibly compact a range of surface nodes into a single summary node. `start` and `end` name an inclusive span by **SURFACE POSITION, not numeric seq order**; replacements can make visible seqs **non-monotonic**. Both edges must be balanced so assistant tool calls remain paired with their results.

### 5.2 压缩块数据结构（本体）

`<PKG>\dsh-compaction\lib\types\types.d.ts`（132 行）。**四个事件全部是 log-only（文档明确「not surface events」）**：

| 事件 | 行 | 载荷与语义 |
|---|---|---|
| `compaction/start` | `:21-25` | `{ compactionId, sourceCommandId?, turn: number \| null }`。持有锁；`turn === null` 表示回合之间的独立手动事务 |
| `compaction/summary` | `:35-68` | `{ compactionId, sourceCommandId?, summary: ContentBlock[], shadowedRange:{start,end}, shadowedSeqs: SessionSeq[], shadowedTokenCount, provider, model, maxTokens?, usage?, rawOutput + llmStreamCall:true \| rawOutput? + llmStreamCall?:never }`。文档：「The summary content is in `data.summary`; **the actual surface replacement is performed by the immediately following `user/message` event that shadows the compacted range. That adjacency is contractual**」 |
| `compaction/end` | `:73-78` | `{ compactionId, sourceCommandId?, turn, error? }` |
| `compaction/prune` | `:88-98` | `{ shadowedRange, shadowedSeqs, shadowedTokenCount }`。文档：「Shadow price of one **model-free** prune replacement — log-only, no surfaceOp … **The replacement MUST be appended synchronously right after this event.**」 |

`CompactionResult`（`:102-131`）：

```ts
{ compactionId, sourceCommandId?, startSeq, summarySeq, endSeq,
  summary: ContentBlock[], shadowedRange: {start,end},
  shadowedSeqs, shadowedTokenCount }
```

文档（逐字，务必按此理解）：

> A surface-POSITION span, not a numeric seq interval — after a prior replace lands a fresh high-seq summary node at an older range's position, **`start` can be GREATER than `end`**. `shadowedSeqs` is the authoritative set of shadowed nodes, in surface order.

其余导出：`checkpoint.d.ts`（`compactCheckpointSource` / `isCompactCheckpointSource` + `MessageSourceMap 'compact-checkpoint'`）、`tool-pairing.d.ts`（工具配对配平）、`brand.d.ts`（`CompactionId`）、`invariant.d.ts`。

### 5.3 tier1/2/3 与 `verifiedReadings`：**不属于 DSH 本体**

这是 `billion-context-dsh`（第三方，ACP）在 `compaction/summary` 的 `rawOutput` 里塞的**私有账本**。`billion-context-dsh\dist\block-ledger.d.ts`：

```ts
export declare const ACP_BLOCK_LEDGER_MARKER = "$dshAcpBlockLedger";   // :26
export declare const ACP_BLOCK_LEDGER_VERSION = 1;                     // :28

export interface AcpBlockLedgerPayload {                               // :34-49
    readonly tier?: 1 | 2 | 3;                 // 1=消息区间, 2=蒸馏 tier1, 3=蒸馏 tier2
    readonly kernelBlockId?: string;           // acp-kernel 的 bN
    readonly topic?: string;
    readonly parentBlockIds?: readonly string[];
    readonly directMessageIds?: readonly string[];
    readonly effectiveMessageIds?: readonly string[];
    readonly verifiedReadings?: readonly string[];   // B3：压缩前已绿的验收读数
}
```

其注释（`:1-23`）解释了为什么藏在 `rawOutput` 里：**发布版 `@deepseek-ai/dsh-session-format-v0-to-v1` 对 `compaction/summary` 载荷做精确成员白名单校验，白名单外第一个成员即拒绝**（issue #141）；把六个 tier/lineage 字段放在顶层会让所有升级前的 v0 会话日志「砖掉」。放进已被允许的可选 `rawOutput` 成员即无损往返。解码「对 marker/version 严格、逐字段宽松，且**永不抛错**」——未知/缺失 marker 或未来版本 ⇒ 「无账本数据」，调用方回退 tier-1 重建。

`compress` 工具的 `verifiedReadings` 参数（模型可见，`billion-context-dsh\dist\tools.d.ts:98-104`）：

> Optional: acceptance readings that are already green before this compression (e.g. "t0-fastpath 8/8", "closedloop 414/414"). Stored structurally on the `compaction/summary` event and recovered by `verifiedReadingsOf`, so later steps need not re-run the checks.

### 5.4 `decompress` 的可逆性

DSH 本体**没有** `decompress`。可逆性来自「原文留在 append-only 日志 + `shadowedSeqs` 是权威集合」这两条本体保证，由第三方实现读取：

- `expandShadowedSeqs(session, blockId)`（`billion-context-dsh\dist\region.d.ts:472`）：递归展开被蒸馏的父块的 shadowed seqs（tier-2 块遮蔽的是父块的 checkpoint 节点，要还原原文必须展开），**循环安全**；
- 分页切片 `sliceDecompressPage(expanded, offset, limit, charBudget, renderLen)`（同文件 `:524`），页上限**同时**受条数与渲染字符数约束——其注释（`:473-499`）给出理由：只按条数会被宿主 `dsh-compaction-tool-result-pruner` 按字符（`thresholdChars: 8192`）削掉中间，所以字符预算取 **7000**（留出块头、`[seq N]` 前缀、继续提示的余量），且明确说明这一预算**不**与 kernel 的 `config.truncate.threshold` 挂钩（不同机制、不同阈值）。

### 5.5 引擎如何落地一次压缩事务（ACP 实现，可作第三方范式）

`billion-context-dsh\dist\region.d.ts:1-12` 的模块文档给出完整序列（并说明它是「modeled on `dsh-compaction-basic/src/region.ts`，后者 package-internal 且未被接缝导出」）：

1. 校验 surface 区间与 tool-call/result 配对；
2. 取持久锁 `compaction/start`；
3. 记 `compaction/summary` 作为 shadow price；
4. 落 `user/message` surface 替换，摘要内容挂在 `compactCheckpointSource`（`checkpointSourceFor`，`:192-196`，`kind:'compact-checkpoint'`）；
5. `compaction/end` 释放锁。

`runCompactionTransaction(session, input)`（`:201-204`）成功后「四个事件已在日志中，surface 上多一个 summary 节点」。

**一个必须知道的写入陷阱**（`:274-284`）：`session.append` **不可重入**——在 `session/event` 监听器里同步 append 会抛 `"session append cannot reenter while another append is being published"`，**而 dispatcher 会静默吞掉这个错误**，于是同步隐藏在生产环境是**静默 no-op**。官方解法是 `deferCompressPairHide`（`:284`）：把隐藏排到 microtask 队列，在当前 append 完全发布之后、agent loop 恢复之前执行。

---

## 6. fork 语义

### 6.1 API（会话级 fork）

服务方法与类型：

- `@Remote('fork') fork(request: SessionForkRequest): Promise<SessionForkValue>`——运行时实测签名：`"@Remote('fork') fork(request: SessionForkRequest): Promise<SessionForkValue>"`（`cordis_inspect_query` → host `Service.listService` → `sessionController`；落地文件 `C:\Users\KEI.NEO\AppData\Local\Temp\dsh-spill-dwrlkG\session-f8d61c6e9336\73604b1227cd-cordis_inspect_query.txt:1081`，下称 **实测 spill 文件**）。
- 类型（`<PKG>\dsh-api-session-controller\lib\types\types.d.ts:308-317`）：

```ts
SessionForkRequest {
  sessionId: SessionId;
  atSeq?: number;   // Exact inclusive source event seq; omitted selects the latest completed-turn prefix
}
SessionForkValue { sessionId: SessionId }
```

- 实现（`<PKG>\dsh-api-session-controller\lib\types\commands.js:202-239`）：`forkWorkspace`（`:519-525`）通过 `ctx.sessionQuery.traceSession` 追 lineage；种子由 `buildForkSeed`（`import` 于 `commands.js:59`、`index.js:14`，来自 `@deepseek-ai/dsh-session/fork`）生成。文档（`:200-206`）：**「Fork one cold-readable exact event prefix into a new Session. An omitted boundary selects the latest completed-turn prefix; an open cut receives synthetic fork closers.」** 无可用边界时抛 `session/fork-unavailable`（`:232-239`）。
- 客户端：`<PKG>\dsh-api-session-controller\lib\types\client\sessions\manager.js:451-462`（「on success merge the child into summaries … **lineage rides `parentSessionId`**」）；`service.js:339-355`（fork + rename，子标题带递增的 fork 序号，`client.js:3061-3064`）。
- 回合结束原因新增 `forked`（`turnEndReasonMap`）。

### 6.2 四个维度上的关系

| 维度 | 关系 |
|---|---|
| **上下文** | 子会话拿到父会话的一个**精确事件前缀**（`atSeq` 含）或「最近一个已完成回合的前缀」的**冷读副本**。它**独立演化**，之后父会话新增的消息不进入子会话，反之亦然。（`commands.js:200-206`） |
| **日志** | 各自独立的 append-only 日志。`Session.isOwnSeq(seq)`（`<PKG>\dsh-session\lib\types\index.d.ts:199-206`）用于区分「本会话自有事件」与「fork 继承前缀」——**继承来的 seq 不算自有**。 |
| **生命周期** | 独立 Session。`TurnEndReasonMap` 里的 `forked` 表明父的当前回合会以 fork 作为结束原因（实测 spill 文件与 `commands.js` 一致）。 |
| **UI 呈现** | 作为**独立会话**出现在会话列表（`sessionController.list` / `follow`），带 `parentSessionId` lineage；标题加 fork 序号（`client.js:3061-3064`）。 |
| **消耗归属** | 归**子会话**。token 计量按 session 折叠（`ctx.tokenMeter.measure(session, requestHeader?)`，实测 spill 文件 `tokenMeter` 段），fork 后的 token 计在子会话账上；但**fork 的种子前缀本身会复制一份上下文占用**到子会话（即同一批 token 在两个会话里各算一次）。 |

### 6.3 与子代理侧 `fork` 的区别（别混）

`<PKG>\dsh-subagent-fork-in-process\lib\types\index.d.ts:1-19`：providerName 默认 `'fork'` 的 **SubagentProvider**，子 Agent 以父会话日志前缀为 **seed**。这是「子代理继承父上下文」，与会话级 fork 的「把一个前缀复制成新会话」目的与生命周期都不同（前者随 run 处置，后者是持久会话）。

> **对插件可调用性**：`ctx.sessionController.fork({ sessionId, atSeq })` 是 Host Remote（浏览器侧调用面），宿主侧插件直接调 `ctx.sessionQuery` / 会话服务更自然（`resolveAgent`、`readSession` 等，见实测 spill 文件 `sessionQuery` 段：`observeSession / searchSessions / searchEvents / listSessions / readSession / filterSessions`）。**fork 不是「丢弃执行单元」的工具**——它复制而非丢弃。

---

## 7. `sessionController.prompt`

### 7.1 签名与参数

运行时实测（spill 文件 `:1084`）：

```
"@Remote('prompt') prompt(request: SessionPromptRequest, signal: AbortSignal): Promise<SessionPromptValue>"
```

类型（`<PKG>\dsh-api-session-controller\lib\types\types.d.ts:318-331`）：

```ts
SessionPromptRequest {
  requestId: SessionRequestId;
  sessionId: SessionId;
  mode: 'queue' | 'steer';
  content: readonly PromptContentPart[];
  clientTimeZone?: string;
}
SessionPromptValue { accepted: true }
```

客户端契约文档（`<PKG>\dsh-api-session-controller\lib\types\client\contract\session.d.ts:75-82`，逐字）：

> mode - `'queue'` appends a turn; `'steer'` interrupts the running one

### 7.2 限制

1. **返回只有 `accepted: true`**——不返回 message id，也不等待回合结束。它是「投递收据」，不是同步调用。
2. **必然唤醒 Agent**——这是它的目的（用户 prompt 入口）。它是 `agent.inject`（不唤醒）的对照面。
3. **有 `requestId` 要求**（`SessionRequestId`），服务端据此做幂等/去重与附件绑定；重复 requestId 的行为**未在本次调研中确证** → 附录 A。
4. 附件走另一条 API：`fileUploads.bindPrompt(agent, receiptIds, requestId)` / `retirePrompt(agent, requestId)`（实测 spill 文件 `fileUploads` 段）。
5. 同族方法（实测 `sessionController` 段）：`resolveAgent / inspect / list / search / create / selectModel / initializeDefaultModel / modelCatalog / canOpenWorkspacePath / workspaceDesktop / openWorkspacePath / workspacePathApplications / rename / fork / prompt / attachment / updateQueue / cancel / page / follow / projections / control`。`cancel(request: SessionCancelRequest): SessionCancelValue` 是唯一能撤销排队/steering 工作的入口。

> **对「不回注」需求的相关性**：`prompt` 是**反向**工具（把外部内容灌进会话并唤醒）。唯一有用的形态是「把副作用限制在 UI/日志层面」——但 record 类事件本来就该用 `Session.append` 的 log-only 事件，无需 prompt。

---

## 8. 一次性执行单元（能否不回注）——本次调研核心

### 8.1 答案：能。原语是 `ctx.llm.stream()`

`<PKG>\dsh-llm\lib\types\index.d.ts`：

```ts
export declare class LlmRuntime extends TypertRemoteService {      // :236
    listProviders(): LlmProviderInfo[]                             // :272
    listModels(provider: string): Promise<LlmModelInfo[]>          // :350
    imageRequestPricing(provider, model): LlmImageRequestPricing | undefined  // :333
    prepareCall? / registerAdapter... (见 :253 起)
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;   // :412 (LlmRuntime 本体)
}
```

模块头（该文件 `:2-3`，逐字）：

> LLM service: adapter registry with a **waterfall-interceptable streaming call API**. Exports the `LlmRuntime` default, the abstract `LlmAdapter` …

瀑布（`:34-45`）：

```ts
'llm/stream'(this: LlmRuntime, options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>;
```

`GenerateOptions`（`<PKG>\dsh-llm\lib\types\types.d.ts:489-531`）关键字段：

| 字段 | 行 | 说明 |
|---|---|---|
| `provider` / `model` | `:490-492` | 路由 |
| `reasoningEffort?` | `:494` | 适配器自有的推理档位 |
| `messages: RequestMessage[]` | `:501` | 「**a hand-built one-shot may include identity-free user inputs**」——明确承认手工一次性调用 |
| `system?` | `:506` | 「System prompt text for **one-shot callers**」 |
| `tools?` / `toolHistory?` | `:508-510` | 工具 schema |
| `temperature?` / `maxTokens?` / `stop?` / `signal?` | `:511-519` | 常规生成参数 |
| `sessionId?` | `:524` | 「Session identity stamped by the loop for request routing. Replay uses it to separate cursors」——**可选**；不传即不挂会话 |
| `purpose?: 'compaction' \| 'session-title'` | `:530` | 「Provider-neutral classification for an auxiliary model call … **Ordinary conversation requests leave it unset**」 |

**语义结论（逐条）**：

1. `ctx.llm.stream()` **只做一次模型调用**，没有 Session 参数、不写 Session、不产生 surface 事件、不产生 message、不碰 inbox。
2. 唯一的「副作用」是：适配器层可有自己的日志；`llm/stream` 瀑布的监听者能看到请求（这是插件的扩展点，也是审计点）。
3. 既然是 `AsyncIterable<StreamChunk>`，插件**自己消费完即丢**——这就是「跑完就丢」的完整实现。
4. `purpose` 字段是**官方的旁路调用标注位**，取值恰为 `'compaction' | 'session-title'` 两个已存在的辅助用途。

### 8.2 官方先例一：`dsh-compaction-basic` 的摘要调用

`<PKG>\dsh-compaction-basic\lib\types\index.d.ts:39-49`（逐字）：

> Summarize the replayed conversation region through a **direct one-shot `ctx.llm.stream()` call** whose prefix reuses the conversation's own system prompt, tools, and messages so the provider's KV cache is not invalidated.

`<PKG>\dsh-compaction-basic\lib\types\summarizer.d.ts:46-56`：`summarizeWithLlm(ctx, config, input, agent, signal): Promise<SummaryResult>`，「replay the conversation prefix, then append the compaction instruction as the final user message so the provider's warm prefix cache is reused」。

`SummaryResult`（同文件 `:27-44`）用判别联合区分「是否经由 LLM 接缝」：

```ts
type SummaryResult = { summary: ContentBlock[]; provider; model; maxTokens?; usage? } & (
  { rawOutput: ContentBlock[]; llmStreamCall: true }      // 走了 ctx.llm.stream()
| { rawOutput?: ContentBlock[]; llmStreamCall?: never }   // 模板/远端等未标注实现
);
```

**关键**：这次调用的产出**不自动进会话**。它只在 `compaction/summary` 事件里被记为 `summary` / `rawOutput`，并且该事件是 **log-only**。进模型上下文的是紧随其后的 `user/message(replace)`。

> 这构成「用旁路调用产生内容 → 只把一份受控摘要写进 surface → 原始推理内容永不进上下文」的**官方范式**。

### 8.3 官方先例二：会话标题的旁路调用

`<PKG>\dsh-session-title-llm\lib\types\index.d.ts`：

```ts
export declare function generateSessionTitleWithLlm(...): Promise<SessionTitleProviderResult>   // :101

declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        /** Log-only pre-dispatch record of one session-title model request. */
        'session/title-llm-request': SessionTitleLlmRequestEventData;    // :37-38
    }
}

export interface SessionTitleLlmRequestEventData {   // :21-34
    readonly titleProvider: SessionTitleProviderId;
    readonly messageSeqs: SessionSeq[];   // 请求中代表的确切 human user/message seqs
    readonly route: SessionTitleModelIdentity;
    readonly system: string;
    readonly messages: Message[];
    readonly maxTokens: number;
}
```

**这是「一次性、可丢弃、只在日志留痕」的最精确官方案例**：标题生成的**请求**被记为一条 **log-only** 事件（`session/title-llm-request`），**响应文本不进会话消息流**——它只成为会话标题元数据。其 `MessageSourceMap` 扩展（`:9-14`）用 `ContextFormed` 标注该消息来源。

相关包：`<PKG>\dsh-session-title`（标题服务本体）、`<PKG>\dsh-session-title-first-prompt-llm`（基于首个 prompt 的模型实现，`Config = SessionTitleLlmConfig`，`:4-8`）。

### 8.4 对照：三种执行单元的「进上下文」矩阵

| 执行方式 | 是否产生 message | 是否进模型上下文 | 是否进会话日志 | 是否唤醒 Agent | UI 留痕 |
|---|---|---|---|---|---|
| `ctx.llm.stream()` | 否 | **否** | 否（除非插件自己 append log-only 事件） | 否 | 需插件自建（日志事件或 client 侧） |
| `ctx.subagents.start()`（不取结果） | 否 | **否** | 否（父会话零写入） | 否 | 子会话独立呈现 |
| `ctx.subagents.start()`（把结果作为工具结果返回） | 是（tool result + assistant 消息） | 是 | 是 | 已唤醒 | 是 |
| `agent.inject(msg)` | 是（领取后成为 `user/message`） | **是** | 是（inbox 事件） | 否（除非后续被唤醒） | 是 |
| `sessionController.prompt(...)` | 是 | 是 | 是 | **是** | 是 |

### 8.5 「只在 UI 留痕」怎么做

本体没有「UI-only 事件」这一概念——**能持久记录的东西都在 Session 日志里**，而日志是模型的权威来源。三条可行路径：

1. **log-only 事件**：`Session.append('你的自定义事件类型', data)`（`<PKG>\dsh-session\lib\types\index.d.ts:246`）。**非 `SurfaceEventType` 的事件不承载 surface 元数据、不进入 derived history**（`<PKG>\dsh-session\lib\types\types.d.ts:442,508-511`），因此「写进日志但模型看不见」是**本体一等能力**。官方 `session/title-llm-request` 就是范例。
   - 注意：自定义事件类型要能过**发布版 reader 的成员白名单**（ACP 在 issue #141 上被这条卡过，见 5.3），否则旧会话升级后会加载失败。
2. **surface replace 遮蔽**：先 append 一条 `user/message`（UI 可见），再立刻用 `replace` 把它自己遮蔽（模型不可见）。**声明 `sourceEventSeqs` 时必须覆盖被遮蔽节点**（4.2 的硬门）。
3. **纯 client 侧**：`dsh.client` half（client 插件）可以有自己独立的呈现，与 Session 日志无关。

---

## 9. 上下文预算与裁剪

本章覆盖两条独立的预算线：**§9.1–9.4 = 会话级上下文预算**（自动压缩阈值、token meter、部署归属）；**§9.5–9.9 = 单条工具结果的大小裁剪**（字符级 pruner 与 token 级 spill，含落盘路径机制）。

### 9.1 本体自带：`dsh-compaction-basic`

`<PKG>\dsh-compaction-basic\lib\types\types.d.ts` 的 `CompactionPolicyConfig`（`:8-27`，附默认值）：

| 配置 | 默认 | 含义 |
|---|---|---|
| `thresholdRatio` | **0.8** | 压力触发的窗口占比；上限为「窗口 − 输出预留 − `headroomTokens`」 |
| `headroomTokens` | **65536** | 在路由输出预留之外追加的压力余量 |
| `retainRatio` | **0.16** | 保留的近期上下文（占「窗口 − 输出预留」的比例）；与 `retainTokens` 互斥 |
| `retainTokens` | — | 绝对近期预算（与 `retainRatio` 互斥） |
| `summarizationProvider` / `summarizationModel` | 继承会话路由 | 摘要用路由 |
| `maxTokens` | 取解析后的 `headroomTokens` | 摘要生成上限 |
| `compactionRetries` | **1** | 压力仍在阈值之上时的额外尝试 |
| `maxOverflowRetries` | **1** | provider 确认超窗后的最大恢复次数；`0` 关闭 |
| `modelPolicies` | — | 精确 provider/model 覆盖；重复目标在插件加载期失败 |
| `auto` | **true** | 开自动 step-boundary 压力与 overflow 恢复监听 |

`<PKG>\dsh-compaction-basic\lib\types\index.d.ts:24-31`：`BasicCompactionEngine extends CompactionEngine`，`inject`/`Config` 静态字段；`summarize()`（`:49`）是**唯一的子类定制钩子**；`regionDependencies()`（`:81`）绑定有效 token meter 与动态派发的 summarizer。

### 9.2 宿主平面的压缩服务归属（本机实际部署）

**重要运行事实**：`dsh-web-app` 在**宿主平面把压缩服务全部 disable**，改由**每个预设在自己的 `isolate: { compaction: true }` realm 内私有挂载**。

`<PKG>\dsh-web-app\cordis.patch.yml:509-516`（逐字）：

```yaml
- id: compaction-basic
  disabled: true

- id: command-compact
  disabled: true

- id: tool-result-pruner
  disabled: true
```

其上方注释（`:502-507`）说明 **token METER 留在宿主平面**（它拥有 context-meter 投影单位，那张表是进程级的；若归预设所有，meter 会变成「挂了哪些预设」的函数）。同文件 `:518-520` 注释：**子代理注册表及其后端留在宿主平面**（`subagents` 是进程单例，带跨会话查询面 `listChildren` / `followup`，由 host api-proxy 提供给浏览器）。

本地 `desktop` profile 的覆写（`C:\Users\KEI.NEO\.dsh\profiles\desktop\cordis.patch.yml`，`preset-cordis` 段）里，`compaction` 组仍是三件套：

```yaml
- id: compaction
  name: cordis:group
  group: true
  isolate:
    compaction: true
    toolResultPruner: true
  config:
    - id: compaction-basic
      name: '@deepseek-ai/dsh-compaction-basic'
    - id: command-compact
      name: '@deepseek-ai/dsh-command-compact'
    - id: tool-result-pruner
      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
      config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 }
```

**对插件的含义（关键）**：`ctx.compaction` 是**realm 级服务**。宿主平面读不到预设 realm 内的实例——`ctx.get('compaction')` 恒为 `undefined`。第三方要成为压缩后端，必须在**同一个 `isolate:{compaction:true}` realm 内**（或自己抢占宿主平面那一份，但那需要先禁用预设内的同名行）。

- `<PKG>\dsh-compaction\lib\types\index.d.ts:69` 的模块文档「Load one implementation per context」正是这条约束。
- 相关部署注释（`desktop\cordis.patch.yml`，逐字）：
  > dsh-web-app 在宿主平面把 compaction-basic / command-compact / tool-result-pruner 全部置为 disabled，压缩服务改为由每个预设在自己的 `isolate:{compaction:true}` realm 内私有挂载。cordis 的隔离严格向下，宿主平面的 smart-compaction 副本读不到该服务（`ctx.get("compaction")` 恒为 undefined），只有挂在同一 realm 内的兄弟副本才行。

### 9.3 第三方：`billion-context-dsh`（ACP）

**它做了什么**：把 Active Context Pruning 引擎做成一个 `CompactionEngine` 后端，**挂在宿主平面**，从而对 profile 的**所有预设模式**生效。包描述逐字（`package.json:4`）：

> Active Context Pruning (ACP) for the DeepSeek Harness — model-driven context management as a CompactionEngine backend.

**它怎么做到（关键设计）**——`billion-context-dsh\dist\index.d.ts:1-27`：

- 模型**自己决定**何时压、压什么（纯 ACP 语义）：`compress` 工具让**模型写摘要**并由工具落成持久 surface 替换，**不做第二次 LLM 摘要调用**（ACP 的成本收益）；
- 原文事件留在 append-only 日志，所以 `decompress` / `search_context` / 回放**永远可用**；
- **引用用 surface seq**，由注入的 nudge 的范围表携带——文档明写：**「DSH has no in-memory message rewrite hook」**（`dist\nudge.d.ts:1-6`）——所以模型只能按 surface seq 指定区间，而不是像上游 Pi 那样用 `<acp>` 标签；
- **自动策略从不自己摘要：它只 nudge 模型**。

`AcpCompactionEngine extends CompactionEngine`（`dist\index.d.ts:143`），三个接缝方法的选择是本次调研最有启发的一点：

```ts
/** ACP is model-driven: automatic pressure policy never summarizes by itself. */
compactIfNeeded(_agent, _trigger, signal): Promise<CompactionResult | null> { … }   // :263-264 → 恒 null
/** Explicit idle-session compaction: ACP leaves the decision to the model. */
compactNow(_agent, signal): Promise<CompactionResult | null> { … }                    // :265-266 → 恒 null
/** The model-driven path lands through the `compress` tool… */
compactRegion(_start, _end, _agent, signal): Promise<CompactionResult> { … }          // :267-272 → 拒绝并给指引
```

即：**把接缝的三个口全部堵死，改由模型工具驱动**。这是「官方接缝足够宽，允许一个完全不摘要的实现」的直接证明。

其配置面（`dist\index.d.ts:50-136`，节选与默认值）：

| 配置 | 默认 | 备注 |
|---|---|---|
| `modelContextLimit?` | 自动探测 | 显式值优先并禁用两条自动路径 |
| `autoModelContextLimit` | `true` | 宿主投影 `contextPressure.contextWindow` 优先，其次 `agent.ctx.llm.resolveModelInfo` 探测 |
| `nudgeMinContextLimitPct?` | kernel 0.45（仅校验用） | 「the growth-driven trigger has no percentage floor」 |
| `nudgeMaxContextLimitPct?` | **engine 0.70**（kernel/pi 0.75） | 刻意低于宿主 compaction-basic 的 0.80，保证强制 nudge 先触发 |
| `nudgeEmergencyThresholdPct?` | **engine 0.85**（kernel/pi 0.95） | 绕过每轮去重，但每 user turn 上限 `EMERGENCY_NUDGE_MAX_PER_TURN = 3` |
| `preset?` | — | `'preserve' \| 'relaxed' \| 'balanced' \| 'efficient' \| 'aggressive'`；只填未显式设置的阈值，未知名构造期报错 |
| `coreOverrides?` | — | 任意 acp-kernel `Config` 覆盖；合并顺序：kernel 默认 → 顶层 pct → `coreOverrides` 最后落地 |
| `countTokens?` | kernel `defaultCountTokens`（CJK 1 字 = 1 token，其他 4 字 = 1 token） | 只影响 kernel 内部估算；`sessionProjections` 的 `projectedTokens` 是 provider 锚定的，不受影响 |
| `autoTools` / `autoCommand` / `autoNudge` | 全 `true` | 四个模型工具 / `/acp-prune` / pre-step nudge |
| `maxOverflowRetries?` | `1` | 超窗救援预算；有进展（落 assistant 消息）或回 idle 即重置 |
| `settingsEnabled?` | 启用 | 组合层专用逃生口 |
| `prompts?` | — | 分槽位模板覆盖（nudge / 范围表 / system prompt / 工具描述），构造期校验占位符 |

窗口解析的工程细节（`dist\index.d.ts:207-250`）：自动路径下会把**适配器每请求输出上限**从窗口里**减掉**，得到「可持续输入预算」；文档给的理由是「96K 窗口 + 16K 上限实际最多承载 80K 输入，裸窗口分母会把用量低估 cap/window（≈17%，小窗口模型更差）」。

**kernel 与本地的关系**：真正的引擎在 devDep `acp-kernel@0.0.101`（`package.json:70`），**不在本机**。`config.d.ts` 说明 kernel 默认值是 nudge 窗口 45%–75%、emergency 95%、增长比 5%、保护最近 5 条消息；引擎自身把两个 nudge 阈值改成 0.70/0.85（`dist\config.d.ts:1-13`）。

**它自己声明的边界（对第三方插件极有参考价值）**：

- `acp_rule`（永久规则层）**尚未移植**：上游有第五个工具在对话中途登记「能穿越压缩」的原则级提醒；kernel 0.0.101 的 API 已齐（`RULE_TOOL_NAME` / `addRule` / `removeRule` / `clearRules` / `formatRulesForPrompt` / `formatRulesList` / `resolveRuleLimits`），但本地适配层未接线（README.md:222）。
- 摘要标源：每条压缩摘要在写入时前置 `[Model-written summary — not user words; re-verify any obligations before relying on them]`，同时写进持久化摘要事件与 checkpoint 节点（README.md:220）。目的：**阻止模型把摘要里的义务句当成用户原话执行**。
- 受保护行（不可压缩）：`guardedSurfaceSeqsOf(session)`（`dist\region.d.ts:315-340`）= 每个 scope 的**最新** AGENTS.md 注入行 + 最新**真实**用户回合。理由逐字：宿主在**当前副本从 surface 消失时**会无条件重新注入（存在性闸门，非载荷 diff），所以压最新副本纯属浪费 token；而技能目录行**不会**被重新发送（重发闸门是目录摘要，遮蔽可见行不改变摘要），所以压它会丢失技能发现能力直到目录真的变化。

### 9.4 本机部署的裁剪参数快照

官方 base 层（`<PKG>\dsh\node_modules\@deepseek-ai\dsh-base\cordis.patch.yml`）：

```yaml
404:    - id: spill-local
405:      name: '@deepseek-ai/dsh-spill-local'
407:    - id: spill-policy
408:      name: '@deepseek-ai/dsh-spill-policy'
410:        maxInlineTokens: 12500
418:    - id: tool-result-pruner
419:      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
421:        thresholdChars: 8192
422:        headChars: 4096
423:        tailChars: 1024
427:    - id: image-offload
428:      name: '@deepseek-ai/dsh-compaction-image-offload'
```

`image-offload` 的作用（同处注释 `:425-426`）：当图像路由以「超过图像预算」拒绝请求时，把最旧的图像在 surface 上换成占位符并重试。

---

### 9.5 工具结果裁剪第一级：`tool-result-pruner`（按字符，不落盘）

两级机制，按不同单位裁剪，先给全景对照：

| | `tool-result-pruner` | `spill-policy` |
|---|---|---|
| 单位 | **Unicode 码点（字符）** | **估算 token** |
| 默认阈值 | `thresholdChars: 8192`，保 `headChars: 4096` + `tailChars: 1024` | `maxInlineTokens: 12500` |
| 是否落盘 | **不落盘**（纯内存裁剪） | **落盘**，给 locator 路径 |
| 触发点 | surface 级重写（`pruneSession`） | `tools/post-execute` 钩子 |
| 机制 | 位置替换（surface replace） | 保留 head+tail，中间换成缺口+提示 |
| 原文可恢复 | 是（被遮蔽节点仍在日志，`PrunedEntry.originalSeq`） | 是（完整内容在 spill 文件里） |

字符级 pruner 的配置与 API：

`<PKG>\dsh-compaction-tool-result-pruner\lib\types\types.d.ts:5-13`：

```ts
export interface ToolResultPruneConfig {
    thresholdChars?: number;   // 超过这么多 Unicode 码点就裁剪；默认 8192
    headChars?: number;        // 保留的头部最大码点数；默认 4096
    tailChars?: number;        // 保留的尾部最大码点数；默认 1024
}
```

`ResolvedConfig` 为三者只读（`:14-19`）。

`<PKG>\dsh-compaction-tool-result-pruner\lib\types\config.d.ts`：

```ts
export declare const PRUNE_MARKER = "\n\n[... tool result middle pruned ...]\n\n";
export declare const DEFAULTS: ResolvedConfig;
export declare function codePointLength(text: string): number;
```

服务面（`lib\types\index.d.ts:18-52`）：

```ts
export declare class ToolResultPruner extends Service {
    readonly config: ResolvedConfig;
    measureContent(blocks: readonly ContentBlock[]): number;        // :30 文本块码点数，非文本块计 0
    pruneContent(blocks: readonly ContentBlock[]): ContentBlock[] | null;   // :38 超预算则替换中段；否则 null
    pruneSession(session: Session): PruneResult;                    // :51
}
```

`pruneSession` 的语义（`:39-50` 文档，逐字要点）：从**一份稳定的当前 surface 快照**里裁剪每一个超预算的工具结果；**每次替换保留完整事件数据（只有 `content` 变了），引用被遮蔽节点以便回放能恢复替换输入**；并且**紧接在它前面会写一条 `compaction/prune` 影子价格事件**（经注入的 token meter 计价被遮蔽节点），使纯消费者无需逐节点状态即可扣减。返回 `PruneResult{ pruned: PrunedEntry[], charsRemoved }`，`PrunedEntry{ originalSeq, replacementSeq, callId, charsBefore, charsAfter }`（`types.d.ts:28-53`）。

裁剪按**码点**而非 UTF-16 码元，因此保留边界不会切断代理对；**字素簇仍可能被切断**（`:33-35`）。

### 9.6 `spill-policy`：超长工具结果落盘并给路径

服务定义 `<PKG>\dsh-spill\lib\types\index.d.ts`（51 行）：

```ts
ctx.spillStore: SpillStore                       // :20-24
export declare abstract class SpillStore extends Service {   // :41-49
    abstract saveText(input: SaveTextSpill): Promise<SpillRef>;   // :48
}
```

模块文档（`lib\types\index.d.ts:1-51` 内）明确职责边界，逐字要点：

- `saveText` **原样持久化完整内容**；
- 存储以**请求方的 owner session** 为界；
- 后端选择**私有（非 worldwide-readable）**位置与**不冲突的名字**，名字**由 `suggestedName` 派生但绝不等于它**；
- `saveText` **在真实存储失败时 reject**，由调用方决定如何降级（spill policy 把 rejection 当作 best-effort 并保留 inline 结果）；
- **它不拥有**保留策略（那是 `@deepseek-ai/dsh-output-retention`）、**不做**工具结果替换（那是 `@deepseek-ai/dsh-spill-policy`）、**没有**检索/搜索 API。

数据结构 `<PKG>\dsh-spill\lib\types\types.d.ts`（72 行）：

```ts
SpillLocator            // :16 品牌化不透明字符串（本地后端可能是文件路径）
SpillOwner { sessionId }   // :31-33；文档：fork 出来的会话「继承已存在于种子日志中的 locator；那些产物不被复制也不被重新拥有」
SpillSource = { kind:'tool', toolName, callId, label }
            | { kind:'session-reference', sessionId, label }   // :39-53
SaveTextSpill { owner, source, suggestedName, content }        // :55-65
SpillRef { locator, bytes, retrievalHint }                     // :67-71
```

策略插件 `<PKG>\dsh-spill-policy\lib\types\index.d.ts:12-20`：

```ts
name = 'spill-policy'; inject = ['tools'];
Config { maxInlineTokens?: number }   // 省略即完全禁用保留
```

算法在 `<PKG>\dsh-spill-policy\lib\index.js`（262 行），**逐字常量**：

- 通知模板（`:7-26`）：`(${describeOmitted(omitted,'bytes')}${imageNotice}${' Full formatted result stored at: '}${ref.locator}${'. '}${ref.retrievalHint})`，其中 `imageNotice = ' Omitted N images.'`；
- `apply`（`:141`）：`const cap = config.maxInlineTokens; if (cap === void 0) return;`——即**配置省略即彻底关闭**；
- 钩子 `tools/post-execute`（`:237-255`，`{prepend:true}`）；**跳过 `exec.name === 'read'`**（`:239`），并跳过 `exec.parent !== void 0 && !hasImages` 的 PTC 子调用（`:242`）；
- 保留算法 `retainContent`（`:62-120`）：head 取 `ceil(budget/2)`、tail 取 `floor(budget/2)`；**图像永不部分保留**（整块留或整块丢）；`fitText`（`:39-52`）二分找最大可容纳文本；`textSlice`（`:31-37`）**绝不在 UTF-16 代理对之间切**；
- 缺口文字 `'\n\n[...]\n\n'`（`:132-135`）；
- 预算不足时抛 `spill notice for X exceeds maxInlineTokens`（`:213`）；总价 ≤ maxTokens 时不落盘（`:184`）；
- 没有 `ctx.spillStore` 时抛 `no ctx.spillStore backend loaded`（`:187-188`），但**所有错误都是 best-effort**：记 `spill-policy: <err>; keeping the inline content` 并返回 undefined（`:232-235`）；
- 图像计价需要 `ctx.get('llm').imageRequestPricing(provider, model)`（`:147-166`），没有计算器则抛 `the current model has no image token calculator` 并保留 inline；
- `fullText`（`:168-177`）把每个图像块改写为：

  ```
  \n[Image: "<readonlyPath>"; <mediaType>; <W>x<H>. Use read_image to view it.]\n
  ```
- 第二个钩子 `tools/ptc-dispatch-log`（`:256-259`）也限幅派发日志。

### 9.7 被裁剪后模型看到什么（实测）

**本次会话就发生了一次真实的 spill**：调用 `cordis_inspect_query` 取 Host Service 目录时，返回体在 31541 字节处被截断，工具结果给出的提示是：

```
(Omitted 31541 bytes. Full formatted result stored at:
C:\Users\KEI.NEO\AppData\Local\Temp\dsh-spill-dwrlkG\session-f8d61c6e9336\73604b1227cd-cordis_inspect_query.txt.
Use read with offset/limit, or grep this path to search within it.)
```

——这正是 10.3 的模板运行时形态：**省略字节数 + 完整内容路径 + 检索指引**。后续可用 `read`（带 `offset`/`limit`）或 `grep` 读回。

### 9.8 spill 后端（本地实现）

`<PKG>\dsh-spill-local\lib\types\index.d.ts`（102 行）：

```ts
export interface Config {
    root?: string;              // :21-27 省略则用 OS tmpdir 下懒创建的私有 0700 每进程目录
    cleanupPeriodDays?: number; // :28-38 默认 30；0 完全禁用清理
}
```

- 文件落在 `<root>/session-<hash>/…`，`0600` 独占写、`0700` 私有根（`:43-52`）——文档理由：「a spilled tool result must not be readable by other local users or redirectable via a planted symlink」；
- 激活后跑**一次** best-effort 清理 sweep，回收 mtime 严格早于 cut-off 的文件；fresh 文件、符号链接、无关条目不动；POSIX 上跳过其他本地用户可修改/替换的根与会话目录（`:28-38`）。**保留是刻意的**——被恢复或被 fork 的会话可能仍引用旧 locator，直到它自然过期（`:34-36`）；
- 导出 `DEFAULT_ROOT_PREFIX / encodeSegment / isErrno / privateRoot / saveTextFile / sessionDir / discoverDefaultRoots / sweepSpillRoots`（`:16-19`）；
- **检索指引逐字**（`lib\index.js:566`）：

  ```js
  retrievalHint: "Use read with offset/limit, or grep this path to search within it."
  ```

### 9.9 `dsh-output-retention`：机械保留库（非服务）

`<PKG>\dsh-output-retention\lib\types\index.d.ts`（237 行）。模块文档（`:17-20`）明确：**这是库，不是 cordis 服务或插件**——不接收 `ctx`、不注册任何东西、不发任何事件；两个 retainer 是唯一有状态的部分，状态是**每实例一次累积**，绝不跨调用。

两个保留器差异的**资源模型**（`:22-28`）：

- `ItemRetainer`（`:135-157`）：约束**有序逻辑单元**（路径、grep 命中、搜索来源）；v1 只有 `head` 策略；
- `TextRetainer`（`:170-199`）：约束**面向字节的文本流**（bash stdout/stderr、web 正文）；`head` / `tail` / `headTail`，在 `finish` 时保持 UTF-8 边界。

关键值语义：

- `Omitted = {kind:'none'} | {kind:'exact', count} | {kind:'unknown'}`（`:39-46`）；
- `RetainedText.truncated` 的语义（`:10-15`，逐字要点）：意为「**retainer 因预算而省略了本来可用的内容**」，**不是**「上游不完整」；权限失败、跳过的二进制、provider 部分失败、不可读候选留在工具域字段里，绝不并入 `truncated`；
- `text` 是**字节导向**的，`omittedBytes` 计**字节**（非字符/行）（`:70-79`）；
- `describeOmitted(omitted, unit)`（`:210`）：`exact` 打印数量（`Omitted 3 items`），`unknown` **不打印数量**；
- `formatRetentionNotice(notice, recovery)`（`:224`）：库只拥有标准化省略子句，**恢复话术由工具提供**（只有工具知道动作）；
- `truncateWithoutSplittingSurrogatePair(text, maxChars)`（`:236`）：按 UTF-16 码元封顶且不产生孤立高代理项——理由逐字：「an unpaired surrogate is not well-formed text — a strict JSON reader rejects a durable Session log that carries one」。

`spill-policy` 的 `formatSpillNotice` 正是 `describeOmitted`（unit `'bytes'`）的消费者（见 10.3）。

---

## 10. 对外部插件的可用面（API 速查）

### 10.1 服务

| 服务 | 关键方法 | 证据 |
|---|---|---|
| `ctx.llm` | `stream(options: GenerateOptions): AsyncIterable<StreamChunk>`；`listProviders()`；`listModels(provider)`；`imageRequestPricing(provider, model)`；`registerAdapter(providers, adapter)` | `dsh-llm\lib\types\index.d.ts:412, 253, 272, 350, 333` |
| `ctx.sessionController` | `fork({sessionId, atSeq?})`；`prompt({requestId, sessionId, mode, content, clientTimeZone?})`；`cancel(...)`；`create/list/search/inspect/resolveAgent/page/follow` | 实测 spill 文件 `:1042-1107`；`dsh-api-session-controller\lib\types\types.d.ts:308-331` |
| `ctx.sessionQuery` | `observeSession / searchSessions / searchEvents / listSessions / readSession / filterSessions / traceSession` | 实测 spill 文件 `:1216-1232` |
| `ctx.compaction` | `compactIfNeeded / compactNow / compactRegion`（抽象，需实现） | `dsh-compaction\lib\types\index.d.ts:69,116,137,157` |
| `ctx.subagents` | `start(name, req) / startContinuable(spec) / sendMessage / interrupt / listChildren / listDescendants / prompt(@Remote) / interruptByParent(@Remote) / registerProvider / getProvider / list` | `dsh-subagent\lib\types\index.d.ts:109,142-157`；实测 spill 文件 `subagents` 段 |
| `ctx.spillStore` | `saveText(input): Promise<SpillRef>` | `dsh-spill\lib\types\index.d.ts:48` |
| `ctx.toolResultPruner` | `measureContent / pruneContent / pruneSession(session)` | `dsh-compaction-tool-result-pruner\lib\types\index.d.ts:30,38,51` |
| `ctx.tokenMeter` | `measure(session, requestHeader?) / estimateMessage(message)` | 实测 spill 文件 `tokenMeter` 段 |
| `ctx.sessions` | `create / prepare / enter / announce / flush / registerMessageProjection` | 实测 spill 文件 `:1282-1298` |
| `ctx.sessionPersistence` | `create(header, options?) / …`（逐会话句柄） | 实测 spill 文件 `:1132-1137` |
| `ctx.systemPrompt` | `section / context / tools / variable / suppressRuntimeContext / assemble` | 实测 spill 文件 `systemPrompt` 段 |
| `ctx.tools` | `register / guard / restrict / get / schemas / execute / executionMode` | 实测 spill 文件 `tools` 段 |
| `ctx.agents` | `create(options) / resume(options) / register / get / list / roots / currentInitiator / requireInitiator / withInitiator / withoutInitiator` | 实测 spill 文件 `agents` 段 |

### 10.2 事件（插件可监听/拦截）

| 事件 | 模式 | 行 | 用途 |
|---|---|---|---|
| `agent/pre-step` | waterfall | `dsh-agent\lib\types\runtime-types.d.ts:304-310` | 拒绝或替换本步入场消息（官方 ACP nudge 走这条） |
| `agent/request` | waterfall | `:327-332` | 替换冻结的调用配置；**不可改消息** |
| `agent/turn-stopping` | serial | `:387-391` | 回合收尾 |
| `agent/inbox/inserted` `/claimed` `/discarded` | emit | `:263-266, 277-281, 289-292` | 观察 inbox 生命周期 |
| `agent/status` | — | `billion-context-dsh\dist\index.js:9673` 用法 | idle/running 转换 |
| `agent/request-error` | waterfall | 同上 `:9678` | 超窗恢复（返回 `{kind:'retry'}`） |
| `llm/stream` | waterfall | `dsh-llm\lib\types\index.d.ts:45` | 包住每次流式模型调用（重试/回放/路由） |
| `compaction/start` `/summary` `/end` `/prune` | log-only | `dsh-compaction\lib\types\types.d.ts:21,35,73,88` | 压缩事务观测 |
| `compaction/summary-error` | waterfall | `dsh-compaction\lib\types\index.d.ts:85-90` | 摘要失败 |

### 10.3 类型/原语（可直接写日志）

```ts
// 遮蔽任意 surface 区间（含单节点）
SurfaceOp = 'append' | { op:'replace'; startSeq: SessionSeq; endSeq: SessionSeq }
Session.append<T>(type: T, data: SessionEventMap[T], ...opts: ...): SessionEvent<T>
```

- `<PKG>\dsh-session\lib\types\types.d.ts:458-462`、`:246`；
- 只有 `'system/message' | 'developer/message' | 'user/message' | 'assistant/message' | 'tool/result'` 能承载 surface 元数据（`:442`）；其余事件类型即 **log-only（写日志但模型看不见）**；
- `assistant/message` 禁止 `sourceEventSeqs`（`:469-471`）。

---

## 11. 结论：本需求可用的原语组合

### 11.1 推荐方案 A（首选）：`ctx.llm.stream()` + log-only 事件

```
插件 → ctx.llm.stream({ provider, model, messages: [...], purpose: 'session-title'(或自定义语义) })
      → 自行消费 chunk 流、得到结果
      → 结果存在插件自己的状态里（或返回给调用方）
      → 若需 UI/审计留痕：Session.append('your-plugin/request', {...})   // log-only，模型不可见
```

- **进父上下文？否。** 完全没有 Session 参与（除可选的 `sessionId` 路由标注）。
- **代价**：需要自己组装 `messages`；没有工具调用循环（除非自己实现）；没有 KV 缓存复用（除非自己重放前缀，像 compaction-basic 那样）；计费照常。
- **限制**：`provider`/`model` 必须已注册（否则适配器解析失败）；`purpose` 的合法取值是 `'compaction' | 'session-title'`，自定义语义**没有专用字段**（附录 A）。
- **先例**：`dsh-compaction-basic`（摘要）、`dsh-session-title-llm`（标题，且请求被记为 log-only 事件）。

### 11.2 方案 B：`ctx.subagents.start()` 但**不**把结果交给模型

- **进父上下文？否。** 父会话零写入（`dsh-subagent-in-process-driver\lib\index.js:161-252`）。
- **代价**：子会话独立存在，占用独立 token 与日志；必须有 provider 已注册（如 `spawn` / `fork`）；`maxDepth` 约束（宿主默认 1，本会话即因 depth 2 被拒）。
- **限制**：子代理的「UI 留痕」是**子会话**，不是父会话内联呈现。

### 11.3 方案 C：先可见、后遮蔽（「UI 留痕 + 模型不可见」的同一会话形态）

```
1. session.append('user/message', data, { surfaceOp: 'append' })            // UI 可见
2. session.append('user/message', {content:[{type:'text',text:'(hidden)'}]},
                  { surfaceOp: {op:'replace', startSeq: S, endSeq: S},
                    sourceEventSeqs: [S] })                                 // 模型不可见
```

- **限制**：第 2 步会替换掉第 1 步的可见内容（模型看到的是 `(hidden)` 或你的替换文本，不是原文）。若想让「UI 看到原文、模型看到空」，这条路**做不到**——因为替换节点是 model-only 的，human transcript 只认 append-origin 事件（`surface.d.ts:52-57`）。反过来，UI 看到的是**原文**，模型看到的是**替换文本**，这个方向是成立的（这也是 compaction 的形态）。
- **可恢复**：是（原文在日志里；`sourceEventSeqs` 提供了溯源）。
- **风险**：`sourceEventSeqs` 必须覆盖被遮蔽的全部节点，否则 append 直接抛错（`index.d.ts:231-244`）；在 `session/event` 监听器里同步 append 会**静默失败**（`billion-context-dsh\dist\region.d.ts:274-284`），必须排到 microtask。
- **更简单的等价做法**：直接用**方案 A 的 log-only 事件**——如果你要的只是「审计留痕」，根本不需要产生 surface 事件再遮蔽。

### 11.4 不推荐：`agent.inject` 做「不回注」

它是持久 inbox 条目、进模型上下文、进日志。**唯一正确用途**是「不唤醒 driver 的排队上下文」（例如：等下一次唤醒时顺带交给模型一段背景）。

### 11.5 组合建议（针对「跑完就丢、只在 UI 留痕、绝不进模型上下文」）

1. **执行**：`ctx.llm.stream()`（无工具需求）或 `ctx.subagents.start()`（需要完整 agent 循环 / 工具 / 文件操作）。
2. **留痕**：`Session.append('<plugin-ns>/<event>', …)` 写 log-only 事件——**注意发布版 reader 的成员白名单**（`billion-context-dsh` 在 issue #141 上被这条卡过：白名单外成员会让旧会话日志加载失败）。稳妥做法是把自定义载荷塞进**已存在的可选成员**（如 ACP 塞进 `rawOutput`）。
3. **呈现**：需要富交互才写 client half（`dsh.client`），或监听自己的 log-only 事件在 UI 侧渲染。
4. **绝不要**：把结果 append 成 `user/message`（那必然进模型上下文），或用 `agent.inject`。

---

## 附录 A 未确认事项

以下条目在本次调研中**未能确证**，不得据此写代码：

1. **`agent.inject` 的大小上限与幂等/去重语义**。`<PKG>\dsh-agent\lib\types\runtime-types.d.ts:201-209` 与 `Inbox`（`:41-82`）均未声明长度上限、去重键或幂等保证。文档只说「It may miss a request whose pre-step already claimed its batch」。**未实测**注入超长内容的行为。
2. **`Session.append` 对 `sourceEventSeqs` 的完整性校验细节**。文档称要求「complete shadowed-node coverage」（`dsh-session\lib\types\index.d.ts:236-238`），但**具体是拒绝缺项还是拒绝多项、错误类型/消息文本为何，未读到实现代码**。ACP 的 `region.d.ts:100-116` 从第三方角度描述了同一不变量，但不等价于本体的错误面。
3. **`decompress` 是否存在于任何官方包**。本次在 `<PKG>` 下未找到；但**未做全量 grep 的穷尽搜索**（仅按包名与类型名检索）。`billion-context-dsh` 的 `decompress` 是插件自实现。
4. **`SessionPromptRequest.requestId` 的重复投递行为**（幂等？报错？覆盖？）。类型在 `dsh-api-session-controller\lib\types\types.d.ts:318-331`，语义文档未涵盖。
5. **`GenerateOptions.purpose` 是否接受自定义字符串**。类型上只有 `'compaction' | 'session-title'`（`dsh-llm\lib\types\types.d.ts:530`）。适配器对未知值的处理**未确证**；插件若要自定义辅助调用语义，**没有专用字段**，只能复用这两个值或不填。
6. **`ctx.llm.stream()` 是否在任何适配器里隐含写 Session**。本次只确证了接缝层（`LlmRuntime.stream`）不接收 Session 参数；**未逐一审阅各 provider 适配器实现**（`dsh-llm-deepseek`、`dsh-llm-pi-ai` 等）。`sessionId` 字段的文档说「adapters may map it to model-hidden transport metadata」（`dsh-llm\lib\types\types.d.ts:520-524`），但**是否确实 model-hidden 未实测**。
7. **`acp-kernel` 本体不在本机**。`billion-context-dsh` 的 devDep `acp-kernel@0.0.101`（`package.json:70`）才是真正的 ACP 引擎；本报告对其行为的所有描述都来自**适配层的类型文档与 README**，未经 kernel 源码验证。
8. **实验性 Agent Teams 四个包未审阅**。`C:\Users\KEI.NEO\.dsh\staging-upgrade-20260929\node_modules\@deepseek-ai\` 下的 `dsh-experimental-agent-team` / `-tool-agent-team` / `-client-ui-agent-team` / `-agent-team-profile` 本次**完全未打开**。但注意：本机运行时的宿主平面上已存在 **`agentTeams` 服务**（实测 spill 文件 `agentTeams` 段）：`membership / listMembers / spawnTeammate / sendMessage / createTask / getTask / listTasks / updateTask / waitForChange / interrupt / tryMembership`，描述为「Agent Teams service backed by the exact live Lead Session log」。**该服务归属哪个包、是否即上述实验包、以及其成员产出是否回注 Lead 上下文，均未查证**——如果要在这个轴上继续，这是最该接着看的一块。
9. **`hideCompressToolPair` / `stripOrphanedSurfaceToolMessages` 的边界条件**。仅读了类型文档（`billion-context-dsh\dist\region.d.ts:240-284`），未读实现。
10. **`compaction/summary` 的白名单校验清单本身**（`@deepseek-ai/dsh-session-format-v0-to-v1` 的允许成员列表）。ACP 的注释指认了问题，但**具体白名单未读**，因此「把自定义载荷塞进 `rawOutput` 是否永远安全」只能说有先例，不能说有保证。
11. **`registerMessageProjection` 的用法**。`ctx.sessions.registerMessageProjection(projection)`（实测 spill 文件 `:1282`）与 `SessionMessageProjection` 类型本次未读；它似乎是「插件自有消息变更」的官方通道（对应 `SessionSurface.contentGeneration` 文档里的「plugin-owned message changes」），**很可能是比 surface replace 更合适的「改写模型可见消息」的原语**，但语义未确证。
12. **本文所有「实测」若来自 `desktop` profile 的运行时**：注意本会话实际协议栈是 `desktop` profile 的 `preset-cordis` 覆写层，与该 profile 的 `web` 副本存在同步关系但**不保证等价**；`billion-context-dsh` 是**web profile 下安装**的第三方插件（`C:\Users\KEI.NEO\.dsh\profiles\web\node_modules\billion-context-dsh\`），在 desktop profile 是否同样挂载**未经运行验证**。
