# DSH 插件宿主 API 表面技术底稿（agent-team 类插件可行性依据）

- **目标版本**：DSH `0.2.0-rc.2`
- **运行时**：`C:\Users\KEI.NEO\AppData\Local\Programs\DeepSeek Harness\resources\runtime`
- **官方包根目录**（本稿所有 `文件:行号` 的相对基准）：
  `C:\Users\KEI.NEO\.dsh\profiles\node_modules\@deepseek-ai\`
  下称 `<PKG>`，例：`<PKG>\dsh-subagent\lib\types\index.d.ts`
- **当前会话 profile**：`desktop`（`C:\Users\KEI.NEO\.dsh\profiles\desktop\node_modules\@deepseek-ai\` 只有 `cosmokit / dsh-toolkit / schemastery` 三个目录，**官方核心包不在 profile 里，而在 `profiles\node_modules\@deepseek-ai\`**）
- **app.asar 路径不可直读**：`resources\app.asar\dsh` 经 `Test-Path` 判定为 `False`（asar 是打包容器，不是目录）。可读的未打包目录只有 `resources\app.asar.unpacked\dsh\node_modules\@deepseek-ai\`，其中仅 `dsh-desktop-host`、`dsh-session-log-export`、`libreoffice-kit*`。
- 默认包数量：`<PKG>` 下共 **249** 个目录（含 cordis 家族与全部官方插件）。

---

## 0. 阅读约定与可信度标注

| 标注 | 含义 |
| --- | --- |
| **[实测]** | 由 `cordis_inspect_*` 在**当前运行进程**里读到的真实结构 |
| **[类型]** | 来自已安装 `.d.ts`，有 `文件:行号` 证据 |
| **[未知]** | 未能确认，禁止当作事实使用 |

**本轮无法完成的检查**：`client` platform 的全部 Inspect 查询（`Service.listService` / `Slots.listSubTree` / `Theme.listTokens`）**全部超时**（`Client inspect query ... timed out after 10000ms. Open or reconnect the Harness page, then retry.`）。原因是没有活跃的 Harness 页面连接。因此第 4 节（UI）的 Slot 树与主题 token **全部由 `.d.ts` 与产物文件导出**，而非运行时实测。**这是本稿最大的证据缺口**，建议在页面打开时重跑 `cordis_inspect_query(client, Slots, listSubTree)` 与 `(client, Theme, listTokens)` 交叉验证。

---

## 1. Inspect Provider 盘点 [实测]

### 1.1 Provider 清单（`cordis_inspect_list`）

| platform | id | 用途 | method |
| --- | --- | --- | --- |
| host | `Service` | 渐进式 Host Service 发现：先给紧凑能力/签名目录，再给单个精确契约 | `listService` |
| host | `Event` | 渐进式 Host Event 发现：先给监听器目录，再给单个事件契约 | `listEvents` |
| host | `Config` | 活体插件 Config 发现：分页条目目录（带 schema 状态），再给单条 JSON Schema | `listConfigs` |
| host | `Tool` | 当前 Agent 可调用的全部 Tool schema（含 scoped 与动态注册） | `listTools` |
| client | `Service` | 客户端 Service 发现（同 host 语义） | `listService` |
| client | `Event` | 客户端 Event 发现 | `listEvents` |
| client | `Builtin` | 动态 Client half 可用的纯 JS 符号 | `listBuiltins` |
| client | `Slots` | 活体 Slot 检查，含显式 Slot 与 Factory 拓扑节点 | `listSubTree` |
| client | `Theme` | 当前主题 token 名与 light/dark 覆盖要求 | `listTokens` |

要点：**host 侧没有独立的「Slots」或「Theme」provider**——UI 注入面只存在于 client platform。插件要做 UI，必须先建立 client half（见 §4.3）。

### 1.2 host `Service.listService` 的关键结构 [实测]

返回 `{ mode: 'catalog', services: [{ key, description, methods: [{ signature }] }] }`。
**host 侧共 91 个 Service key**（完整清单）：

```
agentDefaultModel, agentLoop, agentPresets, agents, agentTeams, approval, attachments,
authorization, browserUse, clientModules, commands, compaction, computerUse, configEditor,
connection, credentials, credentialsController, deepseekAccount, deepseekLlmApiExtensions,
directoryPicker, directoryPickerController, fileReferences, fileUploads, fs, goals, hmr,
inspector, invariants, jobController, jobs, llm, lsp, mcpResources, messageFeedback,
officeToPdf, otel, permissionPresets, planMode, pluginManager, pluginRegistryProbe,
productAnalytics, productTelemetry, profileContext, ptcRuntime, sandbox, sandboxPolicy,
schedule, sessionController, sessionFeedback, sessionFileReferences, sessionPersistence,
sessionProjectionCache, sessionProjections, sessionQuery, sessionReferenceResolver,
sessions, sessionSkillCatalog, sessionTelemetry, sessionTitle, settings,
settingsController, shell, shellEnv, skills, speechController, speechToText, spillStore,
ssh, storage, storageDomain, subagentModelSelection, subagents, subprocess, systemPrompt,
terminalController, terminals, timer, tokenMeter, toolResultPruner, tools, typert,
typertGateway, userQuestions, web, webhookRuntime, webServer, workflowEngine,
workspaceChanges, workspaceController, workspaceFiles, workspaceRegistry
```

**对 agent-team 插件直接相关的 12 个**（签名摘录，均来自 [实测] catalog）：

```ts
// ctx.agents —— 活体 Agent 注册表 + 进程内 initiator 链
currentInitiator(): Agent | undefined
requireInitiator(): Agent
withInitiator<T>(agent: Agent, operation: () => T): T
withoutInitiator<T>(operation: () => T): T
setFactory(factory: AgentFactory): () => void
create(options: CreateAgentOptions): Promise<AgentHandle>
resume(options: ResumeAgentOptions): Promise<AgentHandle>
register(agent: Agent): ReturnType<Context['effect']>
enter(agent: Agent, owner: Agent | undefined): () => void
announce(agent: Agent, source: SessionStartSource, signal?: AbortSignal): Promise<void>
get(id: SessionId): Agent | undefined
isOwnedBy(id: SessionId, owner: Agent): boolean
list(): Agent[]
roots(): Agent[]

// ctx.subagents —— 命名 provider 注册表（子代理能力缝）
resolveMaxDepth(configured?: number | 'provider-managed'): number | undefined
startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart>
sendMessage(sender: Agent, targetId: SessionId, content: ContentBlock[],
            options: SubagentSendMessageOptions): Promise<MessageId>
interrupt(targetSessionId: SessionId, authority: SubagentInterruptAuthority): void
drainContinuableDescendants(parents: readonly Agent[]): Promise<void>
drainContinuableChildren(parent: Agent, childIds: readonly SessionId[]): Promise<void>
listChildren(parentSessionId: SessionId, signal?: AbortSignal): Promise<SubagentCatalogEntry[]>
listDescendants(rootSessionId: SessionId, signal?: AbortSignal): Promise<SubagentDescendantListEntry[]>
@Remote('prompt') prompt(request: SubagentPromptRequest, signal: AbortSignal): Promise<SubagentPromptReceipt>
@Remote('interruptByParent') interruptByParent(childSessionId: SessionId,
    parentSessionId: SessionId, mode: 'continuable'): SubagentInterruptReceipt
registerProvider(provider: SubagentProvider): () => void
getProvider(name: string): SubagentProvider | undefined
list(): string[]
start(name: string, request: SubagentStartRequest): Promise<SubagentRun>

