# `@nanmicoder/dsh-agent-teams` v0.1.22 深度逆向调研报告

> 调研对象：本地已安装的 DSH 插件 `@nanmicoder/dsh-agent-teams@0.1.22`
> 路径：`$DSH_HOME\profiles\desktop\node_modules\@nanmicoder\dsh-agent-teams\`
> 方法：逐文件精读 `lib/*.js`（编译产物，保留完整 JSDoc）+ 分段读 `lib/client/*.js`，结论均附 `文件:行号`。
> 说明：`lib/` 是 TypeScript 经 `tsc` + `tsdown` 后的 ESM 产物，代码可读性高（未压缩、保留注释）。`lib/client.js` 是前端 bundle（4331 行，含内联 CSS），可读性差，仅用于交叉验证。

---

## 1. 定位与需求

### 1.1 一句话定位

把**当前 DSH 会话变成一个"队长"（captain）**：它会拉起若干**可续聊的持久化子 Agent（member）**，把目标拆成**带依赖的任务 DAG**，通过**持久化邮箱**协调，并自动用调度器把就绪任务喂给空闲成员。全程由自然语言驱动，无需单独的 Workflow 引擎。

`lib/index.js:1-20` 的模块注释即为官方定位：

- host-plane 插件，注册 `agent_teams_*` 工具 + 1 个 agent 级 system prompt section（`lib/index.js:5-6`）
- 成员是 "durable continuable subagents"（`lib/index.js:9-11`）
- 安装方式为 bundle patch：`dsh plugin --profile <name> add @nanmicoder/dsh-agent-teams`（`lib/index.js:14-17`）

### 1.2 README 声称的能力清单

`README_ZH.md:35-47` 的表格是官方能力清单（英文版见 `README.md:35-46`）：

| 能力 | README 原话要点 | 代码落点 |
| --- | --- | --- |
| 队长式委派 | 当前会话建队、分配角色、汇总结果 | `index.js:103-127`、`tools.js:623-757` |
| 可续聊成员 | 成员 = 可持续唤醒的 DSH 子 Agent | `members.js:495-541`（`startContinuable`） |
| 带依赖的任务 | 任务有显式状态；依赖未完成不能领取 | `state.js:106-109`、`tools.js:1437-1440` |
| 自动续领与安全接管 | 空闲成员自动领下一项；转派先撤销旧 attempt；冷恢复重试 | `scheduler.js:201-376`、`tools.js:1258-1367` |
| 成员直达消息 | 成员通过持久化邮箱直接找队友/队长，无需队长中转 | `tools.js:1776-1899`、`mailbox.js:1-174` |
| 实时活动面板 | 分段进度 + 可折叠成员树 + 可交互 DAG；运行中子任务标模型；归档保留历史 | `client/ActivityPanel.js`、`client/activity-model.js` |
| 质量门禁 | 默认 需求→实现→验证→审查→集成；失败自动修复/复审；恢复须显式 resume | `quality-gates.js:1-1047` |
| 计划先行（README.md:45） | `/agent-teams` 默认 staged 未生成成员的名单与 DAG，Web 面板用宿主模型目录选路由 | `tools.js:453-491`、`client/StagingPlanEditor.js` |

其他被 README 明确声明的行为：

- **14 个业务工具**（`README_ZH.md:25`；实测 `tool-names.js:2-8` 恰为 14 个）
- 队长**从第一轮就保留固定核心协议 + 全部 14 工具**，不随建队/审批/结束改写 system prompt 与工具 schema（`README_ZH.md:105`）
- 成员拿到**四个团队工具**（`README_ZH.md:105`；`tool-names.js:9-11`）
- 团队状态存 `<workspace>/.agent-teams/`（`README_ZH.md:122`）
- 队长**同一时间只带一个活动团队**（`README_ZH.md:162`）
- 状态文件持久化，**仅在单进程内串行**，多进程并发不保证一致（`README_ZH.md:164`）

---

## 2. 完整工具面

工具名定义在 `lib/tool-names.js:2-8`（14 个），注册在 `lib/tools.js:572-2132`。

```js
// lib/tool-names.js:2-8
TEAM_TOOL_NAMES = [
  'agent_teams_create', 'agent_teams_approve', 'agent_teams_edit_plan',
  'agent_teams_add_member', 'agent_teams_remove_member', 'agent_teams_create_task',
  'agent_teams_reassign_task', 'agent_teams_claim_task', 'agent_teams_update_task',
  'agent_teams_amend_task',
  'agent_teams_send_message', 'agent_teams_status', 'agent_teams_resume', 'agent_teams_delete',
];
// lib/tool-names.js:9-11  成员可见集合（4 个）
MEMBER_TOOL_NAMES = ['agent_teams_claim_task','agent_teams_update_task','agent_teams_send_message','agent_teams_status'];
// lib/tool-names.js:12    队长集合 = 14 - 4 = 10
CAPTAIN_TOOL_NAMES = TEAM_TOOL_NAMES.filter(n => !MEMBER_TOOL_NAMES.includes(n));
```

注册实现：`ctx.tools.register(defineTool({ ... }))`，来自 `@deepseek-ai/dsh-tools`（`tools.js:12`）。每个工具同时声明 `parameters`（入参）与 `output.schema`（出参 JSON Schema）+ `output.render`（给模型看的文本渲染）。

### 2.1 `agent_teams_create`（`tools.js:573-758`）

| 字段 | 类型 | 必填 | 语义 |
| --- | --- | --- | --- |
| `name` | string | ✅ | 团队名，用作稳定 id（`sanitizeKey`，`tools.js:627-630`） |
| `description` | string | — | 团队目标/目的 |
| `profile` | string | — | 已配置的命名 profile（与 `plan` 互斥，`tools.js:638-639`） |
| `plan` | object | — | 一次原子提交的 roster + DAG，见下 |
| `approval` | `'required' \| 'automatic'` | — | 默认 `automatic`；`required` 进入两阶段 staged 流程（`tools.js:594-598, 631`） |

`plan` 子结构（`tools.js:579-593`，`additionalProperties:false`）：

- `members[]`（必填）：`name`（必填）、`role`、`provider`、`model`、`reasoning_effort`
- `tasks[]`（必填）：`id`（必填，本批内的本地引用，依赖用它）、`subject`（必填）、`description`、`assignee`、`dependencies[]`

**输出 schema**（`tools.js:600-614`）：`team_id`、`team_name`、`state_dir`、`phase`，可选 `profile`、`task_planning`、`members[]`（`member_name/member_id/provider/model/reasoning_effort/status`）、`tasks[]`（`task_id/seed_id/subject/status/kind/assignee/dependencies`）。

**关键语义**：

- `phase='staged'` 时渲染文案明确要求模型"不要自己启动或审批"（`tools.js:617-619`）
- 队长已有团队（作为 lead 或 member）时直接抛错并给出继续/结束指引（`tools.js:640-648`）
- 团队 id 被别的队长占用时报错（`tools.js:650-653`）

### 2.2 `agent_teams_edit_plan`（`tools.js:760-883`）

| 字段 | 类型 | 必填 | 语义 |
| --- | --- | --- | --- |
| `operations` | array | ✅ | 一个**原子有序批次**；任一项非法则全部不保存（`tools.js:766`） |

`operations[]` 项字段（`tools.js:768-787`）：

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| `action` | enum ✅ | `update_member \| update_task \| add_task \| remove_task \| remove_member` |
| `member_name` | string | `update_member`/`remove_member` 用 |
| `task_id` | string | `update_task`/`remove_task` 用 |
| `subject` | string | `add_task` 必填；`update_task` 可选替换 |
| `description` | string | 任务描述 |
| `assignee` | string | **空字符串 = 移回共享任务池**（`tools.js:780`） |
| `dependencies` | string[] | **完整替换**依赖表（非增量） |
| `role` / `provider` / `model` / `reasoning_effort` / `execution_prompt` | string | 成员属性 |

**运行中团队的收窄契约**（`tools.js:354-360`）：非 staged 时**只允许 `update_task`**，且只能改 `status==='pending' && attempt===0 && !reassigning` 的任务（`tools.js:380-382`）；roster 与删除类操作必须回 staged。

**删除保护**：`remove_task` 前先检查是否还有别的任务依赖它，有则报错要求先改依赖（`tools.js:415-418`）；`remove_member` 前检查该成员是否还拥有计划任务（`tools.js:425-428`）。

输出：`status`、`team_id`、`members`(number)、`tasks`(number)、`dependencies`(number)、`roster[]`、`graph[]`（`tools.js:792-804`）。

### 2.3 `agent_teams_approve`（`tools.js:885-915`）

- 入参：`confirmation`（string，**必填**）——"用户的显式批准原话"
- 描述明确约束：**只能在新的用户轮次里、响应用户的显式批准时调用；绝不能在创建/编辑计划的同一轮调用**（`tools.js:886`）
- 校验 `confirmation.trim() !== ''`（`tools.js:907-908`）——注意这只是**形式参数**，不是真正的权限门；真正的门在 system prompt 协议与 Web UI
- Web 的「确认并启动团队」按钮**不走这个工具**，而是直接调用同一个 runtime（`index.js:280-298`）
- 输出：`status`、`team_id`、`members`、`tasks`

### 2.4 `agent_teams_add_member`（`tools.js:917-1012`）

| 字段 | 类型 | 必填 | 语义 |
| --- | --- | --- | --- |
| `name` | string | ✅ | 团队内唯一成员名 |
| `role` | string | — | 角色（researcher / engineer / reviewer…） |
| `provider` | string | — | **仅当用户明确要求异构分工时才用**；且**必须同时给 `model`**（`members.js:216-218`） |
| `model` | string | — | 省略则用队长的当前模型或配置的 `memberModel` |
| `reasoning_effort` | string | — | 目标模型支持的档位 id，或 `'default'` 强制用模型自身默认档 |
| `executionPrompt` | string | — | 成员专属执行提示词；staged 期间仍可编辑 |

**硬约束**：`name` 不得等于 `captain`（`tools.js:959-961`）；同名（`sanitizeKey` 后）不得重复（`tools.js:962-964`）；成员数达 `maxMembers` 上限报错（`tools.js:965-967`）。
**创建即校验模型**：`validateMemberLlmSelections` 在落盘前对 provider 目录校验（`tools.js:987`；`members.js:41-57`）——目录为空视为"适配器接受动态模型 id"，非空则严格校验。
**staged 期间不 spawn**：`id: ''`，成员状态 `idle`（`tools.js:975-986`）。

### 2.5 `agent_teams_remove_member`（`tools.js:1014-1072`）

- 入参：`name`（string，必填）
- 行为：撤销该成员所有未完成任务（`invalidateTaskAttempt`，任务回到 `pending` 并置 `reassigning=false`）→ 成员 `status='removed'` → 丢弃其未读邮箱 → 记录 retired deny-list → drain 其子激活（`tools.js:1039-1064`）
- **没有用户确认**（模型直接调用）
- 输出：`member_name`、`status`、`requeued_tasks[]`

### 2.6 `agent_teams_create_task`（`tools.js:1074-1231`）

这是字段最多的工具。

| 字段 | 类型 | 必填 | 语义 |
| --- | --- | --- | --- |
| `subject` | string | ✅ | 非空标题；**验证/审查任务也必须给**（`tools.js:1077`） |
| `description` | string | — | 详细说明 |
| `dependencies` | string[] | — | 依赖的任务 id，全部 `completed` 后才可领取 |
| `assignee` | string | — | 成员名；**省略即进共享池**；角色/标题/描述都不会自动指定负责人（`tools.js:1084`） |
| `kind` | enum | — | `work \| requirements \| implementation \| verification \| review \| repair \| integration`；省略 = `work`（无门禁），**即使标题里写了 implementation/review** |
| `round` | number | — | 1 起算的轮次 |
| `objective` | string | 质量类必填 | 目标 |
| `inScope` | string[] | implementation/repair 必填 | 工作区相对 POSIX 路径白名单 |
| `outOfScope` | string[] | — | 禁止改动的路径 |
| `acceptance` | string[] | 质量类必填（≥1） | 验收标准 |
| `verify` | string[] | implementation/repair 必填 | 验证命令 |
| `deliverables` | string[] | — | 预期产物 |
| `nonGoals` | string[] | — | 明确的非目标 |
| `reviewedTaskId` | string | review 必填 | 被审的 implementation/repair 任务 id |
| `sourceTaskId` | string | repair 必填 | 修复来源任务 |
| `sourceFindingIds` | string[] | repair 必填（≥1） | 本次修复要关闭的 finding id |
| `coverageOf` | string[] | — | 本任务覆盖的用户约束/目标条目 |
| `resume` | boolean | — | true 时在同一把锁内清除 halted |
| `resumeReason` | string | 与 `resume` 配套 | 非空原因 |

**门禁校验**由 `validateCreateTask`（`quality-gates.js:197-315`）执行，要点：

- `halted` 团队创建任务必须带 `resume=true` + 非空 `resumeReason`（`quality-gates.js:202-207`）
- 质量类必须有非空 `objective` 与 ≥1 条 `acceptance`（`quality-gates.js:208-215`）
- `implementation`/`repair` 必须有非空 `inScope` + `verify`（`quality-gates.js:216-223`）
- `review` 必须有存在且真实的 `reviewedTaskId`（`quality-gates.js:224-231`）
- `repair` 必须有 `sourceTaskId` + ≥1 `sourceFindingIds`，且**不允许与既有 open repair 覆盖同一组 finding**（防重复工作，`quality-gates.js:232-244`）
- `repair`/`review` **不得依赖 failed/cancelled 的上游**（`quality-gates.js:251-253`）
- **inScope 重叠禁止**：与其它 open 的写类任务 inScope 相交则要求串行化或拆路径（`quality-gates.js:255-273`）
- **implementation 必须被 requirements 围栏**：若团队已存在 requirements 任务而未通过，则 implementation 的依赖闭包必须包含某个 requirements 任务（允许 staged 期先规划，`quality-gates.js:274-287`）

### 2.7 `agent_teams_reassign_task`（`tools.js:1233-1367`）

| 字段 | 类型 | 必填 | 语义 |
| --- | --- | --- | --- |
| `task_id` | string | ✅ | 目标任务 |
| `assignee` | string | ✅ | 活跃成员名，或 `'captain'` 表示队长接管 |
| `reason` | string | — | 重试/转派原因（写入事件 output） |

行为与守卫：

- `completed` 任务**不可变**，拒绝改派（`tools.js:1269-1270`）
- 正在 reassigning 的任务只能"同目标重入"（幂等重试），否则报错（`tools.js:1271-1276`）
- 目标成员必须空闲：`memberOpenTask` 检查其是否已持有未完成任务（`tools.js:1288-1293`）
- 队长接管：① 队长自己同时只能有 1 个未完成接管（`captainOpenTask`，`tools.js:1278-1282`）② 依赖必须已满足（`tools.js:1283-1286`）
- **撤销顺序**：先 `invalidateTaskAttempt(task, target, true)`（清 `attemptId`、生成新 `handoffId`、置 `reassigning=true`）并标记旧成员 `stopping=true` → 锁释放 → `stopTeamMemberActivations`（`ctx.subagents.drainContinuableChildren`）等待安静 → 回到锁内校验 `handoffId` 未被并发改动（`tools.js:1321-1326`）；若 quiescence 失败则把 `reassigning` 留为 true 并把错误抛出
- 队长接管路径直接 `beginTaskAttempt(task,'captain')` + `status='in_progress'`（无成员 claim 握手，`tools.js:1334-1339`）

### 2.8 `agent_teams_claim_task`（`tools.js:1369-1469`）

| 字段 | 类型 | 必填 | 语义 |
| --- | --- | --- | --- |
| `task_id` | string | ✅ | 要领取的任务 |
| `assignee` | string | — | **已弃用**：claim 只支持成员领自己的任务（`tools.js:1373`） |

- 队长调用被严格限制：只能"读取自己已启动接管的 capability"，不得创建成员 claim（`tools.js:1405-1412`，注释指向 issue #125）
- 成员不能设置 `assignee`；任务若已指派他人则报错（`tools.js:1414-1420`）
- 已 `claimed`/`in_progress` 时走**幂等返回**，但**授权检查在幂等返回之前**，避免其他成员拿到假成功（`tools.js:1422-1436`）
- 依赖未满足 → 报错列未完成 id（`tools.js:1437-1440`）
- 同一成员已有未完成任务 → 报错（`tools.js:1447-1450`）
- `beginTaskAttempt` 生成 `attemptId = randomUUID()`（`state.js:146-161`）
- **输出含 `task_details`**：由 `taskDetails`（`tools.js:163-172`）拼装，包含 subject/description/kind/objective/inScope/outOfScope/acceptance/verify/依赖输出摘要

### 2.9 `agent_teams_update_task`（`tools.js:1471-1693`）

| 字段 | 类型 | 必填 | 语义 |
| --- | --- | --- | --- |
| `task_id` | string | ✅ | 目标任务 |
| `attempt_id` | string | 成员**每次**必填 | 当前 attempt capability；遗漏会给出"这是缺参数、不是被撤销，不要重启工作"的专门提示（`tools.js:1577-1579`） |
| `status` | enum | — | `in_progress \| completed \| failed \| cancelled` |
| `output` | string | — | 原始结果摘要；`completed`/`failed` 后不可变 |
| `evidence_note` | string | — | **仅终态任务**的追加观察；不改写原结论（活跃任务上使用会报错，`tools.js:1600-1601`） |
| `verdict` | enum | requirements/review 完成必填 | `pass \| needs_revision \| reject` |
| `findings` | array | `needs_revision`/`reject` 必填 | `{id✅, severity✅(low\|medium\|high\|blocker), problem✅, requiredFix✅, file?, line?, resolved?}` |
| `changedPaths` | string[] | implementation/repair 完成必填 | 工作区相对 POSIX 路径 |
| `acceptanceResults` | array | 质量类完成必填 | `{criterion✅, status✅(passed\|failed), evidence?}`，按契约顺序逐条 |
| `commandsRun` | array | 质量类完成必填 | `{command✅, status✅, exitCode?, evidence?}`，按 verify 顺序逐条 |

**权限与所有权校验**（`tools.js:1557-1601`）：

- 队长若目标是成员拥有的未终态任务 → 报错要求先 `reassign_task(assignee="captain")`；**唯一例外**是队长把 `pending`+`attempt=0`+非 reassigning 的任务直接 `cancelled`（`tools.js:1566-1572`）
- 成员必须 `task.assignee === identity.name`（`tools.js:1573-1575`）
- 成员 `attempt_id` 缺失/不匹配的两种错误文案分开（缺参数 vs stale capability）
- 终态任务走 `appendTaskEvidence` 追加路径：逐字段对比，**改 `status`/`output`/`verdict`/`findings`/`changedPaths` 会抛"终态任务不可变"**（`quality-gates.js:1014-1046`）

**自动质量跟进**（`tools.js:1640-1654`）：当 `status==='failed' && verdict ∈ {needs_revision, reject}` 时调用 `applyQualityFollowUp`（`tools.js:2282-2340`），自动生成 repair + 下一轮 review（或下一轮 requirements），并把仍 pending 的下游依赖**改挂到新终局门**上（`tools.js:2330-2338`），同时给队长邮箱塞一条"用这些任务，别重复建"的消息。

### 2.10 `agent_teams_amend_task`（`tools.js:1695-1773`）★ 队长专属

| 字段 | 类型 | 必填 | 语义 |
| --- | --- | --- | --- |
| `task_id` | string | ✅ | 要修订契约的任务 |
| `reason` | string | ✅ | 为什么当前契约是错的；写入 revisions 账本 |
| `objective` | string | — | 替换目标 |
| `acceptance` | string[] | — | 替换验收标准（**全量替换，非增量**） |
| `verify` | string[] | — | 替换验证命令（全量） |
| `inScope` | string[] | — | 替换 inScope（全量） |
| `outOfScope` | string[] | — | 替换 outOfScope（全量） |

纯规则在 `amendTaskContract`（`quality-gates.js:472-546`）：

- 必须非空 `by`（此处恒为 `'captain'`）与非空 `reason`
- **终态任务不可改**（`quality-gates.js:477-479`）
- `kind==='work'` 无权契约可改（`quality-gates.js:480-482`）
- 至少给一个可修订字段（`AMENDABLE_CONTRACT_FIELDS = ['objective','acceptance','verify','inScope','outOfScope']`，`quality-gates.js:457`）
- `inScope`/`outOfScope` 每项必须是合法的工作区相对路径（拒绝绝对路径与 `..`，`quality-gates.js:512-519`）
- **一旦有 review/requirements 任务已对该任务判 `verdict==='pass'`，契约冻结**（`quality-gates.js:523-528`）
- 追加 `TaskRevision{at, by, reason, fields, previous}`（`quality-gates.js:529-545`）

输出含 `revision_count` 与 JSON 化的新契约（`tools.js:1765-1771`）；同时发 `agent-teams/task-amended` 事件（`tools.js:1759-1764`）。

### 2.11 `agent_teams_send_message`（`tools.js:1775-1899`）

| 字段 | 类型 | 必填 | 语义 |
| --- | --- | --- | --- |
| `source_task_id` | string | — | **发送方**的任务，不是接收方的 |
| `source_attempt_id` | string | 与上者成对 | 发送方 capability；stale 报告会被拒（`tools.js:1816-1817,1821-1823`） |
| `to` | string | ✅ | `'captain'` 或成员名 |
| `content` | string | ✅ | 消息正文 |
| `from` | string | — | 必须等于调用者自己的身份，否则报错（防冒充，`tools.js:1811-1813`） |

投递语义（输出 `delivered` 四态，`tools.js:1789-1798`）：

- `live`：成员发给在线队长，`steerCaptainReport` → `captain.steer(...)` 成功（`tools.js:1870-1873`）
- `wake`：队长/成员发给成员，`dispatchMember(..., mode='steer')` 成功（`tools.js:1883-1887`）
- `mailbox`：只落持久邮箱（对方离线/投递失败）
- `duplicate`：同 from+content+task/attempt 且仍未过期的重复消息直接复用（`tools.js:1826-1831`）

另有**写入前**的门：目标成员必须在 team 里且**非 halted**（`tools.js:1845-1847`）。

### 2.12 `agent_teams_status`（`tools.js:1901-2024`）

- **无入参**（`parameters: {}`）
- 返回超集：`team_id/team_name/description/phase/halted/escalated/loop_state/loop_summary/deliverable/coverage[]/delivery{ok,blockers}/profile{name,protocol(截断240),task_planning}/viewer/members[]/tasks[]/captain_inbox[≤10]/member_inbox[≤10]/member_inboxes/mailbox_warnings/mailbox_warning_count`（`tools.js:1982-2015`）
- `members[]` 字段：`name/role/provider/model/reasoning_effort/status/activity/spawn_error?`；`activity` ∈ 实时驱动状态，未 spawn 时为 `'unspawned'`（`tools.js:1919-1930`）
- `tasks[]` 字段：`id/subject/status/assignee/dependencies/attempt/attempt_id/reassigning/kind/round?/verdict?/supplemental_evidence?/findings_open/seed_id?/output?`（`tools.js:1931-1947`）
- **可见性分级**：队长看到全部成员邮箱（每成员 `{count, latest(截断200)}`）；成员只能看到自己的（`tools.js:1956-1972`）
- **读取即确认**：返回后把已展示的消息 `acknowledgeMailbox`（`tools.js:2016-2021`）
- 队长调用时会顺带 `scheduler.kickTeam`（`tools.js:1914-1916`）
- 文本渲染 `renderStatus`（`tools.js:2351-2403`）会输出：团队名+标记（halted/escalated/deliverable）、Profile、Loop、Viewing as、成员列表（含 provider/model/reasoning 与启动失败原因截断400）、任务列表（含 kind/round/verdict/attempt/(reassigning)/seed/依赖/output(截断300)/补充证据）、Coverage、Delivery、队长 Inbox、成员 Inbox 摘要（截断120）、邮箱告警（≤10 条）

### 2.13 `agent_teams_resume`（`tools.js:2026-2077`）

- 入参：`reason`（string，**必填**）
- 行为：`resumeTeamState` 要求非空 reason；未 halted 时返回 `already_running`；成功则清 `halted/haltedAt` 并 `scheduler.kickTeam`（`tools.js:2053-2075`；`quality-gates.js:723-739`）
- **不重建已取消的任务**，只调度仍 pending 的工作（`tools.js:2027`）

### 2.14 `agent_teams_delete`（`tools.js:2079-2132`）

- **无入参**
- 行为：丢弃所有成员未读邮箱 → 成员 `status='removed'` → 撤销未终态任务的 attempt → 落盘 → 记录 retired deny-list → drain 所有成员激活 → 发 `agent-teams/team-deleted` → **归档（rename 到 `archive/<teamId>/`）而非删除**（`tools.js:2101-2130`）
- **没有二次确认**；只有 system prompt 层面的"未经授权不要丢弃未完成工作"（`index.js:100`）

### 2.15 工具面补充：`/agent-teams` slash 命令

不是 `agent_teams_*` 工具，但属于对外接口面（`lib/command.js`）：

- 注册 `agent-teams` 命令，`input.hint = '[--profile <name>] <goal>'`（`command.js:75-94`）
- **为每个合法 profile 名再注册一个 `/agent-teams-<name>` 别名**（仅小写 ASCII+数字+短横，`command.js:12-17, 95-111`）
- 命令处理器把原文作为普通用户消息 `followup`（`command.js:91`），因此聊天记录里能看到完整 `/agent-teams …`（符合 README_ZH.md:134）
- gesture boundary：`agent/pre-step` 里对**以 `/agent-teams` 开头的真实用户消息**注入确定性激活指令（`command.js:118-142`）；正则 `^\/agent-teams(?=$|[\t\n\r ])` 保证句中提及不算（`command.js:5`）
- 未知 profile 时注入"不要建队"的指令（`command.js:138-139`）

---

## 3. 代码实现逻辑

### 3.1 插件注册方式

**宿主侧**（`lib/index.js`）：

```js
export const name = 'agent-teams';                                    // index.js:38
export const inject = ['tools','llm','subagents','systemPrompt','agents'];  // index.js:39
export const Config = z.object({ ... });                              // index.js:47-87
export function apply(ctx, config) { ... }                            // index.js:103
```

`apply` 做了 6 件事：

1. **解析配置**（`index.js:104-113`）：`stateDir`、`memberProvider`、`memberModel`、`executionPrompt`、`fallback`、`memberMaxDepth`、`maxMembers`、`profiles`
2. **注册工具**：`registerAgentTeamsTools(ctx, resolved)`（`index.js:119`，`tools.js:282`）——内部先装 4 个全局守卫，再装调度器，再注册 14 个工具
3. **注入 system prompt section + 能力域**：`installTeamCapabilities`（`index.js:120-127`）
4. **slash 命令与手势边界**（`index.js:138-143`，`config.slashCommand` 默认 true）
5. **Web 路由（惰性）**：`registerWebSurface()`（`index.js:150-434`）
6. **服务绑定事件兜底**：`ctx.on('internal/service', ...)`，等待 `webServer/httpServer` 与 `workspaceRegistry/workspace` 出现（`index.js:435-440`）

**工具注册细节**：`registerAgentTeamsTools` 开头先安装 4 个守卫（`tools.js:283-285`）：

```js
installRetiredMemberGuard(ctx, config.stateDir);                        // 退役成员不可再被唤醒（members.js:600-605）
installMemberDelegationGuard(ctx, config.stateDir, config.memberMaxDepth ?? 0); // 后代深度预算（members.js:607-654）
installMailboxAdmission(ctx, config.stateDir);                          // 邮箱准入（mailbox.js:61-174）
const scheduler = installTeamScheduler(ctx, {...});                     // 调度器（scheduler.js:175）
```

**system prompt 注入**（`lib/capabilities.js:94-99`）：

```js
ctx.systemPrompt.section({
  name: 'agent-teams:usage', order: config.order ?? 117,
  text: ({ agent }) => states.get(agent)?.member ? TEAM_MEMBER_PROMPT : captainPrompt,
});
```

- `captainPrompt` 在挂载时**一次性快照**：`TEAM_ACTIVATION_PROMPT + usageSectionText(TEAM_TOOL_NAMES, formatProfilesForPrompt(profiles))`（`capabilities.js:45`；`index.js:126`）
- `usageSectionText` 就是那份**10 条固定队长协议**（`index.js:89-102`）
- 成员版本是一条更短的 `TEAM_MEMBER_PROMPT`（`capabilities.js:8`）

**成员工具裁剪**：`attach(agent)` 判断该 agent 是不是成员，若是则 `agent.ctx.tools.restrict({ deny: TEAM_TOOL_NAMES - MEMBER_TOOL_NAMES })`（`capabilities.js:82-85`）。
成员身份判定三条并集（`capabilities.js:55-60`）：① 是否 pending 成员（正在 spawn）；② 是否在 retired deny-list；③ 是否属于某个 team 且不是该 team 的 captain。

### 3.2 状态枚举与流转

**团队（TeamState，`lib/types/types.d.ts:213-255`）**

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `phase` | `'staged' \| 'running'`（可缺省＝running） | 两阶段生命周期 |
| `planReviewState` | `'awaiting_review' \| 'awaiting_feedback'` | staged 期间的人机子状态 |
| `halted` | boolean | 人工停止 |
| `escalated` | boolean | 自动质量循环触顶 |

**成员（MemberStatus，`types.d.ts:136`）**：`'idle' | 'working' | 'removed'`
附加布尔/可选字段：`stopping`（握手中，拒绝新投递）、`fallbackActive`、`spawnError`、`activeProvider`/`activeModel`（`types.d.ts:138-170`；持久化校验见 `state.js:611-630`）。

**任务（TaskStatus，`types.d.ts:11`）**：`pending | claimed | in_progress | completed | failed | cancelled`

**任务状态机**（`state.js:114-135`，`quality-gates.js:316-323` 两处相同定义）：

```
pending     → claimed | cancelled
claimed     → in_progress | failed | cancelled
in_progress → completed | failed | cancelled
completed   → (终态)
failed      → (终态)
cancelled   → (终态)
```

`TERMINAL_TASK_STATUSES = ['completed','failed','cancelled']`（`types.js:11`）。
注意：**`claimed` 不能直接跳 `completed`**（`state.js:116`），成员必须两步。

另有一套**视觉状态**（供 UI，非持久化）：`taskVisualState` → `'blocked' | 'open' | 'running' | 'completed' | 'failed' | 'cancelled'`（`state.js:911-926`）。

**任务 kind**：`requirements | implementation | verification | review | repair | integration | work`（`types.js:12-20`）
其中 `QUALITY_KINDS` = 前 6 个，`WRITE_KINDS = ['implementation','repair']`（`quality-gates.js:7-15`）。

**verdict**：`pass | needs_revision | reject`（`types.js:21`）
**finding severity**：`low | medium | high | blocker`（`types.js:22`）

### 3.3 任务 DAG

**依赖表达**：`TeamTask.dependencies: string[]`，存的是**任务 id**（`t1, t2, …`，由 `taskSeq` 单调分配，`tools.js:1185, 1208`）。

**环与引用校验**（两个位置）：

- staged 图：`validateStagedGraph` 用三色 DFS 检测自环/未知依赖/环（`tools.js:120-157`）
- profile 模板：`topoSortTasks` 做 Kahn 拓扑排序，剩余节点即环，错误信息按环长分档（`profiles.js:408-470`）
- 单任务创建：`validateCreateTask` 只校验依赖存在性与"repair/review 不得依赖 failed/cancelled"（`quality-gates.js:245-254`）

**就绪判定**：`unsatisfiedDependencies(tasks, deps)` = 依赖中 `status !== 'completed'` 的那些（`state.js:106-109`）。**注意 failed 依赖也算未满足**，即 failed 依赖会永久阻塞下游（这正是自动 repair 必须重挂下游依赖的原因）。

**成员取任务的优先级**（`scheduler.js:116-122`）：

```js
function nextReadyTask(tasks, memberName) {
  const ready = tasks.filter(t => t.status === 'pending' && t.reassigning !== true
    && unsatisfiedDependencies(tasks, t.dependencies).length === 0);
  return ready.find(t => t.assignee === memberName)   // 先领指派给自己的
      ?? ready.find(t => t.assignee === undefined);   // 再领共享池的
}
```

**这是关键架构事实：成员只会领"指派给自己"或"完全未指派"的任务，绝不会去抢别人指派的任务。**

**调度循环**（`lib/scheduler.js`）：

1. **事件驱动**：`ctx.on('agent/status', ({agent,status}) => syncMemberStatus(...))`（`scheduler.js:446-450`）
2. `syncMemberStatus` 先用 `findTeamByParticipant` 定位团队；队长走特殊分支（见下）；成员则写 `working/idle` 并在 idle 时 `kickMember`（`scheduler.js:378-445`）
3. `kickMember(workspace, teamId, memberName, captain)`（`scheduler.js:215-376`）：
   - 每个 (team, member) 一条串行队列 `serializeMember`（`scheduler.js:184-199`）
   - 若 team 不存在 / `halted` / `phase==='staged'` → 直接返回（`scheduler.js:220-221`）
   - 若队长 agent 不在线 → 返回（`scheduler.js:222-224`，**没有 live captain 就完全不调度**）
   - 若成员不可用（`stopping` 或 live 状态非 idle）→ 返回（`scheduler.js:106-111, 226`）
   - **优先投递 pending 邮箱**：`readPendingMailbox` → 丢弃过期邮件（`isCurrentMail`）→ 其余 lease（`claimMailboxDelivery`）→ `dispatch(..., 'steer')`，成功则 `markMailboxDelivered`，失败则 `releaseMailboxDelivery` 回退（`scheduler.js:230-253`）
   - 否则在锁内原子领取一张 ticket：
     - **parked 机制**：`parkedAttempts: Map<memberId, attemptId>`（`scheduler.js:182`）。本进程见过 idle 边但任务仍未终结 ⇒ 记下该 attempt 并"停驻"，后续 kick 不再自动重试；**只有冷启动（本进程没见过该 attempt）才允许一次恢复**（`scheduler.js:262-296`）
     - 领取时 `beginTaskAttempt` → `member.status='working'` → 落盘 → 返回 ticket（含依赖输出、契约、kind、round、executionPrompt 等，`scheduler.js:299-330`）
   - 组装 `assignmentPrompt`（`scheduler.js:123-173`）并 `dispatch(..., 'queue', ticket.attemptId)`
   - **失败回滚**：只在 `task.attemptId` 仍等于本次 ticket 时回滚（并发 handoff 优先），恢复型失败恢复原 generation 并继续 park，新任务型失败退回 `pending`（`scheduler.js:343-374`）
4. `kickTeam` = 对 team 内每个非 removed 成员依次 `kickMember`（`scheduler.js:201-214`）

**唤醒点汇总**：`create`、`approve`、`edit_plan`、`add_member`、`remove_member`、`create_task`、`update_task`、`resume`、`status`、`reassign_task`、以及每个 `agent/status` idle 边。

**`assignmentPrompt` 内容**（`scheduler.js:146-172`）非常关键，它把状态文件路径、依赖结果、契约、`attempt_id` 与"结构化完成载荷"一次性写给成员，并明确：
- 先 `claim_task` 再 `in_progress`，最后 `completed/failed`
- 每次 `update_task` 都要带 `attempt_id`
- stale 就停手
- 完成后 `send_message` 给队长并转 idle
- `quality kinds` 必须提交结构化字段
- **"`${stateDir}/${teamId}/` 是只读诊断，只能通过 `agent_teams_*` 工具改状态"**（`scheduler.js:172`）

### 3.4 成员如何被拉起

**走的是 `@deepseek-ai/dsh-subagent` 的 continuable 子代理**（不是 `dsh-subagent` 的普通 spawn）。

```js
// members.js:495-541  spawnMember()
const provider = ctx.subagents.getProvider(config.provider);           // 'spawn' | 'fork'
if (!provider) throw ...                                              // 499-503
if (!provider.prepareContinuable) throw ...                            // 504-506
if (!provider.capabilities.persona) throw ...                          // 507-509
if (!provider.capabilities.toolFilter) throw ...                       // 510-512
const label = `agent-teams:${team.id}:${member.name}`;                 // 513
await selections.withPending(captain.id, label, llmSelection, () =>
  startMemberWithLenientFilter(toolFilter => ctx.subagents.startContinuable({
    provider: config.provider, label,
    request: {
      prompt: [{type:'text', text: initialPrompt ?? memberWelcome(...)}],
      parent: captain,
      persona: memberPersona(team, member, stateDir, config.executionPrompt),
      toolFilter,
      agentOptions: { provider, model, reasoningEffort? },
    },
    signal,
  }), memberToolFilter(config.maxDepth, restrictableToolNames(captain))));
member.id = start.childId;                                             // 540
```

- **`memberProvider` 是"子 Agent 运行后端"**，取值 `spawn`/`fork`（默认 `spawn`，`index.js:49`、`cordis.patch.yml:21`），README_ZH.md:156 专门澄清"不是 LLM provider"
- **能力校验推迟到第一次 spawn**，因为 provider 注册是兄弟插件的副作用，可能在本插件挂载之后才落地（`index.js:114-118` 的注释）
- **成员模型路由**：`resolveMemberLlmSelection`（`members.js:198-254`）
  - 无显式 `provider`/`model` → 快照队长当前请求路由（`captain.session.requestHeader()?.config`）
  - `provider` 显式但缺 `model` → 报错（`members.js:216-218`）
  - **reasoning effort 策略**：同路由才继承队长档位；路由一变则**主动省略**，让目标模型用自己默认档（`members.js:231-238`）；显式给 `'default'` 强制走目标默认；显式档位必须能被 `ctx.llm.resolveCallConfig` 接受（`members.js:239-245`）
- **冷恢复**：`installMemberSelectionRuntime` 注册 `registerContinuableSetup`，在**子 session 组合期（同步）**用 `readTeamSync` 从 team.json 恢复持久化的 provider/model（`members.js:262-411`）；若描述符里的路由与 team.json 不一致则抛错（`members.js:303-305`）——防止"悄悄用默认模型跑"
- **准入护栏**：每个成员的 `agent/pre-step` 都重新校验它是否仍是该 team 的活跃成员、team 非 staged/非 halted、且没有正在 reassigning 的任务，否则 `{kind:'reject'}`（`members.js:283-295`）
- **失败收敛**：`agent/error`（这是 llm-retry 耗尽后的最终错误）→ 同步快照 attempt → `failMemberOpenAttempt` 把该任务置 `failed` 并写队长邮箱（`members.js:311-354`、`failMemberOpenAttempt` 在 `members.js:84-144`）
- **fallback 路由**：`agent/request-error` 命中 `QUOTA|RATE_LIMIT|AUTH|MISSING_CREDENTIAL|NO_ADAPTER` 时切到配置的 fallback（仅一次），并持久化 `activeProvider/activeModel/fallbackActive`（`members.js:59-69, 362-382`；`FALLBACK_FAILURE_CODES` 在 `members.js:59`）
- **人格（persona）替换整个 persona 段**：`memberPersona`（`members.js:435-469`），包含 10 条工作规则；protocol 截断到 400 字符（`members.js:25, 416-422`）
- **首次欢迎语** `memberWelcome`（`members.js:476-481`）明确"在调度器或队长派活之前不要开工"
- **投递两条通道**（`harness-compat.js`）：
  - `queueMemberPrompt` = **新回合 FIFO**（`host.followup` 或 `Symbol.for('dsh.subagent.deliverPrompt')` 的 `'queue'` 模式，`harness-compat.js:113-126`）
  - `steerMemberPrompt` = **并入最近模型步骤**（`'steer'` 模式，`harness-compat.js:128-147`）
- **深度预算**：`installMemberDelegationGuard` 用**父链遍历**（不依赖工具名）实现，`maxDepth=0` 时任何后代创建都抛错（`members.js:607-654`）；同时 `memberToolFilter` 在 `maxDepth===0` 时 deny 掉 `subagent` 与 `send_message`（`harness-compat.js:251-259`），并按宿主 registry 的 `restrictableNames` 过滤未知名字，失败还能"按报错名单缩小 deny 列表并重试"（`harness-compat.js:266-302`）

### 3.5 attempt_id / capability 机制

**生成**：`activateTaskAttempt` 里 `randomUUID()`，写入 `task.attemptId`，`task.attempt += 1`，清空上一轮的 `output/verdict/findings/changedPaths/acceptanceResults/commandsRun`（`state.js:136-161`）。
**`handoffId`**：另一条独立的随机 UUID，作为"异步静默期"的代际标记，用于检测 reassign 期间状态是否被并发改写（`state.js:178-186`、`tools.js:1321-1326`）。

**失效时机**：

| 场景 | 代码 | 效果 |
| --- | --- | --- |
| `reassign_task` | `state.js:178-186` | `attemptId=undefined`、新 `handoffId`、`status='pending'`、`reassigning=true` |
| `remove_member` | `tools.js:1048` | 撤销该成员所有非 completed 任务 |
| `cancelUnfinishedTask`（halt） | `state.js:167-177` | `status='cancelled'`，清 attempt/handoff |
| `captain takeover` | `tools.js:1335` | 新 attempt 归属 captain |
| `delete` | `tools.js:2112-2113` | 撤销未终态任务 |
| **队长 idle 边** | `scheduler.js:400-409` | 队长自己的未完成接管会被退回共享池（队长没有持久调度 lane） |

**防串改的三道防线**：

1. `update_task`：成员必须带 `attempt_id`；缺失 → 专门的"缺参数，不是被撤销，别重启"提示；不匹配 → "stale attempt，停手请求新指派"（`tools.js:1577-1582`）
2. `claim_task`：成员不能改 `assignee`，且授权检查在幂等返回之前（`tools.js:1414-1436`）
3. `send_message`：`source_task_id` + `source_attempt_id` 必须成对，且必须属于调用者本人与当前 generation（`tools.js:1816-1823`）

**生命周期硬化**：`recordRetiredMemberIds` 维护一份 `<stateRoot>/retired-members.json` deny-list（`state.js:27, 284-295`），`guardSubagentDelivery` 包装了 `followup` / `deliverPrompt` / `queuePrompt` / `sendMessage` 四条投递路径，命中即抛 `SubagentError('...NOT_RESUMABLE')`（`harness-compat.js:149-219`）。目的是补上上游 `interrupt()` 不彻底退役 continuable 会话的缺口（注释见 `members.js:588-599`）。

### 3.6 质量门禁（quality gates）

**契约字段矩阵**（`quality-gates.js:197-315` 的 `validateCreateTask` + `347-406` 的 `evaluateQualityCompletion`）：

| kind | objective | acceptance | inScope | verify | changedPaths | acceptanceResults | commandsRun | verdict | findings | reviewedTaskId | sourceTaskId/FindingIds |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `work` | — | — | — | — | — | — | — | — | — | — | — |
| `requirements` | ✅创建 | ✅创建 | — | — | — | — | — | ✅完成需 `pass` | ✅`needs_revision`/`reject` 时 ≥1 | — | — |
| `review` | ✅创建 | ✅创建 | — | — | — | — | — | ✅完成需 `pass` | 同上 | ✅ | — |
| `implementation` | ✅ | ✅ | ✅ | ✅ | ✅完成 | ✅完成 | ✅完成 | — | — | — | — |
| `repair` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | ✅ |
| `verification` | ✅ | ✅ | — | — | — | ✅完成 | ✅完成 | — | — | — | — |
| `integration` | ✅ | ✅ | — | — | — | ✅完成 | ✅完成 | — | — | — | — |

**完成门禁判定**（`quality-gates.js:347-406`）：

- 状态迁移本身必须先合法（`STATUS_TRANSITIONS`，`quality-gates.js:349-353`）
- `review`/`requirements` 完成：必须有 `verdict`，且**必须是 `pass`**；`pass` 还**不允许留下未解决的高/blocker finding**（`quality-gates.js:359-368`）
- `review`/`requirements` 失败：若 `verdict ∈ {needs_revision, reject}` 则**至少要有一个 finding**（`quality-gates.js:369-373`）
- `implementation/repair/verification/integration`：
  - 任何 `commandsRun` 为 `failed` ⇒ **必须** `status='failed'`，不能 `completed`（`quality-gates.js:378-382`）
  - `completed` 需要 `acceptanceResults` 覆盖**每一条** acceptance（`acceptanceCovered`：先按 criterion 精确匹配，退路是"等长且全 passed"，`quality-gates.js:327-338`）
  - `completed` 需要 `commandsRun` 覆盖**每一条** verify（`verifyCovered`，`quality-gates.js:339-346`）
  - `implementation/repair` 还需 `changedPaths`，且**每个路径都必须被判为 `in_scope`**（`quality-gates.js:392-403`）

**路径审计**（`quality-gates.js:71-140`）：

- `normalizeWorkspacePath` 拒绝绝对路径（`/` 开头）、Windows 盘符、`~`、`..`（`quality-gates.js:72-92`）
- `isDefaultExcluded` 恒定排除 `.git/`、`.dsh/`、`.env*`、含 `secrets` 段、`id_rsa*`（`quality-gates.js:114-129`）
- `classifyChangedPath` → `illegal | out_of_scope | in_scope | undeclared`

**自动修复/复审循环**（`planQualityFollowUp`，`quality-gates.js:579-649`）：

- 仅对 `review`/`requirements` 且 `status==='failed'` 生效
- `verdict==='reject'` ⇒ 直接 `escalated`（不再自动循环，`quality-gates.js:584-585`）
- `verdict!=='needs_revision'` ⇒ 什么都不做
- 轮次上限：`requirementsMaxRounds`（默认 4）/ `codeMaxRounds`（默认 3），超限 ⇒ `escalated`（`quality-gates.js:17-22, 588-593`）
- `requirements` 失败 → 生成下一轮 `requirements-round-N+1`（`quality-gates.js:594-604`）
- `review` 失败 → 生成一对：
  - `repair-round-N+1`：`inScope` **从 findings 推导**（`finding.file` + `requiredFix` 里出现的路径 token，正则见 `quality-gates.js:420`；推导不出才回退源任务 inScope，`quality-gates.js:441-456`）
  - `review-round-N+1`：依赖 repair，`reviewedTaskId = repair.id`
  - 修复者选择 `schedulableAssignee`：优先源任务原 owner，否则第一个非 removed 的非 captain 成员（`quality-gates.js:549-558`）
- 修复重复保护：同 `(sourceTaskId, findingIds)` 已有 open/repeated repair 则跳过；`maxRepairAttempts` 默认 2（`quality-gates.js:559-571, 612-616`）
- **下游重挂**：仍 pending 且依赖被关闭任务的下游，依赖改挂到新终局门（`tools.js:2330-2338`）

**覆盖矩阵与交付判定**：

- `buildCoverageMatrix`（`quality-gates.js:650-664`）：按 `coverageOf` 汇聚，状态 `missing | blocked | passed | in_progress`
- `canDeclareDelivery`（`quality-gates.js:665-722`）：blocker 包含 — staged、halted、escalated、无任务、非质量任务未完成、全部取消、质量任务未完成、`completed` 但无 `pass` verdict、失败但无后续修复、有完成实现但无通过的 review、以及**任何未通过审计的 changedPath**
- `describeQualityLoop`（`quality-gates.js:960-999`）：`halted | deliverable | escalated | running | blocked`，并明确写入"escalated 不是 halt"（`quality-gates.js:986`）

**契约修订（amend）**：见 2.10。设计动机写在 `quality-gates.js:458-471`——"契约本身错了会让执行者要么死锁要么钻空子"。

### 3.7 状态持久化

**文件布局**（`state.js:1-13` 注释 + 代码）：

```
<workspace>/<stateDir>/                       stateDir 默认 '.agent-teams'
├── retired-members.json                      # 全局退役 session id deny-list（含 BOM 容错）
├── <teamId>/                                 # teamId = sanitizeKey(teamName)
│   ├── team.json                             # 唯一真相源（TeamState）
│   └── inbox/
│       ├── captain.jsonl                     # 队长邮箱（每行一条 TeamMessage）
│       └── <memberName>.jsonl                # 每成员一个邮箱
└── archive/
    └── <teamId>/                             # 归档（整目录 rename）
        ├── team.json
        └── inbox/*.jsonl
```

- `createTeamDir` 建 `inbox/` 并原子写 `team.json`（`state.js:192-196`）
- `writeTeam` 用 `atomicWriteText`：同目录 temp（`wx` 独占创建）→ `rename`，Windows EPERM 时重试 3 次 × 50ms，最终降级为**直接覆盖写**；两条路都失败抛 `AggregateError`（`state.js:516-597`）
- `readTeam` 走 `coerceTeamState` 做**宽松迁移**：profile 字符串→对象、空字符串可选字段归一化后删除、`profileSeedId` 空值删除（`state.js:659-697`），最后 `isTeamState` 严格校验；不合法则抛 `invalid AgentTeams state in team "…"`（`state.js:206-208`）
- 邮箱是 JSONL：`appendMailbox` 读全文 + 拼接 + 原子重写（`state.js:373-387`）——**O(n) 重写，不是 append-only**，这是信息密度/规模上的一个隐含上限
- 坏行容错：`readMailbox` 逐行 parse，坏行跳过并回调 `onMalformedLine`，`status` 工具最多报告 10 条告警（`state.js:397-428`、`tools.js:1948-1955`）
- 邮件四态时间戳：`deliveryClaimedAt`（60s lease，`state.js:25, 434-441`）、`deliveredAt`、`readAt`、`discardedAt`（`state.js:472-511`）

**并发模型**：

- `withTeamLock(key, fn)` = 进程内 Map 的 promise 链（`state.js:29-55`），key 形如 `team:<stateRoot>:<teamId>`（`tools.js:39-41`）或 `captain:<stateRoot>:<captainId>`（`tools.js:43-45`）或 `retired-members:<stateRoot>`
- 每个成员的调度另有 `serializeMember` 队列（`scheduler.js:184-199`）
- **无跨进程锁**（README_ZH.md:164 明确承认）

**恢复逻辑**：

1. **冷启动成员路由恢复**：`readTeamSync` 在子 session 同步组合期读回 provider/model（`members.js:296-306`）
2. **冷启动任务恢复**：`parkedAttempts` 为空 ⇒ 本进程没见过该 attempt ⇒ 允许 `recoverOwned` 一次（`scheduler.js:262-296`）；恢复失败会把原来的 status/attempt/attemptId/结果整体写回并重新 park（`scheduler.js:350-360`）
3. **归档恢复**：`collectArchivedTeamsActivity` 从 `archive/` 读回完整成员与任务历史（`snapshot.js:166-182`），`archive/` 目录本身没有 `team.json`，因此活动扫描天然跳过（`state.js:829-837` 注释）
4. **历史卡片兜底**：`historicCardTeam` 把会话卡片里的 roster 投影成"已 removed、idle、0 进度"的只读面板（`client/ActivityPanel.js:420-441`）
5. **队长多队冲突检测**：`findTeamByCaptain` / `findTeamByParticipant` 发现一个 session 属于多个活动团队时**抛错**（`state.js:319-321, 354-356`）

### 3.8 审批与用户控制（staged plan → approve 两阶段）

**阶段一：创建 staged 计划**

- `agent_teams_create({..., approval:'required'})` 或 `create({profile})` → `state.phase='staged'`、`planReviewState='awaiting_review'`（`tools.js:664`、`tools.js:2166`、`tools.js:1178`+`201-202`）
- **不创建子会话、不领取任务**：staged 成员 `id:''`、`status:'idle'`，成员数是 0 个真实 session（`tools.js:975-986`）
- 调度器遇到 `phase==='staged'` 直接返回（`scheduler.js:204, 220`）
- `agent_teams_approve` 在 staged 之外调用会被 `requireStagedTeam` 拒绝（`tools.js:108-114`）
- 编辑计划：`edit_plan` 或 Web 的 `/plan` 路由（`updatePlanBatch`，`tools.js:346-449`）；任何 staged 编辑都会把 `planReviewState` 重置为 `awaiting_review`（`tools.js:444`）

**阶段二：三种用户动作**

Web 侧 `POST /plugins/dsh-agent-teams/plan`（`index.js:239-384`），`action` 四值：

| action | 后端行为 | 前端行为 |
| --- | --- | --- |
| `approve` | `approveStagedTeam`：过滤 removed 占位 → `validateStagedGraph(requireRunnable=true)`（至少 1 成员 + 1 任务，`tools.js:122-125`）→ 逐个解析并校验模型路由 → `phase='running'`、删 `planReviewState`、写 `approvedAt` → `scheduler.kickTeam` | 单次点击；成功后 `StagingPlanEditor` 卸载 |
| `continue` | `continueStagedPlanning`：若已 `awaiting_feedback` 则幂等返回；否则置 `awaiting_feedback` → `captain.cancel({kind:'user'},{keepInbox:true})` → `captain.followup(stagedPlanFeedbackContext)` | 「返回对话修改」→ `onContinuePlanning()` 关闭标签/回到输入框 |
| `discard` | `discardStagedTeam`：发 `plan-discarded` 事件 → `archiveTeamDir` → `captain.inject(stagedPlanDiscardContext)` → 再次 `captain.cancel` | 「放弃本次计划」→ 需**二次确认** |
| `update_member`/`update_task`/`add_task`/`remove_task` | `updateStagedPlan`（staged-only，`tools.js:451`） | 计划编辑器内的表单保存/删除 |

**Web approve 后如何唤醒模型**（`index.js:280-298`）：HTTP 结果只到浏览器，因此额外 `captain.steer(createUserMessage({text: stagedPlanApprovedContext(team.name)}))`；若 steer 抛错只记 warn，**绝不因为通知失败而报告审批失败**（避免诱导重试造成重复审批）。

**三段注入上下文**（`tools.js:251-276`）：

- `stagedPlanApprovedContext`：已提交、调度器接管、不要重复审批/重建、不要 busy-poll
- `stagedPlanDiscardContext`：决定是终局的、已归档、**不要因此重建替代团队**
- `stagedPlanFeedbackContext`：只保留这一份草案、本轮不要编辑、先问一个具体修改问题

**「放弃」与「停止」都阻断回环**：`continue`/`discard` 都会 `captain.cancel({kind:'user'}, {keepInbox:true})`，防止一个迟到的模型步骤看到"团队没了"就重新建队（`tools.js:546-561`）。

---

## 4. UI 呈现（重点）

### 4.1 客户端注入的 slot（对照 `package.json:70-83` 的 `dsh.client.inject`）

`package.json:70-82` 声明 8 个 client inject 依赖、`platform: "web"`：

| # | package.json inject 项 | 实际用途（代码证据） |
| --- | --- | --- |
| 1 | `@deepseek-ai/dsh-client-locale` | `ctx.locale.register('agentTeams', {zh,en})`；`native.locale.bind(...)`（`client/index.js:24, 39`） |
| 2 | `@deepseek-ai/dsh-client-ui-conversation` | `ctx.uiConversation.events.register(agentTeamsCardDefinition)` 折叠会话卡片（`client/index.js:77`；`agent-teams-card-definition.js:31-85`） |
| 3 | `@deepseek-ai/dsh-client-ui-layout` | `ctx.layout`（beginNavigation/selectPanel）+ `shell.overlay` 槽位（`client/index.js:26, 63`；`ActivityPanel.js:493` 查 `[data-shell-overlay]`） |
| 4 | `@deepseek-ai/dsh-client-ui-sidebar-right` | `ctx.inject(['sidebarRight','sidebarRightTabs'])` → 注册原生 "团队协作" 标签 + `sidebar.right.pane.tab`（`client/index.js:38-61`） |
| 5 | `@deepseek-ai/dsh-client-ui-model-selection` | `ctx.modelDirectories.directoryFor(sessionId)` 供 `StagedModelPicker` 读取宿主模型目录（`client/index.js:34, 57`；`StagingPlanEditor.js:71-218`） |
| 6 | `@deepseek-ai/dsh-api-session-controller` | `ctx.sessions`（`list`/`openSubagent`/`refreshSubagents`/`subagentAddress`）用于打开成员转写（`client/index.js:26`；`session-navigation.js:17-38`） |
| 7 | `@deepseek-ai/dsh-client-ui-session` | `currentSessionId(useSyncExternalStore(sessionsList...))` 判定当前会话（`ActivityPanel.js:464`；`session-navigation.js:3-7`） |
| 8 | `@deepseek-ai/dsh-client-ui-chat` | `useChat(snapshot => snapshot.nodes)` 驱动回合尾卡（`TeamChatEntry.js:17`） |

客户端自身的运行时服务依赖（`lib/client/index.js:10` / `client.js:4223-4230`）：
`['uiConversation','slots','sessions','locale','modelDirectories','layout']`。

**实际注册的 slot：6 个**（`lib/client/index.js:44-85`）：

| # | slot 名 | 注册 key/id | 组件 | 用途 |
| --- | --- | --- | --- | --- |
| 1 | `conversation.session.header.actions` | id `agent-teams-entry`, order 50 | `TeamChatEntry` | 会话标题栏的「查看团队」按钮（带队长鲸鱼头像），点击派发 `agent-teams:open-panel` 窗口事件（`TeamChatEntry.js:9-15`） |
| 2 | `conversation.chat.turnTail` | id `agent-teams-summary`, order 50 | `TeamTurnCard` | 回合尾部的团队摘要卡；**只在回合 `status==='closed'` 且存在卡片节点时渲染**（`TeamChatEntry.js:16-22`） |
| 3 | `sidebar.right.pane.tab` | key `TEAM_TAB_ID` = `@nanmicoder/dsh-agent-teams/activity` | `WorkspaceActivity` | 原生右侧栏「团队协作」标签页；同时通过 `createWorkspaceBridge` 让浮动面板**让位**（`client/index.js:53-61`；`WorkspaceActivity.js:23-26`） |
| 4 | `shell.overlay` | id `agent-teams-activity`, order 80 | `Panel` → `ActivitySurface` | 壳层叠加的**活动面板/浮动窗**（旧宿主回退路径）（`client/index.js:63-69`） |
| 5 | `conversation.chat.commandview` | key `agent-teams` | `HiddenAgentTeamsCommand`（返回 `null`） | 故意隐藏命令结果行，因为 `/agent-teams …` 原文会被回放成可见用户消息，否则重复（`client/index.js:13-15, 70-76`） |
| 6 | `conversation.chat.node` | key `agent-teams` | `AgentTeamsCard` | 会话内的团队卡片节点（队长头像 + 成员头像行 + 「查看团队」按钮）（`client/index.js:78-85`） |

另外注册了一个**侧栏标签**（不是 slot）：`native.sidebarRightTabs.register({ id: TEAM_TAB_ID, kind: TEAM_TAB_KIND:'agent-teams', title: () => t('workspace.title') })`（`client/index.js:40-43`；`WorkspaceActivity.js:10-11`）。

> 注：`ActivitySurface` 在 `bridge` 存在时渲染 `WorkspaceMonitor`（不渲染面板本身，只做轮询 + 打开标签），`bridge` 不存在时（旧宿主）渲染旧的 `ActivityPanel` 浮动面板（`WorkspaceActivity.js:23-26`）。

### 4.2 右侧栏 / 面板组件树

```
ActivitySurface                                    (WorkspaceActivity.js:23)
├─ WorkspaceMonitor（原生宿主）                     (WorkspaceActivity.js:27-71)
│   └─ 只轮询 + 检测首个 team → sidebar.openTab('agent-teams')
├─ WorkspaceActivity（sidebar.right.pane.tab 内容） (WorkspaceActivity.js:72-100)
│   └─ TeamSection（workspace=true）                (ActivityPanel.js:297)
└─ ActivityPanel（旧宿主 shell.overlay 浮动窗）      (ActivityPanel.js:442-804)
    ├─ CollapsedBadge（折叠角标：动点 + 计数）       (ActivityPanel.js:118-120)
    └─ aside[data-agent-teams-activity]
        ├─ header（拖拽把手 + 标题 + 忙碌点 + dock/折叠按钮） (ActivityPanel.js:793)
        ├─ div.teams
        │   ├─ visibleTeams   → TeamSection            (ActivityPanel.js:798-799)
        │   ├─ visibleArchived→ archive 标签 + TeamSection(historic) (ActivityPanel.js:800)
        │   └─ visibleHistoric→ historicCardTeam → TeamSection(historic) (ActivityPanel.js:801-802)
        ├─ resizeHandle（left / bottom / corner）      (ActivityPanel.js:803)
        └─ Modal（停止团队二次确认）                    (ActivityPanel.js:415-416)

TeamSection                                        (ActivityPanel.js:297-417)
├─ header.teamHead
│   ├─ 团队名 + (已结束/已放弃/已停止) 药丸
│   ├─ teamStats: N 名成员 / X/Y 完成 / N 条消息          (ActivityPanel.js:348, locales:186-188)
│   └─ 停止按钮（仅 canStop 时）                          (ActivityPanel.js:348)
├─ StagingPlanEditor（phase==='staged' && !historic）     (ActivityPanel.js:348 => StagingPlanEditor.js:373)
├─ section.delegationSection
│   ├─ captainNode: 鲸鱼队长头像(LEAD_ART) + "队长"/"拆解·派发·汇总" + 摘要 + 状态
│   ├─ ProgressOverview: 总进度标题 + 分段条 + 图例(进行中/等待依赖/已交付) + 汇总句
│   ├─ membersToggle（N 名成员 / 展开折叠）
│   └─ delegationTree → memberBlock × N
│       ├─ memberRow: 头像（角色鲸鱼图 或 首字母色块）+ 状态贴纸(ACTION_ART)
│       │             + 名字 + 角色 + 模型 chip + 状态 + 状态文案 + done/total
│       └─ assignmentLine: 「已派发」标签 + 任务 chip（运行时显示 `t1 · gpt-5.6-sol`）
└─ DependencyMap                                          (ActivityPanel.js:221-296)
    ├─ sectionHead: 折叠标题（"任务依赖" 或 "并行任务"）+ 提示
    ├─ dagViewport > dagCanvas
    │   ├─ svg.dagEdges（三次贝塞尔曲线，依赖边）
    │   └─ button.dagNode × N（id + 圆点 + 负责人 + 标题 + 运行时 WorkGlyph）
    └─ taskDetail（选中/悬停/键盘焦点任务）
        ├─ id + subject + 状态徽章
        ├─ 负责人 · （已完成/已取消/失败/无前置/前置已就绪/等待 …）
        ├─ 模型（`task.model`）
        └─ 下游：无下游 / 完成后解锁 X
```

**`StagingPlanEditor` 组件树**（`StagingPlanEditor.js:373-493`）：

```
section[data-staging-editor]
├─ header: 「执行前计划审查」+ "N 名成员 · N 项任务 · N 条依赖" + 「待确认」徽章 + 说明
├─ ol.planFlow: 1 审查计划 → 2 创建成员 → 3 开始执行
├─ section 成员与模型路由（可折叠）
│   └─ StagedMemberEditor × N                        (StagingPlanEditor.js:219-294)
│       ├─ 折叠头：名字 + 角色 + `provider/model` 路由 + 未保存标记
│       └─ 表单：角色 input / StagedModelPicker / 角色提示词 textarea / 保存
│           └─ StagedModelPicker: Menu 三层（root → models → effort）
│               ├─ 模型（provider 分组 label + 模型项）
│               └─ 推理等级（Provider 默认值 / 模型默认值(x) / 各档位 name+description）
├─ section 任务与依赖（可折叠）
│   └─ StagedTaskEditor × N                          (StagingPlanEditor.js:295-372)
│       ├─ 折叠头：task id + subject + 负责人 · 依赖条数 + 未保存标记
│       └─ 表单：subject / description / assignee select / dependencies（逗号分隔）/ 保存 / 删除（二次确认）
├─ form.planNewTask: 新增计划任务（输入 + 添加任务）
└─ div.planApproveRow[data-review-state]
    ├─ 文案区（三态：确认放弃 / 等你说明修改方向 / 计划检查完毕？）
    └─ 按钮组：确认并启动团队 | 返回对话修改 | 放弃本次计划
```

**关键交互细节**：

- 「确认并启动团队」按钮**在存在未保存编辑时禁用**（`hasPendingEdits`，`StagingPlanEditor.js:386, 492`）
- 「确认并启动团队」还要求 `runnable`（至少 1 成员 + 1 任务，`StagingPlanEditor.js:385, 492`）
- 模型 picker 的 `onChange` **立即持久化**（`persist()`，`StagingPlanEditor.js:253-287`），切换模型会把 `reasoningEffort` 重置为 `'default'`（`StagingPlanEditor.js:185-189`）
- 每个编辑器通过 `onPendingChange` 上报表单脏状态（`StagingPlanEditor.js:241-243, 312-314, 391-402`）

### 4.3 视觉风格：头像、拟人化元素、颜色

**结论：有头像，有明确的拟人化元素；但代码里没有任何 emoji 字符。**

**确证 1 — 无 emoji**：对 `lib/**/*.js` 用 Unicode 码位范围正则搜索 `[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B00}-\x{2BFF}]` 与 `🐳|🐋|🐬|🐟|🦈|🐙` → **零命中**。UI 里的"鲸鱼"全部是 **PNG 位图资源**。

**确证 2 — 拟人化鲸鱼吉祥物（已目视确认）**：

| 资源 | 尺寸 | 目视结果 |
| --- | --- | --- |
| `assets/agent-teams/team-lead-v2.png` | 256×256 | 蓝色卡通鲸鱼，戴白色**船长帽**，前鳍指向右侧 |
| `assets/agent-teams/member-engineer-v2.png` | 256×256 | 蓝色卡通鲸鱼，戴**护目镜**、手持**扳手**、腰系**工具带** |
| `assets/agent-teams/action-sleeping-v2.png` | 256×256 | 蓝色卡通鲸鱼，蜷缩闭眼睡觉，头顶冒气泡 |

全部 15 个 PNG 均为 256×256、约 40–78 KB。

**头像资源引用方式**：服务端**白名单路由**下发，前端按角色关键词映射（`lib/index.js:388-432`、`lib/client/artwork.js`）。

```js
// index.js:388-398  白名单（同时是路径穿越防护）
const artDir = fileURLToPath(new URL('../assets/agent-teams/', import.meta.url));
const ART_ALLOWLIST = new Set([
  'team-lead-v2.png',
  'member-researcher-v2.png','member-engineer-v2.png','member-qa-v2.png',
  'member-designer-v2.png','member-security-v2.png','member-docs-v2.png',
  'member-data-v2.png','member-operator-v2.png',
  'action-working-v2.png','action-thinking-v2.png','action-reporting-v2.png',
  'action-celebrating-v2.png','action-sleeping-v2.png','action-sending-v2.png',
]);
// index.js:399-432  路由 /plugins/dsh-agent-teams/assets/<name>，白名单外一律 404
```

```js
// client/artwork.js:8-29
export const ART_BASE = '/plugins/dsh-agent-teams/assets/';
const ROLE_ART = [                        // 按顺序首个命中生效
  [/data|analys|metric|performance|数据|分析|指标|性能/, 'member-data-v2.png'],
  [/resear|investig|explor|study|研究|调查|探索|调研/,  'member-researcher-v2.png'],
  [/\bqa\b|test|verif|quality|测试|质量|验证/,          'member-qa-v2.png'],
  [/engineer|dev\b|server|backend|\bapi\b|runtime|watcher|contract|工程|后端|服务|接口|开发|代码|编程/, 'member-engineer-v2.png'],
  [/design|\bui\b|\bux\b|front|theme|accessib|设计|前端|主题|无障碍/, 'member-designer-v2.png'],
  [/secur|audit|risk|threat|review|安全|审计|审查|风险/,  'member-security-v2.png'],
  [/docs|writer|product|spec|撰写|文案|写作|文档|规范/,   'member-docs-v2.png'],
  [/release|\bbuild\b|deploy|\bops\b|\bci\b|ship|coordin|发布|构建|部署|运维|协调/, 'member-operator-v2.png'],
];
export const LEAD_ART = `${ART_BASE}team-lead-v2.png`;   // 队长固定用 lead 鲸鱼
export const ACTION_ART = { working: '.../action-working-v2.png', idle: '.../action-sleeping-v2.png', unknown: '.../action-thinking-v2.png' };
```

**重要结构性事实**：

- 路由和 `ACTION_ART` 只声明了 3 个动作图（working / idle / unknown），但**白名单里有 6 个动作图**——`action-reporting-v2.png`、`action-celebrating-v2.png`、`action-sending-v2.png` **当前是"已打包但未被前端引用"的资源**（对应 v0.1.10 release note 里"减轻状态贴纸"的收敛）。
- 角色无命中时回退为**首字母色块**，背景色按 `stableHash(member.id) % 5` 取宿主主题别名（`ActivityPanel.js:57-76`）：
  `--dsw-alias-state-business-primary` / `-success-` / `-error-` / `-warn-primary` / `--dsw-alias-label-tertiary`
- **全部颜色都走宿主主题变量 `--dsw-alias-*`**，没有硬编码色值（`client.js:780` 的内联 CSS 也是同一套变量），因此跟随宿主主题/暗色模式。
- 面板整体视觉：毛玻璃（`backdrop-filter: blur(20px) saturate(1.08)`）、1px 主题边框、双层阴影、`position:absolute; top:64px; right:18px` 的折叠角标、宽度上限 640px（`client/panel-geometry.js:7`）。

### 4.4 信息密度

**典型运行态（1 队长 + 3~8 成员 + 5~10 任务），活动面板同时可见的字段清单**：

**A. 面板头（3 项）**：标题「AgentTeams 活动」、忙碌指示点（`data-busy`）、2 个图标按钮（停靠/浮动切换、收起）。

**B. 团队头（6 项）**：团队名、历史药丸（已结束/已放弃/已停止）、成员数、完成比 `X/Y 完成`、消息条数、停止按钮。

**C. 队长节点（6 项）**：鲸鱼头像、称呼「队长」、角色行「拆解 · 派发 · 汇总」、摘要句（4 变体）、派工状态字、WorkGlyph 动画。

**D. 总进度（5 项）**：标题、分段进度条（**每任务一格**）、图例三档计数（进行中/等待依赖/已交付）、汇总句（11 变体之一）、色调标记（running/warning/completed/discarded）。

**E. 成员树每成员 10 项**：角色鲸鱼头像或首字母色块、状态贴纸图、名字、角色、模型 chip（`provider/model` 紧凑化）、状态词（12 变体）、状态文案（11 变体，含"正在执行 t3 · gpt-5.6-sol"）、`done/total`、未读标记、任务 chip 行（每 chip = taskId [+ 运行时模型]）。

**F. 依赖图（全局）4 项 + 每节点 4 项 + 详情 5 项**：地图标题/提示、边（贝塞尔曲线）、节点（id、圆点、负责人、标题、运行中字符号）、详情（id、subject、状态徽章、负责人·阶段说明、模型、下游）。

**量级估算**：8 成员 + 10 任务的团队，面板一次渲染 ≈ **40（团队/队长/进度）+ 80（成员行）+ 60（10 个 DAG 节点 + 详情）≈ 180 个可见数据点**。这正是 README 所说"分段进度、可折叠成员树、可交互 DAG"三者叠加的结果；`ActivityPanel.js:375` 的默认折叠策略（只显示"运行中或有未完成任务的成员"，其余藏在「展开 N 位已完成成员」后面）就是为控制这个密度。

**卡片（会话内）密度低得多**（`AgentTeamsCard.js:59-62`）：头像 + 团队名 + `{count} 名成员` + 「查看团队」按钮 + 每个成员一个"头像+名字"按钮，共 4 + 2N 项。

**轮询开销**：活动面板对每个有团队的会话**每 1000 ms** 轮询一次 `/plugins/dsh-agent-teams/state`（`activity-monitor.js:101`）；没有卡片的会话用 5000 ms 低频探测，直到发现首个团队才升级到 1 s（`activity-monitor.js:108, 178-183`）。服务端每次都要 `readdir` 所有工作区 stateRoot + 读每个 `team.json` + 读每个成员邮箱（`snapshot.js:129-157, 49-58`）——这是本插件最明显的持续开销来源。

### 4.5 审批点清单（会弹用户确认/审批的时机）

严格按代码区分**UI 强制确认**与**仅 prompt 约定**两类。

#### A. UI 强制确认（前端真会拦一道）

| # | 时机 | 触发位置 | 确认形式 | 需要点击数 |
| --- | --- | --- | --- | --- |
| 1 | **确认并启动团队** | `StagingPlanEditor.js:492` `data-plan-approve` | ⚠️ **单击直接生效**，无二次确认。locale 里有 `plan.approveConfirmTitle` / `plan.approveWarning` / `plan.approveConfirm`（`locales.js:171-173`）但**无任何组件引用**——是未使用的死字符串 | **1** |
| 2 | 放弃本次计划 | `StagingPlanEditor.js:492` `data-plan-discard` → `discardArmed` | 按钮组切换为「取消 / 确认放弃」`data-confirming` | **2** |
| 3 | 删除计划中的任务 | `StagingPlanEditor.js:371` `confirmingRemove` → `plan.removeConfirm` | 「删除」→「确认删除」 | **2** |
| 4 | 停止团队（运行中） | `ActivityPanel.js:348` 团队头停止按钮 → `ActivityPanel.js:415-416` `Modal` | 弹窗「确认停止"{team}"？」+「继续运行 / 确认停止」 | **2** |

其它不算审批但需点击的 UI 动作：返回对话修改（1 次，`plan.continue`）、切换成员模型/推理档（Menu 内 2–3 次）、DAG 节点固定/取消（1 次，Esc 取消）、打开成员转写（1 次）。

#### B. 仅 prompt 约定（无 UI/代码强制门）

| 时机 | 约定出处 | 是否有代码强制 |
| --- | --- | --- |
| `agent_teams_approve` | `tools.js:886` "只在新的用户轮次、响应用户显式批准时调用" | ❌ 仅校验 `confirmation` 非空字符串（`tools.js:907`） |
| 队长接管实现/审查 | `index.js:96` "Captain implementation/review takeover requires a user request" | ❌ |
| `agent_teams_reassign_task` | `tools.js:1234` | ❌ **无任何用户确认** |
| `agent_teams_amend_task` | `tools.js:1696` | ❌ 仅校验 reason 非空 + 非终态 + 未被 review 判过 pass |
| `agent_teams_remove_member` | `tools.js:1015` | ❌ |
| `agent_teams_delete`（结束并归档团队） | `tools.js:2080` | ❌ **无二次确认**；只有 `index.js:100` "未经授权不要丢弃未完成工作" |
| 部署（deploy） | `index.js:99` "Deployment requires explicit user confirmation" | ❌ 无对应工具，纯提示 |

#### C. 典型任务的点击数统计

| 场景 | 用户点击次数 |
| --- | --- |
| **最小**：`/agent-teams 目标` → 模型建 staged 草案 → 点「确认并启动团队」 | **1 次** |
| 典型（含一次修改往返）：`/agent-teams` → 「返回对话修改」 → 说明 → `edit_plan` → 「确认并启动团队」 | **2 次点击 + 1 条消息** |
| 典型（跑到结束）：建队 → 审批 → 收班 → 让队长 `delete` 归档 | **1 次**（删队不需确认） |
| 中途人工干预：建队 → 审批 → 停止团队（2 次） → 要求恢复（说话即可） | **3 次** |
| 弃案：建队 → 放弃本次计划（2 次） | **2 次** |

**结论**：**典型大任务最少 1 次、常见 1–3 次、需要人工停止时 3–4 次**。设计意图非常明确——除"启动"与"停止/放弃"这两个不可逆边界外，其余全部交给模型自主决策（`README_ZH.md:201` 也如此宣称）。

---

## 5. 硬约束与安全

### 5.1 数量上限

| 约束 | 默认值 | 出处 |
| --- | --- | --- |
| 每队成员数 `maxMembers` | **8**（可配，`min(1)`） | `index.js:84, 111`；校验 `tools.js:965-967` |
| 成员后代深度 `memberMaxDepth` | **0**（不允许成员再建子代理；`1` 允许一层） | `index.js:83, 110`；`harness-compat.js:251-259`；`members.js:607-654` |
| 命名 profile 数量 `MAX_TEAM_PROFILES` | **16** | `profiles.js:13, 31-33` |
| 每 profile 种子任务数 `MAX_PROFILE_TASKS` | **32** | `profiles.js:15, 228-230` |
| 每个队长的活动团队数 | **1** | `tools.js:640-648`；`state.js:319-321` |
| 每个 agent 参与的活动团队数 | **1**（多队即抛错） | `state.js:354-356` |
| 每个成员同时持有的未完成任务 | **1** | `tools.js:1447-1450`（claim）、`tools.js:1288-1293`（reassign） |
| 队长同时持有的未完成接管任务 | **1** | `tools.js:1278-1282` |
| 每个 (team, member) 并发调度 | 串行队列 | `scheduler.js:184-199` |
| 每个 team 的并发改状态 | 串行队列 | `state.js:36-55` |

### 5.2 长度/体量上限

| 项 | 值 | 出处 |
| --- | --- | --- |
| 依赖结果注入提示词的单项上限 | 2000 字符 | `scheduler.js:19, 78-79` |
| 依赖结果合计上限 | 12000 字符（超出从最旧的开始丢） | `scheduler.js:21, 83-89` |
| persona 里 profile protocol 上限 | 400 字符 | `members.js:25, 419-421` |
| usage prompt 里 profile protocol 上限 | 240 字符 | `profiles.js:17, 137-139` |
| HTTP 请求体上限 | 1,000,000 字节（超 413） | `web-routes.js:9, 36-37` |
| 路径/邮箱 key 长度 | 48 个码点 + 8 位 sha256 摘要 | `state.js:64, 94-96` |
| `status` 渲染的 output 截断 | 300 字符 | `tools.js:2376` |
| `status` 渲染的 spawn_error 截断 | 400 字符 | `tools.js:2370` |
| `status` 返回的邮箱条数 | 队长 ≤10、成员自己 ≤10、每成员 latest 200 字符 | `tools.js:1959, 1969, 2006, 2017` |
| `status` 邮箱坏行告警 | ≤10 条 | `tools.js:1948-1955` |
| 模型候选报错展示 | 前 8 个 | `members.js:53` |
| 面板最大宽度 | 640 px | `client/panel-geometry.js:7` |
| 任务标题紧凑化截断 | 18 字符 | `ActivityPanel.js:172` |

**注意**：**`agent_teams_send_message.content` 本身没有任何长度上限**，邮箱 JSONL 也没有逐文件大小上限。（未确认：宿主 `followup`/`deliverPrompt` 是否在更下层设限——本插件代码内未见。）

### 5.3 循环/重试防护

| 机制 | 说明 | 出处 |
| --- | --- | --- |
| `DEFAULT_REVIEW_POLICY` | `requirementsMaxRounds:4`、`codeMaxRounds:3`、`maxRepairAttempts:2`、`requirementsMinRounds:1` | `quality-gates.js:17-22` |
| `escalated` 状态 | 超限后停止自动循环，明确"不是 halt" | `quality-gates.js:584-585, 592-593, 980-988` |
| parkedAttempts | 本进程见过的 idle 边 ⇒ 不自动重试，只有冷启动恢复一次 | `scheduler.js:176-182, 262-296` |
| 恢复失败回写 | 恢复型投递失败时恢复原 generation 并继续 park，避免无限新 attempt | `scheduler.js:350-360` |
| 邮箱 lease | `deliveryClaimedAt` 60 s 租约，崩溃后可重试 | `state.js:25, 434-441` |
| fallback 只切一次 | `selectFallbackRoute(..., alreadySwitched)` | `members.js:64-69, 362-382` |
| `agent/error` 去重 | 按 `payload.turn` 去重，同一轮只记一次 | `members.js:311-314` |
| repair 去重 | 同 `(sourceTaskId, findingIds)` 已有 open repair 则拒绝新建 | `quality-gates.js:239-243, 612-613` |
| inScope 冲突拒绝 | 两个 open 写类任务 inScope 相交则拒绝 | `quality-gates.js:255-273` |
| attempt 幂等 | 队列串行 + attemptId 比对 + handoffId 代际校验 | `state.js:36-55`、`tools.js:1321-1326` |
| 活动轮询降频 | 无团队时 5 s 而非 1 s | `activity-monitor.js:108` |
| 反重建护栏 | discard/continue 后 `inject`+`cancel` 双保险 | `tools.js:546-561` |
| 单团队重建拒绝 | 已有团队时 `create` 直接抛错并给出指引 | `tools.js:640-648` |

### 5.4 权限与安全校验

| 项 | 实现 | 出处 |
| --- | --- | --- |
| 工具调用必须是 agent | `requireCaptain`：`exec.agent` 为空即抛错 | `tools.js:24-29` |
| 角色/身份**每把锁内重新推导** | `participantIdentityOf` + `requireFreshParticipant` | `tools.js:62-91` |
| 队长专属操作在锁内复查 | `requireFreshCaptainTeam` | `tools.js:76-83` |
| 成员工具面收紧 | `tools.restrict({deny: 10 个队长工具})` | `capabilities.js:82-85` |
| 成员 spawn 时工具过滤 | `deny: CAPTAIN_TOOL_NAMES + (maxDepth===0?['subagent','send_message']:[])` + 宿主 registry 校验 + 未知名重试 | `harness-compat.js:251-302` |
| 成员前步准入 | 每个 `agent/pre-step` 复查成员/团队状态，失败 `{kind:'reject'}` | `members.js:283-295` |
| 退役成员拒绝唤醒 | `retired-members.json` + 4 条投递路径 guard | `state.js:284-295`、`harness-compat.js:149-219` |
| 身份冒充防护 | `send_message` 的 `from` 必须等于调用者 | `tools.js:1811-1813` |
| Web 路由鉴权 | `authenticatedWebRoutes`：Connection 缺失 → 503；`requestRejection` → 401/403 | `web-routes.js:62-85` |
| 静态资源白名单 | `ART_ALLOWLIST`（15 个文件名，拒绝路径穿越） | `index.js:389-417` |
| 请求体防护 | 1 MB 上限 + JSON 解析 + 必须是对象 | `web-routes.js:9-59` |
| 路径穿越防护 | `sanitizeKey` 把非字母数字折成 `-`，纯符号/emoji 走摘要 | `state.js:87-98` |
| 工作区路径约束 | 拒绝绝对路径/盘符/`~`/`..` | `quality-gates.js:72-92` |
| 默认敏感路径排除 | `.git`、`.dsh`、`.env*`、`secrets`、`id_rsa*` | `quality-gates.js:114-129` |
| 状态文件自愈 | 空字符串可选字段归一化后删除，避免"一个空串砖掉整个 team" | `quality-gates.js:799-819`、`state.js:683-694`、issue #99/#105 注释 |
| 事件写入降级 | 宿主不认识的 event type 直接跳过并 debug 记录，不抛 | `events.js:26-47` |
| 单进程假设 | README 明确承认不跨进程 | `README_ZH.md:164` |

### 5.5 已知的宽松点（作为对照）

- **`agent_teams_delete` 无任何确认**，一次工具调用即归档全队（成员被 drain、未完成任务 attempt 被清）。防护只在 prompt 层。
- **`agent_teams_amend_task` 允许队长在任务执行中改契约**（含 `inScope`/`verify`）。约束只有"非终态 + 未被判过 pass + 有 reason"，且 `revisions` 账本**只记录不阻断**。
- **`agent_teams_approve` 的 `confirmation` 是纯装饰参数**。
- `status` 工具**读即标记已读**（`acknowledgeMailbox`），没有"仅预览"选项。

---

## 6. 兼容性与工程化

### 6.1 宿主版本矩阵

`compatibility.json`（全文 39 行）：

```json
{ "schemaVersion": 1, "recommendedHost": "0.2.0-rc.2", "previewTag": "next",
  "supportedHosts": [
    {"version":"0.2.0-rc.2","track":"recommended"},
    {"version":"0.1.7-rc.2","track":"legacy"},
    {"version":"0.1.5-rc.3","track":"legacy"},
    {"version":"0.1.5-rc.2","track":"legacy"},
    {"version":"0.1.5-rc.1","track":"legacy"},
    {"version":"0.1.2-rc.1","track":"legacy"},
    {"version":"0.1.2-alpha.5","track":"preview"},
    {"version":"0.1.2-alpha.2","track":"legacy"}
  ] }
