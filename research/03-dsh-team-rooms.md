# dsh-team-rooms v1.0.4 深度逆向调研报告

> 调研对象：本机已安装插件 `dsh-team-rooms@1.0.4`
> 路径：`C:\Users\KEI.NEO\.dsh\profiles\web\node_modules\dsh-team-rooms\`
> 方法：精读 `src/` TypeScript 源码（优先于 `lib/`）、`ARCHITECTURE.md`、`README*.md`、`cordis.patch.yml`、`package.json`、`lib/types/**/*.d.ts`，并对本机**真实运行数据**（存储域、投影缓存、profile 配置）做实证校验。
> 证据标注：`文件:行号`。凡无法从代码或本机数据确证的，一律写"**未确认**"。
>
> 阅读提示：本报告的证据行号基于软件包内实际文件。`src/` 为随包发布的 TypeScript 源码（`package.json:33` 把 `src` 列入 `files`），与 `lib/` 构建产物同源。

---

## 1. 定位与需求：为什么需要"跨会话房间"

### 1.1 一句话定位

`dsh-team-rooms` 把**若干个彼此独立的 DSH 会话**变成一个协同团队：一个 **房间（room）** = `{成员(每个成员都是一个独立会话), 消息总线, 共享任务板, 共享时间线}`，持久化在 harness 自己的存储层里，每个成员仍保有自己的独立会话日志（`ARCHITECTURE.md:3`）。

包描述原文：*"Persistent multi-agent team rooms for DeepSeek Harness: cross-session rooms with a message bus, a shared task board, approval-gated handoffs and a shared timeline that survive DSH restarts. Extracted from dsh-background-agents 0.9.6, whose background-agent half is superseded by native DSH continuable subagents."*（`package.json:5`）

### 1.2 需求来源：一个被"抽出来"的插件

这不是从零设计的产品，而是**从 `dsh-background-agents` 0.9.6 里切出来的另一半**：

- 原包有两半：**后台代理半**（`background_agent` 与五个 `bg_*` 工具）与**团队房间半**。
- 后台代理半被 DSH 原生的 continuable subagents（`subagent` / `subagent_fork`）取代，于是**被删除**。
- 团队房间半**没有原生等价物**，因此单独成包继续存在（`README-zh.md:28`、`ARCHITECTURE.md:5`、`package.json:5`）。

这解释了插件里一切"看起来不像新设计"的地方：四段**冻结身份字符串**必须与 0.9.6 逐字节一致，否则既有 profile 的存储域、会话日志、设置页全部失联（`ARCHITECTURE.md:9-18`）：

| 冻结字符串 | 声明位置 | 不能改的原因 |
|---|---|---|
| `team_rooms` | `src/room/domain.ts:47` | 存储域的磁盘身份；改名会让所有房间/成员/消息/任务变孤儿 |
| `teamRoom` | `src/room/projection.ts:268` | 投影缓存键 + 客户端 `faceOf('teamRoom')` 查找键 |
| `team-room/fact` | `src/room/events.ts:26` | 会话日志事件类型；旧成员日志里已有该类型的记录 |
| `team-rooms` | `src/client/index.ts:209` | 设置页 slot id |

外加一个**故意不改名**的生产者标签：`PLUGIN = 'dsh-background-agents'`（`src/vocabulary.ts:44`），因为存量 `tool/result` 的 `presentationMeta.plugin` 里写着它，改名会把一个逻辑生产者劈成两个字符串（`vocabulary.ts:1-17`、`ARCHITECTURE.md:18`）。

### 1.3 README / ARCHITECTURE 的宣称能力

宣称的产品面只有**四件**（`README-zh.md:43-50`）：

1. **`/room` 命令族** —— `create|join|leave|list|send|tasks|task add|assign|claim|done|delete`；房间有名、有属主、用可粘贴的稳定 roomId 寻址。
2. **八个 `room_*` 工具** —— 模型在自己的会话内操作共享任务板与总线；跨成员交接（`room_transfer_task`）先请求审批。
3. **持久房间存储** —— 存放在 `team_rooms` 存储域（SQLite 或 JSONL 后端，由部署决定，插件不新增任何服务），DSH 重启后恢复。
4. **Web 设置页** —— 显示当前会话所属每个房间的成员状态、任务板与时间线；读自 `teamRoom` 投影，写回通过宿主 `/room` 命令。

### 1.4 作者自划的边界（`ARCHITECTURE.md:121-127`）

- **不派生 subagent**：房间半从不 spawn / message / interrupt 子代理；包不声明任何 `subagent:*` 权限，不声明子代理依赖，`inject` 列表里也没有 `subagents`。"**成员是用户（或别的接缝）已经拥有的一个会话。**"（`ARCHITECTURE.md:123`）
- **不调度**：房间拥有"共享对象"，不拥有"何时跑"（`ARCHITECTURE.md:124`）。
- **不跨机器**：每个成员都是本部署的进程内会话（`ARCHITECTURE.md:125`）。
- **不做成本核算**：那属于已删除的后台代理半（`ARCHITECTURE.md:126`）。
- **存储是唯一的持久化依赖**：没有 `@deepseek-ai/dsh-storage-domain` 时，`/room` 与 `room_*` 保持休眠，插件其余部分正常加载（`ARCHITECTURE.md:127`；代码见 `src/index.ts:197-202`）。

**它明确不是**什么（`README-zh.md:134-140`）：

| 对比项 | 它做什么 | 本插件的边界 |
|---|---|---|
| `dsh-automation` | 在新会话里跑定时编码任务 | 它管"**何时**跑"（调度）；本插件管"多个会话共同操作的**共享对象**"——没有调度接缝、没有 cron |
| `dsh-plugin-agent-dashboard` | 多 agent 仪表盘（只读展示为主） | 本插件的房间是**可写的协同状态**：一条总线、一块任务板、需审批的交接 |
| `dsh-background-agents` | 后台代理（此前也带团队房间） | 其 `bg_*` 已被原生子代理取代；它的房间半**就是本包**。**不要同时挂载两个房间半**（`README-zh.md:84`） |

---

## 2. 完整工具面：8 个 `room_*` 工具的参数 schema 与语义

全部定义在 `src/room/tools.ts`，注册入口 `registerRoomTools(ctx, hub)`（`tools.ts:105`），由 `src/index.ts:208` 在存储域可用时调用。**实测注册数 = 8**（`tools.ts:107/174/235/305/375/436/488/555`；`README-zh.md:121` 也强调"以上是**八个**"）。工具用 `defineTool` 定义，`output.schema` 为 JSON Schema，`isConcurrencySafe: () => true`（8 处皆同）。

### 2.1 工具总表

| # | 工具 | 参数 | 返回 | 语义与关键约束 |
|---|---|---|---|---|
| 1 | `room_list_rooms` | 无（`parameters: {}`，`tools.ts:112`） | `{rooms: [{roomId, name, createdAt, memberCount, openTasks, inProgressTasks, doneTasks, members[], myRole}]}`（`tools.ts:114-149`） | 列出**本会话所属**的每个房间；`members[].sessionId` 暴露全部成员会话 id（这是模型获知其他成员身份的**唯一**途径）。渲染为 `"<name>" — N members, X open / Y in-progress / Z done (you: role)`（`tools.ts:152-157`）。无房间时渲染 `(this session is not a member of any team room)`（`tools.ts:153`） |
| 2 | `room_post` | `room_id: string 必填`；`text: string 必填`；`to?: string`（成员 session id，省略=广播）（`tools.ts:181-197`） | `{roomId, seq}`（`tools.ts:199-206`） | **唯一的发消息工具**。描述原文："Live members are woken with the message as their next turn; offline members receive it when their session next starts."（`tools.ts:178-180`）——**这就是自动派发的自述**。`presentationMeta` 打 `plugin/action/roomId/seq`（`tools.ts:213-218`） |
| 3 | `room_read` | `room_id: string 必填`；`since?: number`（`tools.ts:240-248`） | `{messages: [{seq, senderSessionId, toSessionId?, text, createdAt}]}`（`tools.ts:251-270`） | 读总线的**保留窗口**内、`seq > since` 的消息。`since` 非安全整数或 <0 时静默回落为 0（`tools.ts:289-291`）。**先做成员校验**，非成员抛 `RoomError('not-member')`（`tools.ts:286-288`）。注意：这是**拉取**接口，但系统提示词明确要求模型不要用它轮询（`src/index.ts:279-283`） |
| 4 | `room_list_tasks` | `room_id: string 必填`（`tools.ts:311-315`） | `{tasks: [{taskId, title, description, status, assigneeSessionId?, createdBy, createdAt, updatedAt}]}`（`tools.ts:318-337`） | 读任务板；同样先做成员校验（`tools.ts:356-358`）。`assigneeSessionId` 为 null 时**从输出中省略该字段**（`tools.ts:365`） |
| 5 | `room_create_task` | `room_id`、`title` 必填；`description?`；`assignee?`（成员 session id）（`tools.ts:381-398`） | `{taskId, status: 'todo'}`（`tools.ts:401-408`） | 新建一张 `todo` 卡片。**注意：`title`/`description` 没有任何长度上限**（见 §4.3）。空标题抛 `empty-title`（`hub.ts:473-474`）；`assignee` 非成员抛 `unknown-target`（`hub.ts:470-472`） |
| 6 | `room_claim_task` | `room_id`、`task_id` 必填（`tools.ts:442-451`） | `{taskId, status: 'in-progress', assigneeSessionId}`（`tools.ts:454-461`） | 认领：状态置 `in-progress` + 指派人=自己（`hub.ts:714-724`）。**不检查任务是否已被他人认领**——重复认领会直接覆盖 assignee（见 §4.6） |
| 7 | `room_transfer_task` | `room_id`、`task_id`、`to` 全必填（`tools.ts:495-509`） | `{taskId, assigneeSessionId, approved: true}`（`tools.ts:512-519`） | **唯一审批闸门工具**。流程：`approvalOf(ctx)` → `requireApproval(...)` → 通过后才 `hub.assignTask`（`tools.ts:536-550`）。审批通过后：任务变 `in-progress` + 新 assignee + 时间线 `task-assigned` + **自动向新 assignee 发一条定向消息** `Task assigned to you: <title>`（`hub.ts:751-759`），该消息会唤醒对方 |
| 8 | `room_complete_task` | `room_id`、`task_id` 必填（`tools.ts:559-569`） | `{taskId, status: 'done'}`（`tools.ts:572-579`） | 置 `done`。**权限**：只有 assignee 或房主能完成，否则 `not-assignee`（`hub.ts:705-707`）；已完成的任务是幂等的（直接返回，`hub.ts:704`） |

### 2.2 模型**没有**的能力（同样重要）

`room_*` 工具集里**没有** `room_create_room` / `room_join_room` / `room_leave_room` / `room_delete_room`。房间的**建立、加入、退出、销毁**只能由人来做：

- 宿主命令 `/room create|join|leave|delete`（`src/room/commands.ts:152-173, 239-242`）；
- Web 设置页按钮 → 仍转成 `/room …` 行执行（`src/client/index.ts:194-202`）。

**推论（对回声风暴非常关键）**：模型**无法自我扩员**，也无法把第三个会话拉进房间。扇出宽度被"人类预先设定的名册"封顶。见 §4.7。

### 2.3 稳定错误码全集（`RoomError`，`hub.ts:67-72`）

从源码穷举：`store-unavailable`（`hub.ts:152`）、`empty-name`（271）、`room-cap`（273）、`member-cap`（304）、`membership-cap`（307）、`owner-leave`（349）、`not-owner`（379）、`empty-message`（401）、`message-too-long`（403）、`not-member`（409/468/697）、`unknown-target`（412/471/712）、`unknown-room`（1037）、`empty-title`（474）、`unknown-task`（702）、`not-assignee`（706）、`ambiguous-room`（141，命令侧）、`approval-unavailable` / `approval-denied`（`tools.ts:54/61`）。命令侧把 `RoomError` 渲染成 `"<code>: <message>"`（`commands.ts:270-275`）。

---

## 3. 代码实现逻辑

### 3.1 房间数据结构（schema）

**权威 schema**：`src/room/schema.ts`（zod v3，全部 `.strict()`）；`lib/types/room/schema.d.ts` 是同一 schema 的生成声明（实测该文件第 22/27 行 `lastDeliveredSeq: z.ZodNumber` / `lastFactSeq: z.ZodNumber`，第 78/80 行 `busNext` / `timelineNext`，第 534-541 行导出 `RoomMember/RoomRecord/BusMessage/TaskRecord/TimelineEvent/TeamRoomView` 类型别名，第 549 行 `isTeamRoomView`）。

#### (a) room 记录 `roomRecordSchema`（`schema.ts:33-43`）

```ts
{ roomId: string(≥1), name: string(≥1), createdAt: int≥0,
  members: RoomMember[],                                   // 注册顺序
  busNext: int≥0,        // 下一个要铸造的 bus seq（每房间单调；排序权威）
  timelineNext: int≥0 }  // 下一个 timeline seq