// ctx.agentLoop —— 具体 agent 工厂/驱动器
readonly config: Config
create(id: SessionId, options?: AgentOptions, meta?: Pick<SessionHeader,'cwd'>): Promise<Agent>
createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle>
resume(ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle>

// ctx.tools —— 工具注册表与执行管线
presentAs(mode: ToolPresentationMode): () => void
register(definition: ToolDefinition): () => void
restrict(filter: ToolRestriction): () => void
guard(guard: ToolGuard): () => void
get(name: string, scope?: ScopeKey): ToolDefinition | undefined
schemas(scope?: ScopeKey): ToolSchema[]
executionMode(exec: ToolExecutionInput): ToolExecutionMode
execute(exec: ToolExecutionInput): Promise<ToolExecutionResult>

// ctx.commands —— 人类命令注册表
register(definition: CommandDefinition): () => void
registerFileReceiptResolver(resolver: CommandFileReceiptResolver): () => void
@Remote list(agent: Agent): readonly CommandDescriptor[]
find(agent: Agent, name: string): CommandDefinition | undefined
@Remote execute(agent: Agent, line: string,
    submittedAttachments: readonly CommandSubmitAttachment[],
    signal: AbortSignal): Promise<CommandExecution | undefined>

// ctx.approval —— 会话策略 + answerer + 审计
setPolicy(agent: Agent, policy: ApprovalPolicy): void
request(req: ApprovalRequest): Promise<ApprovalOutcome>
overrideOf(session: Session): ApprovalPolicy | undefined

// ctx.authorization —— 凭据获取流程注册表（一次一个 key）
registerFlow(flow: AuthorizationFlow): () => void
list(): readonly AuthorizationEntry[]
describe(key: CredentialKey): AuthorizationEntry | undefined
cancel(key: CredentialKey): void
begin(request: AuthorizationRequest): Promise<AuthorizationOutcome>

// ctx.storage / ctx.storageDomain —— 持久化
readonly backend: BackendRegistry                       // ctx.storage
mount<K extends keyof StorageForms>(form: K, facility: StorageForms[K]): () => void
form<K extends keyof StorageForms>(form: K): StorageForms[K]
open<S extends DomainSpec>(spec: S): Promise<Domain<S>>  // ctx.storageDomain
get(name: string): DomainImpl | undefined
closeAll(): Promise<void>

// ctx.systemPrompt —— 提示词分节/上下文/变量注册
section(section: PromptSection): () => void
getSectionOrder(name: PromptSectionOrderName): number
getContextOrder(name: PromptContextOrderName): number
context(context: PromptContext): () => void
suppressRuntimeContext(): () => void
tools(provider: (context: AssembleContext) => ToolProviderResult): () => void
variable(name: string, provider: (context: AssembleContext) => string | undefined): () => void
assemble(context: AssembleContext = {}): Promise<PromptAssembly>

// ctx.llm —— 模型路由
listProviders(): LlmProviderInfo[]
listModels(provider: string): Promise<LlmModelInfo[]>
resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>
resolveCallConfig(config: LlmCallConfig, signal?: AbortSignal): Promise<LlmCallConfig>

// ctx.agentDefaultModel / ctx.subagentModelSelection —— 模型选择设定
currentSelection(): ModelSelection                                 // agentDefaultModel
saveSelection(next: ModelSelection): Promise<void>
current(): SubagentModelSelectionSettings                          // subagentModelSelection

// ctx.agentTeams —— 「Agent Teams」服务（本机为第三方插件提供，非官方核心）
membership(agent: Agent): TeamMembership
listMembers(agent: Agent): TeamMemberView[]
spawnTeammate(caller: Agent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult>
sendMessage(caller: Agent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult>
createTask(caller: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskView>
getTask(caller: Agent, id: TeamTaskId): TeamTaskView
listTasks(caller: Agent): TeamTaskView[]
updateTask(caller: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskView>
waitForChange(caller: Agent, timeoutMs: number, signal: AbortSignal): Promise<TeamWaitResult>
interrupt(caller: Agent, targetName: string): { previousStatus: 'running' | 'inactive' }
tryMembership(agent: Agent): TeamMembership | undefined
```

`ctx.agentTeams` 的**实现在 `@nanmicoder/dsh-agent-teams@0.1.22`**（见 §9），不在 `@deepseek-ai/*` 里。它是本机唯一一个「agent-team 类插件」的生产实现，是本设计最重要的先例。

### 1.3 host `Tool.listTools` [实测]

返回 `{ tools: [{ name, description, parameters }] }`，`parameters` 是标准 JSON Schema。**注意**：`ToolSchema` 只白名单暴露 `name / description / parameters`（`<PKG>\dsh-tools\lib\types\index.d.ts:706-715`，`schemas()` "Project visible definitions onto the allowlisted model-facing schema fields, excluding execution and presentation callbacks"）——`timeoutMs`、`isConcurrencySafe` 等**永不发给模型**，插件可安全地把内部元数据挂在定义上。

`cordis_inspect_query(host, Tool, listTools)` 的实际返回体积极大（本次约 270 KB，被截断并落盘到 spill 文件）。**建议后续只按需读取，不要整份拉取。**

### 1.4 host `Event` / `Config` [未实测]

本轮未调用 `Event.listEvents` / `Config.listConfigs`。事件签名改从各包 `.d.ts` 的 `declare module '@deepseek-ai/cordis' { interface Events {...} }` 取得（见 §3.3、§4.6）。**建议后续补测**，因为 `@mode`（`emit` / `serial` / `waterfall`）决定了订阅语义，而 `.d.ts` 注释里已带 `@mode` 标注，可信度尚可。

---

## 2. 官方包清单与职责

`<PKG>` 下 249 个包。以下按任务要求逐个覆盖；`version` 一律 `0.2.0-rc.2`，除非另注。

### 2.1 子代理链路

| 包 | 一句话职责 | 关键导出 |
| --- | --- | --- |
| `dsh-subagent` | **子代理能力缝的 Service Definition**：命名 provider 注册表 + 能力校验的异步 start API（`ctx.subagents`） | `SubagentRuntime`(class), `SubagentProvider`, `SubagentRun`, `SubagentStartRequest`, `ContinuableStartSpec`, `ContinuableStart`, `SubagentInterruptAuthority`, `SubagentSendMessageOptions`, `SubagentCapabilities`, `SubagentResult`, `SubagentStopReason`, `SubagentError`, `SubagentRunId`, `deliverSubagentPrompt`(symbol), `parentAgentOptionsForDelegation`, `resolveChildAgentOptions`, `resolveChildDepth`, `assertSubagentMaxDepth`, `delegationDepthOf`, `applyChildComposition`, `snapshotSubagentDescriptor` |
| `dsh-subagent-spawn-in-process` | in-process **SPAWN** 后端：每个子代跑成**全新** child Agent（独立 session、独立 system prompt、**零父上下文**） | `name = "subagent-spawn-in-process"`, `Config { providerName: string /*默认 'spawn'*/ }`, `apply(ctx, config)` |
| `dsh-subagent-fork-in-process` | in-process **FORK** 后端：子代 Agent 被**父会话日志前缀 seed**（继承父对话上下文）；seed 止于最后一个 `turn/end` | `name = "subagent-fork-in-process"`, `Config { providerName: string /*默认 'fork'*/ }`, `apply(ctx, config)` |
| `dsh-subagent-in-process-driver` | spawn/fork 共用的 in-process 驱动实现 | [未细读] |
| `dsh-tool-subagent` | **面向模型的委派工具**（默认工具名 `subagent`），一个实例配置一个 provider + 子代默认值 | `Config`(见下), `apply(ctx, config, session?)` |
| `dsh-tool-subagent-control` | 续跑控制面（browser → child 的 prompt / interrupt） | [未细读] |
| `dsh-tool-subagent-report` | 子代回报工具 | [未细读] |
| `dsh-subagent-profile`(第三方, web profile) | 第三方 profile 选择器 | 非官方 |

`dsh-subagent` 的 `index.d.ts:1-30` 明确定位：

> Service Definition for the subagent capability seam (`ctx.subagents`): a named-provider registry plus a capability-validating asynchronous start API. … This package owns the Service Definition role of the capability seam. Service Providers (`@deepseek-ai/dsh-subagent-spawn-in-process`, `-fork`, `-acp`) and the model-facing consumer (`@deepseek-ai/dsh-tool-subagent`) are separate packages.

**这意味着第三方插件不应直接依赖 spawn/fork 后端，而应只依赖 `dsh-subagent` 的 Service Definition 并通过 `ctx.subagents.getProvider(name)` / `start(name, ...)` 使用。** 这是关键的稳定性结论。

### 2.2 Agent / 会话 / 投影

| 包 | 职责 | 关键导出 |
| --- | --- | --- |
| `dsh-agent` | Agent 服务定义：活体注册表 + 工厂委托 + 进程内 initiator 作用域（`ctx.agents`） | `AgentRegistry`(class), `Agent`, `CreateAgentOptions`, `ResumeAgentOptions`, `AgentHandle`, `AgentFactory`, `AgentSetup`, `AgentOptions`, `Inbox`, `InboxTarget`, `AgentStatus`, `ModelSelection`, `ModelSelectionRef`, `installModelSelection`, `SessionStartSource` |
| `dsh-agent-loop` | 具体 Agent 工厂与驱动器实现（turn/step 边界、assistant 流、inbox 持久化） | `Agent` 运行时增强, `TurnBoundaryProjection`, `agent/inbox/spliced` 事件 |
| `dsh-session` | 会话事件溯源日志与 Session 值类型 | `SessionId`, `SessionLogOffset`, `SessionHeader`, `SessionEventMap`, `Session`, `UserMessage`, `SessionSeq` |
| `dsh-session-projection` | `ProjectionDefinition` 状态驱动计算单元契约 + `ctx.sessionProjections` 注册表 | `SessionProjectionRegistry`(class), `ProjectionDefinition`, `ProjectionSnapshot`, `ProjectionCheckpointRow`, `SessionProjectionStateMap`, `SessionProjectionMap` |
| `dsh-session-projection-cache` | 投影检查点持久化缓存（domain `session_projcache`，`per-record` layout） | [见 §5] |
| `dsh-session-persistence` | 会话持久化 Service Definition（`ctx.sessionPersistence`），句柄式 API | `SessionPersistence`, `SessionHandle`, `SessionAccess`, `SessionPersistenceSnapshot`, `SessionAlreadyExistsError` 等 |
| `dsh-session-persistence-jsonl` | **JSONL 后端**：每 session 一目录，header + 连续事件写入不可变 generation 文件 | `JsonlSessionHandle`, `JsonlCompression`, `Config` |
| `dsh-session-query` / `dsh-session-query-sqlite` | 会话历史合并读取/追踪/过滤/全文检索；具体实现为 **SQLite FTS5 派生索引** | `SessionQueryEngine`, `SESSION_QUERY_SQLITE_APPLICATION_ID`, `SESSION_QUERY_SQLITE_PATH_KEY` |
| `dsh-agent-presets` | YAML 预设注册表与活体 Agent 保留的 revision；`composeFrom` / `composedPreset` / `serviceFor` | `AgentPreset`, `PresetDefinition`, `AgentPresetRoster` |
| `dsh-agent-default-model` | 默认模型选择的独立持有者 | `ModelSelection` 读写 |
| `dsh-persona` / `dsh-agent-tool-presentation` | persona 段 / 工具呈现模式 | [未细读] |

### 2.3 工具 / 系统提示 / 命令

| 包 | 职责 | 关键导出 |
| --- | --- | --- |
| `dsh-tools` | 工具注册表、模型呈现模式、pre/guard/around/post/result 执行管线（`ctx.tools`） | `ToolRuntime`(class), `ToolDefinition`, `ToolOutputDefinition`, `ToolExecution*`, `PreToolDecision`, `PostToolDecision`, `ToolRestriction`, `ToolGuard`, `ToolRuntimeScheduler`, `TOOL_ABORTED`, `TOOL_ABORTED_BEFORE_DISPATCH`, `defineTool`, `ToolArgsError`, `JsonSchemaNode`, `ObjectJsonSchema` |
| `dsh-system-prompt` | 每次模型步骤前组装的提示词输入注册表（`ctx.systemPrompt`） | `SystemPrompt`(class), `PromptSection`, `PromptContext`, `PromptAssembly`, `AssembleContext`, `ToolProviderResult`, `PromptSectionOrderName`, `PromptContextOrderName`, `SECTION_ORDERS`, `CONTEXT_ORDERS`, `PERSONA_PREFIX_SECTION`, `PERSONA_SUFFIX_SECTION` |
| `dsh-commands` | 插件自有「人类命令」注册表，由交互式 UI 适配器共享（`ctx.commands`） | `CommandRuntime`(class), `CommandDefinition`, `CommandInvocation`, `CommandResult`, `CommandDescriptor`, `CommandExecution`, `CommandSubmitAttachment`, `CommandFileReceiptResolver`, `parseCommand`, `CommandId`, `CommandDefinitionId` |

### 2.4 持久化

| 包 | 职责 | 关键导出 |
| --- | --- | --- |
| `dsh-storage` | **存储枢纽**（`ctx.storage`）：命名后端注册表 + 已挂载的数据形态设施。枢纽自身不做 IO | `Storage`(class), `BackendRegistry`, `StorageBackend`, `KvFacet`, `KvUnit`, `KvUnitDescriptor`, `StorageForms`, `storageBackendServiceKey`, `UNIT_NAME_RE`, `StorageError` |
| `dsh-storage-domain` | **挂载的 domain 设施**（`ctx.storageDomain`）：一个 spec 即声明域的身份/布局/记录 schema | `domainTable`, `defineDomain`, `descriptorOf`, `Domain`, `DomainGlobal`, `KvTable`, `DomainImpl`, `DomainSpec`, `DomainTableSpec`, `DomainGlobalSpec` |
| `dsh-storage-json` | **JSON 后端**：每 unit 一个人可读文档；`root` 无默认值（故意的） | `JsonStorageBackend`, `apply`, `Config { root: string }`；注册为后端名 `json` |

**不存在 `dsh-storage-sqlite`。** SQLite 只出现在 `dsh-session-query-sqlite`（派生检索索引，可丢弃），不是通用 storage 后端。

### 2.5 LLM 路由

| 包 | 职责 | 关键导出 |
| --- | --- | --- |
| `dsh-llm` | provider 中立的消息/流式词汇表 + adapter 注册表（`ctx.llm`） | `LlmRuntime`, `LlmAdapter`, `LlmProviderInfo`, `LlmModelInfo`, `LlmResolvedModelInfo`, `LlmModelReasoningInfo`, `LlmReasoningEffortInfo`, `LlmConfigurableProvider`, `GenerateOptions`, `ToolSchema`, `ContentBlockMap`, `StreamChunk`, `ReasoningEffortId`, `LlmFailure`, `HarnessError` |
| `dsh-llm-deepseek` / `dsh-llm-pi-ai` / `dsh-llm-retry` | 具体 adapter / 重试策略 | [未细读] |

### 2.6 api / 客户端 / UI / 命令 / web

| 包 | 职责 | 关键导出 |
| --- | --- | --- |
| `dsh-api-session-controller` | Host Remote + **Client 会话控制器契约**（会话快照、投影存储、传输、血缘、命令、技能目录、模型选择投影） | `Agent`(client), `catalog`, `commands`, `control`, `history`, `list`, `model-selection-projection`, `remote-events`, `skill-catalog`, `client/sessions/{manager,service,session,projection-store,notifier,lineage,remotes}`, `client/contract/{session,sessions,snapshot,events}` |
| `dsh-client-store` | **React-free 的 store 契约**（`StoreDecl` / `PropsStore` / `HandleOf` / `BoundActions` / `SnapshotSelectorHook` / `useSyncExternalStore` 语义） | ⚠️ **该包未随 profile 安装**（`Test-Path` 为 `False`，`profiles/node_modules/@deepseek-ai/` 无此目录）。`dsh-client-ui-slots/lib/types/store.d.ts:2` 是对它的纯 re-export ⇒ **类型解析会在插件工程里失败**（见 §9.4） |
| `dsh-client-ui-slots` | **Slot 注册表纯核**：SlotMap 契约表、注册/子槽声明/store 座位/inject 面、`SlotCore` | `SlotCore`, `SlotMap`, `SlotFactoryMap`, `SlotEntryDef`, `SlotSpec`, `ChildrenDecl`, `ComposedProps`, `RegisterFactory`, `StoredEntry`, `SlotLabel`, `LiveSlotNode`, `LocaleNamespaceMap`, `GlobalStandardProps`, `SessionStandardProps`, `SessionMaybeStandardProps`, `LocalizedText` 相关 |
| `dsh-client-ui-renderer` | 渲染器：`SlotRegistry`（Cordis Service 层）、`ctx.slots`、`ctx.uiRenderer.mount` | `SlotRegistry`, `UiRendererService`, `RootOwnerProps`, `slots/changed` 事件 |
| `dsh-client-ui-layout` | 三列 AppFrame + `ctx.layout`（列几何 + 主面板选择） | `LayoutController`, `ILayout`, `MainPanelId`, `PanelInfo`, `AppFrameProps`, `SidebarOwnerProps`, `RightbarOwnerProps`, `computeColumns`, `CENTER_MIN/SIDEBAR_MIN/SIDEBAR_MAX/SIDEBAR_DEFAULT/SIDEBAR_COLLAPSED/SIDEBAR_AUTO_COLLAPSE/RIGHTBAR_MIN/RIGHTBAR_MAX_RATIO/RIGHTBAR_DEFAULT_RATIO` |
| `dsh-client-ui-sidebar-right` | 右侧 Sidebar（docking 表面）：会话绑定状态、面板、header 展开控件、导航 service | `ISidebarRight`, `SidebarRightTabRegistry`, `TabDomain`, `SidebarTabInventory`, `createSidebarRightController`, `SidebarRightTabInfo`, `SidebarRightTabActions`, `UseSidebarRightTabInfo`, `SidebarRightTabInjected` |
| `dsh-client-ui-primitives` | UI 基元组件库（含 icons、markdown、settings-form） | 见 §4.5 完整清单 |
| `dsh-client-ui-settings` | 设置页框架与配置表单 | `ConfigForm`, `config-form`, `developer-tools`, `settings-mirror`, `schema`, `client/contract/slots` |
| `dsh-client-locale` | 浏览器端 locale 注册表 + Language 设置行（`ctx.locale`） | `LocaleRuntime`, `LocaleSnapshot`, `LocaleDefinition`, `LanguageRegistration`, `LocaleDict`, `FALLBACK_LOCALE`, `COMMON_NS`, `SETTINGS_NS`, `locale/change` 事件 |
| `dsh-web` | Web 访问服务缝（`ctx.web`）：搜索与抓取共享一个缝 | `WebSearchProvider`, `WebFetchProvider`, `WebSearchRequest/Result/Source`, `WebFetchRequest/Result/Body`, `WebError` |
| `dsh-authorization` | 凭据获取流程的能力缝（`ctx.authorization`）：一次一个 key | `AuthorizationService`, `AuthorizationFlow`, `AuthorizationSession`, `AuthorizationInteraction`, `AuthorizationRequest`, `AuthorizationError`, `AuthorizationDeclinedError`, `authorization/settled` 事件 |
| `dsh-user-approval` | 审批能力缝（`ctx.approval`）：请求、取消、审计、按会话策略。缺 answerer 时 fail-closed | `ApprovalService`, `ApprovalRequest`, `ApprovalRequestEvent`, `ApprovalOutcome`, `ApprovalPolicy`, `APPROVAL_POLICIES`, `ApprovalRequestId`, `setApprovalPolicy`, `approval/request` 事件 |

---

## 3. 具体问题逐条回答

### 3.1 子代理：如何以程序方式启动一个 subagent

#### 3.1.1 暴露的 Service `[类型]`

`ctx.subagents` = `SubagentRuntime`（`<PKG>\dsh-subagent\lib\types\index.d.ts:109`，`declare module '@deepseek-ai/cordis' { interface Context { subagents: SubagentRuntime } }` 在 `:62-65`）。

#### 3.1.2 spawn 与 fork 的差别

`<PKG>\dsh-subagent-spawn-in-process\lib\types\index.d.ts:1-6`：

> The in-process SPAWN subagent backend: registers a `SubagentProvider` on `ctx.subagents` that runs each child as a fresh child `Agent` on the same cordis context (its own session, own system prompt, **zero parent context**). The cheapest transport, reusing the agent factory's quiescent teardown.

`<PKG>\dsh-subagent-fork-in-process\lib\types\index.d.ts:1-7`：

> The in-process FORK subagent backend: … runs each child as a child `Agent` **SEEDED with a prefix of the parent's session log** — so the child inherits the parent's conversation context instead of starting fresh. The seed ends at the last `turn/end`: the current tool-call turn is unbalanced and cannot be replayed as a valid child session.

程序化可观测的差别是 `SubagentProvider.inheritsParentContext: boolean`（`types.d.ts:337`）："Whether the child sees the parent's completed-turn prefix. This is descriptive, not a service-validated start capability… It says nothing about tool registration, injected services, or authority inheritance."

两者都以 `providerName` 注册（默认 `spawn` / `fork`），可被配置改名。

#### 3.1.3 一次性（one-shot）启动

```ts
// <PKG>\dsh-subagent\lib\types\index.d.ts:300
start(name: string, request: SubagentStartRequest): Promise<SubagentRun>
```

`SubagentStartRequest`（`types.d.ts:136-192`）：

```ts
export interface SubagentStartRequest {
  readonly label?: string;                  // 短显示标签，随 session-backed 子代持久化
  readonly prompt: ContentBlock[];          // 作为子代的 user message
  readonly parent: Agent;                   // 发起者 Agent（决定 workspace/lineage/depth）
  readonly signal: AbortSignal;             // 取消通道（tool 的 exec.signal）
  readonly agentOptions?: AgentOptions;      // provider/model/reasoningEffort/maxTokens 覆盖
  readonly outputSchema?: ObjectJsonSchema;  // object-rooted JSON Schema，约束结构化返回
  readonly maxDepth?: number;                // 绝对深度上限（非负安全整数）
  readonly toolFilter?: ToolRestriction;     // 子代工具白名单/黑名单
  readonly persona?: string;                 // 每子代 persona，shadow deployment persona
}
```

返回 `SubagentRun`（`types.d.ts:292-318`）：

```ts
export interface SubagentRun {
  readonly id: SessionId;                    // 本地运行时 MUST 等于发布的 child session id
  readonly localAgent: Agent | undefined;    // 本地子代 Agent（远程为 undefined）
  readonly result: Promise<SubagentResult>;  // 终态结果（子代级失败不 reject，而是 stopReason:'error'）
  dispose(): Promise<void>;                  // 取消剩余工作、等待静默、释放资源（幂等）
}
```

`SubagentResult`（`types.d.ts:256-282`）：`{ output: ContentBlock[]; structured?: unknown; diagnostic?: string; stopReason: 'completed'|'aborted'|'error'|'max-tokens'|'refusal' }`。

**契约重点**：服务在委派给 provider 之前先校验 `SubagentCapabilities`（`types.d.ts:122-128`：`agentOptions / outputSchema / depthLimit / toolFilter / persona`）。「请求了一个所选 provider 不支持的能力 → 用 typed error 拒绝，而不是 accept-then-ignore」——即 **fail loud, no silent degradation**（`types.d.ts:112-121`）。插件若把 `agentOptions` 传给一个不支持 `agentOptions` 的 provider，会**直接失败**，不会静默忽略。

#### 3.1.4 可续跑（continuable）启动 —— 拿到 child session id 并后续发消息

```ts
// <PKG>\dsh-subagent\lib\types\index.d.ts:142
startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart>
```

```ts
// types.d.ts:26-51
export interface ContinuableStartSpec {
  readonly provider: string;                 // 用哪个 provider 建立 child
  readonly label: string;                    // 初始委派的短 description，持久化为子代 creation label
  readonly childId?: SessionId;              // 可选：调用方预留的子代身份（省略则 manager 分配 UUID）
  readonly request: Omit<SubagentStartRequest, 'label' | 'signal' | 'outputSchema'>;
  readonly signal: AbortSignal;
}
export interface ContinuableStart {
  readonly childId: SessionId;               // durable child session id，跨 activation 稳定
  readonly messageId: MessageId;             // 已被接受的初始 prompt 的 inbox message id
}
```

**这就是「拿到子会话 id」的答案**：`childId` 稳定跨 activation。

续跑发消息：

```ts
// index.d.ts:157
sendMessage(sender: Agent, targetId: SessionId, content: ContentBlock[],
            options: SubagentSendMessageOptions): Promise<MessageId>
```

`index.d.ts:143-157` 的语义说明极关键：

> Steer one model-authored message to the sender's **direct parent or direct continuable child**.
> A **running** target admits it at the nearest step boundary; an **idle** target **starts a turn**, and an **absent direct child cold-resumes from persistence**.
> The service derives durable sender attribution from the exact live sender.

⇒ **「如何唤醒一个空闲会话」的答案就在这里**：idle 目标会起一个 turn；不在内存里的 direct child 会**从持久化冷恢复**。

**邻接性限制（重要）**：只能发给**直接父**或**直接子**。跨层/兄弟/任意会话**不可**通过 `sendMessage` 发送。

#### 3.1.5 中途 interrupt

```ts
// index.d.ts:186
interrupt(targetSessionId: SessionId, authority: SubagentInterruptAuthority): void
```

```ts
// types.d.ts:57-63
export type SubagentInterruptAuthority =
  | { readonly kind: 'user'; readonly parentSessionId: SessionId }
  | { readonly kind: 'ancestor'; readonly agent: Agent };
```

`index.d.ts:171-186` 的语义：

> Interrupt one live continuable child's current turn under a human parent address or an exact live ancestor Agent. **Fire-and-return**: the cancel signal is issued before this returns, but the target may keep running until it observes the signal. **Unclaimed pending inbox work, the Activation, and published descendants are preserved; claimed work is not requeued.** Once the interrupted driver is idle, a waking send resumes the parked FIFO queue. An absent target — including a one-shot or unknown id — is an accepted no-op.
> `@throws {SubagentError} UNAUTHORIZED` when the authority does not own the live target.

**只能 interrupt continuable 子代**；one-shot（`start()` 返回的 `SubagentRun`）要走 `run.dispose()`。

Browser/Remote 面（`@Remote`，可在客户端 half 调）：

```ts
// index.d.ts:268
interruptByParent(childSessionId: SessionId, parentSessionId: SessionId,
                  mode: 'continuable'): SubagentInterruptReceipt   // { accepted: true }
// index.d.ts:253
prompt(request: SubagentPromptRequest, signal: AbortSignal): Promise<SubagentPromptReceipt>
```

`SubagentPromptRequest`（`<PKG>\dsh-subagent\lib\types\control-types.d.ts:71-88`）：`{ requestId, parentSessionId, childSessionId, mode:'continuable', delivery:'queue'|'steer', content: PromptContentPart[], clientTimeZone? }`。

#### 3.1.6 provider / model / reasoningEffort / 工具白名单 / token 预算的确切指定方式

| 目标 | 字段 | 位置 |
| --- | --- | --- |
| provider | `AgentOptions.provider?: string` | `<PKG>\dsh-agent\lib\types\runtime-types.d.ts:21-30` |
| model | `AgentOptions.model?: string` | 同上 `:24` |
| reasoningEffort | `AgentOptions.reasoningEffort?: ReasoningEffortId` | 同上 `:27` |
| token 预算 | `AgentOptions.maxTokens?: number`（**每会话模型请求的最大输出 token**，非子代理总预算） | 同上 `:29` |
| 工具白名单 | `SubagentStartRequest.toolFilter?: ToolRestriction` = `{ allow?: readonly string[]; deny?: readonly string[] }` | `<PKG>\dsh-tools\lib\types\index.d.ts:508-513` |
| 递归深度 | `SubagentStartRequest.maxDepth?: number` | `types.d.ts:175` |
| persona | `SubagentStartRequest.persona?: string` | `types.d.ts:191` |
| 结构化返回 | `SubagentStartRequest.outputSchema?: ObjectJsonSchema` | `types.d.ts:168` |

`toolFilter` 的实际语义（`types.d.ts:176-183`）：

> In-process backends apply it as a scoped `tools.restrict()` in the child's creation window: the named tools **vanish from the child's prompt AND refuse to execute** (one visibility), with **loud unknown-name validation**.

⇒ **「token 预算」的唯一程序化控制是 `maxTokens`（单次请求输出上限）**；子代理的**总量**预算要靠 `maxDepth` / `maxActiveSubagents` 与 compaction，**没有** per-child 总 token 上限字段。这是本设计需要记录的能力缺口。

容量配置（`<PKG>\dsh-subagent\lib\types\index.d.ts:101-107`）：

```ts
export interface Config {
  maxActiveSubagents: Volatile<number>;   // 共享不间断 continuable 父链的活体子代上限，默认 8
  maxDepth: Volatile<number>;             // 无显式限制的委派工具默认深度，默认 1
}
```

#### 3.1.7 生命周期事件

`<PKG>\dsh-subagent\lib\types\index.d.ts:66-99`：

- `subagent/provider-added(provider)` `@mode emit`
- `subagent/provider-removed(name)` `@mode emit`
- `subagent/start(info: SubagentRunInfo)` `@mode emit`，**scope-filtered**（按委派父级路由；父级作用域监听器只见自己的委派）；对 in-process provider，`ctx.agents.get(info.id)` 在此通知期间可解析
- `subagent/end(info: SubagentRunEndInfo)` — 与 start 配对（同一 `runId`）

#### 3.1.8 目录发现

```ts
listChildren(parentSessionId: SessionId, signal?: AbortSignal): Promise<SubagentCatalogEntry[]>
listDescendants(rootSessionId: SessionId, signal?: AbortSignal): Promise<SubagentDescendantListEntry[]>
```

`index.d.ts:209-234`：**不加载也不恢复 Agent**；直接子级按父级事件顺序返回；后代按稳定前序（pre-order）遍历，每个目录观察一次即释放。corrupt/unavailable 只截断该分支。

---

### 3.2 模型路由

#### 3.2.1 枚举可用 provider / model

```ts
listProviders(): LlmProviderInfo[]                    // <PKG>\dsh-llm\lib\types\index.d.ts:272
listModels(provider: string): Promise<LlmModelInfo[]> // :350
```

```ts
// <PKG>\dsh-llm\lib\types\types.d.ts:205-210
export interface LlmProviderInfo { id: string; name: string }
// :304-315
export interface LlmModelInfo {
  provider: string; id: string; name: string; description?: string;
  inputModalities?: readonly ModelModality[];   // 缺席=未知；显式省略=否定能力
}
```

拓扑变更事件：`llm/adapters-updated()`（`types.d.ts:10-23`），payload-free，观察者需重读 `listProviders()` / `listModels()` / `listConfigurableProviders()`。

可配置但可能休眠的 provider 目录：`registerConfigurableProviders()` / `listConfigurableProviders()`（`index.d.ts:281-286`），`LlmConfigurableProvider` 带 `settingsNs` / `settingsPath` / `declared?` / `error?`。

端点探测：`registerModelDiscovery(settingsNs, discover)` / `discoverModels(settingsNs, request, signal)`（`index.d.ts:297-308`），返回 `LlmDiscoveredModel[]`。

#### 3.2.2 查某模型支持的 reasoning effort 档位

```ts
// <PKG>\dsh-llm\lib\types\index.d.ts:360
resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>
```

```ts
// <PKG>\dsh-llm\lib\types\types.d.ts:377-388
export interface LlmResolvedModelInfo extends LlmModelInfo {
  context?: LlmModelContext;                  // { contextWindow: number }
  defaultMaxTokens?: number;
  reasoning?: LlmModelReasoningInfo;          // ← 档位在这里
  systemPromptUpdate?: SystemPromptUpdate;
  toolUpdate?: ToolUpdate;
}
// :349-358
export interface LlmModelReasoningInfo {
  efforts: readonly LlmReasoningEffortInfo[];  // adapter 偏好显示顺序
  defaultEffort?: ReasoningEffortId;           // 调用方省略时物化进请求；缺席保留 provider 默认
}
// :340-348
export interface LlmReasoningEffortInfo {
  id: ReasoningEffortId; name: string; description?: string;
}
```

**校验**（`index.d.ts:364-374`）：

> `resolveCallConfig(config, signal?)` — Validate a conversation call config against its exact model capability and materialize adapter-configured defaults. **Unsupported explicit efforts reject before provider I/O; no clamping or aliasing is performed.**

⇒ 传入不支持的 effort 会**直接 reject**，不会被夹到最近档。

#### 3.2.3 官方「模型选择白名单」机制 —— 存在

机制位于 **`<PKG>\dsh-tool-subagent\lib\types\model-selection.d.ts`**（用户设置拥有的授权路由表）：

```ts
// :6-18
export interface AllowedModelRoute {
  readonly provider: string;   // 已注册的 LLM provider id
  readonly model: string;      // provider 拥有的精确 model id
}
export declare const AllowedModelRouteSchema: z<AllowedModelRoute>;

export interface ModelSelectionPolicy {
  readonly routes: readonly AllowedModelRoute[];   // 被授权可显式选择的路由
}
```

配套 API（同文件）：

```ts
modelRouteKey(route: AllowedModelRoute): string                        // :24 稳定身份
assertAllowedModelRoutes(routes: unknown): asserts routes is readonly AllowedModelRoute[]  // :30 边界校验
hasDelegationModelRequest(request: DelegationModelRequest): boolean    // :42
requestedAgentOptions(parentOptions, configured, request, enabled): AgentOptions | undefined  // :53
assertAllowedModelSelection(policy | undefined, parentOptions, requested, request): void        // :63
hasConfiguredLlmSelection(options): boolean                            // :69
preflightChildLlmRoute(llm, parentOptions, requested, signal, inheritParentReasoningEffort?): Promise<void>  // :80
```

`DelegationModelRequest`（`:32-36`）——**这是模型可见的字段名**：

```ts
export interface DelegationModelRequest {
  readonly provider?: string;
  readonly model?: string;
  readonly reasoning_effort?: string;   // 注意：snake_case，模型面向
}
```

`assertAllowedModelSelection` 的契约（`:54-63`）：

> Enforce a settings-owned route list at the operation that creates the child. **Pure inheritance remains outside this policy because no model-facing choice occurred**; any explicit route or effort field must resolve to an allowed route.

⇒ 白名单只在**模型显式选择**时生效；纯继承（子代沿用父模型）不受限。

**状态载体**（`<PKG>\dsh-tool-subagent\lib\types\model-selection-state.d.ts`）：每个 session 一个 durable `subagent/model-selection-policy` 事件（log-only，**不进模型历史**），在定义第一次能到达模型请求**之前**追加。

**Host 设置服务**：`ctx.subagentModelSelection.current(): SubagentModelSelectionSettings`（[实测] catalog；描述：「Singleton settings owner read when delegation tools are composed for a Session」）。

**模型可见的发现工具**：`registerListSubagentModels(ctx, policy)`（`<PKG>\dsh-tool-subagent\lib\types\list-models.d.ts:9`）注册 `list_subagent_models`。

**工具侧开关**：`Config.modelSelectionSettings?: boolean`（`<PKG>\dsh-tool-subagent\lib\types\index.d.ts:25-29`）——"Sample the Host `subagent-model-selection` setting for each new top-level Session and inherit that decision in its child Sessions."

**结论**：混合拓扑 agent team 插件**应当复用**这套 `ModelSelectionPolicy` + `AllowedModelRoute` 机制，而不是自造白名单；模型可见字段名是 `provider` / `model` / `reasoning_effort`。

---

### 3.3 工具注册

#### 3.3.1 注册 API

```ts
// <PKG>\dsh-tools\lib\types\index.d.ts:636
register(definition: ToolDefinition): () => void
```

> Register globally or in the calling agent scope. **Scoped tools shadow globals**; duplicates within one layer and the reserved `run_code` name fail.

⇒ **作用域即调用点**：用 `ctx.tools.register(...)` 注册 = 全局；用 `agent.ctx.tools.register(...)` 注册 = 该 agent 私有。返回值是 Cordis effect disposer（HMR 安全）。

#### 3.3.2 schema 用什么描述 —— **既不是 schemastery 也不是裸 JSON Schema**

官方提供的是 **`dsh-tools` 自有的 JSON-value schema DSL**，经 `defineTool` 编译为受约束的原始 JSON Schema：

```ts
// <PKG>\dsh-tools\lib\types\schema.d.ts:248
defineTool<const S extends ParameterSchemaSpec, const O extends ValueSchemaSpec>(
  options: DefineToolOptions<S, O>
): ToolDefinition
```

`DefineToolOptions`（`:178-240`）关键字段：

```ts
{
  readonly name: string;                       // 必须唯一
  readonly description: string;
  readonly parameters: S;                      // ParameterSchemaSpec：逐属性隐式开放对象根
  readonly output: {                           // ★ 强制：canonical 输出声明
    readonly schema: O;
    render(args: InferArgs<S>, value: InferValue<NoInfer<O>>): ContentBlock[];
    presentationMeta?(args, value): JsonValue;
  };
  readonly deferLoading?: true;
  readonly timeoutMs?: number;                 // 协同超时预算（永不发给模型）
  isConcurrencySafe?(args: InferArgs<S>): boolean;
  execute(args: InferArgs<S>, exec: ToolRunContext): Promise<InferValue<NoInfer<O>>>;
  projectContent?(exec, result): ContentBlock[] | undefined;
  finalizeContent?(exec, result): ContentBlock[] | undefined;
  presentCall?(args): ToolCallView | undefined;
  presentResult?(args, result: ToolResult): ToolResultView | undefined;
}
```

作者面向的 schema 节点（`schema.d.ts:9-70`）：`type: 'string'|'number'|'integer'|'boolean'|'null'|'array'|'object'|'json'` 或 `oneOf`。**`object` 节点必须显式写 `additionalProperties: boolean`**（`:58-62`：openness is mandatory so a nested or output object never acquires an accidental JSON Schema default）。必填性用逐属性 `required?: true`（`:74-76`）。

类型推断有界：**最多 16 层容器**，超出回落 `JsonValue`（`schema.d.ts:124-125`、`:145-148`）。

**三种 schema 语言的分工 —— 这是最容易踩坑的地方**：

| 用途 | 语言 | 出处 |
| --- | --- | --- |
| **工具参数/输出** | `dsh-tools` 自有 DSL（`ValueSchemaSpec` / `ParameterSchemaSpec`） | `dsh-tools/lib/types/schema.d.ts` |
| **插件 `Config`** | **schemastery** | `dsh-storage-json/lib/types/index.d.ts:9,26`（`import z from '@deepseek-ai/schemastery'; export declare const Config: z<Config>`） |
| **storage domain 记录 schema** | **zod** | `dsh-storage-domain/lib/types/spec.d.ts:6-10`（"Record schemas are zod … plugin `Config` stays schemastery."） |

#### 3.3.3 权限 / 审批如何声明

**工具定义本身不声明权限。** 权限走 `tools/pre-execute` waterfall + guard：

```ts
// <PKG>\dsh-tools\lib\types\index.d.ts:445-460
export type PreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string; info?: ToolErrorInfo }
  | { kind: 'cancel' }
  | { kind: 'ask'; reason?: string; displayReason?: { readonly en: string; readonly [locale: string]: string } };
```

`tools/pre-execute`（`:37-47`）：

> Allow, deny, cancel, or ask before dispatch. `next()` delegates to allow; `cancel` selects the canonical pre-dispatch cancellation result, and **missing approval support turns `ask` into denial**. Async gates must observe `exec.signal`; the registry rechecks cancellation after they settle but never abandons their promise.

`ask` 的解析（`:816-827`，`serviceAsk`）：

> Resolve an `ask` decision to allow/deny through the approval seam. The seam is consumed **opportunistically with `ctx.get('approval')`** — a deployment that composes no ApprovalService **keeps the historical degrade to deny**, and an unmount mid-session degrades the same way on the next ask. **An agent-less execution also degrades**: without an agent there is no session to audit to and no UI to route to. Otherwise the outcome maps one-to-one — `allowed-once` proceeds; the three non-grants deny with distinct reasons so the model can tell a human "no" from an absent approval channel.

⇒ **fail-closed 在两处**：(a) 没有 approval service → deny；(b) 没有 agent → deny。

两种更简单的钩子：

```ts
// :644
restrict(filter: ToolRestriction): () => void   // 按 scope 遮蔽全局工具（allow/deny 求交）
// :655
guard(guard: ToolGuard): () => void
```

```ts
// :522
export type ToolGuard = (execution: Readonly<ToolExecution>) => string | undefined;
```

> A monotonic execution guard evaluated after every `tools/pre-execute` listener and before the tool body. Returning a reason denies the call; returning `undefined` leaves it unchanged. **Because guards have no allow result, listener ordering cannot turn a denial back into permission.**（`:514-522`）

其他管线事件：`tools/execute`（around，只能改 `exec.signal`）、`tools/post-execute`（`PostToolDecision` = accept / block）、`tools/ptc-dispatch-log`、`tools/result`（只读观察）、`tools/change`（未过滤的注册表通知）。

`ToolExecutionResult`（`:413-435`）：成功 `{isError:false, value, content, meta?, additionalContexts?, concludesTurn?}`；失败 `{isError:true, error: ToolFailure, content, additionalContexts?}`。`ToolRunContext` 额外提供 `deferContext(context)` 与 `concludeTurn()`（`:305-322`）。

---

### 3.4 会话与消息

#### 3.4.1 往另一个会话投递消息（agent inbox）

**两条路，语义不同：**

**路 A —— 直投 inbox（需要精确活体 `Agent`）**，`<PKG>\dsh-agent\lib\types\runtime-types.d.ts:175-209`（`declare module './types.ts' { interface Agent {...} }`）：

```ts
send(message: UserMessage, target: InboxTarget, wakeup: boolean): void
followup(message: UserMessage): void   // 队列一个普通后续 turn 并唤醒 driver；该项成为其 turn 的唯一普通消息
steer(message: UserMessage): void      // 送到最近 step；idle driver 会起一个 turn；running driver 在下一 step 边界消费
inject(message: UserMessage): void     // 只排队模型可见上下文，不唤醒 driver
```

`InboxTarget = 'next-turn' | 'next-step'`（`<PKG>\dsh-agent\lib\types\types.d.ts:31`）。

`send` 的精确契约（`runtime-types.d.ts:175-186`）：

> Route identified input to an inbox boundary and optionally wake the driver. Waking input submitted after active cancellation is queued for the next turn and runs when the aborted activity converges to idle; a `disposed` cancel leaves it parked. **A wake submitted while already idle always opens its turn boundary**, even when its message is cleared before the driver claims.

**无 wake 的 `inject` 是最安全的「投递但不打扰」通道**（`:201-209`）。

**路 B —— 子代理邻接通道（推荐）**：`ctx.subagents.sendMessage(sender, targetId, content, options)`（§3.1.4）。它做邻接校验、durable sender 归因、cold-resume，并天然支持「目标 idle → 起 turn」。

#### 3.4.2 如何唤醒一个空闲会话

| 手段 | 效果 | 出处 |
| --- | --- | --- |
| `agent.followup(msg)` | 排队一个新 turn 并唤醒 | `runtime-types.d.ts:187-192` |
| `agent.steer(msg)` | idle driver 起 turn | `:194-200` |
| `agent.send(msg, target, true)` | wakeup=true 时若已 idle **总是开 turn 边界** | `:175-186` |
| `ctx.subagents.sendMessage(...)` | idle 目标起 turn；**不在内存的 direct child 从持久化冷恢复** | `subagent/index.d.ts:143-157` |
| `ctx.subagents.prompt(...)`（Remote） | 浏览器来源的人类消息；容量满时冷恢复会以 `subagent/delivery-unavailable` 拒绝 | `subagent/index.d.ts:235-253` |

`AgentStatus = 'idle' | 'running'`（`runtime-types.d.ts:90`）："`idle` means no driver is active; `running` begins when waking input starts cancellable pre-step processing". 等待静默用 `whenIdle(): Promise<void>`（`:158-164`）。

#### 3.4.3 session id 的语义

```ts
// <PKG>\dsh-session\lib\types\types.d.ts:5
export type SessionId = Branded<'SessionId'>;
// :11
export declare function SessionId(id: string): SessionId;
```

语义（来自多处交叉验证）：

1. **agent 与 session 共用同一个 id**。`<PKG>\dsh-agent\lib\types\index.d.ts:48-49`：`CreateAgentOptions.sessionId` — "The live agent/session identity"；`AgentRegistry.get(id)` 的 doc 是 "the shared agent/session id"（`:343`）。`<PKG>\dsh-agent\lib\types\types.d.ts:11-14`：`Agent { readonly id: SessionId }`。
2. **子代的 run id 就是子 session id**。`<PKG>\dsh-subagent\lib\types\types.d.ts:293-298`：`SubagentRun.id` — "For a local run, this MUST equal the published child session id, whose `parentSession` records `request.parent.session.id`; a remote provider mints an id unique in the parent namespace."
3. **血缘是 durable session metadata**。`SessionHeader.parentSession?: SessionId`（`dsh-session/lib/types/types.d.ts:71`）。`CreateAgentOptions.meta` 可带 `{cwd, parentSession, isSeeded, origin:'subagent', delegationDepth, agentPreset}`（`dsh-agent/lib/types/index.d.ts:64-71`）。
4. **continuable child id 跨 activation 稳定**（`subagent/types.d.ts:46-48`）。
5. **运行时所有权 ≠ durable 血缘**。`AgentRegistry.isOwnedBy(id, owner)` 的 doc（`dsh-agent/lib/types/index.d.ts:344-352`）："Runtime ownership is **independent of durable session lineage** and remains unambiguous when unrelated providers reuse an id."
6. **品牌化**：`SessionId` / `MessageId` / `SubagentRunId` / `ApprovalRequestId` / `CommandId` 都是 `Branded<...>`，编译期不可混用。

事件（`dsh-agent/lib/types/runtime-types.d.ts:212-408`，全部 scope-filtered）：`agent/created`（serial）、`agent/disposed`、`agent/status`、`agent/inbox/inserted|claimed|discarded`、`agent/pre-step`（waterfall）、`agent/request`（waterfall，可换冻结的 call config）、`agent/request-error`（waterfall）、`agent/assistant-stream`、`agent/turn-stopping`（serial）、`agent/error`。

---

### 3.5 持久化

#### 3.5.1 storage domain 的用法

```ts
// <PKG>\dsh-storage-domain\lib\types\spec.d.ts:93
defineDomain<S extends DomainSpec>(spec: S): S
// :80
domainTable<K extends string, V>(schema: ZodType<V>): DomainTableSpec<K, V>
```

`DomainSpec`（`:31-68`）：

```ts
export interface DomainSpec {
  readonly name: string;                       // 必须匹配 UNIT_NAME_RE
  readonly version: number;                    // 当前格式版本
  readonly layout?: 'single' | 'per-record';    // 默认 'single'
  readonly compatibleVersions?: readonly number[];
  readonly invalidRecords?: 'backup-and-skip';  // 只对可丢弃的派生数据
  readonly global?: DomainGlobalSpec<unknown>;  // { schema: ZodType<G>; initial: G }
  readonly tables: Record<string, DomainTableSpec>;
}
```

`defineDomain` 是**通用校验 + 类型收敛**（`:82-93`）：非法 name/version、或 global schema 接受 `null` 都会在**模块加载时**抛错（`null` 被拒是为了 round-trip：后端把 global 存成 opaque JSON，用 `null` 当「从未写入」哨兵）。

打开与使用：

```ts
// 实测 catalog：ctx.storageDomain.open / get / closeAll
open<S extends DomainSpec>(spec: S): Promise<Domain<S>>
```

```ts
// <PKG>\dsh-storage-domain\lib\types\domain.d.ts:84-105
export interface Domain<S extends DomainSpec> {
  readonly name: string;
  readonly global: DomainGlobalHandleOf<S>;
  table<N extends keyof S['tables'] & string>(name: N): KvTable<TableKeyOf<S,N>, TableValueOf<S,N>>;
  close(): Promise<void>;
}
```

```ts
// :15-30 DomainGlobal
get(): G                                       // 同步读内存；首次 set 之前是 spec 的 initial
set(value: G): Promise<void>                   // 排队到写链；首次 set 才在介质上物化
// :36-78 KvTable
get(key: K): V | undefined                     // 同步读内存
entries(): IterableIterator<[K, V]>            // 快照迭代器，非活视图
keys(): IterableIterator<K>
readonly size: number
put(key: K, value: V): Promise<void>
delete(key: K): Promise<boolean>               // 记录不存在时返回 false，不写不发事件
update(key: K, fn: (current: V) => V): Promise<V>   // 原子读改写，fn 看到队列槽位的当前值
```

**写语义（关键，`domain.d.ts:1-10`）**：

> Reads are synchronous from memory; every write queues on the chain, **awaits backend durability FIRST, then mutates memory, then emits `domain/changed`** — a rejected backend write leaves memory untouched (no divergence between reads and the medium), and events carry values that equal the in-memory state at emission, in write order.

⇒ **先落盘、再改内存、最后发事件**。后端写失败时内存不受影响。

记录是**不可变数据**（`domain.d.ts:33-35`）：返回值就是存储对象本身，**没有防御性拷贝**，禁止原地修改，必须走 `put` / `update`。

#### 3.5.2 JSONL vs SQLite 后端

| 层面 | 后端 | 位置 | 说明 |
| --- | --- | --- | --- |
| **通用 KV / domain** | `json` | `<PKG>\dsh-storage-json` | 每 unit 一份人可读文档；`single` layout = `<unit>.json`，`per-record` layout = `<unit>/` 树；原子重写发布。注册为后端名 `json`。`Config.root` **无默认值**（刻意的：`process.cwd()` 回退会把 unit 文件散落到进程碰巧启动的地方） |
| **通用 KV / domain** | — | — | **没有 `dsh-storage-sqlite`** |
| **session 日志** | `jsonl` | `<PKG>\dsh-session-persistence-jsonl` | 每 session 一目录；header + 连续事件写入**不可变 generation 文件**；句柄式 `SessionPersistence` API；`Config.root` 同样必填 |
| **session 检索** | `sqlite` (FTS5) | `<PKG>\dsh-session-query-sqlite` | **派生索引，可丢弃**；`SESSION_QUERY_SQLITE_PATH_KEY = "launcherSessionQueryPath"` 由 launcher 拥有绝对路径 |
| **投影缓存** | `json`（经 domain） | `<PKG>\dsh-session-projection-cache` | domain `session_projcache`，`per-record` layout |

⇒ **「JSONL vs SQLite」的正解是：两者不是同一个选项的两个候选，而是不同层面的两种介质。** 业务数据用 domain + `json` 后端；会话日志用 `jsonl`；检索用可丢弃的 SQLite 派生索引。

#### 3.5.3 重启后恢复

- **session 日志**：`ctx.sessionPersistence`（Service Definition `<PKG>\dsh-session-persistence\lib\types\index.d.ts`），句柄式。`AgentRegistry.resume({resumeSessionId, parentAgent?, agentOptions?, signal?, setup?})` 加载持久化 session 并在其上恢复 agent（`<PKG>\dsh-agent\lib\types\index.d.ts:109-128`）。`resume` 的 doc（`:177-179`）："must be called after `ctx.sessionPersistence` exists (consumers inject `sessionPersistence`)"。
- **domain**：`open(spec)` 会 `loadAll` 并逐记录过 zod 校验。版本不一致时：`single` layout 精确版本匹配（`version-mismatch` → reject）；`per-record` layout 接受 `compatibleVersions` 里列出的版本戳，写入永远打 `version`。
- **continuable 子代冷恢复**：`ctx.subagents.sendMessage` 对不在内存的 direct child 会「cold-resumes from persistence」；`ctx.subagents.prompt` 在容量满时以 `subagent/delivery-unavailable` 拒绝。
- **投影检查点是 fold 捷径而非权威**（`dsh-session-projection-cache` 头部）："a row is possibly stale (its `seq` says how stale) but never wrong"，`ver` 不匹配就丢弃该行（不迁移），所有写路径 fail-soft。
- **`restart` 相关的 session 边界**：`SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact'`（`<PKG>\dsh-agent\lib\types\runtime-types.d.ts:105`）。

---

### 3.6 UI

#### 3.6.1 Slot 机制总览

Slot 契约表 `SlotMap` 通过**声明合并**扩展：`declare module '@deepseek-ai/dsh-client-ui-slots' { interface SlotMap { '<key>': { kind; scope; owner?; keyProps?; hookContext?; inject? } } }`（`<PKG>\dsh-client-ui-slots\lib\types\index.d.ts:16-18`）。

```ts
// index.d.ts:83-85
export type SlotKind  = 'single' | 'list' | 'keyed' | 'chain';
export type SlotScope = 'root' | 'session-maybe' | 'session';
```

`SlotCore.register` 的语义（`index.d.ts:757-791`）：

- **加载期校验 fail-loud，渲染热路径不再复检**
- 注册进未声明的 slot → throw
- 声明已被他人声明的子 key → throw（**一个 slot 一个声明者**，报错会点名第一个声明者）
- 同一个 shared store handle 挂到不同 scope 的 slot → throw
- kind 约束：`keyed` 缺 `key` throw；`list` 缺 `id` throw；`chain` 缺 `select` throw
- **遮蔽（shadowing）**：同 cell 的条目按 `priority` 升序排序（平局按注册序），**cell 内优先级最低的活条目渲染**；在同一 cell 的**已占用优先级**（默认 0）再注册一次 → **throw 并点名占用者**
- **生命周期**：disposer 移除贡献**并级联坍塌它声明的每个子 slot**（子条目递归清空；陈旧 disposer 变成 no-op）

组件收到的 props 是五路共享的合成（`index.d.ts:474`，`ComposedProps`）：

```ts
type ComposedProps<K, EntryKey, S, H, I, M, N> =
  PropsRuntime<K, EntryKey>     // owner 份额 + keyProps + slot inject 面 + scope standard kit（session 标准套件 + 全局席位）
  & PropsRenderSlots<S>          // renderSlot / renderSlotChain / SessionProvider
  & PropsRenderFactories          // renderFactorySlot
  & PropsStore<H>                 // store 座位（声明了才有）
  & InjectFace<I>                 // 注册者业务面（hooks 舱 → 绑定成 use<Name> selector hooks）
  & MatchedShare<SlotMap[K], M>   // chain kind：selector 结果注入为 `matched`
  & PropsLocale<N>;               // locale: 声明了才有的 `t` 座位
```

`chain` kind 的路由（`index.d.ts:246-257`）：render 时按 `priority` 升序跑 entry selector，**第一个非 null 返回的条目当选**，其结果成为组件 `matched` prop；全 null 落 owner fallback。`ChainSelect` **必须是纯函数**（只看 owner props，无副作用）。

#### 3.6.2 可用的 Slot 清单与 props 形状

**A. layout（`dsh-client-ui-layout/lib/types/client/index.d.ts:33-106`）**

| Slot key | kind | scope | owner props |
| --- | --- | --- | --- |
| `root` | single | root | `RootOwnerProps { children?: never }`（**在 `ui-renderer` 里声明**；**明确写了 DO NOT register here** — 再注册会遮蔽 AppFrame，整个页面只剩你的组件） |
| `sidebar` | single | root | `SidebarOwnerProps { collapsed: boolean; width: number }` — **已被 `ui-sidebar` 的 `SidebarRoot` 占用**；在此注册会**整体替换**导航列 |
| `main` | keyed | root | 无 owner；**保留 key `conversation`** 承载 Conversation，其它 key 不获得 Session 绑定 |
| `rightbar` | single | root | `RightbarOwnerProps { width: number; viewportWidth: number; canShow: boolean }` — 已被右侧 Sidebar 占用 |
| `shell.overlay` | **list** | root | 无 owner — **★ 推荐的自有全框浮层席位**：加性、可点击穿透（条目自己 opt-in 指针事件），天然不遮挡底层应用 |
| `shell.leading` | single | root | 无 owner；仅在 sidebar 列完全隐藏时挂载（macOS 桌面折叠）；挂载期间 frame 发布 `--dsh-frame-leading-clearance` |

`AppFrameProps`（`client\AppFrame.d.ts:4`）渲染的子槽：`'sidebar' | 'main' | 'rightbar' | 'shell.overlay' | 'shell.leading'`。

列几何常量（`client\columns.d.ts:13-31`）：`CENTER_MIN = 400`、`SIDEBAR_MIN = 264`、`SIDEBAR_MAX = 420`、`SIDEBAR_DEFAULT = 280`、`SIDEBAR_COLLAPSED = 56`、`SIDEBAR_AUTO_COLLAPSE = 1024`、`RIGHTBAR_MIN = 300`、`RIGHTBAR_MAX_RATIO = 0.7`、`RIGHTBAR_DEFAULT_RATIO = 0.45`。

**B. sidebar-right（`dsh-client-ui-sidebar-right/lib/types/client/contract/slots.d.ts:30-110`）**

| Slot key | kind | scope | props |
| --- | --- | --- | --- |
| `rightbar.session` | single | session | owner: `RightbarOwnerProps & { active: boolean; retainTab(tabId: TabId, signal: AbortSignal): () => void }` |
| **`sidebar.right.pane.tab`** | **keyed** | session | key = tab type definition 的 `id`；`hookContext: TabHookContext`；`inject: SidebarRightTabInjected { hooks: { tabInfo: SlotHookFactory<'sidebar.right.pane.tab', UseSidebarRightTabInfo> } }` |
| `sidebar.right.pane.tab.title` | keyed | session | 同上（key 与 hook 相同） |
| `sidebar.right.tab.guide` | chain | session | `hookContext: UseSidebarRightTabInfo`；inject `hooks.tabInfo` |
| `sidebar.right.tab.guide.entry` | keyed | session | owner `SidebarRightGuideEntryOwnerProps { entryId, kind, title, description? }`；hook `tabInfo` |
| `sidebar.right.tab.menu.item` | list | session | owner `SidebarRightTabMenuOwnerProps { tab: TabRecord; dismiss(): void }`（**条目执行动作必须调用 `dismiss()`**，菜单只会自有关闭） |

`SidebarRightTabInfo`（同文件 `:169-191`）—— tab body/title/guide 共享的活信息：

```ts
{
  sidebar: { expanded: boolean; fullscreen: boolean };
  panel:   { id: PaneId };
  tab: TabRecord & {
    refreshShortcut?: ShortcutCatalogEntry | undefined;
    visible: boolean;
    navigation: SidebarRightTabNavigation;   // { address, params, revision }
    signal: AbortSignal;                     // 只在 record 消失或插件卸载时 abort，hide/session 切换不 abort
    actions: SidebarRightTabActions;
  };
}
```

`SidebarRightTabActions`（`:142-167`）：`bindCommands({refresh?})`、`openResource(address, options?)`、`openTab(kind, options?)`、`close()`。

**C. conversation（`dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:119-279`）**

| Slot key | kind | scope | owner / 备注 |
| --- | --- | --- | --- |
| `main.conversation` | single | session-maybe | 无 owner；Conversation shell，位于其 root-scope 主面板条目之下 |
| `conversation.session` | single | session | `{ view?: string }` |
| `conversation.header` | single | session-maybe | 常驻导航容器（含未选 session 时） |
| `conversation.session.header` | single | session | `{ hideChrome: boolean }` |
| `conversation.session.header.lineage` | single | session | `ConversationHeaderLineageOwnerProps { lineageSessionId, displayTitle, openTitle? }` |
| **`conversation.session.header.actions`** | **list** | session | `ConversationHeaderActionOwnerProps { children?: never }`（无 owner 专属值，从 session 标准 props 取状态） |
| `conversation.session.header.utilities` | list | session | 同上 |
| `conversation.header.leading` | single | root | `{ children?: never }` |
| `conversation.session.header.corner` | single | session | `{ children?: never }` |
| `conversation.view` | list | session | `ConvViewOwnerProps { inspectCall, viewRequest, openView, completeViewRequest }` |
| `conversation.composer` | **chain** | session | owner `ComposerChainProps { sessionId?, session?: SessionSnapshot, pendingInteraction? }`；唯一消费者，支持 `overlay: true` 保留 fallback 挂载（草稿/DOM 状态存活） |
| `conversation.hero.workspace` | single | root | `EmptyWorkspaceOwnerProps { open, anchorRef?, selectedId?, onPick, onClose }` |
| `conversation.hero.brand.mark` | single | root | `{ size: number; className?: string }` |
| `conversation.hero.agentPreset` | single | session-maybe | `{ children?: never }` |
| `conversation.input.dock` | list | session | `InputZone { session: SessionSnapshot; input: InputState }` |
| `conversation.input.overlay` | list | session | 无 |
| `conversation.composer.dock` | list | session | 无 |
| `conversation.input.left` | list | session | 无 |
| `conversation.input.right` | list | session | 无 |
| `conversation.input.activity` | single | session | `InputActivityOwnerProps extends InputControlOwnerProps { onActiveChange(active): void }` |
| `conversation.composer.bar` | single | session-maybe | `ComposerBarOwnerProps { variant: 'hero'\|'composer'; blocked?; disabled?; workspacePickerOpen?; onRequestWorkspace?; placeholder?; accessory? }` |
| `conversation.input.attachments` | single | session-maybe | `ComposerAttachmentsOwnerProps` |
| `conversation.input.plan` | single | session | `InputControlOwnerProps { locked: boolean }` |
| `conversation.input.permission` | single | session | 同上 |
| `conversation.input.model` | single | session | 同上；工具行挤不下时行会设 `--dsh-composer-model-text-display: none` / `--dsh-composer-model-icon-display: block` 供 occupant 紧凑显示 |

**SlotFactoryMap**（同文件 `:280-327`）：`conversation.content`，scope `session-maybe`，props `ConversationContentInputProps { variant: 'main'|'embedded'; phase: 'settling'|'hero'|'active'; hero: boolean }`，locale `'conversation'`，子槽 `conversation.session` / `conversation.composer` / `conversation.composer.bar` / `conversation.input.dock` / `conversation.hero.brand.mark` / `conversation.hero.workspace` / `conversation.hero.agentPreset`，local 槽 `views`（session）与 `widthControls`（root）。

**Standard props**（同文件 `:328-347`）：

```ts
interface GlobalStandardProps { useWorkspaces: SnapshotSelectorHook<WorkspaceSnapshot> }        // ui-conversation 合并
interface SessionStandardProps {
  useConversation: UseConversation;                              // ConversationSnapshot
  useInput: SnapshotSelectorHook<InputState>;
  inputActions: InputActions;
}
interface SessionMaybeStandardProps { /* 三者皆可为 undefined */ }
```

`dsh-client-ui-layout` 另外往 `GlobalStandardProps` 合并了 `usePanelInfo: UsePanelInfo`（`layout\client\index.d.ts:29-32`）。

**D. chat（`dsh-client-ui-chat/lib/types/client/contract/slots.d.ts`）** —— agent-team 卡片实际落点：

| Slot key | kind | scope | 行号 |
| --- | --- | --- | --- |
| `conversation.chat.node` | keyed | session | `:235-237`；props `ChatNodeViewProps<Kind> = PropsRuntime<'conversation.chat.node', Kind> & PropsLocale<'chat'>`（`:163`）；inject hooks `turnData: SlotHookFactory<'conversation.chat.node', UseChatNodeTurnData>`、`disclosure: SlotHookFactory<'conversation.chat.node', UseDisclosure>`（`:120-121`） |
| `conversation.chat.commandview` | keyed | session | `:262-264`；props `CommandRowProps = PropsRuntime<'conversation.chat.commandview'>`（`:170`） |
| `conversation.chat.turnTail` | list | session | `:272-274` |

#### 3.6.3 客户端插件如何注入

三步（全部来自实测的 `@nanmicoder/dsh-agent-teams` 的 `package.json` 与 `dsh-client-ui-*` 官方 `package.json`）：

**1）`package.json` 声明 client half**

```jsonc
{
  "exports": {
    ".":       { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client":{ "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },     // host 侧：Loader 补丁
    "client": {                                      // ★ 浏览器 half
      "inject": ["@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-conversation", ...],
      "platform": "web"
    }
  }
}
```

`dsh-client-ui-sidebar-right/package.json` 的 `dsh.client` 就是 `{ inject: [...6 个包...], platform: "web" }`。

**2）`lib/client.js` 是浏览器模块**

产物格式（实测 `@nanmicoder/dsh-agent-teams\lib\client.js` 第 1 行起）：

```js
window.__ModuleLoader__.load({
  id: "@nanmicoder/dsh-agent-teams",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react_jsx_runtime = require("react/jsx-runtime");
    let react = require("react");
    let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    // ... plugin body ...
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
```

`require` 可解析 `react`、`react/jsx-runtime`、以及 `dsh.client.inject` 里列出的包。

**3）`apply(ctx)` 里注册 Slot**

```js
export const inject = ['uiConversation', 'slots', 'sessions', 'locale', 'modelDirectories', 'layout'];
export function apply(ctx) {
  ctx.inject(['sidebarRight', 'sidebarRightTabs'], (native) => {   // ← 子上下文集
    native.effect(() => native.sidebarRightTabs.register({ /* tab type */ }));
    native.slots.inject('sidebar.right.pane.tab', () => native.slots.register({
      name: 'sidebar.right.pane.tab', key: TEAM_TAB_ID,
      locale: AGENT_TEAMS_LOCALE_NAMESPACE,
      inject: () => ({ state, modelDirectories: native.modelDirectories, openMember })
    }, WorkspaceActivity));
  });
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'agent-teams-activity', order: 80,
    label: 'AgentTeams activity', locale: AGENT_TEAMS_LOCALE_NAMESPACE
  }, Panel));
  ctx.uiConversation.events.register(agentTeamsCardDefinition);
}
```

**`ctx.slots.inject(key, callback)` 是必需的**（`dsh-client-ui-renderer\lib\types\client\registry.d.ts:96-111`）：它把 effect 装到该 slot 的**声明生命周期**上——声明已存在则同步执行；否则在声明者的 `register()` 提交后执行；坍塌时 dispose，再次声明时重跑。**不这样做就会因为「注册进未声明的 slot」而 throw**，而 slot 的声明顺序取决于插件加载顺序。

客户端可用服务（实测）：`ctx.slots`（`SlotRegistry`）、`ctx.uiRenderer`（`{ mount(container) }`）、`ctx.locale`（`LocaleRuntime`）、`ctx.layout`（`ILayout`）、`ctx.sessions`、`ctx.uiConversation`、`ctx.modelDirectories`、`ctx.sidebarRight` / `ctx.sidebarRightTabs`。事件：`slots/changed(key)`（`dsh-client-ui-renderer\lib\types\client\index.d.ts:31-38`）。

#### 3.6.4 React 版本

**React 18。** `react: "^18.2.0"`，`react-dom: "^18.2.0"`，`@types/react: "~18.3.1"`，`@types/react-dom: "~18.3.0"`（`dsh-client-ui-sidebar-right/package.json`、`dsh-client-ui-conversation/package.json`、`dsh-client-ui-layout/package.json` 的 devDependencies；`@nanmicoder/dsh-agent-teams` 的 peerDependencies 也是 `react: "^18.2.0"`）。

`react` 出现在 **peerDependencies 且 `peerDependenciesMeta.react.optional = true`**（agent-teams 的写法）——即运行时由宿主提供，插件不打包自己的 React 副本。

#### 3.6.5 UI primitives

`<PKG>\dsh-client-ui-primitives\lib\types\` 下的组件（按文件名，完整清单）：

**基础交互**：`Button`、`Checkbox`、`Input`、`Switch`、`SegmentedControl`、`SegmentedTabs`、`Menu`、`MenuGroup`、`MenuSurface`、`Modal`、`Tooltip`、`Toast`、`HoverCard`、`DisclosureRow`、`FoldToggle`

**展示**：`Pill`、`Tag`、`StateDot`、`TextShimmer`、`PathLabel`、`ShortcutKeys`、`ConnectionIndicator`、`PermissionIcon`、`ReferenceIcon`、`LinkIcon`、`SiteGlyph`、`CodeFileIcon`、`FileTypeIcon`、`BrandWordmark`、`FishLogo`

**内容块**：`DiffBlock`、`JsonTree`、`ReadBlock`、`SearchBlock`、`TerminalBlock`、`WebBlock`、`CodeToolbar`、`ImagePreview`、`ImageLightbox`、`RiskConfirmation`

**markdown 子模块**：`MarkdownText`、`CodeBlock`、`JsonBlock`、`katex`、`highlight`、`incremental`、`file-link`、`local-image-syntax`、`useViewportHighlighting`

**settings-form 子模块**：`SettingsForm`、`form-model`、`fields`

**icons 子模块**：`icons/index`、`icons/props`、`icons/shared-artwork`

**hooks/工具**：`useAnchoredPosition`、`useAnchoredMaxHeight`、`useDismissOnOutsidePointer`、`useModalLayer`、`use-copy-feedback`、`focus`、`clipboard`、`ansi`、`code-highlighting`、`code-file-types`、`relative-time`、`file-size`、`head-tail-cap`、`rank-by-name`、`user-text`、`input-modality`、`keyboard-composition`、`darwin-desktop`、`overlay-top-margin`、`pointer-grace`、`guide-artwork`、`plugin-artwork`

**给「简洁纯文字/几何图形」UI 的建议**：优先 `Pill` / `Tag` / `StateDot` / `TextShimmer` / `DisclosureRow` / `Tooltip` / `SegmentedTabs` + 自绘内联 SVG。

⚠️ **实测的策略警告**（来自 `@nanmicoder/dsh-agent-teams\lib\client\icons.js` 顶部注释）：

> `/** Plugin-owned icons avoid depending on the host's generated design-export names. */`

⇒ 生产插件**不依赖宿主生成的 design-export 图标名**，而是自绘内联 SVG（`stroke = { fill:'none', stroke:'currentColor', strokeWidth:1.5, strokeLinecap:'round', strokeLinejoin:'round' }`）。这是稳定性上更安全的选择。

#### 3.6.6 主题 token

来源：`<PKG>\dsh-client-ui-theme\lib\client.js`（打包产物）与 `lib\styles\brand-font.css`。**`--dsw-alias-*` 共 107 个**。

**别名 token（`--dsw-alias-*`，107 个）**

- **背景**：`bg-base`、`bg-layer-1`、`bg-layer-2`、`bg-layer-3`、`bg-overlay`、`bg-skeleton`、`bg-multi-select`、`bg-mask-1/2/3`、`bg-mask-drop`、`bg-mask-photo`、`bg-module-platform`、`bg-document-preview`、`bg-document-selection`
- **边框**：`border-l1`、`border-l2`、`border-l3`、`border-l4`、`border-l2-darkmode-thin`、`border-inverted`、`border-inverted2`
- **文字/标签**：`label-primary`、`label-primary-dimmed`、`label-primary-foreground`、`label-primary-inverted`、`label-primary-bluish`、`label-secondary`、`label-tertiary`、`label-caption`、`label-dimmed`、`label-shimmer`、`label-deep-diving`、`label-deep-diving-shimmer`、`label-document-preview`、`link`
- **品牌**：`brand-primary`、`brand-primary-invert`、`brand-text`
- **按钮**：`button-primary-fill`、`button-primary-hover`、`button-primary-dimmed`、`button-elevated-fill`、`button-floating-fill`、`button-floating-hover`、`button-contrast-fill`、`button-ghost-active-fill`、`button-ghost-active-hover`、`button-ghost-active-border`、`button-info-fill`、`button-info-hover`、`button-tool-bar-fill`、`button-tool-bar-fill-invisible`、`button-tool-bar-hover`
- **交互态**：`interactive-bg-hover`、`interactive-bg-hover-accent`、`interactive-bg-hover-danger`、`interactive-bg-hover-solid`、`interactive-bg-active`
- **状态色（语义最有用）**：`state-success-primary/secondary/tertiary`、`state-warn-primary/secondary/tertiary`、`state-warn-label`、`state-error-primary/secondary`、`state-idle-primary`、`state-business-primary/tertiary`
- **markdown**：`markdown-inline-code`、`markdown-code-block`、`markdown-code-block-banner`、`markdown-code-segment-selected`、`markdown-code-segment-unselected`、`markdown-tag`、`markdown-citation`、`markdown-placeholder`
- **diff**：`code-diff-added`、`code-diff-deleted`、`file-diff-added-bg/gutter/marker`、`file-diff-deleted-bg/gutter/marker`
- **其它**：`scrollbar-bg-l1/l2`、`scrollbar-hover-l1/l2`、`menu-group-header-fill`、`menu-icon`、`tooltip-bg`、`tooltip-key-bg`、`toast-bg`、`toast-label`、`switch-thumb`、`settings-card-fill`、`settings-card-stroke`、`turn-trigger-bg`、`turn-trigger-bg-hover`、`onboarding-accent`、`onboarding-card-fill`、`onboarding-checkbox-border`、`onboarding-secondary-fill`

**非别名族**

- 阴影/层级：`--dsw-shadow-lv1`、`--dsw-shadow-lv1-blur`、`--dsw-shadow-lv2`、`--dsw-shadow-lv3`、`--dsw-elevation-stroke`、`--dsw-elevation-stroke-color`、`--dsw-elevation-panel`、`--dsw-elevation-prominent`、`--dsw-elevation-soft`
- 字体阶梯：`--dsw-font-family`、`--dsw-font-family-brand`、`--dsw-font-base-16`（+ `-font-family/-font-size/-font-style/-font-weight/-line-height`）、`--dsw-font-base-strong-16*`、`--dsw-font-l-20*`、`--dsw-font-m-18*`、`--dsw-font-markdown-base*`、`--dsw-font-markdown-code*`
- 焦点/形状：`--dsw-focus-ring-color`、`--dsw-focus-ring-width`、`--dsw-corner-shape`
- 渐变：`--dsw-linear-gradient-think`、`--dsw-linear-think-select`
- 菜单材质：`--dsw-menu-backdrop-filter`
- **DSH 自有（非 `--dsw`）**：`--dsh-content-font-size`（用户字号设置，默认 14px）、`--dsh-content-font-size-secondary`、`--dsh-content-font-delta`、`--dsh-content-font-delta-secondary`、`--dsh-scrollbar-thumb`、`--dsh-scrollbar-thumb-hover`、`--dsh-scrollbar-thumb-border`、`--dsh-scrollbar-track-margin`、`--dsh-scrollbar-width`（默认 5px）、`--dsh-boot-bg`、`--dsh-frame-leading-clearance`、`--dsh-composer-model-text-display`、`--dsh-composer-model-icon-display`

暗色模式以 `body[data-ds-dark-theme]` 为开关（`lib/index.js:40-41`、`README.md:40`）。`<PKG>\dsh-client-ui-theme\README.md:78` 说明 `--dsw-font-markdown-*` 阶梯由 `--dsh-content-font-delta` 从用户字号派生。

#### 3.6.7 locale 注册

```ts
// <PKG>\dsh-client-locale\lib\types\client\index.d.ts:199 / :209
register<N extends Extract<keyof LocaleNamespaceMap, string>>(
  ns: N, dicts: Record<BuiltInLocaleId, LocaleDictOf<N>>): () => void   // 类型化：所有内置 locale 必填（双balanced强制）
register(ns: string, locale: string, dict: LocaleDict): () => void      // 单 locale 非类型化形式（语言包）
bind<N>(ns: N): TranslateNS<N>                                          // 稳定身份，可挂 inject 面
addLanguage(input: LanguageRegistration): () => void
setLocale(id: string): void
getSnapshot(): LocaleSnapshot
subscribe(fn: () => void): () => void
```

命名空间也靠声明合并：`declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { '<ns>': '<KeyUnion>' } }`（`:20-27`）。已占用的 ns：`common`、`settings.locale`（locale 包）、`sidebarRight`（sidebar-right）、`conversation`（conversation）、`chat`（chat）、`shortcuts.layout`（layout）。

组件侧：在 `register({ locale: '<ns>' })` 里声明即可拿到框架合成的 `t` 座位（`dsh-client-ui-slots\index.d.ts:604-612`）；未安装 locale face 时**渲染会 fail loud**。

事件：`locale/change(snapshot)`——**只在活动 locale 切换时发出**；字典注册不发事件（避免 boot 期事件风暴），而是通过 `LocaleFace` 的 revision 驱动渲染刷新（`:62-70`、`:229-236`）。

---

### 3.7 审批

#### 3.7.1 `dsh-user-approval` 接口

```ts
// <PKG>\dsh-user-approval\lib\types\index.d.ts:105-157
export declare class ApprovalService extends Service {
  config: Config;                                   // { policy?: ApprovalPolicy }
  setPolicy(agent: Agent, policy: ApprovalPolicy): void;
  request(req: ApprovalRequest): Promise<ApprovalOutcome>;
  private effectivePolicy;
  overrideOf(session: Session): ApprovalPolicy | undefined;
  private decide;
}
```

```ts
// <PKG>\dsh-user-approval\lib\types\types.d.ts:26
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';
// <PKG>\dsh-user-approval\lib\types\index.d.ts:54
export type ApprovalPolicy = 'ask' | 'never';
// :56
export declare const APPROVAL_POLICIES: readonly ApprovalPolicy[];
// :63
export declare function setApprovalPolicy(session: Session, policy: ApprovalPolicy): void;
```

```ts
// <PKG>\dsh-user-approval\lib\types\index.d.ts:68-89
export interface ApprovalRequest extends ApprovalRequestEvent {
  readonly agent: Agent;             // 代表谁提问：路由（UI answerer 只回答自己拥有的 agent）+ 审计落点
  readonly toolName: string;
  readonly callId?: ToolCallId;      // 让 UI 把提示挂到已流式渲染的那个 tool call 上
  readonly reason?: string;          // asker 的「为什么问」
  readonly signal?: AbortSignal;     // abort 即撤回问题 → 立即 'cancelled'，迟到的答案被丢弃
}
```

`request()` 的精确契约（`index.d.ts:117-135`）：

> The request **requires an open turn** because the audit pair must be enclosed by the durable log's commit/replay boundary; **an idle ask rejects before appending anything**. The answerer phase always produces an outcome: an aborted signal yields `'cancelled'`, a **missing or throwing answerer yields `'unavailable'` (fail closed)**, and a **rogue non-vocabulary return value is normalized to `'unavailable'`**.

审计事件（`types.d.ts:27-52`）：`approval/asked { id, toolName, callId?, reason? }` → `approval/decided { id, outcome }`，**log-only**（不是 surface event，不带 `surfaceOp`）；**恰好一次**。策略切换也持久化：`approval/policy { policy, source?: 'delegation' }`（`index.d.ts:34-38`）——**最后一个此类事件即会话 override**。

策略语义（`index.d.ts:44-54`）：

- `'ask'`（默认）— 委派给已组合的 answerers；**没有 answerer 时链落到 fail-closed 的 `'unavailable'`**
- `'never'` — 不提示任何人：每次 ask 都确定性地解析为 `'rejected'`（CI/无人值守的严格姿态）

answerer 注册点是 waterfall 事件（`types.d.ts:72-82`）：

```ts
'approval/request'(this: Scoped<Agent>, req: ApprovalRequestEvent,
                   next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome>   // @mode waterfall
```

> Ask composed answerers for one decision. **Return an outcome to claim the request or call `next()` to delegate.** Scope-filtered dispatch: agent-scoped listeners receive only that agent.

#### 3.7.2 插件如何请求一次用户审批

**两条路：**

**路 A（推荐给工具实现）**——`tools/pre-execute` 返回 `{ kind: 'ask', reason?, displayReason? }`，由 registry 转调 approval seam。见 §3.3.3。这条路的 fail-closed 已由 registry 实现。

**路 B（直接调用）**：

```ts
const outcome = await ctx.approval.request({
  agent,                       // 必须是活体 Agent
  toolName: 'my_tool',
  callId,                      // 可选，把提示挂到 tool call 上
  reason: 'why I need this',
  displayReason: { en: 'Allow …?', zh: '是否允许…？' },
  signal,                      // 用当前 turn 的 signal
});
if (outcome !== 'allowed-once') { /* deny */ }
```

**必须在一个打开的 turn 内调用**，否则 reject。

#### 3.7.3 如何做到 fail-closed

设计插件时必须叠加的 4 层：

1. **只把 `'allowed-once'` 当授权**。其余三个（`'rejected'` / `'cancelled'` / `'unavailable'`）一律当拒绝（`types.d.ts:22-26`：Callers fail closed on `unavailable`）。
2. **不假设 approval service 存在**。`dsh-tools` 用的是 `ctx.get('approval')`（`dsh-tools\index.d.ts:816-827`），即**机会式消费**：没有 service、或会话中途卸载 → 保持 deny。插件也应如此（用 `ctx.get('approval')` 而不是静态 `inject: ['approval']`，否则整个插件会被一个可选能力挟持）。
3. **不假设有 agent**。无 agent 的执行**也降级**：没有 session 可审计、没有 UI 可路由 → deny（同处 doc）。
4. **用自己的单调 guard 兜底**：`ctx.tools.guard(exec => allowed(exec) ? undefined : 'reason')`。guard **只有拒绝、没有允许**，因此监听器顺序**无法把拒绝变回许可**（`dsh-tools\index.d.ts:514-522`）。

补充：`setPolicy(agent, 'never')` 是让整条链**确定性地不打扰人**的正解（CI/无人值守）；`ApprovalPolicy = 'never'` 下每次 ask 都返回 `'rejected'`，**无需** answerer。

#### 3.7.4 authorization 是另一回事

`dsh-authorization` **不是审批**，而是「凭据获取流程」缝（`<PKG>\dsh-authorization\lib\types\index.d.ts:1-27`）：获得一个无法仅从配置得到、必须与人类对话才能拿到的凭据（打开页面、粘贴 code、选账号）。它有独立的 `AuthorizationOutcome = 'authorized' | 'cancelled'`、`AuthorizationFlow.registerFlow/begin`、`AuthorizationInteraction.notify/prompt`、`AuthorizationDeclinedError`，以及 `authorization/settled` 事件。

二者**不应混用**：审批回答「是否允许这次动作」，授权回答「如何取得一个凭据」。

---

### 3.8 命令

```ts
// <PKG>\dsh-commands\lib\types\index.d.ts:94
register(definition: CommandDefinition): () => void
```

> Register a **global or calling-agent-scoped** command. Plain-context definitions are global; definitions registered through a command-injected child of an agent context **shadow globals for that agent**（`:76-79`）。

```ts
// <PKG>\dsh-commands\lib\types\index.d.ts:38-55
export interface CommandDefinition {
  readonly definitionId?: CommandDefinitionId;   // 稳定插件自有身份；无身份型客户端行为的定义可省
  readonly name: string;                          // 小写、无前导斜杠
  readonly description: string;                   // 发现 UI 用的摘要
  readonly input?: CommandInputDescriptor;        // { hint: string; attachments?: boolean }
  readonly recordInput?: boolean;                 // 默认 true；false = 不让 command/run 记录 rawInput
  readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>;
}
```

```ts
// :19-36
export interface CommandInvocation {
  readonly commandId: CommandId;                          // 已写入本次 command/run 的配对 id
  readonly agent: Agent;                                  // 收到命令的确切 agent
  readonly rawInput: string;                              // 名称之后的原文，含分隔空白
  readonly attachments: readonly (ImageBlock | FileBlock)[];  // 仅在 input.attachments 声明时非空
  readonly signal: AbortSignal;
}
// :33-41
export type CommandResult =
  | { readonly kind: 'success'; readonly text?: string; readonly sourceEventSeq?: SessionSeq }
  | { readonly kind: 'error';   readonly text: string };
```

**生命周期**（`:114-142`）：

> A resolved command's lifecycle is logged: **`command/run` is appended before the handler is invoked and `command/done` after settlement** (a thrown or aborted handler settles as `kind: 'error'`). Both are **direct log-only appends — no turn wraps them**, and persistence drains them at ordinary checkpoints. **Admission misses (syntax or unknown name) log nothing** — they never entered a handler.

**附件准入在此强制**，不在 composer：发给未声明 `input.attachments` 的命令、缺失附件存储、超出图片上限 —— 每种都在 handler 运行前结算为 error result（`:126-132`）。

工具函数与查询：

```ts
parseCommand(line: string): ParsedCommand | undefined        // :74  { name, rawInput }
list(agent: Agent): readonly CommandDescriptor[]             // :106  按名排序，已做 scope 遮蔽
find(agent: Agent, name: string): CommandDefinition | undefined   // :113
execute(agent: Agent, line: string, submittedAttachments, signal): Promise<CommandExecution | undefined>  // :142
registerFileReceiptResolver(resolver): () => void            // :100  唯一有权解析暂存文件收据者
```

注册表变更事件：`commands/change()`（`types.d.ts:78-87`，未过滤，因为全局或 scoped 变更可能影响任何 UI 视图；观察者失败被contain、不能否决变更）。

持久事件：`command/run { commandId, name, args?, source }` 与 `command/done { commandId, kind, text?, sourceEventSeq? }`（`types.d.ts:89-120`）。`args` 在 `recordInput: false` 时缺席。

---

## 4. 契约与版本稳定性线索

### 4.1 官方包的 peerDependencies 写法

**官方包之间：精确 pin，无范围。** 例（`dsh-subagent/package.json`）：

```json
"peerDependencies": {
  "@deepseek-ai/cordis": "~4.0.4",
  "@deepseek-ai/dsh-agent": "0.2.0-rc.2",
  "@deepseek-ai/dsh-llm": "0.2.0-rc.2",
  "@deepseek-ai/dsh-session": "0.2.0-rc.2",
  "@deepseek-ai/dsh-tools": "0.2.0-rc.2",
  ... 共 22 项
}
```

- **cordis 家族**：`~4.0.4`（波浪号：允许 patch）
- **所有 `@deepseek-ai/dsh-*`**：**精确版本字符串**，无 `^`/`~`/范围
- **自己实现的服务才放 `dependencies`**：`dsh-subagent` 的 `dependencies` 只有 `zod@^4.4.3`、`dsh-brand`、`dsh-chunked-list`、`dsh-util-values`、`schemastery@~3.18.4`（内部纯工具包，仍是精确 pin 的 dsh 包）

⇒ **官方把 peerDependency 当作 ABI 契约：精确版本 + 版本号即兼容承诺。** 这在 rc 阶段意味着**任何 patch 都可能是有意的破坏**，升级必须整栈对齐。

### 4.2 第三方插件的写法（3 种策略）

| 插件 | 写法 | 评价 |
| --- | --- | --- |
| `@deepseek-ai/dsh-toolkit@0.0.1`（官方示例插件） | `"@deepseek-ai/dsh-tools": ">=0.0.1-rc.1 <0.2.0"`, `"@deepseek-ai/cordis": "^4.0.1"`, `"@deepseek-ai/dsh-invariants": ">=0.0.1-rc.1 <0.2.0"` | **范围**：跨 minor 容忍，但**把 `0.2.0` 排除了** |
| `@nanmicoder/dsh-agent-teams@0.1.22`（生产 agent-team 插件） | 22 个 dsh 包全部写成 **显式 alternation**：`"0.2.0-rc.2 \|\| 0.1.7-rc.2 \|\| 0.1.5-rc.3 \|\| 0.1.5-rc.2 \|\| 0.1.5-rc.1 \|\| 0.1.2-rc.1 \|\| 0.1.2-alpha.5 \|\| 0.1.2-alpha.2"` + **全部 24 项 `peerDependenciesMeta.*.optional = true`** | **白名单枚举**：只有实测兼容的版本放行；`optional` 让缺包时不阻塞安装 |
| 官方 UI 包 | `peerDependencies: { "@deepseek-ai/cordis": "~4.0.4" }` 只放 cordis；其余 dsh 包全在 devDependencies 里精确 pin | 官方内部用法（同栈构建），第三方不能照搬 |

**对混合拓扑团队插件的建议**：采用 agent-teams 的 **白名单 alternation + 全 optional** 策略。理由：rc 阶段官方无兼容承诺；`optional: true` 避免宿主缺失某个 UI 包时安装整体失败。

### 4.3 双 half 包的声明契约

```jsonc
{
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".":        { "types": "./lib/types/index.d.ts",        "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle":  { "patch": "./cordis.patch.yml" },     // host 侧 Loader 补丁（第三方用它挂进 cordis.yml）
    "client":  { "inject": ["@deepseek-ai/dsh-client-..."], "platform": "web" }
  },
  "engines": { "node": "^22.19.0 || >=24" }
}
```

- `dsh.bundle.patch` **只在第三方插件里出现**（官方 UI 包没有它，因为官方走 bundles）——这是插件挂进 host Loader 的入口
- `dsh.client.platform = "web"` + `exports["./client"]` 是浏览器 half 的**唯一发现机制**（`<PKG>\dsh-client-modules\lib\types\index.d.ts:1-26`：扫描 host Loader 条目中声明 `dsh.client` 的包，在 module-graph 顺序上组装 `window.__DSH_BOOT__` 入口图）。**扫描是增量式的，没有全量重扫路径**；每个 cordis `internal/plugin` 发射把该 fiber 的 entry name 标脏，microtask flush 后与活体 loader 条目对账
- `engines.node` 在官方与第三方都一致：`^22.19.0 || >=24`

### 4.4 deprecation 标记

**在 `dsh-subagent\lib\types\*` 与 `dsh-client-ui-slots\lib\types\*` 中 grep `@deprecated`：0 命中。**

⇒ 官方包**不使用 `@deprecated` JSDoc 标记**。兼容性靠**精确版本 pin + 新包（如 `dsh-session-format-v0-to-v1` / `-v1-to-v2` / `-v2-to-v3` 三个迁移包）**表达，而不是靠注释标记。

**实践含义**：不要指望 TypeScript/IDE 提示你某个 API 要废弃；唯一的信号是版本号变化与新增迁移包。

### 4.5 官方示例插件的实际形态

`@deepseek-ai/dsh-toolkit@0.0.1`（**private: true**，本地示例包，位于 `profiles\web\node_modules\@deepseek-ai\dsh-toolkit`）是一个可直接抄的模板：

```
dsh-toolkit/
  package.json          # dsh.bundle.patch + exports + peerDeps 范围写法
  cordis.patch.yml      # host Loader 补丁
  lib/index.js          # 汇总入口（lib/types/index.d.ts 出类型）
  packages/
    dsh-tool-calculator/    # 每个工具一个子包，含 lib/ src/ tests/ tsconfig.json README
    dsh-tool-csv/  dsh-tool-diff/  dsh-tool-encoding/  dsh-tool-json/
    dsh-tool-markdown/  dsh-tool-regex/  dsh-tool-schema/  dsh-tool-stat/  dsh-tool-time/
  scripts/              # build-all.sh / test-all.sh / link-deps.sh
```

**它有 `peerDependenciesMeta` 之外的完整 peerDep 三件套**（`dsh-tools` + `dsh-invariants` + `cordis`）——注意它还依赖 `@deepseek-ai/dsh-invariants`，那是运行时不变量库，**新插件应考虑同样依赖它**以保证契约违反时 fail loud。

### 4.6 已知缺口 / 风险清单

| 编号 | 缺口 | 证据 | 影响 |
| --- | --- | --- | --- |
| G1 | **client Inspect 全部超时** | `cordis_inspect_query(client, ...)` × 3 均 `timed out after 10000ms` | Slot 树与主题 token 未经运行时实测；以 `.d.ts` 与产物为唯一依据 |
| G2 | **`@deepseek-ai/dsh-client-store` 未安装** | `Test-Path <PKG>\dsh-client-store` = `False`；`dsh-client-ui-slots\lib\types\store.d.ts:2` 是纯 re-export | 插件工程里 `PropsStore` / `StoreDecl` / `HandleOf` / `BoundActions` / `SnapshotSelectorHook` / `MaybeSnapshotSelectorHook` 等类型**无法解析**；需自行声明或绕过 store 座位 |
| G3 | **无 per-child 总 token 预算** | `AgentOptions` 只有 `maxTokens`（单请求输出上限）；`SubagentStartRequest` 无预算字段 | 团队插件需自建配额层（可用 `ctx.tokenMeter.measure(session, header?)`） |
| G4 | **`sendMessage` 只有直接邻接** | `subagent\index.d.ts:143-157` "direct parent or direct continuable child" | 任意成员间消息必须由插件自建 mailbox（agent-teams 就是这么做：`lib/mailbox.js`） |
| G5 | **`agentTeams` 不是官方核心** | 实现在 `@nanmicoder/dsh-agent-teams@0.1.22`；`<PKG>` 无对应包 | 新插件若复用该 Service key 会与已装插件冲突（同一 key 只能一个 provider） |
| G6 | **`subagents` 全局容量上限默认 8 / 默认深度 1** | `dsh-subagent\index.d.ts:101-107` | 混合拓扑（>8 并发成员）需调 `maxActiveSubagents`；默认深度 1 时成员不能再委派 |
| G7 | **审批要求打开的 turn** | `dsh-user-approval\index.d.ts:117-135` "an idle ask rejects before appending anything" | 空闲期的审批必须靠 `sendMessage`/`followup` 先起 turn |
| G8 | **官方无 `@deprecated`** | grep 0 命中 | 无编译期废弃信号；升级只能靠版本 pin 对齐 |

---

## 5. 对「混合拓扑 agent team 插件」的关键结论

### 5.1 可直接复用的能力

1. **子代理生命周期已完整**：`start`（一次性，`spawn` 零上下文 / `fork` 带父上下文 seed）/ `startContinuable`（durable child id + inbox 消息 id）/ `sendMessage`（idle 起 turn、absent cold-resume）/ `interrupt`（fire-and-return，保留未认领 inbox 与后代）/ `listChildren` / `listDescendants`（不加载 Agent）。
2. **能力声明与 fail-loud**：`SubagentCapabilities` 在委派前逐项校验，请求不支持的能力**直接报错**，绝不静默降级。
3. **模型选择白名单现成**：`AllowedModelRoute` + `ModelSelectionPolicy` + `assertAllowedModelSelection` + `preflightChildLlmRoute`，模型面向字段名 `provider` / `model` / `reasoning_effort`；路由发现用 `ctx.llm.listProviders()/listModels()/resolveModelInfo()`。
4. **工具权限有单调拒绝通道**：`tools/pre-execute` 的 `ask` 走 approval seam，`ctx.tools.guard` 只能拒绝不能放行。
5. **持久化有事务化 domain**：durability-first 写链、`update()` 原子读改写、`per-record` layout 便于稀疏大记录。
6. **UI 有加性浮层席位**：`shell.overlay`（list/root）是唯一**明确设计给第三方加性注入**的全框席位；右侧栏扩展用 `sidebar.right.pane.tab`（keyed）+ `sidebarRightTabs.register` 注册 tab type；会话内联卡片用 `conversation.chat.node`（keyed）。

### 5.2 必须自建的层

1. **成员间任意通信**：`sendMessage` 只能直接邻接 ⇒ 需要自建 mailbox / 路由表（参照 agent-teams 的 `lib/mailbox.js` + `lib/members.js`）。
2. **任务/依赖图**：官方无任务板抽象 ⇒ 自建（agent-teams 的 `lib/scheduler.js` + `lib/state.js`，并用 storage domain 持久化）。
3. **配额与深度**：`maxActiveSubagents` 默认 8、`maxDepth` 默认 1，且无 per-child 总 token 预算 ⇒ 需自建配额层。
4. **拓扑可视化**：官方无团队拓扑 UI ⇒ 用 `shell.overlay` + `sidebar.right.pane.tab` 自绘（几何图形建议自绘内联 SVG，见 §3.6.5 的实测警告）。
5. **会话身份到成员的映射**：SessionId 与 Agent id 相同，但**运行时所有权 ≠ durable 血缘**（`isOwnedBy` 的 doc）；跨重启的成员识别必须落在 durable session metadata + 自有 domain 记录上，不能靠内存注册表。

### 5.3 架构建议（基于先例）

实测的 `@nanmicoder/dsh-agent-teams` 的分层是最可靠的模板：

```
lib/index.js            host 插件体（apply(ctx, config)）
lib/members.js          成员生命周期（spawn/续跑/interrupt）
lib/mailbox.js          邻接之外的成员间消息路由
lib/scheduler.js        任务调度与依赖（DAG）
lib/state.js            durable 状态（storage domain）
lib/quality-gates.js    质量门（review/verification 契约）
lib/events.js           事件词汇 + 快照
lib/snapshot.js         跨 half 的结构化快照
lib/tools.js            面向模型的工具注册
lib/command.js          / 命令注册
lib/web-routes.js       HTTP 路由（webServer.register）
lib/profiles.js         profile 选择（走 subagents provider）
lib/client/index.js     浏览器 half：apply(ctx) + ctx.slots.inject/register
lib/client/AgentTeamsCard.js / ActivityPanel.js / WorkspaceActivity.js
```

它的 client 注册点（**可直接照抄的 slot 选择**）：

| Slot | kind | 用途 |
| --- | --- | --- |
| `conversation.session.header.actions` | list, `id: 'agent-teams-entry'`, `order: 50` | 会话头部的团队入口按钮 |
| `conversation.chat.turnTail` | list, `id: 'agent-teams-summary'`, `order: 50` | 每个 turn 尾部的团队摘要卡 |
| `sidebar.right.pane.tab` | keyed, `key: TEAM_TAB_ID` | 右侧栏的团队监控面板（真实生产形态） |
| `shell.overlay` | list, `id: 'agent-teams-activity'`, `order: 80`, `label: ...` | 全框浮动的活动指示 |
| `conversation.chat.commandview` | keyed, `key: 'agent-teams'` | 隐藏命令行 |
| `conversation.chat.node` | keyed, `key: 'agent-teams'` | 团队卡片本体 |

它的 `inject` 声明与子上下文用法（`lib\client\index.js:10,21,38`）：

```js
export const inject = ['uiConversation', 'slots', 'sessions', 'locale', 'modelDirectories', 'layout'];
export function apply(ctx) {
  ctx.inject(['sidebarRight', 'sidebarRightTabs'], (native) => { /* 可选能力作用域 */ });
}
```

> `// Optional service scope keeps legacy hosts working`（`lib\client\index.js:36-37`）

⇒ **可选能力用 `ctx.inject([...], cb)` 包住，而不是放静态 `inject` 数组**，这样缺服务时只丢功能、不丢插件。

---

## 6. 附：本稿证据索引

| 主题 | 主要文件 |
| --- | --- |
| Inspect provider 清单 | `cordis_inspect_list` 返回值 |
| host Service 目录（91 key） | `cordis_inspect_query(host, Service, listService)` |
| 子代理契约 | `<PKG>\dsh-subagent\lib\types\{index,types,control-types}.d.ts` |
| spawn / fork | `<PKG>\dsh-subagent-spawn-in-process\lib\types\index.d.ts`、`<PKG>\dsh-subagent-fork-in-process\lib\types\index.d.ts` |
| Agent / AgentOptions / inbox | `<PKG>\dsh-agent\lib\types\{index,runtime-types,types,model-selection}.d.ts` |
| 模型路由 / reasoning | `<PKG>\dsh-llm\lib\types\{index,types}.d.ts` |
| 模型选择白名单 | `<PKG>\dsh-tool-subagent\lib\types\{model-selection,model-selection-state,list-models,index}.d.ts` |
| 工具注册 / schema / 权限 | `<PKG>\dsh-tools\lib\types\{index,schema,json-schema,presentation}.d.ts` |
| 命令 | `<PKG>\dsh-commands\lib\types\{index,types}.d.ts` |
| 审批 | `<PKG>\dsh-user-approval\lib\types\{index,types}.d.ts` |
| 授权 | `<PKG>\dsh-authorization\lib\types\{index,types}.d.ts` |
| 存储枢纽 / domain / JSON 后端 | `<PKG>\dsh-storage\lib\types\{index,backend,registry}.d.ts`、`<PKG>\dsh-storage-domain\lib\types\{spec,domain}.d.ts`、`<PKG>\dsh-storage-json\lib\types\index.d.ts` |
| 会话持久化 / 检索 | `<PKG>\dsh-session-persistence{,-jsonl}\lib\types\index.d.ts`、`<PKG>\dsh-session-query{,-sqlite}\lib\types\index.d.ts` |
| 投影 | `<PKG>\dsh-session-projection\lib\types\index.d.ts`、`<PKG>\dsh-session-projection-cache\lib\types\index.d.ts` |
| 系统提示 | `<PKG>\dsh-system-prompt\lib\types\index.d.ts` |
| Slot 核心 / SlotMap | `<PKG>\dsh-client-ui-slots\lib\types\{index,renderer,store}.d.ts` |
| 客户端渲染器 / ctx.slots | `<PKG>\dsh-client-ui-renderer\lib\types\client\{index,registry}.d.ts` |
| layout slots | `<PKG>\dsh-client-ui-layout\lib\types\client\{index,columns,AppFrame,service,stores}.d.ts` |
| sidebar-right slots | `<PKG>\dsh-client-ui-sidebar-right\lib\types\client\contract\{slots,params,seed}.d.ts`、`client\service.d.ts` |
| conversation slots | `<PKG>\dsh-client-ui-conversation\lib\types\client\contract\slots.d.ts` |
| chat slots | `<PKG>\dsh-client-ui-chat\lib\types\client\contract\slots.d.ts` |
| UI primitives | `<PKG>\dsh-client-ui-primitives\lib\types\**` |
| locale | `<PKG>\dsh-client-locale\lib\types\{index,client\index,locales\*}.d.ts` |
| 主题 token | `<PKG>\dsh-client-ui-theme\lib\client.js`、`lib\index.js`、`README.md` |
| client 包发现 | `<PKG>\dsh-client-modules\lib\types\{index,client\manifest}.d.ts` |
| 双 half 声明 | 各 UI 包 `package.json` 的 `dsh` 字段与 `exports` |
| 官方示例插件 | `<PROFILE_WEB>\node_modules\@deepseek-ai\dsh-toolkit\**` |
| 生产 agent-team 先例 | `<PROFILE_DESKTOP>\node_modules\@nanmicoder\dsh-agent-teams\**` |

其中 `<PKG>` = `C:\Users\KEI.NEO\.dsh\profiles\node_modules\@deepseek-ai`，
`<PROFILE_WEB>` = `C:\Users\KEI.NEO\.dsh\profiles\web`，
`<PROFILE_DESKTOP>` = `C:\Users\KEI.NEO\.dsh\profiles\desktop`。