```

**8 个受支持宿主**：1 个 recommended + 1 个 preview + 6 个 legacy。`README_ZH.md:51` 强调"宿主仍为 RC 版本"。

`package.json:84-109` 的 `peerDependencies` 用**显式 OR 列表**锁定同一组 8 个版本（例如 `"@deepseek-ai/dsh-agent": "0.2.0-rc.2 || 0.1.7-rc.2 || 0.1.5-rc.3 || …"`），覆盖 22 个 `@deepseek-ai/dsh-*` 包 + `@deepseek-ai/cordis ^4.0.2` + `@deepseek-ai/schemastery ^3.18.2` + `react ^18.2.0`。**全部标注 `optional: true`**（`package.json:110-183`），但 `scripts/compatibility.mjs:21-27` 的注释明确说明：客户端服务可由宿主浏览器模块表提供，而**服务端入口是 value import，optional 元数据并不能让未解析的安装变成可执行**，因此列出 `serverRuntimePeers` 单独校验。

`engines.node`：`^22.19.0 || >=24`（`package.json:58-60`）。

### 6.2 构建方式

`package.json:225` 的 build 流水线：

```
node scripts/clean-build.mjs
  && tsc -p tsconfig.json          # 服务端 TS → lib/*.js + lib/types/*.d.ts
  && tsc -p tsconfig.client.json   # 客户端 TS → lib/client/*.js
  && tsdown                        # 打包 lib/client.js（前端 bundle，含内联 CSS）
  && node scripts/git-artifacts.mjs --write