```

#### (b) member 槽 `roomMemberSchema`（`schema.ts:13-30`）

```ts
{ sessionId: string(≥1),                     // 真身份：就是会话 id 字符串
  role: 'owner' | 'member',
  joinedAt: int≥0,
  lastDeliveredSeq: int≥0,   // 该成员日志已收到"模型可见投递"的 bus seq（0=还没有）——离线发件箱游标
  lastFactSeq: int≥-1 }      // 该成员日志已带"仅日志事实"的 timeline seq（-1=还没有）
```

两个游标是**投递语义的全部**：只有投递落地后才推进 → 至少一次投递（`ARCHITECTURE.md:46-55`）。

#### (c) 总线消息 `busMessageSchema`（`schema.ts:46-55`）

```ts
{ roomId, seq: int≥0,            // 每房间单调：所有读者一致认同的顺序
  senderSessionId: string(≥1),
  toSessionId?: string(≥1),      // 省略 = 广播给每个成员
  text: string,                  // ← 注意：无 max()（见 §4.3）
  createdAt: int≥0 }
```

#### (d) 任务卡 `taskRecordSchema`（`schema.ts:58-70`）

```ts
{ roomId, taskId, title: string(≥1), description: string,
  status: 'todo'|'in-progress'|'done',
  assigneeSessionId: string|null,    // null = 未指派
  createdBy, createdAt, updatedAt, completedAt? }
```

#### (e) 时间线 `timelineEventSchema`（`schema.ts:86-94`）+ 9 种 kind（`schema.ts:73-83`）

```ts
{ roomId, seq: int≥0, kind: TimelineKind, at: int≥0, data: Record<string, unknown> }
kind ∈ { room-created, member-joined, member-left,
         message-posted, message-directed,          // ← 定向消息单独一种 kind
         task-created, task-claimed, task-assigned, task-completed }
```

`data` 是 `Record<string, unknown>`（弱类型、按 kind 约定）——这与其他严格 `.strict()` 记录形成对比，是 schema 里唯一的松口。

#### (f) 折叠出来的线上视图（wire value，`schema.ts:99-130`）

`roomViewMemberSchema`（去掉游标）、`roomViewTaskSchema`、`roomViewSchema{roomId,name,createdAt,members,tasks,timeline}`、`teamRoomViewSchema{rooms: RoomView[]}`，以及运行时守卫 `isTeamRoomView`（`schema.ts:150-153`）——客户端读到的投影 cell 是 `unknown`，必须过这个守卫。

#### (g) 仅日志事实 `team-room/fact`（`src/room/events.ts`）

`TEAM_ROOM_FACT = 'team-room/fact'`（`events.ts:26`），`TeamRoomFact` 是**闭合判别联合**，8 个 kind（`events.ts:29-110`）：`room-joined`（**全量快照**：房间身份+名册+开放任务+保留的时间线，让冷启动的成员日志无需读存储即可重建）、`member-joined`、`member-left`、`message-posted`（可选 `toSessionId`）、`task-created`、`task-claimed`、`task-assigned`、`task-completed`。每个承载时间线的事实都带**权威存储的 `timelineSeq`**，因此折叠顺序与存储完全一致（`events.ts:17-18`）。模块通过 `declare module` 把该事件类型合并进 `SessionEventMap`（`events.ts:112-116`）。

### 3.2 持久化：用 DSH storage domain，不自己写文件

**是的，用的是官方 storage domain**，四张 KV 表（`src/room/domain.ts:46-55`）：

```ts
export const teamRoomsDomainSpec = defineDomain({
  name: 'team_rooms', version: 1,
  tables: {
    rooms:    domainTable<RoomKey, RoomRecord>(roomRecordSchema),
    bus:      domainTable<AppendKey, BusMessage>(busMessageSchema),
    tasks:    domainTable<AppendKey, TaskRecord>(taskRecordSchema),
    timeline: domainTable<AppendKey, TimelineEvent>(timelineEventSchema),
  },
})
```

- **键布局**（`hub.ts:84-86`）：`rooms` 用 `roomId`；`bus`/`timeline` 用 `` `${roomId}/${seq}` ``；`tasks` 用 `` `${roomId}/${taskId}` ``。反解 seq 靠 `seqOf`（取最后一个 `/` 之后）。
- **没有独立数据库、没有网络**（`README-zh.md:145`）。
- **zod v3/v4 桥接**：`dsh-storage-domain` 的表 schema 槽按 zod **v4** 定型，而本包用 zod **v3**，两大版本结构上不可赋值，于是有一个**有意的、有文档的**强制转换（`domain.ts:25-40`）。同样的桥接在投影注册槽也有一份（`projection.ts:243-264`），并说明"注册表只对该 schema 调 `parse`，两个大版本实现一致"。

**实测文件布局**（本机真实数据，非文档推断）：

```
C:\Users\KEI.NEO\.dsh\storages\team_rooms.json          (913,738 bytes)
{
  "unit":   { "name": "team_rooms", "version": 1 },
  "global": null,
  "tables": {
    "rooms":    { "<roomId>": { ...RoomRecord } },
    "bus":      { "<roomId>/<seq>": { ...BusMessage } },
    "tasks":    { "<roomId>/<taskId>": { ...TaskRecord } },
    "timeline": { "<roomId>/<seq>": { ...TimelineEvent } }
  }
}
```

本机后端是 **JSON 文件后端**（`@deepseek-ai/dsh-storage-json`）——插件本身对 SQLite/JSON 无偏好（`domain.ts:1-6`：*"SQLite or JSONL backend — the deployment chooses"*；`cordis.patch.yml:3-4` 同）。本节实测数据见 §附录 A。

### 3.3 重启恢复逻辑

三层：

1. **存储域是唯一持久权威**。挂载时 `RoomHub.open()` 打开域并缓存四张表（`src/index.ts:203-207` → `hub.ts:148-188`）。open 与 `roomOpenTimeoutMs`（默认 15000ms）赛跑：卡死的 provider 以 `RoomError('store-unavailable')` 明确失败，而不是让 `/room` 永远不发出 `command/done`；超时后**迟到到达的域会被立刻关闭**，不留孤儿句柄；正常卸载时通过 `ctx.effect` 注册的关闭钩子关域（`hub.ts:159-176`）。
2. **每次操作先 `await this.ready`**（`hub.ts:193-237`）；打开的失败通过 `requireRooms()` 等在**第一次调用时就大声失败**（`hub.ts:1041-1045`），而非半写。
3. **会话侧重建**：成员会话启动/恢复时 `catchUp(sessionId)` 重放错过的 bus 消息与事实（`src/index.ts:225-245` 挂 `agent/created`；实现 `hub.ts:546-589`）。注意 `agent/created` 是**串行 waterfall**——注册表要等所有监听器返回才完成注册，所以该监听器**绝不允许 await 存储 I/O**：同步判定（来源过滤 + 内存成员表），把真正的活交给 `queueMicrotask`，并吞掉自己的失败（`index.ts:212-245`）。`clear`/`compact` 复用活会话、其 catch-up 已跑过，因此被跳过（`index.ts:230-232`）。

### 3.4 消息投递机制：一条 room 消息如何进入另一个会话

**结论：经由官方 agent inbox，不经过任何私有通道。** 这是本插件最重要的机制。

链路（`hub.ts:779-805` `deliverPosted`，由 `postMessage` 在写链之后调用，`hub.ts:441`）：

```
room_post / /room send / inbound 桥
   → RoomHub.postMessage()                        hub.ts:393-455
       ├─ onRoomChain(roomId)                     每个房间一条投递链（顺序 = bus seq 顺序）
       │   ├─ trim + 长度校验                       hub.ts:400-404
       │   └─ enqueue(...)  单写链：投消息/时间线/更新 busNext/timelineNext/修剪
       │                                            hub.ts:405-439
       ├─ deliverPosted(room, message, event)      hub.ts:441 → 779-805
       │    for each member:
       │      ├─ 若该成员会话存活 → appendFactTo(member, fact)   （仅日志事实）
       │      └─ 若该成员是收件人 → agent.followup(roomUserMessage)  ★ 唤醒
       └─ advanceCursors(room, message, event)     hub.ts:443 → 807-827
            （游标只在投递落地之后推进 = 至少一次）
```

**收件人判定**（`hub.ts:792-794`）：

```ts
const isRecipient = message.toSessionId === undefined
  ? member.sessionId !== message.senderSessionId   // 广播：排除发送者自己
  : member.sessionId === message.toSessionId       // 定向：只发目标
