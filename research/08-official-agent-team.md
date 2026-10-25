# 08 · DSH 官方 Agent Teams 子系统（第 6 家竞品，用户清单外）

> 调研人：Captain 一手精读（README.zh + 类型声明 + profile patch）
> 来源：`$DSH_HOME\staging-upgrade-20260929\node_modules\@deepseek-ai\`
> 版本：**`0.2.0-rc.2`** —— 与本机 DSH CLI 版本**完全一致**
> 状态：**实验性发布（experimental）、不承诺稳定性**，通过 opt-in bundle 启用

---

## 0. 为什么这一家最重要

用户列了 5 个竞品，**全部是社区插件**。但在本机 `staging-upgrade-20260929` 里躺着 **4 个官方包**：

| 包名 | 职责 |
|---|---|
| `@deepseek-ai/dsh-experimental-agent-team` | 领域服务：roster + 持久 mailbox + 共享任务 DAG |
| `@deepseek-ai/dsh-experimental-tool-agent-team` | 9 个模型工具 |
| `@deepseek-ai/dsh-experimental-client-ui-agent-team` | Web 面板 |
| `@deepseek-ai/dsh-experimental-agent-team-profile` | opt-in bundle（一行挂载上面三个） |

**并且 `dsh-team-rooms` 的作者已于 2026-10-05 主动 RETIRED 自己的插件，弃用理由指向官方。** 品类正处在"官方收编"阶段。

**结论：任何新 agent-team 插件的定位，必须先回答"与官方是什么关系"。**

---

## 1. 官方宣称与设计理念

包描述（`package.json`）：

> **Implicit-root Agent Teams roster, durable peer mailbox, and shared task DAG**

四项设计承诺（`README.zh.md:103-108`）：

1. **持久日志，派生状态** — Lead 会话日志是唯一真源；roster、mailbox、任务状态每次读取都从中**回放**。
2. **进程内归属** — 所有协作在单一进程；保证是**重试 + 去重**，绝不是跨进程共识。
3. **显式权限** — 每个服务方法都接收**确切的实时调用方 `Agent`**；只有 Lead 可以 spawn / reassign / interrupt。
4. **超出上限时明确失败** — 每个限制都是经校验的部署值，耗尽时报告**类型化错误**，而不是复用 id 或名字。

> 📌 第 3 条是**很强的安全设计**：权限凭据是"活的 Agent 对象本身"，而不是可伪造的字符串 id。这是本报告最推荐借鉴的机制之一。

---

## 2. 核心架构：隐式根（Implicit Root）

`README.zh.md:129`：

> 每个普通运行时 root 都是一个隐式 Team 的 Lead，其 `TeamId` 等于 `SessionId`；**不存在创建事件**，持久状态从第一条成员、消息或任务记录开始。

**含义**：
- 没有"建队"这一步 —— 每个会话天然就是一支（单成员的）团队的 Lead
- 团队身份 = 会话身份，无额外生命周期
- **这是比 dsh-agent-teams 的 "staged plan → approve" 更轻的模型**

---

## 3. 三个子系统

### 3.1 Roster（成员名册）

- `spawnTeammate()` 先追加并 flush 一条 `provisioning` 记录，再要求 provider 创建预留 child；provider 失败会追加一条持久的 `failed` 成员记录
- 两种上下文模式：**fresh**（不携带 Lead 历史）/ **fork**（只捕获一次 Lead 的已完成 turn 前缀）
- 状态枚举：`running` / `inactive`（无执行轮次，含已加载与仅存储）/ `provisioning` / `failed`
- **名字永久保留，永不复用** —— 连创建失败的 teammate 也占着名字
- 恢复对账：把未终结的 provisioning 记录对照 child 的持久化会话；direct parent 与 continuable descriptor 匹配且初始用户消息已记录 → `active`，否则 → `failed`。同进程竞争先完成则报 `TEAM_PROVISIONING_CONFLICT`

### 3.2 Mailbox（持久点对点邮箱）—— **用户最关心的能力的官方实现**

`README.zh.md:133`（关键段）：

- `sendMessage()` **校验 peer 成员关系**，追加 `team/message/queued` 并 flush
- **任何成员都可以向任何其他成员或 Lead 发送消息** → **这是对等的（peer-to-peer）拓扑，不是星型！**
- live 成员立即收到；**离线成员的消息排队，恢复后到达**
- **"消息不会丢失，也不会重复投递"**
- 投递给 Lead：直接调用 `Agent.steer()`
- 投递给 teammate：走 **continuation owner 的 host-only Steer 路径**，保留 Team 发送者 source，同时授权 **Lead-to-child edge** 并**冷恢复 inactive target**
- **"sibling 消息绝不会通过公开的相邻 Agent 消息操作伪装成 Lead"** ← 防身份伪造
- 去重保证：**进程内重试 + target 会话去重**；明确**不是**跨进程 exactly-once

投递语义（`README.zh.md:71`）：

> 每条消息都使用 **Steer**：running target 在最近的步骤边界收到消息，inactive target 在已加载时启动一个轮次，否则冷恢复。发送方始终能看到结果——target inbox 已接受，或保留为 `queued`。

> ⚠️ **注意：官方 mailbox 是"投递即唤醒"的**（Steer 语义会启动/恢复 target 的轮次）。这正是用户 U-7 担心的回声风暴机制的**充要条件之一**。官方只靠 `maxPendingMessagesPerMember: 64` 兜底 —— **没有跳数、速率、静默判定、方向约束**。→ **这是新插件最明确的价值缺口。**

### 3.3 Task Board（共享任务 DAG）

- 任务含：标题、详情、**对其他任务的可选依赖**、可选**文件触及提示**（`writeScopes`）
- **只有全部依赖完成后，任务才可 claim**
- `expectedRevision` **compare-and-set**：陈旧调用方收到 `TEAM_TASK_STALE_REVISION`，不会覆盖更新值
- 已删除任务作为 **tombstone** 保留以供回放与 id 稳定，不占 `maxTasks`，不出现在 `listTasks()`
- `writeScopes` 是规范化后的 workspace 相对前缀；重叠只**发出警告，绝不阻止 claim 或授予写权限**
- id 形如 `task-<n>`，id 空间耗尽报 `TEAM_TASK_LIMIT`，**不复用最后一个 id**

### 3.4 部署上限（`cordis.patch.yml` 实配 = bundle 默认）

| 字段 | bundle 实配 | 包默认 | 含义 |
|---|---|---|---|
| `maxMembers` | **8** | 16 | 含失败的 teammate 在内 |
| `maxTasks` | 256 | 256 | 活动任务上限 |
| `maxPendingMessagesPerMember` | 64 | 64 | 单成员排队消息上限 |
| `maxMessageBytes` | 65536 | 65536 | 单条消息最大尺寸 |
| `disposalTimeoutMs` | 5000 | 5000 | 关闭清理时限 |

---

## 4. 服务契约 `ctx.agentTeams`（`lib/types/index.d.ts`）

`TeamService extends Service`，公开方法（**全部以 `agent: Agent` 作第一个参数** —— 权限凭据）：

| 方法 | 签名要点 | 权限 |
|---|---|---|
| `membership(agent)` | → `TeamMembership`（root / Team 身份 / role / model-facing name） | 任意成员 |
| `tryMembership(agent)` | → `TeamMembership \| undefined`（不抛异常，供 scoped-tool 安装与观察者用） | — |
| `listMembers(agent)` | → `TeamMemberView[]`，按创建序 | 任意成员 |
| `spawnTeammate(caller, req)` | → `Promise<SpawnTeammateResult>`；req 含不可变 name/description/prompt/context mode/provider/cancellation | **仅 Lead** |
| `sendMessage(caller, req)` | → `Promise<SendTeamMessageResult>`；durable message identity + 即时投递观察 | 任意成员 |
| `createTask(caller, req)` | → `Promise<TeamTaskView>`（revision 1，无 owner） | 任意成员 |
| `getTask(caller, id)` | → `TeamTaskView`（含已删除 tombstone） | 任意成员 |
| `listTasks(caller)` | → `TeamTaskView[]`（非删除，数字创建序） | 任意成员 |
| `updateTask(caller, req)` | → `Promise<TeamTaskView>`（CAS 变更） | 任意成员 |
| `waitForChange(caller, timeoutMs, signal)` | → `Promise<TeamWaitResult>`；**10 秒 ~ 1 小时**；只报告是否超时 | 任意成员 |
| `interrupt(caller, targetName)` | → `{ previousStatus }`；**保留 pending inbox** | **仅 Lead** |

**注入**：`static inject: string[]`；`static Config: z<Config>`。

---

## 5. 工具面（`dsh-experimental-tool-agent-team`）

**9 个工具，Lead 与每个 teammate 都拿到完全相同的 9 个 schema**，执行时才检查 Lead-only 权限：

| 类别 | 工具 |
|---|---|
| 创建 teammate | `spawn_teammate`（**仅 Lead**）：名字、描述、初始任务 |
| 发送消息 | `send_message`：在最近步骤边界对 running 成员 steering；启动/恢复非活动成员 |
| 查看与等待 | `list_agents`（返回 `target` 与可用状态）、`wait_agent`、`interrupt_agent`（**仅 Lead**） |
| 任务板 | `team_task_create` / `team_task_list` / `team_task_get` / `team_task_update` |

**关键工程细节**：
- **按作用域注册，而非全局**：每个注册位于成员 Agent 自己的 `ctx` 上；`maybeInstall` 对每个 live Agent 运行并订阅 `agent/created`，**跳过没有 Team 成员关系的 Agent**
- **与旧版同名全局 subagent 控件冲突**：`spawn_teammate`/`send_message`/`list_agents`/`interrupt_agent`/`wait_agent` 与旧全局 continuable-subagent 控件同名，**scoped 注册只为团队成员覆盖全局控件** → 想同时用两者的组合**必须禁用旧定义**（profile patch 正是这么做的）
- **声明式结果，紧凑 JSON**：每个工具声明完整结果 schema，渲染为紧凑 JSON，"任何结果都不会在缩进上消耗 token"
- **固定策略，不会自主建队**：`README.zh.md:147` —— "**不会自主创建 Team** —— 除非用户明确要求，普通任务不会触发 delegation"

---

## 6. UI（`dsh-experimental-client-ui-agent-team`）—— 与用户 U-3 痛点直接对应

**挂载点**：通过 Cordis effect 注册 locale 字典 + **一个 conversation-header slot**（会话页头 action）。

### 6.1 面板结构

- 从共享 Session store 读 **Lead 会话的 `agentTeam` 投影**
- **Roster 行**：持久名称 + 阶段
  - `provisioning` / `running` → 共享 ongoing loading
  - **`inactive` → 人物图标**
  - `failed` → error 红点
  - 实时 Session 状态提供运行活动；共享 `modelSelection` 投影在可用时提供模型
- **任务板（只读）**：
  - 可开始的 pending → **idle 灰点**
  - 被依赖阻塞的 pending → **warning 橙点**
  - in-progress → ongoing loading
  - completed → done 绿点
  - 展示：任务标识、负责人、依赖、就绪状态、提示性写入范围、重叠警告；**超过两行的描述提供展开按钮**
- **面板是只读的**：不能 spawn / rename / delete / interrupt

### 6.2 ⚠️ 官方自述的 UI 缺陷（`README.zh.md:204-210`）

> **完整视图广播** — 每次 roster 或任务变化都会把**完整 roster 和未删除任务板（含描述）发给所有已连接浏览器**，即使它正在查看其他 Session。

**这一条几乎逐字命中用户 U-3："侧栏界面信息过于杂乱，我没法抓住重点"。**

> **没有 mailbox timeline** — 投影视图只承载 roster 与任务；**不显示 peer 消息**。
> **没有 lifecycle 或 workspace control** — 面板不能 spawn、rename、delete 或 interrupt。

---

## 7. 官方的硬约束清单（已有什么 / 缺什么）

### ✅ 已有

| 机制 | 实现 |
|---|---|
| 权限凭据 | 方法收 `Agent` 对象本身；仅 Lead 可 spawn/reassign/interrupt |
| 资源上限 | maxMembers / maxTasks / maxPendingMessagesPerMember / maxMessageBytes |
| 上限行为 | **类型化错误 + 绝不复用 id/名字** |
| 并发写 | CAS `expectedRevision` + `TEAM_TASK_STALE_REVISION` |
| 幂等 | 进程内重试 + target 会话去重（折叠 live 与持久 inbox/历史） |
| 事件合法性 | **`./invariant` 伴生插件：append 前回放候选事件对照已提交前缀，拒绝非法转换** |
| 身份伪造防护 | sibling 消息**不会**伪装成 Lead 投递 |
| DAG 就绪 | 依赖未全部完成不可 claim |

### ❌ 缺失（= 新插件的价值空间）

| 缺口 | 证据 | 对应痛点 |
|---|---|---|
| **无嵌套团队** | `README.zh.md:208` "**扁平且不可变的 roster**——只有 Lead 可以创建直接 teammate；**不支持嵌套 Team**、重命名、删除或名字复用" | U-9/U-10/U-11/U-12 |
| **无逐成员模型/强度指定** | 服务方法**没有任何 model / reasoningEffort 参数**；`SpawnTeammateRequest` 只有 name/description/prompt/contextMode/provider/cancellation | U-5 |
| **无投递方向/跳数/速率/静默约束** | 只有 `maxMessageBytes` 与 `maxPendingMessagesPerMember`；投递是 Steer（**即唤醒**） | U-7 |
| **UI 全量广播** | 官方自述已知限制第 1 条 | U-3 |
| **无 mailbox timeline** | 官方自述 | U-3 |
| **无飞行中改拓扑** | UI 只读 | U-12 |
| **writeScope 仅提示** | 官方自述："Bash、formatter、代码生成器与直接外部写入可以绕过文件版本检查" | — |
| **owner 不自动释放** | 官方自述 | — |
| **单进程、共享 checkout** | 无 worktree / 远端成员 / merge / 文件锁 | — |
| **mailbox 不保证跨进程 exactly-once** | 官方自述 | — |

### 官方自认的"未来方向"（`README.zh.md:226`）—— 全部"没有承诺"

> 尚未决定的探索方向包括**嵌套 Team**、自动释放 owner 的策略、跨进程 mailbox 事务，以及通过 worktree 实现文件系统隔离

> 📌 **"嵌套 Team" 被官方明确列为未承诺的探索方向 —— 这正是用户 U-10 的核心诉求。空白是真实的、官方承认的。**

---

## 8. 对 `dsh-agent-teams-concourse` 定位的决定性影响

### 8.1 逐项对比：官方 vs 社区 vs 用户要的

| 能力 | 官方 experimental | nanmicoder agent-teams | team-rooms | **concourse 应做** |
|---|---|---|---|---|
| 持久点对点邮箱 | ✅ 强 | ❌（captain 中继） | ✅ | **复用官方** |
| 共享任务 DAG | ✅ 带 CAS | ✅ 带质量契约 | ❌ 只有三态 | **复用 + 加质量契约** |
| 顶层拓扑 | 隐式根单锚点 | 星型单层 | 网状 | **拓扑即数据** |
| 嵌套子团队 | ❌ 明确不支持 | ❌ | ❌ | 🎯 **核心增量** |
| 逐成员模型/强度 | ❌ 无参数 | ✅ 工具里有 | ❌ | 🎯 **核心增量 + 自动建议** |
| 通信硬约束 | ⚠️ 仅容量上限 | ⚠️ 部分 | ❌ | 🎯 **核心增量** |
| UI 密度 | ⚠️ 全量广播 | ❌ 拟人化 + 杂乱 | ⚠️ 平板 | 🎯 **核心增量（反拟人、决策优先）** |
| 零美术资产 | ✅ 无美术资产 | ❌ 15 张鲸鱼 PNG | ✅ | ✅ 坚持 |
| 审批负担 | 低（无 staged plan） | ❌ 高（staged plan + 多次） | 中（handoff 审批） | 🎯 **一次审批** |

### 8.2 三条路线，及其取舍

| 路线 | 说明 | 优点 | 风险 |
|---|---|---|---|
| **A. 独立自建** | 自己实现 roster/mailbox/DAG | 完全可控，不绑实验 API | 重造轮子；且与官方 scoped 工具**同名冲突**（`send_message`/`list_agents`/`wait_agent`/`interrupt_agent` 已被官方占用） |
| **B. 完全寄生** | 只做官方之上的 UI + 建议 | 最省力 | 无法补官方缺的"嵌套团队"（服务层不支持） |
| **C. 分层**（推荐） | **复用官方 mailbox/DAG 作底座，在之上加"concourse 层"** | 不重造轮子；增量精准落在官方明确缺失处 | 需承受实验 API 漂移 → 用**薄适配器**隔离 |

**推荐 C**，理由：
1. 官方已把最难做对的部分（持久邮箱去重、CAS 任务板、恢复对账、不变式校验）做扎实了
2. 官方明确不做嵌套 → concourse 的"子团队"可以作为**服务之上的一层拓扑投影 + 任务树映射**实现，而不必改服务
3. **但适配器必须薄**：官方是 experimental、无稳定性承诺，且 API 明确可能自由变更

### 8.3 必须避让的命名冲突（实测）

官方 scoped 工具已经占用了：`spawn_teammate`、`send_message`、`list_agents`、`wait_agent`、`interrupt_agent`、`team_task_create/list/get/update`。

→ concourse 的新工具**必须另起命名空间**，建议前缀 `concourse_*`（例如 `concourse_define`、`concourse_assign`、`concourse_link`、`concourse_plan`）。

---

## 9. 可复用清单（给新插件）

| 机制 | 复用价值 | 说明 |
|---|---|---|
| **权限凭据 = 活的 `Agent` 对象** | ⭐⭐⭐ | 无法伪造，比字符串 id 安全得多；所有服务方法都该这样 |
| 持久日志为唯一真源、状态回放派生 | ⭐⭐⭐ | 崩溃恢复天然正确，无需额外快照 |
| `./invariant` append 前回放校验 | ⭐⭐⭐ | **硬约束的正确落点**：非法转换在写入前就被拒绝 |
| CAS `expectedRevision` | ⭐⭐⭐ | 多写者不互相覆盖 |
| 类型化错误 + 绝不复用 id/名字 | ⭐⭐⭐ | 失败可诊断，不静默破坏状态 |
| 事件不进会话表面（`team/*` 仅存日志） | ⭐⭐⭐ | **协作记录不污染模型历史** —— 对 token 与 KV cache 都友好 |
| `waitForChange` 有界等待（10s~1h） | ⭐⭐ | 比轮询好；只报告超时，调用方重读状态 |
| 按作用域注册（scoped tools） | ⭐⭐⭐ | 只给团队成员装工具，非成员完全无感 —— 惰性安装的优雅实现 |
| tombstone 保持 id 稳定 | ⭐⭐ | 回放与引用不破 |
| 明确区分"进程内重试+去重"与"跨进程 exactly-once" | ⭐⭐⭐ | **诚实的能力边界声明**，不夸大保证 |