```

- 打包器：**tsdown 0.22.2**（`package.json:218`），另有 `lightningcss ^1.33.0`（`package.json:215`）处理 CSS Modules
- 类型检查：`tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit`（`package.json:226`）
- **产物随包分发**：`package.json:20-33` 的 `files` 明确包含 `lib`、`assets/**`、`cordis.patch.yml`、`release-notes`、两份 README、`compatibility.json`、两个脚本、`pnpm-workspace.yaml`；README 强调"从 Git 安装无需 `prepare` 或批准构建脚本"（`README_ZH.md:93`）
- **产物指纹**：`lib/git-artifact-stamp.json` 记录 `{schema:1, source:<sha256>, output:<sha256>}`，由 `scripts/git-artifacts.mjs` 生成与校验
- 依赖锁定：`pnpm-workspace.yaml` 实为 **JSON 内容**（`compatibility.mjs:5-6` 注释说明"JSON 也是合法 YAML，保持随包诊断脚本零依赖"），含 276 条 `overrides` 全部钉在 `0.2.0-rc.2`，并有 `allowBuilds` 显式关闭 5 个原生包（`pnpm-workspace.yaml:280-287`）
- 兼容性策略校验器：`scripts/compatibility.mjs:29-60` 强制"恰好 1 个 recommended、alpha/beta 不得作为普通用户推荐、source candidate 必须指向官方仓库 + 40 位 commit + `docs/` 证据"
- 诊断 CLI：`package.json:221-223` 暴露 `bin: dsh-agent-teams-doctor` → `scripts/doctor.mjs`，只读 manifest，**不执行包、不读凭据**（`doctor.mjs:22`）

### 6.3 测试脚本清单与规模

`package.json:224-245` 共 **16 个 npm script**，其中 `verify` 是总门（`package.json:231`）串联 **20+ 个验证步骤**：

| script | 内容 |
| --- | --- |
| `build` | 4 段构建 + 产物指纹 |
| `typecheck` | 双 tsconfig `--noEmit` |
| `sync:skill` / `update:skills` / `test:skills-updater` / `verify:skill` | 随仓库分发的 Agent Skills 同步与校验 |
| `verify` | 总门 |
| `verify:quality-gates` | `quality-gates-tdd.mjs` + 2 个 `node --test` 文件 |
| `verify:web-routes` | `web-routes-verify.mjs` |
| `verify:release` | `release-metadata.test.mjs` |
| `verify:readme` | `readme-version.mjs` + 其测试 |
| `verify:harness-contract` | `harness-compat-tdd.mjs`、`stability-tdd.mjs`、`lifecycle-verify.mjs --modern-harness`、`member-failure-tdd.mjs --modern-harness`、`lifecycle-verify.mjs --delivery-harness`、`member-failure-tdd.mjs --delivery-harness`、`client-harness-migration.test.mjs`、`workspace-activity.test.mjs` |
| `verify:compatibility` | `compatibility.mjs` + `compatibility.test.mjs` + `doctor.mjs` |
| `verify:http-body` | `http-body.test.mjs` |
| `diagnose` (`doctor`) | `doctor.mjs` |
| `verify:capabilities` | `capabilities.test.mjs` |
| `verify:member-spawn-recovery` | `member-spawn-recovery.test.mjs` |
| `test:git-install` | `git-artifacts.test.mjs` |
| `verify:source-runner` | `harness-source-verify.test.mjs` |
| `verify:git-artifact` | `git-artifacts.mjs` |

**规模推断**：`verify` 一行引用 **26 个以上脚本/测试文件**，另外直接点名 `scripts/fallback-tdd.mjs`、`member-failure-tdd.mjs`、`lifecycle-verify.mjs`、`stress-verify.mjs`、`issue-159.test.mjs`、`quality-gates-repair-scope.test.mjs`、`quality-gates-amend.test.mjs`、`stability-tdd.mjs`、`harness-compat-tdd.mjs`、`client-harness-migration.test.mjs`、`workspace-activity.test.mjs`、`http-body.test.mjs`、`release-metadata.test.mjs`、`readme-version.test.mjs`、`capabilities.test.mjs`、`member-spawn-recovery.test.mjs`、`git-artifacts.test.mjs`、`harness-source-verify.test.mjs` 等。

**但已安装包里只有 2 个脚本文件**（`scripts/doctor.mjs`、`scripts/compatibility.mjs`），其余 `scripts/*.mjs` 与 `tsconfig*.json` 都**不在 `files` 白名单里**——**普通用户无法在本地重跑这套测试**，只能对发布产物做 manifest 级诊断。这是工程化上的一个重要事实（源码仓库与 npm 包的能力不对等）。

**发布验证声明**：`release-notes/v0.1.22.md:18` 说明"发布要求 8 个宿主运行时矩阵 + 同一 tarball 的 Ubuntu/Windows 静态检查"，并诚实声明"确定性模型 fixture 与浏览器检查不构成真实 provider 或打包 Electron 验收"。

### 6.4 版本策略与兼容层厚度

`lib/harness-compat.js` 是**专门为跨宿主版本而存在的适配层**（302 行），体现了这套支持的代价：

- 用 `Symbol.for('dsh.subagent.queuePrompt')` / `Symbol.for('dsh.subagent.deliverPrompt')` 探测不同代际的宿主投递 API（`harness-compat.js:11-14`）
- `onAgentReady` 同时监听 0.1.6 之后新增的 `agent/created`（带 `source` 字段）与旧版 `agent/session-start`（`harness-compat.js:26-35`）
- `sessionOwnEvents` 兼容 `ownEvents()` 与旧版 `events[] + header.seedLength`（`harness-compat.js:37-45`）
- `installContinuableMemberSetup` 优先走 `registerContinuableSetup`，否则回落到"同步 hook `agent/created` + 手动生命周期管理"（`harness-compat.js:47-111`）
- 每个兼容分支都标注了对应的宿主版本与源文件路径（例如 `harness-compat.js:8-9` 注释指向 `packages/subagent/subagent/src/internal.ts at dsh-v0.1.2-rc.1`）

---

## 7. 明确的局限

以下均从代码直接读出，非推测。

### 7.1 不支持多层嵌套团队 / 子队伍

- **`memberMaxDepth` 默认 0**（`index.js:83`）：成员**不能**创建任何后代代理，`installMemberDelegationGuard` 沿父链遍历，一旦发现当前 agent 是 AgentTeams 成员且 `depth > maxDepth` 就抛错（`members.js:607-654`），错误文案是"AgentTeams member delegation limit (0) reached; report to the captain instead of spawning another agent"。
- 即便手工把 `memberMaxDepth` 设为 1，**也不能形成"子队伍"**：成员的 `agent_teams_create` 被 `tools.restrict` 拒掉（`capabilities.js:82-85`），成员人格第 9 条也明写"你是 worker：不要创建或删除团队、不要转派任务、不要增删成员"（`members.js:467`）。
- **结论：AgentTeams 是单层、单队长的星形结构。不存在子队/嵌套队/多队长。**

### 7.2 成员之间可以直连通信（这是支持的）

- 工具面：`agent_teams_send_message` 在 `MEMBER_TOOL_NAMES` 里（`tool-names.js:10`）
- 人格指引第 5 条："To ask a teammate something, use agent_teams_send_message with to=<teammate name>；消息落到他们邮箱并直接唤醒他们——队友之间无需队长在环"（`members.js:463`）
- 实现：`to` 可以是任意成员名，`requireMember` 校验存在性后写对方邮箱 + `dispatchMember(..., 'steer')` 唤醒（`tools.js:1848-1889`）
- **注意约束**：`send_message` 的 `to` 不能是"共享池"概念，必须是具体成员名或 `'captain'`；且目标成员所属团队必须 `!halted`（`tools.js:1845-1847`）。

### 7.3 模型/推理强度**不能按任务逐个指定**

- **`TeamTask` 类型里没有任何 model/provider 字段**（`types.d.ts:79-134`）
- 模型只在**成员维度**解析：`agent_teams_add_member` / profile 成员模板 / `edit_plan` 的 `update_member` / approve 时的最终解析（`members.js:198-254`）
- approve 之后**路由冻结**：模型在 approve 时被重新解析并写死进 team.json（`tools.js:464-474`），进入 running 后 `update_member` 被拒（`tools.js:358-360`）
- UI 上任务显示的模型是**从负责人反查的**：`memberModelRoute(roster.find(m => m.name === task.assignee))`（`snapshot.js:107`），不是任务自身的属性
- **结论：要换模型，只能改成员路由（且只能在 staged 期或通过 remove/reassign 换人），不能"这个任务用 A 模型、那个任务用 B 模型"。**

### 7.4 一个队长只能带一个团队

`agent_teams_create` 里先 `findTeamByParticipant`，命中就抛错（`tools.js:641-648`），且错误信息区分"你是 lead"和"你是 member"两种关系并给出不同指引。要换团队必须先 `agent_teams_delete` 归档旧队。

### 7.5 没有 live captain 就完全不调度

`kickMember` / `kickTeam` 都要求 `ctx.agents.get(captainSessionId)` 能解析出**存活的队长 Agent**（`scheduler.js:206-208, 222-224`）。队长会话离线时，即使有就绪任务也不会被领取——团队"停在磁盘上"。这也解释了 README 为什么反复强调"Web 审批会唤醒队长""报告会自动唤醒队长"（`stagedPlanApprovedContext`，`tools.js:251-257`）。

### 7.6 failed 依赖永久阻塞下游

`unsatisfiedDependencies` 只认 `completed`（`state.js:106-109`）。因此：
- 依赖任务 `failed` ⇒ 下游永远不可领取；必须显式 `reassign` 重试，或依赖自动 repair 循环生成新门
- 这正是 `applyQualityFollowUp` 里那段"把仍 pending 的下游边改挂到新终局门"的必要性来源（`tools.js:2325-2338`）

### 7.7 单进程一致性假设

`withTeamLock` 是**纯进程内 promise 链**（`state.js:29-55`），没有任何文件锁/OS 级互斥。`README_ZH.md:164` 与 `README.md:175` 都明确承认"多进程同时修改同一团队不保证一致"。

### 7.8 邮箱是"读全文 + 重写"，不是 append-only

`appendMailbox` 每次都要 `readFile` 全文 → 拼接 → `atomicWriteText` 重写（`state.js:373-387`）；`mutateMailbox` 同理（`state.js:442-471`）。长会话下这是 O(n²) 行为，没有轮转/截断机制。**没有任何单条消息长度限制**（仅 HTTP body 1 MB）。

### 7.9 "质量门禁"是完成时审计，不是写入拦截

`README_ZH.md:45` 自己承认："第一版范围控制是完成时审计，不是 host 写入拦截"。代码印证：`classifyChangedPath` / `evaluateQualityCompletion` 只在**任务要 `completed` 时**校验 `changedPaths`（`quality-gates.js:392-403`）与在 `canDeclareDelivery` 里复核（`quality-gates.js:714-720`）——**没有对文件系统写入的实时拦截**。越界写入只能事后判"任务不能完成"。

### 7.10 自动 review/repair 的复核者是谁由启发式决定

`schedulableAssignee(preferred, team, forbidden)`（`quality-gates.js:549-558`）：优先源任务原 owner，否则**团队里第一个非 removed 的非 captain 成员**。这与"不要自己审自己"的协议约定（`lib/index.js:97` 的 "Never approve your own implementation"）**没有代码强制**——只是调度偏好（`planQualityFollowUp` 里对 review 用了 `closed.assignee !== implementer ? closed.assignee : undefined` 作为 preferred，见 `quality-gates.js:636`）。单人团队时必然自审自过。

### 7.11 强制 `requirementsMinRounds` / `requiredReviewers` 未真正生效

`ReviewPolicy` 类型声明了 `requirementsMinRounds` 与 `requiredReviewers`（`types.d.ts:48-54`），`isReviewPolicy` 也校验它们（`quality-gates.js:45-70`），但 `planQualityFollowUp` **只用到 `requirementsMaxRounds`、`codeMaxRounds`、`maxRepairAttempts`**（`quality-gates.js:588-615`）——`requirementsMinRounds` 与 `requiredReviewers` **在代码中未被任何逻辑消费**。

### 7.12 早期版本的无归档删除不可恢复

`README_ZH.md:165`："历史面板依赖保存的团队状态或归档；早期版本删除团队时未保留归档的会话，暂不支持从日志重建完整面板。" 代码侧对应 `agent_teams_delete` 注释"Archive, not delete"（`tools.js:2126-2128`）——即现在的行为是归档，历史遗留数据无法重建。

### 7.13 模型可能"干完活不更新状态"

`README_ZH.md:166` 与 `README.md:176` 自我披露；代码侧的应对是**面板直接读磁盘真相**（`snapshot.js:5-7` 注释："so the panel always reflects the on-disk state even when a model skipped a tool ritual"），而不是信任模型汇报。

### 7.14 未确认项

以下是本次调研**未能从代码确认**的（不做臆测）：

- **宿主 `followup` / `deliverPrompt` 是否有更下层的消息长度上限** —— 本插件代码内无体现。
- **`tsconfig.json` / `tsconfig.client.json` 的具体编译目标与 `lib/client.js` 的完整打包体积构成** —— 这两个文件不在 `files` 白名单内，本地不存在。
- **`assets/ui.png`（749 KB）与 `assets/readme/workspace.png`（116 KB）的实际画面细节** —— 本次仅确认存在与体积，未逐像素核对界面与代码渲染结果的差异。
- **`ctx` 服务（`webServer`/`workspaceRegistry`/`connection`/`sidebarRight`）在本机 desktop profile 中的实际挂载情况** —— 需在实际运行实例中确认，静态代码只能看到 `ctx.get(...)` 候选与 503 降级路径（`web-routes.js:68-79`）。
- **活动面板 1 s 轮询在大型工作区（多 stateRoot、多团队）下的实际 CPU/IO 开销** —— 需要实测。

---

## 8. 给新插件的启示

### 8.1 值得直接复用的设计

1. **"能力（capability）即 attempt_id"的所有权模型**
   `randomUUID()` 作为一次性执行凭据，写入团队状态并只发给当前 owner；转派 = 撤销 + 新代际 `handoffId`；迟到结果按代际丢弃。
   证据：`state.js:146-186`；`tools.js:1577-1582, 1321-1326`。
   **价值**：用最小机制解决了"多 agent 并发写同一份共享状态"的经典竞态，比加锁/版本号更贴合"人（模型）会乱序回话"的场景。**建议：任何多 agent 共享写的系统都该照抄。**

2. **"完成时审计"的契约化质量门**
   把 objective / inScope / outOfScope / acceptance / verify / changedPaths / acceptanceResults / commandsRun 做成**结构化必填字段**，并用 `classifyChangedPath` 做路径归属判定。
   证据：`quality-gates.js:197-315, 347-406`。
   **价值**：把"是否完工"从自然语言争辩变成可判定的数据校验；`acceptanceCovered` 还留了"等长全 pass"的退路（`quality-gates.js:327-338`）以避免把展示文本当 opaque id。**这是本插件最值得抄的部分。**

3. **控制面/数据面分离：system prompt section 一次性快照**
   `capitanPrompt` 在挂载时算完就冻结（`capabilities.js:45`），建队/审批/结束都**不改写 system prompt 与工具 schema**，成员身份判定走 `WeakMap` + `agent.ctx.tools.restrict`。
   证据：`capabilities.js:39-108`。
   **价值**：保住 prompt cache，也避免"插件状态变了导致前缀变了"引发的性能塌方。README_ZH.md:105 把这一点当成卖点是有道理的。

4. **宿主兼容层要独立成文件，并逐处标注宿主版本 + 源文件路径**
   `harness-compat.js` 里每个分支都有 `Source: packages/subagent/subagent/src/internal.ts at dsh-v0.1.2-rc.1` 这类注释（`harness-compat.js:8-9, 12-14, 21-25`）。
   **价值**：跨 8 个宿主版本的支持代价极高，把不确定性**收敛到一个文件**并留下考古线索，是正确的工程取舍。

5. **原子写 + Windows 降级的显式处理**
   temp（`wx` 独占）→ `rename` → 重试 3×50ms → **降级直接覆盖写**（`state.js:516-597`），并解释 Windows 上"目标被其它进程以无 `FILE_SHARE_DELETE` 方式打开会导致 EPERM"。
   **价值**：这是 Windows 上写状态文件几乎必然会踩的坑，代码里把原因、阈值、降级路径都写清楚了。

6. **"宽松读、严格写"的状态迁移策略**
   `coerceTeamState` 把空串可选字段归一化后删除（`state.js:659-697`、`quality-gates.js:799-819`），并在注释里点名是 issue #99/#105 的教训——"某些模型会把可选参数物化成空字符串，写进 team.json 就会把整个团队砖掉"。
   **价值**：**任何由 LLM 直接填结构化参数的插件都该抄这个。** 这是与实践强绑定的一条硬经验。

7. **本地化由宿主官方服务托管，插件零设置**
   `ctx.locale.register('agentTeams', {zh,en})` + `locale.bind(...)`，状态词/动态摘要/无障碍文案全部走 key（`client/index.js:24, 39`；`locales.js:1-429`，共 429 行字典，中英 key 集合完全对齐）。
   **价值**：不引入第二套语言设置，跟随宿主实时切语言。

8. **静态资源用白名单路由下发**
   `ART_ALLOWLIST` + `decodeURIComponent(pathname.split('/').pop())` + 白名单外 404（`index.js:399-432`）。
   **价值**：比"拼接路径 + normalize 后比对前缀"更简单也更安全。

9. **同名 profile 与工具参数的"拼写建议"**
   `assertAllowedKeys` 对未知字段做 Levenshtein 距离 ≤2 的建议（`profiles.js:488-515`）。
   **价值**：配置文件由人写，报错时给 `did you mean ...?` 能省掉大量来回。

### 8.2 用户痛点来源（设计上值得规避或改进的地方）

1. **1 秒轮询磁盘 + 逐队逐邮箱读取**
   `ACTIVITY_POLL_MS = 1000`（`activity-monitor.js:101`），服务端每次要 `readdir` 所有 workspace 的 stateRoot、读每个 `team.json`、读每个成员的 `unread` 邮箱（`snapshot.js:129-157, 49-58`）。
   **痛点**：多工作区/多团队时是持续 IO。**改进方向**：改为事件推送（宿主已有 `agent/status` 与 session event 通道），或至少做 mtime 缓存。

2. **邮箱 O(n) 重写 + 无长度上限**
   `appendMailbox`/`mutateMailbox` 全文重写（`state.js:373-387, 442-471`）；`send_message.content` 无长度上限。
   **痛点**：长团队会话下邮箱文件膨胀，每次 `status` 都会读取并比较。**改进方向**：真 append-only（`fs.appendFile`）+ 定期 compact；对消息长度设上限。

3. **审批按钮是"单击即启动"，而 locale 里其实预留了二次确认文案**
   `StagingPlanEditor.js:492` 直接 `approve()`；`plan.approveConfirmTitle/Warning/Confirm`（`locales.js:171-173`）**无任何引用**。
   **痛点**：一次误点就会创建 N 个子会话并开始调度；且 UI 上没有任何"启动后不可在本处编辑"的警示（文案已写好但没接上）。**这是最容易改、收益最明显的一处。**

4. **`agent_teams_delete` 无确认，却执行"归档 + drain 全部成员 + 撤销未完成任务"**
   `tools.js:2096-2131`。相比之下"停止团队"（次要操作）反而有 Modal 二次确认。
   **痛点**：破坏性与确认强度不匹配。

5. **`confirmation` 参数名不副实**
   `agent_teams_approve({confirmation})` 只校验非空字符串（`tools.js:907`），模型完全可以填 `"ok"`。**痛点**：给用户/开发者一种"有审批门"的错觉，实际门在 prompt。

6. **失败依赖永久阻塞下游，且没有"自动重试 failed"的通道**
   `unsatisfiedDependencies` 只认 `completed`（`state.js:106-109`）。只有自动 repair 循环（仅针对 review/requirements）会重挂下游；普通 `work`/`implementation` 任务 `failed` 后必须人工 `reassign`。
   **痛点**：一个成员报错就可能让整条链静默停摆，而 UI 上表现为"任务一直 pending"。README 自己也承认"模型偶尔完成工作却未更新状态"（`README_ZH.md:166`），这两个问题在体验上会被混淆。

7. **`ReviewPolicy` 里两个字段声明了但没实现**
   `requirementsMinRounds`、`requiredReviewers`（`types.d.ts:48-54`、`quality-gates.js:45-70`）在 `planQualityFollowUp` 中**从未被读取**（`quality-gates.js:588-615`）。
   **痛点**：profile 作者配了以为生效，实际无效——属于"配置面谎报能力"。

8. **"不要自己审自己"没有代码强制**
   `schedulableAssignee` 只是启发式（`quality-gates.js:549-558`）；单成员团队必然自审自过。
   **痛点**：质量门在最小团队形态下失去独立性，但 UI/状态里看不出来。

9. **队长离线即停摆**
   `kickMember` 要求 live captain（`scheduler.js:222-224`）。
   **痛点**：用户关掉对话页/切换会话后团队静默停住（虽然 README 说"关闭标签页不会停止团队"，但队长会话本身必须还活着）。这一点在"长时间跑的自主体"里是核心体验缺陷。

10. **成员数上限硬编码在 8，且 profile 数量/任务数上限很紧**
    `maxMembers` 默认 8（`index.js:84`）、`MAX_TEAM_PROFILES = 16`（`profiles.js:13`）、`MAX_PROFILE_TASKS = 32`（`profiles.js:15`）。
    **痛点**：想做"大团队"的用户会撞墙，且这三条限制散落在不同文件，没有集中文档。

11. **测试套件不随包分发**
    `package.json:224-245` 声明了 16 个 script / 26+ 个验证文件，但 `files` 白名单只放行 2 个 `.mjs`（`package.json:30-31`）。
    **痛点**：终端用户/二次开发者无法对已安装产物复现验证；出问题只能跑 manifest 级 `doctor`。**改进方向**：至少分发 `verify:*` 里不依赖源码的那几个。

12. **面板信息密度偏高，且默认展开策略隐式**
    单屏可见 ≈180 个数据点（见 4.4）。成员树默认只显示"运行中或有未完成任务的成员"（`ActivityPanel.js:372-376`），但**用户看不到"为什么某些成员不显示"**——`members.expandFinished: '展开 {count} 位已完成成员'` 是唯一线索。
    **痛点**：新用户会以为成员"消失了"。

---

## 附录 A：核心文件职责速查

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `lib/index.js` | 441 | 插件入口：Config schema、14 工具注册调用、system prompt 注入、4 条 Web 路由、slash 命令 |
| `lib/tools.js` | 2403 | 14 个工具的定义与实现 + 质量跟进 + status 渲染 |
| `lib/state.js` | 957 | 持久化（team.json / inbox / archive）、进程内锁、状态机、记录校验、`sanitizeKey` |
| `lib/members.js` | 676 | 成员 spawn（`startContinuable`）、模型路由解析、冷恢复、失败收敛、fallback、退役/深度守卫 |
| `lib/scheduler.js` | 452 | 事件驱动调度：mailbox 优先 → 原子领 ticket → assignmentPrompt → 投递；parked 机制 |
| `lib/quality-gates.js` | 1047 | 纯规则：契约校验、完成判定、路径审计、修订、自动修复/复审计划、覆盖矩阵、交付判定 |
| `lib/profiles.js` | 572 | 命名 profile 解析/校验/拓扑排序、`--profile` 解析、prompt 渲染 |
| `lib/mailbox.js` | 174 | 邮箱准入（`agent/pre-step`）、收据解析、读后确认、冗余 settled 抑制 |
| `lib/harness-compat.js` | 302 | 跨 8 个宿主版本的 API 适配层（投递、启动、工具过滤、事件） |
| `lib/capabilities.js` | 108 | system prompt section + 成员工具裁剪 + 成员身份判定 |
| `lib/events.js` / `event-types.js` | 60 / 12 | `agent-teams/*` session 事件发射与类型声明 |
| `lib/snapshot.js` | 182 | 活动面板的服务端快照组装（磁盘真相 + 实时活动） |
| `lib/web-routes.js` | 86 | 路由鉴权包装 + 1 MB JSON body 读取 |
| `lib/command.js` | 143 | `/agent-teams` 与 `/agent-teams-<profile>` 命令 + 手势边界 |
| `lib/client/index.js` | 86 | 6 个 slot 注册 + locale + conversation node 定义 |
| `lib/client/ActivityPanel.js` | 804 | 浮动活动面板 + `TeamSection` + `DependencyMap` + 停止 Modal |
| `lib/client/StagingPlanEditor.js` | 493 | staged 计划编辑器（成员/任务表单、模型 picker、审批行） |
| `lib/client/locales.js` | 429 | `agentTeams` 命名空间中英字典 |
| `lib/client/activity-model.js` | 279 | 纯投影：DAG 布局、成员排序、聚焦链、自动展开判定 |
| `lib/client/activity-monitor.js` | 236 | 共享轮询控制器（1 s / 5 s）与快照 store |
| `lib/client/artwork.js` | 43 | 角色关键词 → 鲸鱼图片映射 |

## 附录 B：完整 emoji / 图标字符集搜索结果

| 搜索目标 | 范围 | 结果 |
| --- | --- | --- |
| emoji（`U+1F300`–`U+1FAFF`） | `lib/**/*.js` | **0 命中** |
| 杂项符号（`U+2600`–`U+27BF`） | `lib/**/*.js` | **0 命中** |
| 补充符号（`U+2B00`–`U+2BFF`） | `lib/**/*.js` | **0 命中** |
| 具名 emoji（🐳🐋🐬🐟🦈🐙） | `lib/**/*.js` | **0 命中** |
| 鲸鱼/emoji/头像 关键词 | `README_ZH.md` / `README.md` | 0 命中（图片均为 `<img src="./assets/...">`） |
| 鲸鱼/whale/emoji/头像/拟人 | `release-notes/*.md` | **3 命中**，全在 `v0.1.10.md:3, 28, 34`，中文原话"**鲸鱼角色头像**"、"队长和成员改为透明、无裁切的完整角色剪影，统一头像尺寸，减轻状态贴纸" |

**UI 中使用的非 emoji 图形字符**（为保证报告完整性单列）：

| 字符 | 码位 | 用途 | 出处 |
| --- | --- | --- | --- |
| `■` | U+25A0 | 进度图例前缀 | `locales.js:92-94`（`progress.running/blocked/delivered`） |
| `…` | U+2026 | 截断标记 | 多处（`ActivityPanel.js:172`、`members.js:421`） |
| `·` | U+00B7 | 分隔符 | `ActivityPanel.js:281, 389`、`locales.js:154` |
| `↳` | U+21B3 | 空态标记（`aria-hidden`） | `WorkspaceActivity.js:99` |
| `、` | U+3001 | 中文列表分隔符 | `locales.js:45` |
| SVG 内联图标 | — | 5 个自绘图标 | `client/icons.js:1-18`（Branch / ChevronDown / PanelLeft / StopFill / Warning） |

**结论：本插件的"拟人化"完全由 15 张 256×256 的卡通鲸鱼 PNG 承担，代码层零 emoji。**