```

**两类唤醒的语义差别**（决定性证据来自 DSH 宿主 API 类型声明，`C:\Users\KEI.NEO\.dsh\profiles\node_modules\@deepseek-ai\dsh-agent\lib\types\runtime-types.d.ts`）：

| API | 宿主文档原文 | 行号 | 效果 |
|---|---|---|---|
| `agent.followup(message)` | *"Queue an ordinary follow-up turn and **wake the driver**. The item becomes the **sole ordinary message of its own turn**."* | `runtime-types.d.ts:187-192` | **开启被投递会话的一个全新完整回合**，无需人工确认 |
| `agent.inject(message)` | *"Queue model-facing context for the next pre-step **without waking the driver**. … idle drivers leave it pending until follow-up or steering wakes them."* | `runtime-types.d.ts:201-209` | **不唤醒**；作为待处理上下文，等下一次被唤醒时才进入请求 |

插件用法与之严格对应：

- **在线成员** → `agent.followup`（`hub.ts:800-802`）：*"Live members are woken with the message as their next turn"*（`tools.ts:178-180`）。
- **离线成员** → `agent.inject`（`hub.ts:566-568`）：在成员会话下次启动时的 catch-up 里注入积压；注释明说 *"no wake: the user is opening the session; the backlog enters the next request context"*（`hub.ts:560-563`）。同时**跳过该成员自己发的消息**（`hub.ts:565`）。
- **房间简介** → `agent.inject`（`hub.ts:614-621`）：同样不唤醒。

**模型可见 ⟺ 已记录**：两处投递都用 `createUserMessage(...)` 构造真实用户消息，源标记为插件（`hub.ts:845-854` 的 relay 消息、`hub.ts:614-621` 的 notice 简报），因此**每条模型看见的房间消息都是该成员会话日志里的持久 `user/message`**（`ARCHITECTURE.md:37-44`、`README-zh.md:128`）。来源类型用 `SOURCE_KIND = 'dsh-background-agents'`（`vocabulary.ts:44,51`），并把该 kind 通过 `declare module` 合并进 harness 的 `MessageSourceMap`（`vocabulary.ts:36-41`）——注释解释了为什么不能用旧的 `{kind:'plugin'}` 形状：类型层与持久化层（session-format v3→v4）都已拒绝它（`vocabulary.ts:24-34`）。

**投递模型可见文本**（`hub.ts:843-855`）：

```
[team-room <roomId>] <senderSessionId> (broadcast|to you): <text>
```

**初始化简报**（`hub.ts:633-641`，`injectRoomBrief` 默认 true）：

```
You are a helpful assistant in team room <name>. Room id: <id>. Members: N other session(s); each member is an independent session.
Collaborate with room_post (broadcast or direct a message), room_list_tasks, room_claim_task, room_create_task, room_transfer_task, room_complete_task, and room_list_rooms.
You are notified here when room messages arrive. Keep your room turns brief and prefer your own session for private work.
```

简报每进程幂等：`briefed: Map<sessionId, Set<roomId>>`，加入后又走激活路径不会重复注入；离开或房间销毁会清除记录，重启后按构造会重新注入（`hub.ts:115-120, 600-630`）。

**系统提示词段**（`src/index.ts:272-284`），order 108（与 0.9.6 一致）：

> "When this session is a member of a team room, room messages are delivered into this conversation **automatically — do not busy-poll room_read**. Keep room turns brief: room_post sends messages, room_list_tasks/room_claim_task work the shared board, and room_transfer_task asks approval before handing a task to another member."

这段话把"投递是推送、不是拉取"写进了模型的系统提示——**这是自觉的设计选择，也直接决定了回声风暴是否可能**（§4.4）。

### 3.5 会话如何"加入"房间；身份如何标识

**加入路径只有两条**（模型没有工具）：

1. `/room join <roomId>` 命令（`commands.ts:159-165`），实现 `hub.joinRoom(sessionId, roomId)`（`hub.ts:298-339`）。
2. Web 设置页"加入房间"按钮 → `remote.commands.execute(sessionId, '/room join <id>')`（`client/index.ts:195`）。

**首成员**由 `/room create` 产生，`role: 'owner'`（`hub.ts:276-290`）；后续加入者 `role: 'member'`（`hub.ts:309-315`）。属主不能在其他成员还在时离开（`owner-leave`，`hub.ts:348-350`），必须 `/room delete`（仅属主，`hub.ts:378-380`）。

**身份 = 会话 id 字符串**（`roomMemberSchema.sessionId`，`schema.ts:15`）。工具侧从 `exec.agent.id` 取得调用者身份（`tools.ts:161, 222, 283, 353, 422, 476, 534, 593`），命令侧从 `invocation.agent.id`（`commands.ts:265`）。**没有用户名、没有设备指纹、没有跨机器标识**——成员名册按会话计而非按用户计（`README-zh.md:182`）。

加入时的**游标初始化很讲究**（`hub.ts:309-315`）：新成员的 `lastDeliveredSeq = record.busNext`、`lastFactSeq = record.timelineNext - 1`——即"**之前的历史不算你要补的**"，历史以 `room-joined` 全量快照事实一次性给它；随后才给其他成员广播 `member-joined` 事实（`hub.ts:326-336`）。

### 3.6 投影（session projection）：`teamRoom` 如何折叠事件

定义在 `src/room/projection.ts:267-284`，注册于 `src/index.ts:267-269`：

```ts
export const teamRoomProjectionDefinition = {
  key: 'teamRoom',
  stateSchema: teamRoomViewSchema,
  init: () => ({ rooms: [] }),
  apply(state, event) {
    if (event.type !== TEAM_ROOM_FACT) return state   // 外来事件是 no-op（返回同一对象引用）
    return applyFact(state, event)
  },
  wire: { viewSchema: teamRoomViewSchema, view: state => ({ rooms: state.rooms.map(capDoneTasks) }) },
  stateVersion: 1,
}
```

要点：

- **纯折叠、只吃自己日志里的事件**：类型不匹配就返回**同一个 state 对象**，因此投影缓存对外来事件是零成本 no-op（`projection.ts:273-276`；`ARCHITECTURE.md:71`）。
- **折叠与线上值同一形状**，唯一差别是 done 任务积压：**state 保留全部**，`wire.view` 施加 `capDoneTasks`（`projection.ts:269-270, 277-282`）。
- **两个硬边界**：`TIMELINE_FOLD_BOUND = 1000`（每房间时间线条目上限，`projection.ts:21`）、`DONE_TASK_FOLD_BOUND = 100`（每房间 done 任务上限，`projection.ts:23`，实现 `projection.ts:226-236`）。
- **时间线按 seq 去重 + 保序**：`appendTimeline` 先 `some(existing => existing.seq === event.seq)` 去重，再排序、`slice(-1000)`（`projection.ts:39-45`）。**这是全插件唯一的去重，且只影响"显示"，不影响"投递"**（见 §4.3）。
- 各 kind 的折叠：`room-joined` 只在房间未知时插入（`projection.ts:70-94`）；`member-joined`/`member-left` upsert 名册（95-125）；`message-posted` 追加一条时间线，按 `toSessionId` 是否存在归类为 `message-posted` / `message-directed`（126-141）；四个 task 事实 upsert 板行（142-218）。
- **`stateVersion: 1` 与 0.9.6 写下的持久缓存格式一致**（`projection.ts:283`；`ARCHITECTURE.md:75`）。`declare module` 把 `teamRoom` 合并进 `SessionProjectionStateMap` 与 `SessionProjectionMap`（`projection.ts:286-295`）。
- 投影是**每会话自己重建的副本**，存储仍是权威；这就是"重开设置页瞬间渲染、不需要读存储"以及"投影缓存丢了只损失一次重折叠"的原因（`ARCHITECTURE.md:76-77`）。

### 3.7 事实追加的宿主闸门（`FactAppender`）

`src/facts.ts` 是唯一的追加接缝：

- 追加请求带 `{ ignorable: true }` 信封标记（`facts.ts:70`）。
- **两个宿主线触发降级**（`facts.ts:5-18`）：① rc 线直至 `0.1.1-rc.2`，`Session.append` 早于 `ignorable` 标记，写进去的事件未标记，更严格的宿主会**拒绝恢复**该会话；② **`0.1.2-alpha.1` 及之后，宿主对会话事件词表 fail-closed**，`team-room/fact` 不在 `KNOWN_SESSION_EVENT_TYPES` 里，写进去会让会话不可读。
- 分类函数：`factEventPolicyForVersion`（`audit.ts:105-112`）—— `major > 0 || minor > 1 || (minor === 1 && patch >= 2)` → `'forbidden'`。`isUnmarkedHostVersion`（`audit.ts:61-70`）只匹配 `^0\.1\.(\d+)-rc\.(\d+)$`。
- 被禁时：事实交给 fallback（logger/panel 通道），**不写会话日志**（`facts.ts:66-68, 77-91`）；不可标记时：跳过追加并给一次性警告（`facts.ts:93-106`）；未知版本：先追加一次再探测返回信封（`facts.ts:108-117`）。
- `allowUnmarkedFacts: true` 可强行回写——**故意危险**（`facts.ts:16-18`；`index.ts:86-95`）。

> **本机实测结论（重要）**：本 profile 安装的 `@deepseek-ai/dsh-session` 版本是 **`0.2.0-rc.2`**（实测 `C:\Users\KEI.NEO\.dsh\profiles\node_modules\@deepseek-ai\dsh-session\package.json`）。代入 `factEventPolicyForVersion`：major=0、minor=2 → `minor > 1` 成立 → **`'forbidden'`**。因此在本部署上**所有 `team-room/fact` 都改走 logger fallback，从不写入会话日志**，`teamRoom` 投影**永远是空折叠**。
> 实证：`dict_maintenance` 房间的 4 个真实成员，其投影缓存里的 `teamRoom` 值全部是 `{"ver":1, "seq":<n>, "val":{"rooms":[]}}`（文件 `C:\Users\KEI.NEO\.dsh\storages\session_projcache\sessions\session-3f783d79-*.json`、`session-77778b0a-*.json`、`session-82c262c6-*.json`、`session-945d030b-*.json`）。
> **产品含义**：在 ≥0.1.2-alpha.1 的宿主上，**"Web 设置页"这条产品面实质失效**（面板读不到任何房间），而 `/room` 命令与八个 `room_*` 工具完全正常。README 也承认这一点（`README-zh.md:32`），但"网页设置页"仍被列为四大能力之一（`README-zh.md:50`）——这是一个**文档与实际行为之间的落差**。

---

## 4. 硬约束与回声风暴防护（重点，逐条查证）

> 用户痛点原话："会话间通信缺少硬约束，多会话间通信极易造成回声风暴。"
> 下面按六个维度逐条查证。**结论先行：插件确实有一批"硬约束"，但它们全是"空间/容量"约束（房间数、成员数、保留窗口、单条长度），没有一条是"时间/因果"约束（速率、冷却、跳数、去重、拓扑）。而投递默认是"自动唤醒并开启一个新回合"。因此回声风暴在架构上完全可能。**

### 4.1 有没有消息长度 / 房间数 / 成员数 / 保留窗口上限？

**有，7 个，全部是 Schemastery 校验过的 Config 字段**（`src/index.ts:64-98` 的 `Config` 接口、`122-134` 的 `DEFAULTS`、`136-152` 的 schema；`cordis.patch.yml:25-34` 也把这些默认值注释出来作参考）。

| 键 | 默认值 | schema 约束 | 实现位置（强制点） | 语义 |
|---|---|---|---|---|
| `maxRooms` | `16` | `natural().max(MAX_SAFE_INTEGER)`，**无 min** | `hub.ts:272-274` | profile 内房间总数的硬上限；超限抛 `room-cap` |
| `maxMembersPerRoom` | `8` | `natural().min(2).max(...)` | `hub.ts:303-305` | 每房间成员上限；超限抛 `member-cap`。schema 的 `min(2)` 保证不会配成 <2 |
| `maxRoomsPerMember` | `4` | `natural().min(1).max(...)` | `hub.ts:306-308` | 一个会话可加入的房间数；超限抛 `membership-cap` |
| `busRetention` | `200` | `natural().min(1).max(...)` | `hub.ts:1006-1011`（`pruneRoom`，由 `postMessage` 在 `hub.ts:437` 调用） | 每房间保留的总线消息数；`seq <= busNext-1-retention` 的条目被删 |
| `timelineRetention` | `500` | `natural().min(1).max(...)` | `hub.ts:1012-1016` | 每房间保留的时间线条目数 |
| `taskRetention` | `50` | `natural().max(...)`，**无 min** | `hub.ts:1017-1023` | 每房间保留的**已完成**任务数；超出按 `completedAt` 从旧到新删 |
| `maxMessageChars` | `4000` | `natural().min(1).max(...)`，**无上限** | `hub.ts:400-404` | 单条总线消息文本的硬上限；**超限直接拒绝（`message-too-long`），绝不截断** |

三个 `@room`/`maxRooms` 的特殊性值得记一笔：`maxRooms` 与 `taskRetention` 都没有 `.min()`，所以 `maxRooms: 0` 是**合法配置**且会让所有 `/room create` 失败；`busRetention` 的 `.min(1)` 被注释专门解释——"0 保留会让每条消息一落地就被抹掉，schema 禁止"（`index.ts:140`）。所有上限的 `max()` 都只是 `Number.MAX_SAFE_INTEGER`，即**实际上限由人类配置者决定**。

#### 能否绕过？

- **长度上限不可从模型侧绕过**：`room_post`（`tools.ts:224-229`）、`/room send`（`commands.ts:184-188`）、inbound 桥（`index.ts:314`）**都走同一个 `hub.postMessage`**，检查在 hub 层（`hub.ts:400-404`）。没有旁路。
- **但它是"入口校验"而不是"存储层校验"**：`busMessageSchema.text` 是裸 `z.string()`（`schema.ts:53`），**没有 `.max()`**。也就是说，任何直接对 `domain.table('bus').put()` 写入的代码（本插件内没有，但同进程的其他插件可以拿到域句柄）、或由别的版本/配置写出的存量记录，都不会被长度校验。**上限是 API 契约，不是数据不变量。**
- **房间/成员上限是硬闸门**：都在写链内部判定（`createRoom` 的 `enqueue` 里、`joinRoom` 的 `enqueue` 里），因此并发创建/加入不会竞态超限（`ARCHITECTURE.md:29-33`）。
- **保留窗口是"可配"而非"可绕"**：`maxRooms: 1000`、`busRetention: 10_000_000` 都是合法配置。**配置即授权**——没有第二道防线。

**关键判断**：这 7 个上限**全都是容量约束**。它们约束的是"存储能涨到多大""一条消息能有多长"，**没有任何一条约束"单位时间内能发生多少次投递"**。

### 4.2 有没有深度 / 跳数限制（A→B→A 的往复）？

**没有。全插件不存在任何跳数、深度、因果链或父消息概念。**

穷举搜索正则 `rate|throttle|cooldown|debounce|dedup|idempot|depth|hop|loop|storm|echo|budget|quota|backoff|circuit` 覆盖整个 `src/`，命中项**没有一个是速率/深度/循环防护**：命中的只是 `deliberately`（`facts.ts:16`、`index.ts:89`、`domain.ts:32`、`projection.ts:252`、`client/index.ts:48,141`）、`idempotent`（只描述 `InboundCoordinator` 的 disposer 与游标幂等：`inbound.ts:404,425`、`hub.ts:544`、`hub.ts:604-608`）、`echo`（`inbound.ts:259,262`，指 JSON-RPC id 回显）、`dedupe by seq`（`projection.ts:39`，显示层）。

数据结构上也可以证明：`busMessageSchema`（`schema.ts:46-55`）**没有** `parentSeq` / `rootId` / `hopCount` / `causedBy`；`team-room/fact` 的 `message-posted`（`events.ts:61-71`）同样没有。因此**投递链在数据模型里根本不可表达**，遑论限制。

唯一的"链"是 `assignTask` → 自动定向消息（`hub.ts:751-759`）：交接会把 `Task assigned to you: <title>` 定向发给新 assignee，唤醒对方。这是一条**固定长度 1** 的链，不构成环路——但它证明了"一次工具调用可以直接唤醒另一个会话"。

### 4.3 有没有去重 / 幂等（同一内容重复投递）？

**投递层：没有。显示层：有一个，但不管用。**

- **总线没有内容去重、没有幂等键**。同一段文字 `postMessage` 100 次 → `busNext` 铸 100 个不同 seq（`hub.ts:414-421`）→ 投递 100 次。源码里找不到任何文本哈希、`idempotencyKey`、`(sender, text, window)` 之类的判重。
- **唯一的去重是折叠层的 `seq` 去重**（`projection.ts:41`）：它防止**同一条时间线事件被渲染两次**，与"同一内容被重复投递"完全正交。
- **反向问题也存在：至少一次投递意味着重复投递是设计允许的**。`postMessage` 先提交存储（`hub.ts:405-439`）→ 再投递（`hub.ts:441`）→ **最后才推进游标**（`hub.ts:443` → `807-827`）。若进程在"投递完成"与"游标推进"之间崩溃，`catchUp` 会在下次会话启动时**重投同一条消息**（`hub.ts:564-568`）。ARCHITECTURE 把这写成优点（*"a crash between commit and delivery replays on catch-up instead of losing the message"*，`ARCHITECTURE.md:55`）——它确实是优点（不丢消息），但代价是**收端可能把同一条消息看两遍并回应两次**，而插件没有任何收端去重来兜底。
- 注意 `catchUp` 里的游标推进用的是 `Math.max(candidate.lastDeliveredSeq, current.busNext - 1)`（`hub.ts:580`），即"**一次跳到最新**"，而不是"推进到实际投递到的那条"。对离线补投这是对的（积压全投了），但它也意味着**任何漏投都无法通过游标自愈**。

**实测反证**：本机真实房间 `dict_maintenance` 的 189 条消息中，**文本完全重复的消息 = 0 条**（§附录 A）。也就是说现实中没出现重复投递；但那是"没崩溃"，不是"有防护"。

### 4.4 有没有速率限制 / 冷却（每会话每分钟最多投递多少条）？

**没有。一条都没有。**

- Config 里没有任何 `rate*` / `limit*` / `cooldown*` / `window*` 字段（`index.ts:64-98` 是完整的可调面，只有 §4.1 那 7 个容量项 + `injectRoomBrief` / `roomOpenTimeoutMs` / `allowUnmarkedFacts` / `inbound.*`）。
- `RoomHub` 的私有状态里也没有计数器：只有 `tail`（单写链）、`roomChains`、`memberChains`（投递链）、`briefed`（简报幂等）（`hub.ts:110-120`）。**没有任何按会话/按房间的计数器或时间窗。**
- `postMessage` 的完整校验只有三件事：非空（`hub.ts:401`）、不超长（`hub.ts:402-404`）、发送者是成员（`hub.ts:408-410`）+ 目标是成员（`hub.ts:411-413`）。**没有频率判定。**
- 投递侧 `deliverPosted`（`hub.ts:779-805`）对每个收件人**无条件** `agent.followup`；同一成员连续收到 10 条消息就排 10 个回合。

**因此：单个回合里的 fan-out 无上限。** 一个模型在一轮里可以调 `room_post` k 次（工具调用次数只有宿主的单回合步数在管，插件不管），每次广播唤醒 `N-1` 个成员 → 单轮最多产生 `k × (N-1)` 个**新的完整推理回合**。以默认值 `N ≤ 8` 计算，单轮扇出可达 `7k`。而且每个被唤醒的回合**同样**可以再扇出——这就是乘数效应的完整链条。

### 4.5 派发闸门：收到消息后是否自动触发对方新一轮推理？

**会自动触发。这是回声风暴可能性的决定性一环。**

证据链（四段，互相独立）：

1. **代码**：`hub.ts:799-802` 对每个收件人调用 `agent.followup(this.roomUserMessage(room, message))`，**没有任何条件闸门**（既不问用户，也不问配置，也不看接收方是否已在运行）。
2. **宿主语义**：`agent.followup` 的官方文档是 *"Queue an ordinary follow-up turn and **wake the driver**. The item becomes the sole ordinary message of **its own turn**."*（`runtime-types.d.ts:187-192`）。即"**一条投递 = 一个新回合**"，且**即使驱动已在跑也会排队**（"its own turn"）。
3. **工具自述**：`room_post` 的描述直接写明 *"Live members are woken with the message as their next turn"*（`tools.ts:178-180`）；`room_transfer_task` 描述写明 *"the receiving member is woken with a directed message"*（`tools.ts:492-493`）。
4. **系统提示词明确要求"不要轮询"**：*"room messages are delivered into this conversation automatically — do not busy-poll room_read"*（`index.ts:279-283`）。这等于告诉模型：**消息会自己推过来，你该回应就回应。**

对照：**离线**成员走 `agent.inject`，官方语义是 *"**without waking the driver**"*（`runtime-types.d.ts:201-209`），因此离线路径不构成风暴源。**风暴只发生在"至少两个成员会话同时在线"时。**

**所以：没有"人工/显式唤醒"这道闸门，也没有"自动唤醒但需确认"的中间档。默认就是全自动派发。**

### 4.6 有没有"谁可以给谁发消息"的拓扑约束？

**没有。房间是一个团（clique），任意成员可以给任意成员发，也可以广播。**

- `postMessage` 的拓扑检查只有两项：发送者是成员（`hub.ts:408-410`，否则 `not-member`）、**如果指定了 `to` 则目标也是成员**（`hub.ts:411-413`，否则 `unknown-target`）。**没有任何"谁允许给谁"的边表**，也没有角色差别——房主与普通成员在发消息权限上**完全一样**。
- 角色的额外权力只有两处：房主可 `deleteRoom`（`hub.ts:378-380`），房主可完成任何任务（`hub.ts:705-707`，`not-assignee` 的例外分支）。**发消息没有角色门槛。**
- **跨房间桥接是允许的**：一个会话最多可加入 `maxRoomsPerMember = 4` 个房间（`hub.ts:306-308`）。因此在 R1 收到消息、在 R2 发一条，是完全合法的 —— **风暴可以从一个房间蔓延到另一个房间**，宽度乘数上限是该会话所属房间数（默认 4）。
- **有人类闸门但不在投递层**：成员资格只能由人建立（§2.2），所以房间的**成员集合**是人的决定。这是唯一的"拓扑约束"，而且是**静态**的：一旦 6 个人类会话加入同一个房间，它们之间的全连接就永久成立（除非人 `/room leave` 或房主 `/room delete`）。

**两个值得单独记录的拓扑缺口：**

1. **定向发给自己不受限制 → 潜在自环**。`postMessage` 的目标校验只要求"是成员"，而**自己就是成员**（`hub.ts:411-413`）。`deliverPosted` 对定向消息的收件人判定是 `member.sessionId === message.toSessionId`（`hub.ts:792-794`），对自己**成立**，于是 `hub.ts:800-802` 会把这条消息以 `followup` 投回**发送者自己的会话**，开启一个新回合。也就是说，`room_post(room_id, text, to=<自己的 session id>)` 是一条**单会话即可自激的代码路径**——只要模型知道自己的 session id。模型从何处能得到它，本报告**未确认**（简报文本不含 session id，`hub.ts:633-641`；`room_list_rooms` 返回全部成员的 session id 与 `myRole`，但**不标记哪一行是自己**）。**该路径存在且无守卫，实际可达性未确认。**
   对照：广播路径**显式排除了发送者自己**（`hub.ts:793`：`member.sessionId !== message.senderSessionId`），所以"广播→自己收到自己的广播"这条最常见的自环是**被堵住的**。
2. **`room_claim_task` 不校验当前状态**。`mutateTask` 里只有 `complete` 分支做了状态/权限判断（`hub.ts:704-707`）；`claim` 分支（`hub.ts:714-724`）无条件把 `status` 置 `in-progress`、`assigneeSessionId` 置为自己。两个会话同时认领同一任务 → **后写覆盖先写**，时间线里留下两条 `task-claimed`，两个会话都以为自己拿到了任务。这不是风暴源，但是一个**并发正确性缺口**（"claim" 的语义本应是"抢占成功/失败"）。

### 4.7 结论：回声风暴在架构上是否真的可能？

**是。而且不需要任何配置错误——默认配置就能发生。**

**发生条件（充分）：**

1. 房间有 **≥2 个成员**（`maxMembersPerRoom` 默认 8，`min(2)` 是 schema 下限）；
2. 这 ≥2 个成员会话**同时在线**（`hub.ts:796` 只把消息投给"存活会话"，离线走 inject 不唤醒）；
3. 至少一个会话在收到投递后**选择再发一条**（不需要"失控"——**正常的礼貌回应就够了**：A 广播 → B 被唤醒 → B 回一条 → A 被唤醒 → A 再回一条 → …）。

**乘数（无任何机制削减）：**

- 单轮扇出 `= k × (N-1)`（k = 该回合内的 `room_post` 调用次数，N = 成员数），**k 与 N 都只受"人类预设名册"和"宿主单回合步数"限制**，不受本插件限制；
- 每轮之后，每个被唤醒的回合都能再产生同样的扇出 → **指数级增长的所有前提都具备**；
- 跨房间桥接再把上限乘以 `maxRoomsPerMember`（默认 4）。

**唯一的真实刹车（都不是本插件的防护机制）：**

1. **模型自己的收敛行为**——简报里那句 *"Keep your room turns brief"*（`hub.ts:639`）和系统提示词里那句 *"Keep room turns brief"*（`index.ts:281`）**是纯文字劝导，不是约束**；
2. **回合往返延迟**——本机实测真实房间消息间隔**中位数 25.7 秒**（§附录 A），即每个"跳"要等对方跑完一整个模型回合；这决定了风暴的**传播速度**，但不决定它是否会停；
3. **宿主自身的单回合步数限制**（DSH 核心能力，**本插件不提供、也不知情**）；
4. **人类手动干预**：`/room leave`、`/room delete`（房主），或直接停止会话。

**会被误认为"防护"、但实际不防护的三件事（务必写清楚）：**

| 机制 | 为什么不能防风暴 |
|---|---|
| `busRetention=200` / `timelineRetention=500` / `taskRetention=50` | 剪的是**历史**，不是**流量**。`pruneRoom` 只在 `postMessage` 里被调用（`hub.ts:437` → `1006-1024`），删掉的是旧行；**投递一次都没少**。观察到的 189/200 正是"还没剪过"的状态。把保留窗口当限流器是类别错误 |
| `maxMessageChars=4000` | 只封顶**每条消息的体积**（≈1–1.5k tokens/跳），因此能封顶单跳成本，**不能封顶跳数**。总成本仍然无界 |
| `maxRooms=16` / `maxMembersPerRoom=8` / `maxRoomsPerMember=4` | 封顶**并发宽度**（这确实有用：把最坏单轮扇出压在 7k），但**不封顶轮数**。2 个成员的房间一样可以无限往复 |

**证据链小结（一句话）**：投递无条件调用 `agent.followup`（`hub.ts:799-802`）→ 宿主定义为"新回合 + 唤醒"（`runtime-types.d.ts:187-192`）→ 没有任何速率/跳数/去重/拓扑约束（§4.2–4.6 的穷举）→ 容量上限与保留窗口不削减流量（§4.1、上表）⇒ **A→B→A 的往复在架构上无阻挡，风暴可能**。

### 4.8 本机实证：真实的 6 成员房间发生了什么

这是最有意思的一条证据——**风暴的"形状"真实出现过，但没失控**。

本机 `team_rooms.json` 里有一个真实多人房间（§附录 A）：6 个成员、**189 条总线消息**、**243 条时间线事件**，跨 2026-10-08 20:12 到 2026-10-10 17:26（约 2 天）。

- 发言分布高度不均：`77778b0a ×70`、`3f783d79 ×57`、`82c262c6 ×40`、`945d030b ×10`、`bff71736 ×9`、`c8d68773 ×3`。
- 消息**风格**正是"逐条回应对方论点"：例如 `【T2 → 矿工C】三条逐一回应：**你的 2、3 都成立（3 已进 T3 口径）**…`、`你 4 条我**全部独立复现，全部成立**…`。这是**典型的"多会话逐点互驳"**。
- 但间隔中位数 **25.7 秒**，最大 1.75 天，且**没有出现指数爆炸**：2 天 189 条 ≈ 平均 15 分钟一条。
- **同回合多发是真实存在的**：有 **6 个间隔 < 1 秒**，其中**一个为 0 ms**，20 个 < 5 秒 —— 这就是"一个回合里发多条"的直接痕迹，也就是 §4.4 里 `k` 因子的实证。
- **47 / 189 是定向消息**（有 `toSessionId`），其余为广播。
- **文本零重复**（`Group-Object text` 无任何 count>1 项）；最长 2909 字符，平均 1123 字符，**没有一条触到 4000 上限**。
- 消息正文里大量出现 `@session-82c262c6-…` 这样**手工书写的前缀**——因为 `room_post` 广播不会点名，模型只好自己在文本里"寻址"。这既是可用性缺口，也说明广播的"对谁说话"完全靠约定。

**怎么解读**：这个房间实际上跑成了"**慢速、长篇、逐点互驳的辩论**"，而不是"风暴"。但刹车不是插件的机制，而是**回合延迟（每跳 20+ 秒）** 与 **模型自身的输出长度/收敛倾向**。只要模型变得更短、更快、更"见消息就回"，或者同一回合里多发几次广播，同一套代码就会失控。**这正是"缺少硬约束"的含义：没有机制在兜底，只有行为习惯在兜底。**

---

## 5. UI 呈现

### 5.1 挂载位置：`settings.section`，id 冻结为 `team-rooms`

`src/client/index.ts:204-216`：

```ts
slots.inject('settings.section', () => slots.register({
  name: 'settings.section',
  id: 'team-rooms',          // D3 keystone：必须与 0.9.6 逐字节一致，否则已安装的设置页不再解析
  order: 30,                 // 排在 Models/Agent Presets 之后：房间是协作面，不是部署形塑面
  label: () => ctx.locale.bind(ROOM_NS)('nav'),
  locale: ROOM_NS,           // 'teamRooms'
  inject: injected,
}, TeamRoomsSection))
```

- 客户端 `inject`：`['sessions', 'slots', 'locale', 'remote', 'remote.commands']`（`client/index.ts:51`）；注释特别说明 `connection` 是**故意缺席**的——这个页面从不直接调用 remote namespace（`client/index.ts:45-49`）。
- 浏览器半部由包的 `dsh.client` 声明为 `platform: 'web'`，并注入 5 个客户端包（`package.json:49-58`）。
- 打包形态：单 CJS 面，包在 `window.__ModuleLoader__.load({ id: 'dsh-team-rooms', factory })` 里，从 `/plugins/dsh-team-rooms/client.js` 提供（`ARCHITECTURE.md:94`）。`lib/client.js` 实测 169,130 bytes。

### 5.2 数据流与控制器

`TeamRoomsController`（`client/index.ts:69-136`）是一个 `useSyncExternalStore` 兼容的快照源：

- `start()` 订阅 `sessions.list`（`client/index.ts:89`）；
- `refresh()` 每次取"主视图持有的会话"（`currentSessionIdOf`，`room-presenter.ts:38-43`——注释说明旧的 `SessionListState.current` 在 0.1.6 线被移除，**保留计数是幸存的权威**），会话切换时**解绑旧 face、重新绑定** `sessions.binding(current).session.projections.faceOf('teamRoom')`（`client/index.ts:107-135`）；
- 快照过纯函数 `buildRoomPanels`（`client/index.ts:131-134`；实现 `room-presenter.ts:101-147`），该函数**校验 zod 守卫 `isTeamRoomView`**，非法/缺失时返回 `undefined` → 面板退化为"无房间"而不是崩溃（`room-presenter.ts:102-105`）。

**写回全部走宿主命令**（`client/index.ts:194-202`）：每个动作拼一条 `/room …` 文本，用 `remote.commands.execute(sessionId, line, [])` 执行；**没有私有 RPC、没有客户端本地状态变更**，所以每次点击都保住持久化的 `command/run → command/done` 生命周期与宿主排序保证（`ARCHITECTURE.md:92`）。

| 面板动作 | 生成的命令行 | 行号 |
|---|---|---|
| create | `/room create <name>` | `client/index.ts:194` |
| join | `/room join <roomId>` | 195 |
| leave | `/room leave <roomId>` | 196 |
| post | `/room send <roomId> <text>` | 197 |
| addTask | `/room task add <roomId> <title>` | 198 |
| claimTask | `/room task claim <roomId> <taskId>` | 199 |
| completeTask | `/room task done <roomId> <taskId>` | 200 |
| assignTask | `/room task assign <roomId> <taskId> <member>` | 201 |

### 5.3 渲染结构（`TeamRoomsSection.tsx`）

顶层 `TeamRoomsSection`（`TeamRoomsSection.tsx:283-369`）：

```
<div .section>
  <h2 .title>            t('title')   = 团队房间
  <p  .intro>            一句话说明 + 存储层说明
  {无会话 → <p .noSession>}
  <div .forms>           创建行（input + 创建按钮）+ 加入行（input + 加入按钮）
  {错误 → <div .error role="alert">}
  {无房间 → <div .empty>}  否则每个房间渲染一个 <RoomCard>
</div>
```

`RoomCard`（`TeamRoomsSection.tsx:133-280`）：

1. **header**：房间名 `<h3>`、`房间 id: <uuid>`、**复制按钮**（`navigator.clipboard.writeText`，成功后 1.5s 内显示"已复制"，`TeamRoomsSection.tsx:149-160`）、**离开房间**按钮。
2. **成员区**：`<ul>`，每行 = **状态圆点** + `<span title={member.title ?? member.sessionId}>` 显示 `displayTitle`（无则显示会话 id）+ `role · live/offline` 元信息（`TeamRoomsSection.tsx:171-186`）。
3. **任务板**：标题输入框（Enter 或按钮提交）+ 任务行列表。任务行 `TaskRowView`（`TeamRoomsSection.tsx:71-130`）：状态徽标 + 标题 + assignee（null 显示"未分配"）+ 描述（非空才渲染）+ 动作区（`todo` 显示"认领"；非 `done` 显示 assignee 输入框 + "确定"交接；非 `done` 显示"完成"）。所有按钮在 `busy` 时禁用；交接按钮额外要求 assignee 输入非空。
4. **消息输入区**：`<input placeholder="广播给所有成员…">` + 发送按钮；Enter 提交（`TeamRoomsSection.tsx:233-260`）。**注意：这里只能广播，UI 没有定向发送入口。**
5. **时间线**：`<ul>`，每行 = `event.kind`（大写小字）+ 本地化标签（`timelineLabel`，`TeamRoomsSection.tsx:52-69`，覆盖 9 种 kind + `timelineUnknown` 兜底）。
6. `busy` 时底部显示"处理中…"。

**排序与截断**（纯 presenter，`room-presenter.ts:108-147`）：成员按 `joinedAt` 升序；任务按 `todo(0) → in-progress(1) → done(2)` 再按 `taskId.localeCompare`；时间线**取最新 100 条**（`room-presenter.ts:136-139`）。成员"在线"标记来自会话列表快照（`live: list.byId[sessionId] !== undefined`，`room-presenter.ts:111-118`）——**这是浏览器自己的进程视图，不是宿主的活跃度**（`room-presenter.ts:50`）。

### 5.4 视觉风格：中性工程风，几乎没有拟人化

- **没有任何拟人化元素**：没有头像、没有人脸、没有表情符号、没有人物昵称渲染（渲染的是 `displayTitle` 或裸会话 id）。
- **唯一的"生命感"是一个 8×8 圆点**：`.memberDot` 圆角 50%，在线 `background: #12b76a`（绿），离线 `color-mix(currentColor 30%)`（`TeamRoomsSection.module.css:138-151`）。
- 状态色是工程化的左边框：`.task-todo` 橙 `#f79009`、`.task-in-progress` 蓝 `#2e90fa`、`.task-done` 绿 `#12b76a` + `opacity .65`（`css:182-193`）。
- 整体用 `color-mix(in srgb, currentColor N%, transparent)` 做边框/文字层级，**完全跟随主题**，不硬编码配色（`css:45,55,88,150,178`）；`blockTitle` 用小号大写字 + `letter-spacing` 的标签风格（`css:111-118`）。
- 中文文案（`room-locales.ts:7-58`）是**中性工程语**：「房主 / 成员 / 在线 / 离线 / 任务板 / 时间线 / 认领 / 交接 / 完成 / 未分配」。唯一的拟人化痕迹在**给模型的简报**里：*"You are a helpful assistant in team room X."*（`hub.ts:636`），源码自称 *"one-line role statement (Minimal persona style)"*（`index.ts:11`、`hub.ts:594-599`）。
- 包 README 标题带 🏠 emoji（`README-zh.md:3`），但**UI 面板里没有任何 emoji**。

---

## 6. 审批与权限

### 6.1 `room_transfer_task` 的审批流程与 fail-closed 语义

**接口面**（`tools.ts:21-30`）：

```ts
export interface ApprovalLike {
  request(req: { agent: Agent; toolName: string; callId?: CallId;
                 reason?: string; signal?: AbortSignal })
    : Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'>
}
```

**解析**：`approvalOf(ctx) = ctx.get('approval')`（`tools.ts:33-35`）——审批服务是**可选**的。

**闸门**（`tools.ts:42-65`，逐字引用其语义）：

```ts
if (approval === undefined) {
  throw new RoomError('approval-unavailable',
    'room operation requires approval but no approval service is composed — failing closed')
}
const outcome = await approval.request(req)
if (outcome !== 'allowed-once') {
  throw new RoomError('approval-denied',
    `room operation not approved (outcome: ${outcome}); nothing changed`)
}
```

**fail-closed 的四条路径全部收敛到同一个稳定错误**（`ARCHITECTURE.md:84`、`tools.ts:37-41` 的注释）：

| 情形 | outcome / 分支 | 结果 |
|---|---|---|
| 没有组合审批服务 | `approval === undefined` | `approval-unavailable`，**变更从未发生** |
| 没有应答者（无人可问） | `'unavailable'` | `approval-denied`（`outcome !== 'allowed-once'`） |
| 用户拒绝 | `'rejected'` | `approval-denied` |
| 中断 / 取消 | `'cancelled'` | `approval-denied` |

**只在 `allowed-once` 之后才调用 `hub.assignTask`**（`tools.ts:544-550`），所以"被拒时什么都不变"是**结构保证**而不是约定。请求体携带 `agent`（哪个会话请求的）、`toolName: 'room_transfer_task'`、`callId`（可选）、`reason: "hand task <id> in room <id> to member <id>"`、`signal`（可中断）——（`tools.ts:537-543`）。返回值把 `approved: true` 写进输出 schema（`tools.ts:518`），即**输出本身断言了审批发生过**。

### 6.2 还有哪些动作要批准？

**在本插件的代码里，只有 `room_transfer_task` 一个。**

明确**不需要**审批的写入：`room_post`（总线）、`room_read`/`room_list_*`（读）、`room_create_task`、`room_claim_task`、`room_complete_task`（`tools.ts` 对应各 `execute` 里没有任何 `requireApproval` 调用）。

**`/room` 命令族全都不需要审批**，这是**有意的设计**并有注释说明（`commands.ts:5-8`）：

> *"The command executes directly against the receiving session's agent — it never goes through the model — and every write lands on the shared durable room store. **Because the human typed the command, command-side handoffs are already user-authorized** (the model-facing `room_transfer_task` tool is what routes through the approval seam)."*

### 6.3 一个必须记录的**审批不对称**

同一次"跨成员交接"，两条入口的闸门不同：

| 入口 | 路径 | 审批 |
|---|---|---|
| 模型工具 | `room_transfer_task` → `requireApproval` → `hub.assignTask`（`tools.ts:536-550`） | **有闸门**，fail-closed |
| Web 设置页"确定/交接"按钮 | `actions.assignTask(...)` → `/room task assign <room> <task> <member>`（`client/index.ts:201`）→ `hub.assignTask`（`commands.ts:206-219`） | **无闸门** |
| `/room task assign` 命令 | 同上（`commands.ts:206-219`） | **无闸门**（理由：人类手打的） |
| inbound 桥 | `hub.createTask` / `hub.postMessage` / `hub.completeTask`（`index.ts:306-325`） | **不涉及交接**，但**能写板与总线**；发送者被强制为房间**属主**会话（`index.ts:300-304`、`ownerSessionOf` at `332-337`），无属主的房间**丢弃事件**（fail-closed） |

**更重要的结构性事实**：闸门**只存在于工具外壳里**，不在服务层。`RoomHub.assignTask()` 是一个公开方法（`hub.ts:520-527`），注释明说 *"Callers outside a tool (the /room command) are the user themselves; the room_transfer_task TOOL gates this same mutation behind the approval service."*——也就是说 **hub 层不提供任何"必须审批"的能力**，任何新的入口（新的命令、新的 UI 按钮、新的插件、inbound 扩展）都会**默认绕过闸门**。对"给新插件的启示"这一节这是关键教训（见 §9）。

### 6.4 其他权限面

- **成员身份即授权边界**：`ARCHITECTURE.md:83`；代码上每个工具/命令入口都先解析调用会话的成员槽，非成员抛稳定错误而不是部分写入（`tools.ts:286-288`、`356-358`；hub 层 `hub.ts:408-410, 467-469, 696-698`）。
- **房主专属**：删除房间（`hub.ts:378-380`）、完成任意任务（`hub.ts:705-707`）。
- **workshop 声明权限**：`session:append` + `tools:register`（`package.json:77-80`），与实现一致（追加事实事件 + 注册工具）；**没有 `subagent:*`**（`README-zh.md:144`、`ARCHITECTURE.md:123`）。
- **批准闸门由宿主承载**：客户端会把拒绝渲染成 `error` 行（`TeamRoomsSection.tsx:360`），命令侧把 `RoomError` 渲染成 `<code>: <message>`（`commands.ts:270-275`）。

---

## 7. 兼容性与工程化

### 7.1 peerDependencies / engines

`package.json:118-129` 声明 9 个 peer：`@deepseek-ai/cordis ^4.0.4`、`dsh-commands`、`dsh-llm`、`dsh-session`、`dsh-session-projection`、`dsh-storage`、`dsh-storage-domain`、`dsh-storage-json`、`dsh-tools`（8 个 dsh 包共用同一范围串 `>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0 || >=0.1.6-0 <0.2.0 || >=0.1.7-0 <0.2.0`），外加 `@deepseek-ai/schemastery ^3.18.2`。

- **运行时依赖只有 zod v3**（`"zod": "^3.24.0"`，`package.json:130-132`）。这与 §3.2 的两处 zod v3/v4 桥接直接相关。
- `engines`（`package.json:114-117`）：`node: ^22.19.0 || >=24.0.0`；`dsh` 与 peer 同范围。
- **一个兼容性观察（未确认是否被强制）**：本机实际安装的宿主 `@deepseek-ai/dsh-session` 是 **`0.2.0-rc.2`**。按 semver 预发布规则，`0.2.0-rc.2` **不满足** `engines.dsh` 的任何一支（所有分支都以 `<0.2.0` 收口，而 `0.2.0-rc.2` 与 `0.2.0` 共享 `[major,minor,patch]` 且有预发布标记，只有同元组的比较器带预发布时才算满足）。实测该宿主上插件**仍被正常加载**（本会话的 `room_*` 工具可用，`room_list_rooms` 正常返回）。**宿主是否强制校验 `engines.dsh` —— 未确认。**
- `dshWorkshop.compatibility.dshVersions` 列出的是**已验证过的宿主版本**：`0.1.2-rc.1`、`0.1.5-rc.2`、`0.1.7-alpha.2`、`0.1.7-rc.1`、`0.1.7-rc.2`（`package.json:81-89`）——**不含 0.2.x**。README 也写"Harness `dsh-v0.1.7-rc.2`（2026-09-24 验证）"（`README-zh.md:38`）。

### 7.2 构建与工具链

`package.json:164-177` 的 scripts：

| 脚本 | 命令 | 说明 |
|---|---|---|
| `build` | `node scripts/clean.mjs && tsc -p tsconfig.build.json && tsc -p tsconfig.client-build.json && tsdown && node scripts/fix-dts.mjs` | **两套 tsc 程序**（node 半部 + client 半部）+ **tsdown** 打包 + d.ts 修补 |
| `typecheck` | `tsc --noEmit && tsc -p tsconfig.client.json --noEmit` | 同样是两个程序 |
| `test` | `vitest run` | 单元 / hub / 投影 / jsdom 面板（`README-zh.md:192`） |
| `test:coverage` | `vitest run --coverage` | `@vitest/coverage-v8 3.2.7` |
| `lint` | `oxlint` | `oxlint 0.18.1`（`package.json:157`） |
| `check:readmes` | `node scripts/check-readme-sync.mjs` | **多语 README 同步检查**（5 个语种） |
| `verify:self-contained` / `verify:artifacts` | 自包含性 / 产物声明校验 | |
| `pack:smoke` | 构建+打包+装入一次性 profile 并断言组合行 | 需要 `DSH_HARNESS_ROOT`（`README-zh.md:198`） |
| `gen-aliases` | `node scripts/gen-aliases.mjs` | checkout 移动后重映射 harness 包路径 |

- devDependencies 展示完整工具面：`tsdown ^0.22.14`、`vitest ^3.2.0`、`typescript ^5.9.0`、`jsdom ^29.1.1`、`lightningcss ^1.33.0`（CSS Modules 编译）、`react ^18.2.0` / `react-dom ^18.2.0`（**注意：client 用 React 18 编译，但 `@types/react` 是 `^19.0.0`**——`package.json:152-153, 158-159`）、`@types/node ^22.19.0`（`package.json:133-163`）。
- **`lib/` 已提交进仓库**，所以 git / npm 安装**不需要构建步骤、不需要 allowBuilds**（`cordis.patch.yml:19`、`README-zh.md:65,80`）。实测 `lib/index.js` = 226,877 bytes、`lib/client.js` = 169,130 bytes、`lib/types/**/*.d.ts` 共 16 个文件。
- `packageManager: pnpm@11.7.0`（`package.json:4`）。
- 包 `type: module`（`package.json:14`），`main: ./lib/index.js`，`exports` 暴露 `.`、`./client`、`./cordis.patch.yml`、`./package.json`（`package.json:15-28`）。

### 7.3 测试规模：**未确认**

- 本机安装包**不含** `tests/`、`scripts/`、`tsconfig*.json`、`tsdown.config.ts`、`vitest.config.ts`。实测插件根目录只有：`ARCHITECTURE.md`、`cordis.patch.yml`、`LICENSE`、`package.json`、5 个 README、`THIRD_PARTY_NOTICES.md`，以及 `lib/`、`node_modules/`、`src/` 三个目录——与 `files` 白名单一致（`package.json:29-43`）。
- 因此**无法统计测试用例数**。可确证的只有测试存在与其覆盖域：`README-zh.md:192` 说"vitest：单元、房间 hub、投影与 jsdom 面板测试"；`ARCHITECTURE.md:18` 与 `33` 点名 `tests/room-projection.spec.ts`（钉住三段冻结身份字符串）与 `tests/room-tools.spec.ts`（八个并发 `room_create_task` 全部落地）。

### 7.4 `dshWorkshop` 元数据：逐字段含义

`package.json:60-102`，`schema: "omdsh-workshop-package/v1"`：

| 字段 | 值 | 含义 |
|---|---|---|
| `type` | `plugin` | 包类型 |
| `integration.protocol` | `harness-profile` | 集成协议：装进 harness 的 **profile** |
| `integration.artifact` | `cordis.patch.yml` | 集成产物就是这个 cordis 补丁文件 |
| `install.mode` | `transactional` | 事务式安装（可整体回滚） |
| `install.adapter` | `profile-bundle` | 适配器：作为 profile bundle 安装 |
| `install.failurePolicy` | `generation-rollback` | 失败策略：**按 generation 回滚** |
| `install.touchesCurrentBeforeActivation` | `false` | **激活前不触碰"当前"代**——安装过程不会污染正在运行的 generation |
| `lifecycle.activation` | `restart-profile` | 需要**重启 profile** 生效（非热加载） |
| `lifecycle.dispose` | `supported` | 支持卸载/释放（对应 `ctx.effect` 的 disposer 纪律） |
| `permissions` | `["session:append","tools:register"]` | 申请两项能力：向会话日志追加事件、注册工具 |
| `compatibility.dshVersions` | 5 个版本 | **已验证**的宿主版本白名单（见 §7.1） |
| `capability` | `{id: 'room_create_task', kind: 'tool', invocation: '...', expected: '...'}` | **一条可执行的冒烟能力声明**：workshop 可以用"在已加入房间的会话里调 `room_create_task(room_id, title)`"来证明插件真的可用，期望结果是"任务落到共享板上，且每个成员的 teamRoom 投影折叠出新行" |
| `evidence` | `{install: null, failureIsolation: null, hotReload: null, remove: null}` | **四项证据全部为 null**——安装、故障隔离、热重载、卸载**都没有留下经验证据**。这是一个诚实的（也可能是未完成的）声明：能力声明有，证据没有 |

**注意 `capability.expected` 在本机是失效的**：它承诺"每个成员的 `teamRoom` 投影折叠出新行"，但在 0.2.0-rc.2 宿主上投影永远空折叠（§3.7 实测）。**这条冒烟断言的期望值与本部署实际行为不符。**

`dsh` 段另外声明：`manifestVersion: 1`、`bundle.patch: ./cordis.patch.yml`、`client: {platform: 'web', inject: [5 个客户端包]}`（`package.json:44-59`）。

### 7.5 bundle 补丁与安装

`cordis.patch.yml` 全文只有 **一个 `insert`**（`cordis.patch.yml:21-34`）：

```yaml
- insert:
    - id: team-rooms
      name: dsh-team-rooms
      config:
        # 全部字段都被注释掉，即：用 schema 默认值
```

文件顶部注释解释了三条重要纪律（`cordis.patch.yml:1-20`）：

1. **不得重复插入 storage 行**：每个已发布 profile（web/headless/sdk/acp）都通过 `dsh-base` bundle 组合了存储栈（`storage` + `storage-json` + `storage-domain`），同 id 再插一次会让 profile **拒绝启动**（`duplicate loader entry id: storage`）。补丁只挂插件行。
2. **故意没有 `provider` 键**：那个键属于 `dsh-background-agents`（它用来说明 `background_agent` 工具启动子代理时用哪个 provider）；**团队房间从不 spawn 子代理**（`cordis.patch.yml:12-15`）。
3. 限流/配额式调优的正确做法是**覆盖 `team-rooms` 这一行**（`cordis.patch.yml:17`）。

**本机实测**：`C:\Users\KEI.NEO\.dsh\profiles\web\package.json` 里 `"dsh-team-rooms": "^1.0.4"`（第 21 行），并在 `dsh.profile.bundles` 中列为第 15 个 bundle（第 42 行）；本 profile 的 `cordis.patch.yml` 里**没有** `team-rooms` 覆盖行（实测 `Test-Path`/文本搜索均未命中）。⇒ **本机运行在全部 schema 默认值下**，这一点也被存储观测印证（189 条未修剪 < `busRetention` 200，§附录 A）。

---

## 8. 与领队中心式 agent team 的边界

> 说明：作者**没有**写一节叫"何时该用房间、何时该用领队中心式团队"的文档。本节的结论只能从 `ARCHITECTURE.md` 的 *Boundaries* 段（`:121-127`）、README 的 *这不是本插件* 表（`README-zh.md:134-140`）与代码事实中推出。凡是推断，下面会标明。

### 8.1 作者明确划出的边界

**"房间不派生、不指挥、不打断子代理"**（`ARCHITECTURE.md:123`，原文）：

> *"The room half never spawns, messages, or interrupts a child agent: the package declares no `subagent:*` permission, declares no subagent dependency, and its `inject` list carries no `subagents` entry. **A member is a session the user (or another seam) already has.**"*

代码可证：`inject = ['tools', 'agents', 'sessions']`（`index.ts:53`），**没有 `subagents`**；workshop 权限只有 `session:append` 与 `tools:register`（`package.json:77-80`）；全 `src/` 无任何 `ctx.subagents` 调用。

**"房间不调度"**（`ARCHITECTURE.md:124`）：房间拥有共享对象，不拥有"何时跑"。README 用更直白的话重复：*"它负责任务**何时**运行（调度）。本插件负责多个会话共同操作的**共享对象**——没有调度接缝，没有 cron。"*（`README-zh.md:138`）

**其余三条**：不跨机器（`:125`）、不做成本核算（`:126`）、存储是唯一持久化依赖（`:127`）。

### 8.2 能力重叠的真实范围

| 能力维度 | 领队中心式团队（如 agent-teams：captain + 成员 + 任务图） | `dsh-team-rooms` | 重叠？ |
|---|---|---|---|
| **成员从哪来** | 领队 **spawn / 派生** 成员（continuable subagent） | 成员是**用户已有**的独立会话，靠人 `/room join` | **不重叠**（这是最根本的差别） |
| **谁来定"做什么"** | 领队设计 DAG、质量门、依赖 | 只有一块**手工**任务板；谁做什么靠人/模型自行决定 | 部分重叠（表面都是"任务"） |
| **谁定"何时做"** | **调度器**在依赖满足后派发就绪任务 | **没有调度器**；`ARCHITECTURE.md:124` | **不重叠** |
| **任务状态与账本** | 任务状态机 + 尝试能力（attempt）+ 验收/复核结论 | 三态卡片 `todo/in-progress/done`（`schema.ts:63`），无验收字段、无尝试概念 | 表面重叠，语义弱得多 |
| **跨成员交接** | `reassign_task` / 转移，带所有权契约 | `room_transfer_task`，**审批闸门**在工具壳里 | **重叠** |
| **共享时间线 / 观测** | 任务事件账本 + 成员状态 | `timeline` + `teamRoom` 投影（**本部署上为空折叠**） | **重叠** |
| **成员间自由通信** | 领队居中；成员之间通常不直接对话 | **任意成员可广播/定向**（clique） | `rooms` 独有 |
| **失败恢复** | 重试/接管/复核循环 | **无**（没有重试、没有接管、没有超时检测） | 不重叠 |
| **成本约束** | 可挂预算、token 上限 | **完全没有**（`ARCHITECTURE.md:126` 明确不做成本核算） | 不重叠 |

**重叠其实只有两处**：**一张共享任务板** 与 **一次需审批的交接**。而且两者的**所有权归属完全相反**：

- 领队中心式：**队列/进度由中心拥有**——中心决定什么该跑、跑几次、算不算完成；
- 房间：**对象由中心共享，但没有任何中心**——谁都可以建卡、认领、完成（房主只多一点权限），且**没有人保证任务会被执行**。

### 8.3 一句话边界（可引用的判据）

- 需要**中心化的调度与质量门**（依赖、验收、复核、修复循环、成本约束）→ 领队中心式。
- 需要**多个已存在的人类会话之间共享一块有状态的白板**（发布进展、看板、时间线、"谁在干什么"）→ 房间。
- 两者**并存是可行的**：`rooms` 的"房间"可以作为领队中心式团队的**外部公告面/人类可见面**，因为它不派生任何 agent（`ARCHITECTURE.md:123`），也不与 `subagents` 服务冲突。**但绝不能让房间的自动唤醒与领队的调度器同时驱动同一批会话**——那就是两个调度权威（见 §9）。

---

## 9. 给新插件的启示：设计"既有领队中心、又能局部扁平协作"的混合拓扑

### 9.1 `rooms` 里值得**照搬**的机制（6 条）

1. **单写链作为顺序权威**（`hub.ts:652-657` `enqueue`；`659-681` `onRoomChain`/`onMemberChain`）。
   一句话：**所有 read-modify-write 排在同一条 promise 链上**，于是 bus/timeline 的 `seq` 在链内铸造、严格按提交顺序、无间隙；两个并发发帖者绝不可能交错读-改-写。`enqueue` 的注释还点出一个真实踩过的坑：**必须在 `ready` 解析前同步捕获前一条 tail**，否则会读到刚赋值的 tail 从而整链死锁（`hub.ts:645-651`）。混合拓扑里，"房间板"与"领队任务图"必须共用**一个**写链，否则两套 seq 会互相打脸。
2. **"模型可见 ⟺ 已记录"**（`ARCHITECTURE.md:37-44`；`hub.ts:843-855`）。
   任何进入模型上下文的东西都必须是该会话日志里的持久记录（这里是 `user/message`），并且**来源可归属、可重放**。这条纪律直接换来了"崩溃后能解释模型为什么会那么做"。
3. **权威在存储、副本在会话日志的双层设计**（`projection.ts:267-284`；`events.ts:29-44` 的 `room-joined` 全量快照）。
   `room-joined` 携带完整快照（房间身份 + 名册 + 开放任务 + 保留时间线），因此**冷启动的成员无需读存储即可重建视图**；`stateVersion: 1` 让缓存跨版本可读。混合拓扑里，领队侧的新成员（子代理）也应该收到这样一份"接入快照"。
4. **游标式至少一次投递**（`schema.ts:24,29`；`hub.ts:807-827`；`hub.ts:546-589`）。
   `lastDeliveredSeq` / `lastFactSeq` **只在投递落地后推进**，因此"提交成功但投递失败"会在下次激活时重放。代价是重复投递（见 §9.2 第 2 条，必须补收端去重）。
5. **成员身份即授权边界**（`ARCHITECTURE.md:83`；`tools.ts:286-288`、`hub.ts:408-410`）。
   每个入口第一步都解析"调用者的成员槽"，非成员得到稳定错误。**不要**把授权检查写在 UI 或提示词里。
6. **客户端写入一律走宿主命令**（`client/index.ts:194-202`；`ARCHITECTURE.md:92`）。
   页面只拼 `/room …` 文本交给 `remote.commands.execute`，**没有私有 RPC、没有本地状态变更**，因此每次点击都保住 `command/run → command/done` 生命周期与宿主排序保证。这条对"混合拓扑的 UI"几乎零成本，收益巨大。
   附带两条工程细活：**fail-closed 的可选依赖**（`tools.ts:42-65` 的审批；`index.ts:197-202` 的"无存储域则整体休眠"）与 **不能阻塞宿主关键路径**（`index.ts:212-245`：`agent/created` 是串行 waterfall，监听器只能同步决策 + `queueMicrotask`）。

### 9.2 `rooms` 里**必须补强**的机制（8 条，按优先级）

1. **派发闸门必须收归中心（最高优先级）**。
   现状：`agent.followup` 无条件唤醒并**开启一个新回合**（`hub.ts:799-802` + `runtime-types.d.ts:187-192`）——这就是回声风暴的引擎。混合拓扑的正确做法是：**扁平通道默认"只入板/只入摘要，不唤醒"**（等价于 `rooms` 里的 `inject` 语义，`runtime-types.d.ts:201-209`），唤醒权**只发给领队调度器**；需要点对点唤醒时，改为"申请令牌"——由中心按成员按窗口发放，而不是由发消息者直接触发。
2. **投递去重与幂等键（必补）**。
   现状：总线**没有任何内容去重**（§4.3），只有折叠层按 `seq` 去重（`projection.ts:41`）；且至少一次投递**设计上允许**重复。最小补法：消息带 `(roomId, senderSessionId, contentHash)` 幂等键 + 收端按窗口折叠；同时给 `catchUp` 的重复投递加收端 seen-set。
3. **因果链与跳数上限（必补）**。
   现状：消息**没有** `parentSeq`/`rootId`/`hopCount`（`schema.ts:46-55`、`events.ts:61-71`），投递链在数据模型里不可表达，遑论限制。补法：消息带 `rootId` + `hop`；`hop > N` 时**降级为只写板不投递**（无声降级优于硬失败，因为它保住了可观测性）。
4. **速率限制与回合预算（必补）**。
   现状：**零**（§4.4 穷举）。补法：`(sessionId, roomId)` 维度的滑动窗口投递配额 + 每回合最多 K 次 `post` + 每成员每分钟最多 M 次唤醒；`rooms` 已有的 7 个容量上限**一个都不能替代它**。
5. **拓扑边表与配额（必补）**。
   现状：房间是 clique，任意成员可给任意成员发/广播，无角色差别（§4.6）；一个会话可桥接最多 `maxRoomsPerMember=4` 个房间。补法：混合拓扑应显式声明"哪些成员之间允许直接对话"（局部扁平 ≠ 全连接），并把跨房间桥接列为需要中心批准的动作。
6. **长度与体积约束要覆盖所有文本面（易漏）**。
   现状：`maxMessageChars` **只覆盖总线消息**（`hub.ts:402`）。`room_create_task` 的 `title`/`description` **完全没有长度检查**（`hub.ts:473-479`），而任务描述会被复制进 `task-created` 事实、进而进**每个成员**的日志。补法：给所有文本面（含任务标题/描述、房间名、简报）统一加体积预算。
7. **审批闸门下沉重到服务层（重要教训）**。
   现状：闸门**只在 `room_transfer_task` 的工具壳里**（`tools.ts:536-543`），而 `hub.assignTask` 是公开无闸门方法（`hub.ts:520-527`）；结果是一模一样的"跨成员交接"从工具走要审批、从 Web 按钮走 `/room task assign` 不要审批（§6.3）。补法：把"这是敏感操作"编码进**服务层的意图类型**（例如 `assignTask({requiresApproval: true})` 或独立的 `requestHandoff()`），让任何入口都无法绕过。
8. **可观测性与自动熔断（必补）**。
   现状：没有任何风暴检测、没有投递率指标、没有自动降级。补法：暴露"每房间每窗口投递率""每成员唤醒次数""平均跳数"三个指标；超过阈值时自动进入"只入板不唤醒"的降级态，并**在面板上明示已降级**（用户必须知道为什么消息不再唤醒对方）。

**一条必须记住的反面教训**：不要把**保留窗口当限流器**。`busRetention`/`timelineRetention`/`taskRetention` 剪的是**历史**（`hub.ts:1006-1024`，只在 `postMessage` 里调用），**投递一条都没少**。本机观察到的"189/200 未修剪"正是这种误读最容易产生的现场（§附录 A）。

### 9.3 混合拓扑的推荐骨架（基于以上证据的推断）

```
领队中心层（唯一调度权威）
  ├─ 任务图 / 依赖 / 质量门 / 重试与接管 / 预算
  ├─ 唤醒令牌发放器  ← 唯一能调用 agent.followup 的地方
  └─ 只读镜像：把房间板折叠进领队的任务视图（复用 rooms 的 projection 纪律）

局部扁平层（复用 rooms 的 6 条机制）
  ├─ 每协作群一个 "channel"（= rooms 的 room：单写链 + seq + 投影 + 游标）
  ├─ 默认 inject（不唤醒）→ 成员在下一次被中心唤醒时看到上下文
  ├─ 显式 @ 请求唤醒 → 变成一张"唤醒申请卡"，由中心按配额发放
  └─ 消息带 rootId/hop/幂等键；超跳自动降级为只入板
```

这样"局部扁平协作"保留 `rooms` 的全部好处（共享对象、可重建投影、崩溃可重放、人类可见面），而"回声风暴"所需的燃料（**无条件自动唤醒 + 无跳数/无速率/无去重/无拓扑**）被系统地移除。

---

## 附录 A：本机实证数据（非文档推断）

### A.1 存储域实际布局

| 项 | 实测值 |
|---|---|
| 后端 | **JSON 文件后端** |
| 文件 | `C:\Users\KEI.NEO\.dsh\storages\team_rooms.json`（913,738 bytes） |
| 顶层结构 | `{ "unit": {"name":"team_rooms","version":1}, "global": null, "tables": { rooms, bus, tasks, timeline } }` |
| rooms 键 | `<roomId>`（UUID） |
| bus 键 | `` `<roomId>/<seq>` ``（例：`1e76df74-…/0`） |
| tasks 键 | `` `<roomId>/<taskId>` ``（例：`1e76df74-…/409da2fe-…`） |
| timeline 键 | `` `<roomId>/<seq>` ``（例：`1e76df74-…/0`，kind `room-created`） |

行数：**rooms = 5，bus = 190，tasks = 16，timeline = 253**。

5 个房间：

| roomId（前 8） | name | members | busNext | timelineNext |
|---|---|---|---|---|
| `1e76df74` | `smoke` | 1 | 1 | 5 |
| `9f8e0a6b` | `test 测试team-rooms插件功能。报告插件可用性。` | 1 | 0 | 1 |
| `84d3e1f8` | `test_room` | 1 | 0 | 3 |
| `71289626` | `test` | 1 | 0 | 1 |
| `a590416f` | **`dict_maintenance`** | **6** | **189** | **243** |

⇒ 前 4 个是单成员冒烟房；**只有 `dict_maintenance` 是真实的多人协作房**。

### A.2 `dict_maintenance` 的真实流量特征

| 指标 | 值 |
|---|---|
| 成员 | 6（1 房主 + 5 成员），全部 `lastDeliveredSeq=188`、`lastFactSeq=242` |
| 总线消息 | 189 条 |
| 时间跨度 | 2026-10-08 20:12:58 → 2026-10-10 17:26:35（约 2 天） |
| 发言分布 | `77778b0a ×70`、`3f783d79 ×57`、`82c262c6 ×40`、`945d030b ×10`、`bff71736 ×9`、`c8d68773 ×3` |
| 定向消息 | 47 / 189（有 `toSessionId`），其余广播 |
| 间隔 | min **0 ms**，median **25,678 ms**，max 1.75 天；`<1s` 6 次，`<5s` 20 次，`<30s` 107 次 |
| 文本重复 | **0 条**完全重复 |
| 文本长度 | max 2,909 / avg 1,123 字符；**越界（>4000）0 条** |

**结论**：真实房间跑成了"**慢速长篇逐点互驳**"，不是风暴；但同回合多发（0 ms 间隔）确实存在，且**没有任何插件机制在阻止它变成风暴**。

### A.3 `teamRoom` 投影在本部署上为空折叠

- 本机 `@deepseek-ai/dsh-session` 版本：**`0.2.0-rc.2`**（`C:\Users\KEI.NEO\.dsh\profiles\node_modules\@deepseek-ai\dsh-session\package.json`）。
- 代入 `factEventPolicyForVersion`（`audit.ts:105-112`）：major=0、minor=2 → `minor > 1` → **`'forbidden'`**。
- ⇒ `FactAppender.append` 永不写 `team-room/fact`，改走 logger fallback（`facts.ts:66-68, 77-91`）。
- **实证**：`dict_maintenance` 的 4 个真实成员，投影缓存里的值全部是
  `"teamRoom": { "ver": 1, "seq": <n>, "val": { "rooms": [] } }`
  （文件位于 `C:\Users\KEI.NEO\.dsh\storages\session_projcache\sessions\`，已查 `session-3f783d79-*`、`session-77778b0a-*`、`session-82c262c6-*`、`session-945d030b-*`）。
- ⇒ **本部署上 Web 设置页的团队房间面板渲染不出任何房间**；`/room` 命令与 8 个 `room_*` 工具不受影响。

### A.4 profile 配置：全部默认值

- `C:\Users\KEI.NEO\.dsh\profiles\web\package.json`：`"dsh-team-rooms": "^1.0.4"`（第 21 行），列于 `dsh.profile.bundles`（第 42 行）。
- 该 profile 的 `cordis.patch.yml` 中**没有** `team-rooms` 覆盖行（文本搜索未命中）⇒ **运行在 `DEFAULTS` 全默认值下**（`index.ts:122-134`）。
- 与观测一致：`busNext=189 < busRetention=200`（尚未触发修剪）、`timelineNext=243 < timelineRetention=500`。

### A.5 本会话的直接观测

- 本会话的可用工具里**确实存在** `room_create_task` / `room_claim_task` / `room_complete_task` / `room_transfer_task` / `room_post` / `room_read` / `room_list_rooms` / `room_list_tasks` 八个（与源码注册数一致）。
- 调用 `room_list_rooms` 返回 `(this session is not a member of any team room)` —— 与 §3.5"加入只能由人发起"一致，也确认插件在本机**是挂载状态**（而非"无存储域则休眠"）。

---

## 附录 B：一页速查

**定位**：把若干**已存在**的独立 DSH 会话变成共享「成员 + 总线 + 任务板 + 时间线」的持久团队；从 `dsh-background-agents` 0.9.6 切出。

**工具面**：8 个 `room_*`（list_rooms / post / read / list_tasks / create_task / claim_task / transfer_task / complete_task）；**模型不能建房、不能加入、不能退出、不能删房**——那只能由人用 `/room` 或设置页完成。

**持久化**：官方 `team_rooms` storage domain（`defineDomain`，version 1），四张 KV 表 `rooms`/`bus`/`tasks`/`timeline`，键 `roomId` 与 `roomId/seq`；后端由部署决定。本机是 JSON 后端 `~/.dsh/storages/team_rooms.json`，结构 `{unit, global, tables}`。

**投递与唤醒**：全部走**官方 agent inbox**。在线收件人 → `agent.followup(...)` = **开启一个新回合并唤醒**；离线 → `agent.inject(...)` = **不唤醒**，等下次启动时由 `catchUp` 注入积压。每条模型可见消息都是该会话日志里的持久 `user/message`。

**回声风暴防护查证结论**：
- **有 7 条硬约束**：`maxRooms=16`、`maxMembersPerRoom=8`、`maxRoomsPerMember=4`、`busRetention=200`、`timelineRetention=500`、`taskRetention=50`、`maxMessageChars=4000`（超限拒绝、不截断）。
- **全部是容量/空间约束**。**没有**速率限制、**没有**冷却、**没有**跳数/深度、**没有**内容去重或幂等、**没有**拓扑（谁可发给谁）约束——代码穷举可证。
- **派发闸门是敞开的**：`agent.followup` 无条件触发新回合，且系统提示词明确要求模型把投递当推送。
- **结论：回声风暴架构上完全可能**，默认配置即可发生（≥2 成员同时在线就够）；单轮扇出 `= 每次发帖数 × (成员数−1)`，无任何机制削减。保留窗口剪的是**历史不是流量**。
- 唯一的真实刹车是**模型自身的收敛倾向**与**回合往返延迟**（本机实测中位 25.7 秒/跳），**不是插件的机制**。

**UI**：`settings.section`，slot id 冻结为 `team-rooms`，order 30，locale 命名空间 `teamRooms`；纵向卡片 = 成员（状态圆点）/任务板/发消息/时间线；写入一律走 `remote.commands.execute('/room …')`，零私有 RPC；视觉是**中性工程风，无拟人化元素**。
**注意**：在本机宿主（`0.2.0-rc.2` ≥ `0.1.2-alpha.1`）上事实事件被宿主词表 fail-closed，`teamRoom` 投影**永远空折叠**，该面板实际渲染不出房间。

**审批**：只有 `room_transfer_task` 走审批接缝，四种失败（无服务/无应答者/拒绝/取消）统一 fail-closed 到 `approval-unavailable` / `approval-denied`；闸门**只在工具壳里**，`/room task assign` 与 UI 交接按钮**不经审批**。

**最值得复用的 3 个机制**：① 单一写链作为顺序权威（`hub.ts:652-681`）；② "模型可见 ⟺ 已记录" + 权威在存储/副本在会话日志的双层投影（`projection.ts:267-284`、`events.ts:29-44`）；③ 游标式至少一次投递 + 激活时 `catchUp` 重放（`schema.ts:24,29`、`hub.ts:546-589,807-827`）。

**最必须补强的 3 件事**：① 把 `followup` 的无条件唤醒收归中心（改为默认 `inject` + 令牌唤醒）；② 消息加幂等键与 `rootId/hop`，超跳降级为不投递；③ 加速率/回合预算与自动熔断——并把"跨成员交接"的审批闸门**下沉到服务层**，否则每个新入口都会绕过它。
