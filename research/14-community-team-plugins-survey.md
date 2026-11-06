# 14 · 社区三款团队插件的实现勘验与重叠判定

**对象**：`dsh-agent-foreman@0.4.0`（包工头）· `dsh-team-autopilot@0.6.4` · `dsh-better-subagent@0.1.0`
**方法**：从 npm registry 取 tarball 并**解包逐文件阅读**（非 README 转述）；README 只作对照与交叉验证。
**取证日期**：2026-10-31 · **基线**：本项目 `0.2.1-rc.8` · DSH `0.2.1-rc.2`
**证据约定**：`文件:行号` 相对各自包的根目录（`foreman/lib/...`、`autopilot/dist/...`、`better/lib/...`）。

> 结论先行：三者与本项目**不是同一层的东西**。它们在「派单 / 调度 / 子代理路由」这条轴上各自做到了本项目没有的深度，
> 但在**通信准入（开放边集 + 收件侧权威闸门）**与**旁路探针（零回注）**两条轴上覆盖率为 0。
> 真正的风险不在"被替代"，而在**本项目 FR-B7（请求 vs 生效）目前是自证，而 foreman 已经是实证**——这是唯一一处竞品比我们硬的地方。

---

## 0 · 速答

| 插件 | 一句话定位 | 与本项目的重叠域 | 替代风险 | 结论 |
| --- | --- | --- | --- | --- |
| **dsh-agent-foreman** | 父派单 / 子干活 / 父验收；承包商 = `provider+model+effort`；产物回看板 | FR-B1 逐顶点定档、FR-B7 路由对照、FR-A6 计划期上限、任务 DAG 与看板 | **中**：仅"派单+验收"窄场景可替代 | 并存；**代码可学（路由回显 / 只读恢复 / 原子写）** |
| **dsh-team-autopilot** | 原生 Agent Teams 的确定性调度器：就绪即唤醒、僵死回收、写域软锁、熔断、唤醒预算 | FR-C10 预算/熔断、FR-C8 终止、可观测性、T-5 状态回推 | **低（几乎为零）**：它只认官方名册，看不见 concourse 顶点 | 并存但**不要同时使用两套团队概念** |
| **dsh-better-subagent** | 子代理三修补：默认模型 / 头部模型徽标 / `wait_subagents` 阻塞等待 | 全局默认子模型（FR-B1 的弱形式）、UI 显示真实模型（T-3 邻域） | **无**：不包 `startActivation`，与本项目零交叉 | 完全正交，可共存 |

**探针层（FR-D 全 20 条）三者覆盖率为 0**；且 foreman 的实现取向（产物全量回注）与零回注不变量**正面冲突**。

---

## 1 · dsh-agent-foreman（包工头）0.4.0

### 1.1 挂载形态与依赖策略

- 宿主半边 `inject = ['tools']` 只列工具注册表（`foreman/lib/index.js:54`）；`subagents` / `webServer` / `llm` 全部**在调用点按需 `ctx.get()`**。注释写明理由：没有 `webServer` 的无头 profile 仍要能派单，没有 `llm` 时设置页退化成手填 id，而不是整块插件不加载（`foreman/lib/index.js:47-53`）。这是"必需依赖最小化 + 可选项延迟解析"的范式，与本项目 `tools/deps.ts` 的分层取向一致，但更激进。
- 客户端声明 `dsh.client.platform = web`、`inject: []`（`package.json`），提供「设置 → 包工头」一页。
- 数据目录默认 `%LOCALAPPDATA%/dsh-agent-foreman/`，可用 `dataDir` 覆盖；注释强调名册**跨 profile 共享**（`foreman/lib/store.js:110-120`）。

### 1.2 数据模型：名册 + 工单 + 轮次

| 实体 | 字段 | 证据 |
| --- | --- | --- |
| 承包商 member | `name / role / prompt / provider / model / reasoningEffort / maxParallel(1–8) / enabled / note` | `foreman/lib/index.js:69-79`、`store.js:139-201` |
| 工单 order | `id / title / task / accept / contractor / dependsOn` | `engine.js:219-275` |
| 轮次 run | `id / goal / sessionId / status / policy / orders[]` | `engine.js:814-822` |
| 策略 policy | `concurrency 4 / timeoutSeconds 900 / maxRework 1 / maxDepth 1 / provider spawn\|fork\|cursor` | `store.js:21-45`、README §策略 |

规范化是**硬拒绝**而非静默修正：一轮最多 12 单（`engine.js:222-223`）、`id` 重复拒绝（`:245`）、
`contractor` 填了名册里不存在的名字/岗位直接报错并列出可填值（`:251-253`）、依赖不在本轮内拒绝（`:268-273`）、
成环由 `layerOrders` 拒绝（`engine.js:282-297`）。这与本项目 `kernel/topology/validate` 的 fail-loud 同族。

### 1.3 执行路径（核心）

```
foreman_dispatch(orders)                        tools.js:218-264
  └─ normalizeOrders / resolvePolicy            engine.js:219, tools.js:221
  └─ assignContractors(负载 + 轮转)              engine.js:804
  └─ #scheduleReady                             engine.js:857-992
       ├─ 依赖就绪集合（非整层 barrier）          engine.js:874-877
       ├─ 闸门：policy.concurrency ≤8 + member.maxParallel
       └─ #runOrder                             engine.js:568-751
            ├─ startActivation{request.agentOptions, maxDepth, delivery:'caller'}
            │                                     engine.js:666-683
            ├─ Promise.race(result, timeout, aborted)   engine.js:688-709
            ├─ extractText → 截断 20000 字 → artifacts/  engine.js:66,710-716
            ├─ readChildRoute（起跑后 + 落定后各一次）  engine.js:611-618,736-737
            └─ activation.dispose()                     engine.js:739-746
```

三个关键判断：

1. **`delivery: 'caller'` + `await activation.result`**（`engine.js:682,709`）。派单是**阻塞工具**：全部工单落定才返回看板，可选的 `waitSeconds` 是整轮墙钟上限（`tools.js:200-239`）。这与本项目 `substrate.startVertex` **故意不持有 `result`**（`src/host/substrate.ts:52-57,208`）形成取向对立。对探针而言，这正是"零回注纪律"要消灭的形态；对成员而言，本项目用 `delivery:'parent'` 让终态结果由宿主推给父模型。
2. **`agentOptions` 逐单透传**（`engine.js:586-588,678`）。这是本项目的 `FR-B1` 同款能力，且它连 `provider` 都显式给，不依赖目录猜测。
3. **产物两级**：工具内联 20000 字符 + 全文落 `artifacts/`（`engine.js:713-716`）。回注比在这一层没有任何上限治理——这是与 `echo_ratio < 1%` 的直接冲突点。

### 1.4 真实路由回显（本项目 FR-B7 的照见）

`readChildRoute` 依次尝试两条来源（`engine.js:123-147`）：

1. `sessions.get(childId).header` —— 普通激活创建的子会话；
2. `agents.get(childId).session.header` —— 已挂上 Agent 的会话（团队模式）。

读出 `provider / model / reasoningEffort` 后写进工单（`engine.js:159-181`）：名册声明为 `order.route`，宿主事实为 `order.actualRoute`，
两者不一致置 `routeMismatch = true`；**声明为空（跟随父会话）时不参与比对**（`:176-178`）；读不到只写 `routeNote = '读不到子会话模型头'`，绝不上抛（`:160-165`）。
路由读取包在 `echoChildRoute` 的 try/catch 里，再兜一层"诊断绝不影响派单"（`engine.js:611-618`）。

> **对照本项目**：`src/service/concourse.ts:314-315` 的 `effective` 取的是 `v.model ?? 'inherit'`——即**声明值本身**，
> 不是宿主读回的事实。`README` 与需求都把它写成 V-2 的证据。foreman 证明这条证据链在 0.2.1 的宿主上**是可闭合的**（至少 rc.5 实测）。

### 1.5 调度与失败传播

- **增量就绪**：`depsSettled` 只认 `status === 'done'`，`skipped/failed/timeout` 一律阻断（`engine.js:874-877`）；A 交活立刻起 C，不等同层慢的 B（`:840-845`）。
- **被动递归跳过**：一张单落定后只把**直接下游**标 `skipped` 并写死原因（`engine.js:896-916`），"谁挡住了我"永远是最近那张。
- **调度卡住自检**：`active === 0` 却仍有 queued，则补判一次跳过，否则抛 `SCHEDULER_STUCK`（`engine.js:976-985`）。
- **取消语义**：`signal.aborted` → 未起跑的标 `skipped('派单已取消')`，已起跑的收尾后才返回（`engine.js:956-992`）。

### 1.6 恢复语义：只读，绝不重跑

`#restoreRun`（`engine.js:1005-1028`）把快照里**未落定**的工单就地判 `failed` + `INTERRUPTED_NOTE`，
把 `running/rework` 转成 `waiting-review` 并置 `interrupted = true`；`recovered = true`。
注释的理由很硬：重启后自动重跑会重复改文件、重复花钱，而父模型以为自己看的是旧看板——"那才是真正的危险"（`engine.js:994-1000`）。
跨会话读快照要校验 `sessionId`（`engine.js:1042-1083,1114-1125`），空会话连显式 id 都不放行（`:1048-1051`）。

> **对照本项目**：残留 #14（approve 崩溃恢复）、#15（post-delivery 写盘失败）、#0（重启后 `TARGET_UNAVAILABLE`）、#1（顶点完成后面板仍 running）
> 全部没有"恢复后可见状态 = 什么"的口径。foreman 的"未落定 → failed + 中断说明 + 只读可验收"是一份可直接借用的**降级口径**，不需要完整事务实现也能先落地。

### 1.7 持久化工程细节

| 细节 | 做法 | 证据 |
| --- | --- | --- |
| 名册落盘 | temp 写入 + `renameSync` 原子替换 | `store.js:420-425` |
| Windows rename 抖动 | `EPERM/EBUSY/EACCES` 重试 4 次，5/10/15ms；用 `Atomics.wait` 做同步小睡 | `store.js:350-377` |
| 坏名册容错 | 读不出来当空名册，但**不覆盖**，下次写入才重建；单条坏数据跳过不废整份 | `store.js:396-417` |
| 密钥防泄漏 | 快照前按 key 名与值形态双正则剔除/打码 | `store.js:72-84,267-310` |
| 快照 | 每张单落定存一份；整轮结束再存终态；上限 50 份、扫描 200 | `engine.js:882-893,832-834` |
| 台账 | `runs.jsonl` 追加 | `store.js:390` |

### 1.8 名册即宿主白名单（一个本项目没有的集成面）

宿主有单例服务 `subagentModelSelection`（`enabled` + `allowedModels`），`dsh-tool-subagent` 在**会话首次建立时**读一次并快照进该会话投影。
foreman 因此把名册里所有启用且有显式路由的承包商**汇总进 `allowedModels`**（`foreman/lib/index.js:104-114`、`whitelist.js`）：

- 写 volatile 走 `Symbol.for('cosmokit.volatile.write')`（`whitelist.js:43`），优先官方 `updateVolatile`，取不到就按符号手搓一个只带 `get()` 的源；
- **空名册时绝不写空数组**——`current()` 在 `enabled && allowedModels.length === 0` 时会直接抛错，会让宿主每次定策略都炸（`whitelist.js:32-37`）；
- 同步失败只记日志，不影响派单（`index.js:112-114`）。

> **对本项目**：`FR-B4` 的 fail-loud 目前只校验模型目录（`listProviders/resolveModelInfo`），**不校验宿主子代理白名单**。
> `startActivation` 是否受该白名单约束，列为本轮待验证项（§10 V-2）。若受影响，本项目会出现"目录里合法、拉不起来或静默换模型"的缝。

### 1.9 原生团队兼容桥（R-9 的另一条路）

`native-team.js` 用三层 `Proxy` 在**单次调用作用域**内替换 `roster.ctx.subagents.startActivation`，
把 `agentOptions` / `maxDepth` 注入原生 `spawnTeammate` 的创建请求（`native-team.js:33-97`）：

- 只对该次调用、该 `parent`、该 `prompt`、该 `childId`、该 `provider` 生效，且只转发一次（`native-team.js:53-59`）；
- 契约不匹配立即抛 `NativeTeamRoutingError`，**不退回父模型、不创建替代子会话**（`:41,58,95`）；
- 明确自述"受保护的内部兼容桥，不是宿主公开 API"，且只对 0.2.1-rc.5 做过离线契约测试（README 团队模式）。

> **对本项目**：这不是对 `D-P2 路线 A` 的翻案——本项目自建组织层仍然是正确选择。它只是证明"若要复用官方名册，单次作用域适配在技术上是可行的"，
> 代价是钉死宿主内部形状。**建议只登记，不实施**（见 §7 L-11）。

### 1.10 资产与合规对照

发布包内**含 `icon.svg`（475 B）与 `docs/settings-roster.png`（65 KB）**。
按本项目 `P1 / NFR-3`，这正是 `check-no-assets` 要拒的形态。foreman 还带设置页 + HTTP 写配置接口（`routes.js`，同源/回环校验 + 跨站 403），
与本项目 `§1.3「不做设置页面」` 的边界相反。

---

## 2 · dsh-team-autopilot 0.6.4

### 2.1 定位：补官方 Agent Teams 的三个书面空档

它引用的官方原话是：`Task readiness never starts an owner` / `The owner is never released automatically` / `Write-scope overlap is advisory, not a lock`（README:17-24）。
因此它做三件事：**就绪即唤醒**、**僵死回收**、**写域软锁**——全部建立在 `ctx.agentTeams` 之上，不接管团队状态。

- `inject = ['agents','agentTeams','tools']`（`autopilot/dist/index.mjs:1959-1963`）。
  **`agentTeams` 缺席即整块不加载**——它把官方团队 profile 当**地基**而非叠加对象（README:51）。
- 只注册 1 个工具 `team_autopilot_status`；无 UI、无客户端半边；headless 与 Web 行为一致（README:45）。

### 2.2 纯函数规划层（本项目 kernel 同款思路）

| 规划器 | 职责 | 证据 |
| --- | --- | --- |
| `planDispatch` | 槽位 = `maxConcurrent − inFlight − reserved`，再与唤醒预算取小；逐任务产出 `plans/blocked` 与归因 `kind: parked/scope/noMember/declined/budget` | `dist:262-369` |
| `planReclaim` | 三种僵死：owner 离开名册（立即）/ `failed`（立即，可关）/ `inactive` 超时；有回合边界证据时用更短的 `livenessGraceMs` | `dist:424-501` |
| `planStallWatch` | 只认 `teammate` 且 `running/provisioning`；`provisioning` 只报不断；同一 stall 只 interrupt 一次 | `dist:514+` |
| breaker | 独立纯状态机：`errorThreshold` 次失败 → open → `openCooldownMs` → halfOpen → `halfOpenProbe` 次探针全成才闭合 | `dist:567-684` |
| 唤醒预算 | **时间戳列表**而非「窗口起点+计数」；列表长度由预算本身封顶 | `dist:806-864` |

时间戳列表的理由值得抄进本项目文档：计数器在窗口边界会少报（12:59 发 59 条、13:01 再发 59 条，一小时其实 118 条）。

### 2.3 tick 顺序（顺序即正确性）

`tick`（`dist:1276-1400`）的固定顺序是：

1. 结算上一轮**挂起的唤醒**（冷却到期或回合边界证据）→ 判 `claimed / unclaimed`；
2. `planReclaim` → 用 `updateTask{action:'reassign', expectedRevision}` **CAS 回池**，失败只记 `lastError`、**不触发熔断**；
3. 回收后**重读任务板**；
4. `planStallWatch` → 只报，`interruptStalled` 默认 false；
5. 回收计数到 `reclaimRetryLimit` → `parked`，**停派但不动任务板**；
6. 最后才派发，且熔断打开时**只跳过派发**，结算/回收/观察照常。

三条可直接迁移的判断：

- **槽位要预留"已承诺"**：只算 `inFlight` 会让"已唤醒但还没 claim"的空窗看起来是空闲，同一批人被重复唤醒（README:170）。
- **同一个任务要占住自己的写作用域**，否则会被本轮再派一次、紧接着又被冷却抑制（README:172）。
- **"这一轮满了"与"这一小时的钱花完了"必须分开说**（`why=slots` vs `why=budget`），否则任务板上长得一模一样（README:196）。

### 2.4 可观测性（本项目最该对照的一节）

`team_autopilot_status` 的字段设计按「能不能据此定位问题」取舍（README:383-425）：

- `health = broken > stuck > blind > parked > ok`：一行回答"现在最糟的是什么"；
- `up=`：所有计数都在内存、重启归零，`dispatched=3` 在 3 分钟与 3 天里意义完全相反；
- `why=`：本轮的跳过原因（累计值回答不了"此刻为什么不动"）；
- `parked`：逐条列出已停派任务、第几次回收停的、上一个 owner；
- `stalled`：唯一的 gauge（小时前恢复的团队不该看起来和此刻卡住的一样糟）；
- `statusFile`：**只写变化 + 心跳 + 启动标记行 + 128 KB 裁剪（原子 rename + 指数退避）**，`dryRun` 照写（`dist:916-1160`）。

### 2.5 它明确不做的三件事（都是本项目的地盘）

- **不做 per-member model**：Team 层 `spawn_teammate` 不转发 `agentOptions`；它拒绝 monkey-patch 或绕开 Team 层（README:486-490）。
- **不做投递确认**：解包核实 `team/message/queued|delivered` 已无 append 点，只剩"发送失败重试"（README 边界）。
- **不做质量门 / toolPolicies**：验收属语义判断，与"确定性调度"冲突。
- **不做落盘状态**：理由是"新增一个会失败的文件，换来的只是一段恢复后也未必可信的历史"（README 边界）。

> 最后一条与本项目 NFR-4 相反——但它给了一个诚实的对照：本项目既然要落盘，就必须把恢复口径写死（§1.6 的 foreman 做法）。

---

## 3 · dsh-better-subagent 0.1.0

### 3.1 三个修补

1. **默认子代理路由**：宿主在调用方未指定模型时让子代理继承父模型；本插件在 `ctx.subagents.start` / `startContinuable` 上补默认 `agentOptions`（`better/lib/host.js:123-144`）。
2. **子会话头部模型徽标**：`conversation.session.header.utilities` 槽，仅 `origin === 'subagent'` 时显示 `模型 + 强度`，数据取会话自己的 `modelSelection` 投影（`better/lib/client.js:775-`）。
3. **`wait_subagents` 阻塞等待**：750 ms 轮询 `listChildren` + Agent 注册表，默认 10 分钟、上限 60 分钟；子会话仍在内存时附上收尾消息（`host.js:147-166,234-287`）。

### 3.2 代码层面值得记的三点

- **能力守卫**：仅当 `provider.capabilities.agentOptions === true` 时才介入路由；请求已同时带 `provider+model` 时一律不动；`fork` 子代理可按配置排除（`host.js:92-107`）。注释写明设计目标："永远不会把原本可用的委派变成能力错误"。
  → 本项目 `FR-B4` 的 fail-loud 应在**拒绝**之外再加一层"该 provider 不支持该能力位时**不介入**"。
- **volatile 配置 + 设置页热写**：`Config` 每个字段 `.volatile()`（`host.js:47-54`），浏览器半边改 profile patch 即刻生效，无需重挂插件。
- **`tools.register` 与 `defineTool` 的 schema 差异**：`tools.register` 收的是**已编译 JSON Schema**，裸属性图会投影出 null root type、导致每个模型请求在派发前被拒；因此它手写了 `type:'object'` 根（`host.js:300-318`）。

### 3.3 与本项目的交叉面：零

它只包 `start` / `startContinuable`，**不包 `startActivation`**（`host.js:123-144`）。
本项目走 `startActivation`（`src/host/substrate.ts:212`），`provider.start` 直接抛 `CONTINUABLE_ONLY`（`src/host/provider.ts:78-84`）。
两边互不影响。唯一间接面：若本项目领队同时持有官方 `subagent*` 工具，会收到它追加的"禁止 sleep/轮询"系统提示（`host.js:156-160,330-338`），属于良性叠加。

---

## 4 · 逐条需求对照矩阵

口径：**重叠** = 语义同一件事且机制可对照；**相邻** = 同一问题域但机制不同；**无** = 覆盖率为 0；**反面** = 取向正面冲突。

### 4.1 FR-A 拓扑

| 条目 | foreman | autopilot | better | 判定 |
| --- | --- | --- | --- | --- |
| A1 拓扑即声明式数据 | 名册是平表，无边的概念 | 读官方板，无拓扑声明 | 无 | **无**：本项目独占 |
| A2 单会话 T1.5、零新会话 | 子会话不是新会话，合规 | 合规 | 合规 | 相邻（都不违反） |
| A3 会话加入 / T2a | 无 | 无 | 无 | **无** |
| A4 单一审批闸门 | 无审批，派单即执行 | 无审批，后台 tick 自主唤醒 | 无 | **无**；且是哲学对照：它们是"没有审批"，本项目是"一次审批换零运行期审批" |
| A5 不做真实嵌套 | `maxDepth` 默认 1 + prompt 明令"不要再派给别的智能体"（`engine.js:350`） | 明确不做成员自治 | 无 | 相邻（prompt/配置约束 vs 能力剥夺） |
| A6 计划期完全确定 | 一轮 ≤12 单、并发 ≤8、成员并发 ≤8，硬拒绝 | `maxConcurrent 1–16` + `teamBudgets` | 无 | 相邻（都 fail-loud，但都不校验"顶点集"） |

### 4.2 FR-B 定档

| 条目 | foreman | autopilot | better | 判定 |
| --- | --- | --- | --- | --- |
| B1 逐顶点手动定档 | **强重叠**（核心卖点，`provider+model+effort` 逐单） | 明确不做 | 弱形式（全局默认子模型） | **重叠最高项** |
| B2 自动定档建议 | 无 | 无 | 无 | 无 |
| B3 建议可解释 | 无 | 无 | 无 | 无 |
| B4 fail-loud | 未知承包商/岗位直接报错并列可填值 | schema + `resolveConfig` 双层收敛 | 能力位守卫（不介入而非报错） | 相邻；**本项目缺能力位守卫** |
| B5 校准闭环 | 无 | 无 | 无 | 无 |
| B6 预设只是快捷填充 | **反面**：名册是唯一来源，还同步成宿主白名单 | — | — | 反面教材 |
| B7 请求 vs 生效 | **实证**：读子会话 header + `routeMismatch` | 无 | 读 `modelSelection` 投影显示 | **本项目更弱**（见 §1.4） |

### 4.3 FR-C 通信

| 条目 | 三者覆盖 | 判定 |
| --- | --- | --- |
| C1 开放边集裁剪 | 0 | **无**：本项目护城河 |
| C2 半双工 / 反向应答边 | 0 | 无 |
| C3 跨边界闸门 | 0 | 无 |
| C4 `wake: never` 默认 | foreman 每次派单必激活；autopilot 的存在意义就是唤醒 | **反面**（价值对立，非 bug） |
| C5 速率降级（削峰不丢消息） | autopilot 有冷却但语义是"同一任务别反复叫" | 相邻但不同层 |
| C6 广播只入板 | 0（foreman 的"看板"是任务板不是通信板） | 无 |
| C7 hop TTL | 0 | 无 |
| C8 quiescence | autopilot `reclaimRetryLimit → parked`：到线即停、停派不动板、易手即解冻 | **相邻且可直接借鉴**（§7 L-8） |
| C9 幂等去重 | foreman 工单 id 唯一；autopilot 每任务冷却 | 不同层，不算重叠 |
| C10 预算 + 熔断 | autopilot：并发槽 + 每小时唤醒预算 + 三态熔断；foreman：无 | **相邻**：语义不同的两套账（回合数 vs token） |
| C11 留痕 | foreman 看板/快照/台账；autopilot statusFile；本项目 append-only 事件台账 | 相邻；本项目最严 |
| C12 多层收口、权威在收件侧 | 0 | **无**：本项目护城河 |

### 4.4 FR-D 探针

| 条目 | 覆盖 | 说明 |
| --- | --- | --- |
| D1–D20 | **0 / 20** | 三者都没有"上下文隔离 + 不回注 + 句柄取回"的机制 |

最接近的三处动机都不是探针：

- `wait_subagents`（better）：解决"等结果不要 sleep"，返回的仍是**全量报告进上下文**；
- `statusFile`（autopilot）：解决"看状态不要烧 token"，进的是**文件**不是模型；
- artifact 文件 + 20000 字截断（foreman）：解决"产物太长"，但**仍然回注**。

### 4.5 NFR

| 条目 | 判定 | 说明 |
| --- | --- | --- |
| NFR-1 惰性 | 相邻 | better 默认 `enabled:false`；foreman/autopilot 默认开启；本项目默认不激活 |
| NFR-2 异常不阻断 | 相邻 | foreman 每个工具独立 try/catch、`webServer` 单独依赖作用域、卸载期重复释放吞掉（`index.js:119-138`） |
| NFR-3 零资产 | **foreman 反面**（svg+png）；autopilot/better 同侧 | — |
| NFR-4 持久化 | 两种哲学 | foreman 快照+只读恢复；autopilot 明确不落盘 |
| NFR-5 纯函数内核 | **autopilot 是榜样** | 规划器零依赖、可无 `node_modules` 跑断言 |
| NFR-6 fail-loud | 相邻 | 三方都有各自的 fail-loud 点 |
| NFR-7 不破坏原决策 | 相邻 | better 用 `systemPrompt.section` 追加一段；foreman 用 `/foreman` 命令"用到时注入一次"而非常驻 |
| NFR-8 来源白名单 | **强借鉴** | autopilot 把任务标题当数据：折叠空白、按码点截断、中和反引号（`dist:377-385`） |
| NFR-9 数据准入口 | 无 | 本项目独有 |
| NFR-10 权限凭据不可伪造 | 相邻 | autopilot **每轮重新解析 live Lead**、不缓存（`dist:1276-1295`，README 决策 #3） |
| NFR-11 默认安全 | 相邻 | better 默认关；autopilot `interruptStalled:false` + `dryRun` |
| NFR-12 零外部依赖 | 相同 | 三者都只依赖 schemastery / 全 optional peer |
| NFR-13 零污染可证 | **反面** | foreman 的单次回注上限是 20000 字符 |
| NFR-14 与 T0 兼容 | 三者都不满足 | 它们都以"有子代理/有团队"为前提 |

---

## 5 · 替代关系判定

**问题不是"能不能用它们代替本项目"，而是"用户会不会因为这些插件而不需要本项目"。**

| 用户诉求 | 现成最优 | 本项目 | 结论 |
| --- | --- | --- | --- |
| 把活按模型档位分给几个子代理，逐个验收、不合格打回 | **foreman**（返工闭环 + 真实路由 + 看板，开箱即用） | 要 `team_topology → team_plan → team_assign`，无返工、无真实路由 | **foreman 更强**；本项目在此场景没有优势，应承认 |
| 限制"谁能给谁发消息"、压住回声风暴 | 无 | 唯一 | 不可替代 |
| 空闲成员自动接走就绪任务、僵死回收 | **autopilot**（但要求官方团队 profile） | 不做（`wake:never` 默认、无调度器） | 互补，不同地基 |
| 子代理默认用便宜模型 / 子会话看到模型 / 不 sleep 等待 | **better-subagent** | 部分（逐顶点定档更强，但无默认路由、无等待原语） | 可共存 |
| 旁路查一件事但**不污染**主线上下文 | 无 | P5 才做 | 不可替代（也是本项目最大风险） |

**三条结论：**

1. **在"组织层"这个定位上，三者都不构成替代**——它们没有边集、没有准入闸门、没有探针。
2. **在"派单验收"这条窄链路上，foreman 已经是成品**，本项目若在这条链路上和它比"好不好用"会输（缺返工、缺真实路由、缺看板数据桥）。本项目的立论必须继续落在"通信与拓扑是一等数据"和"探针"上。
3. **autopilot 与本项目是两套不互通的世界**：它只看得见官方 `ctx.agentTeams` 名册，而本项目顶点是自建注册表里的子代理。同装不会崩，但用户会看到"两个团队"，且两边的预算/状态互不认。**建议在 README 的边界段明确写"不要同时用两套团队概念"**（对应风险 R-6 的新形态）。

---

## 6 · 共存与安装风险

| 组合 | 结论 | 依据 |
| --- | --- | --- |
| concourse + better-subagent | **安全** | better 只包 `start/startContinuable`，本项目走 `startActivation`；`provider.start` 抛错也不受影响 |
| concourse + foreman（普通模式） | 安全 | foreman 走 `startActivation` + 自有 provider 名，工具前缀 `foreman_*` 与本项目 `team_*` 无重名 |
| concourse + foreman（团队模式） | 需注意 | foreman 的 Proxy 只在它自己的一次调用内生效（`native-team.js:48-93`），不全局污染；但官方名册里会出现它的成员，而本项目顶点不会 |
| concourse + autopilot | **不建议同用一套心智模型** | autopilot 硬依赖 `experimental-agent-team` profile（`inject: agentTeams`）；同装后模型面前同时有官方 9 个团队工具 + 本项目 6 个 `team_*` + `team_autopilot_status` |
| 版本 | 三家都钉 `0.2.1-rc.2`/`rc.5`；本项目也钉 `0.2.1-rc.2` | T-1 区间化时同批复核 |

**关于 T-1（peer/engines 区间化）的一条硬证据**：autopilot `CHANGELOG` 0.6.4 记录——

> `>=0.2.1-rc.2 <0.3.0` 看起来覆盖 0.2.x 全部，但 node-semver 只允许预发布版本满足「自身 `major.minor.patch` 元组带预发布标签」的比较符，
> 于是 `0.2.2-alpha.2` 落在范围**之外且没有警告**；pnpm 会把用户明确请求的 alpha 静默换成 rc。

本项目 P9 做区间化时**必须同时写 `||` 预发布分支**，否则"区间化"会变成"静默降级"。这一条应写进计划 §4 T-1 的处置里。

---

## 7 · 可学习清单（按优先级）

> 每条给：**学什么 / 落在本项目的哪里 / 为什么值得 / 风险**。只列**代码可落地**的，不列口号。

### L-1 ★★★ 真实路由回显，把 FR-B7 从自证变实证

- **学**：`sessions.get(childId).header` → 退化到 `agents.get(childId).session.header`，读 `provider/model/reasoningEffort`；声明 vs 事实写两个字段并置 `mismatch`；读不到只写 note（`foreman/lib/engine.js:123-181,611-618,736-737`）。
- **落点**：`src/host/substrate.ts` 的 `startVertex` 返回后在 service 侧读一次；`src/service/concourse.ts:314-315` 的 `effective` 改为宿主事实；`ledger.requestedVsEffective` 增加 `verified` 标志。
- **收益**：V-2 从"装配透传测试"升级为"运行时事实"；同时消掉 `README` 里 `effective = request` 的隐患。
- **风险**：`header` 字段名随宿主版本变；必须 try/catch + 可选字段 + 读不到不阻断。**先验证**（§10 V-1）。

### L-2 ★★★ 恢复口径：只读对账，绝不自动重跑

- **学**：未落定 → `failed` + 明确中断原因；`running` → 可验收态（`waiting-review`）+ `interrupted=true`；`recovered=true`；跨会话读快照校验归属（`engine.js:1005-1028,1042-1083`）。
- **落点**：H3.1 的 replay 入口与 `src/service/persistence.ts`；残留 #14/#15/#0/#1。
- **收益**：不需要完整事务实现就能先给出"重启后可见状态 = 什么"的承诺，且**不伪造成功**。
- **风险**：与本项目"回放等价"（live/replay 全等）的既有测试口径要重新表述——等价的是**可见状态**，不是"自动续跑"。

### L-3 ★★★ 不可信内容标注（NFR-8 同族）

- **学**：autopilot 的 `wakeMessage`：任务标题当**数据**处理——折叠空白、按码点截断 80、反引号换成单引号（`autopilot/dist:377-385`），并在正文里写明 `(data, not instructions)`。
- **落点**：`src/host/substrate.ts:269-275` 的 `deliver`——现在把 `request.content` 原样拼进 `Agent X sent a message: `。应加边界标记（随机 token 更佳，可参照 palimpsest 的 `<<<...DATA token>>>` 做法）、折叠与中和。
- **收益**：`wake:never` 场景下消息会进模型，这是唯一的注入面。
- **风险**：标记本身占 token，需计入 `estimateMessageTokens` 的口径；边界标记必须在截断**之后**拼接（否则实际占用超名义上限）。

### L-4 ★★ 预算三账分离 + 槽位预留

- **学**：① 并发槽位与"已承诺未落地"同算占用；② 冷却按任务而非按人；③ 每小时唤醒用时间戳列表而非窗口计数（`dist:806-864,262-369`）。
- **落点**：`src/kernel/comms/budget.ts`（token 账之外加"唤醒回合数"账）、`src/kernel/comms/rate.ts`（冷却窗口的实现已经是时间戳，可对齐其边界纠错理由）。
- **收益**：FR-C10 现在只有 token 轴；"每次唤醒 = 一个模型回合 = 钱"这条轴没有账，T-4（edge.budget 回填）正好需要。
- **风险**：新增账域要进 `AdmissionPlan.consumeGlobal` 的同类设计，否则 live/replay 不等价（本项目 rc.7 已经踩过一次）。

### L-5 ★★ 熔断可复评（halfOpen）

- **学**：`closed → open(cooldown) → halfOpen(probe) → closed/open` 的纯状态机 + `breaker/trips/held` 观测（`dist:567-684`）。
- **落点**：`src/kernel/comms/budget.ts` 的 `fuse-edge/fuse-global`。
- **收益**：FR-C10 目前写"仅人工恢复"，实际运行期一次误熔断就要人介入；半开是"有限自动恢复"，可做成默认关的配置项。
- **风险**：与需求文字冲突，需先改需求（§"需求变更纪律"），不能顺手做。

### L-6 ★★ "允许但没发生"的归因

- **学**：`why=scope|noMember|declined|parked|budget`（本轮）与括号里的累计值分开；`lastDispatch` 带 `wakes` 次数。
- **落点**：`team_status` 增加"本轮未投递原因"；`ledger` 的 reject reason 已有六种，但**静默抑制**（冷却、degrade、等待审批、票据不消费）没有归因。
- **收益**：残留 #3 的"面板不显示真实状态"在数据层先解决一半；用户不会再问"消息是不是丢了"。

### L-7 ★★ 门禁自证三连

- **学**：`verify-status.mjs` 用**真实 `dsh-tools` schema 编译器**校验工具输出 schema，并守三道漂移：输出键集合 == 真实报告逐键相等；`Config` 默认值 == `resolveConfig()`；文档配置表 == 同上（autopilot README「已验证」）。
- **落点**：`scripts/` 新增一条；接入 `pnpm verify`。
- **收益**：直接命中本计划 §3.4.3「门禁必须自证能拒绝」；本项目已知的两处同族问题（残留 #28 emoji 正则假阴性、T-13 空 dts）都属于"文件存在 ≠ 契约成立"。

### L-8 ★★ 终止机制的形状：到线即停、停而不毁、易手即解冻

- **学**：`reclaimRetryLimit → parked`；停派**不动任务板**；任务被"别人"接手/完成/消失即清除停派；重启清空作为兜底放行（README:184）。
- **落点**：FR-C8 quiescence（P7）——"连续 K 轮无新增事实 → 冻结信道"，需要同款三件套：**冻结可见、人工可解冻、外部事实可自动解冻**。
- **收益**：避免 quiescence 变成"静默黑洞"（这是 P-R5 之外的新风险）。
- **风险**：冻结状态必须进 `team_status`，否则用户无法区分"没人说话"和"被冻结"。

### L-9 ★★ 日志工程学（观测面，不是台账替代）

- **学**：只写变化、心跳、启动标记行、128 KB 裁剪 + 原子 rename + 指数退避、`dryRun` 照写（`dist:916-1160`）。
- **落点**：`src/service/ledger.ts` 的运维视图 + 未来的校准报告（FR-B5）。
- **收益**：append-only 台账不该承担"tail 一下看现状"的职责；两者分开，台账保审计、状态行保阅读。

### L-10 ★ 能力位守卫

- **学**：`provider.capabilities?.agentOptions !== true` 时不介入（`better/lib/host.js:92-97`）。
- **落点**：`src/host/catalog.ts` 的 fail-loud 之前——先判"该 provider 是否支持该能力位"，不支持就不注入而不是硬塞。
- **收益**：FR-B4 现在只校验模型目录，未校验 provider 能力；`toolFilter`/`maxDepth`/`agentOptions` 三条各有一个能力位。

### L-11 ☆ 单次作用域 Proxy 兼容桥（只登记，不实施）

- **学**：三层 Proxy 把 `agentOptions` 注入原生 `spawnTeammate` 的 `startActivation`，带契约守卫与 fail-loud（`foreman/lib/native-team.js:33-97`）。
- **落点**：无。写进 `docs/decisions/` 作为"若将来要复用官方名册"的备选路径。
- **理由**：它钉死宿主内部形状（foreman 只验证了 rc.5），与 `R-1` 降级后的路线 A 取向相反。**采纳门槛应是"官方公开透传 `agentOptions`"**，而不是"我们能 Proxy"。

### L-12 ☆ live Agent 引用不缓存

- **学**：每轮 `ctx.agents.roots()` + `tryMembership()` 重新解析 Lead，因为"会话重组后实例会被替换，缓存引用会失效"（README 决策 #3）。
- **落点**：`src/host/substrate.ts` 的 `parents`/`activations` 映射与残留 #0（重启后 `TARGET_UNAVAILABLE`）、T-5（顶点完成不回推）。
- **收益**：同族风险——本项目也缓存 childId → parent，重启后该映射即为陈旧引用；配合订阅 `agent/status` 才能把"顶点生命周期"回推（T-5）。

---

## 8 · 明确不学（附理由）

| 项 | 出处 | 为什么不学 |
| --- | --- | --- |
| 阻塞式派单（等待全部落定） | foreman `engine.js:709` | 与 FR-D3「创建不阻塞主线」及探针零回注取向冲突；本项目 `startVertex` 不持有 `result` 是**有意**的 |
| 产物 20000 字符内联回注 | foreman `engine.js:66,710-716` | 直接违反 `echo_ratio < 1%` 与零回注不变量 |
| 猴子补丁全局 `subagents.start/startContinuable` | better `host.js:123-144` | 永久替换宿主服务方法；与本项目 NFR-2/NFR-10 的"只在自己 provider 内工作"取向冲突。且它不覆盖 `startActivation`，对本项目无收益 |
| 设置页 + HTTP 写配置 | foreman `routes.js` | 违反 `§1.3 不做设置页面`；且引入 CSRF/同源面（它自己要用 403 兜） |
| 图片/图标资产 | foreman `icon.svg`、`docs/settings-roster.png` | 违反 P1 / NFR-3 |
| 名册 = 白名单唯一来源 | foreman README「名册就是白名单」 | 正是 FR-B6 要修的"预设优先 → 实际只剩两个选择"退化；本项目应做的是**校验/提示**，不是**接管** |
| 自建第二套任务板作为团队状态 | foreman 工单 | 与 D-7（复用官方任务板 CAS 语义）相悖；若要补任务板，应映射官方 `blockedBy/ready`（autopilot 的做法） |
| 重启后自动重跑 | 三家都没做，是对的 | — |

---

## 9 · 对本项目定位的净结论

1. **不要改定位**。它们的成功恰恰证明「派单调度」是红海（三家 + 官方 + nanmicoder），而**「谁能和谁说话」与「不污染的旁路查询」仍然无人做**。
2. **FR-B7 必须补实证**（L-1）。这是唯一一处竞品比本项目硬、且用户能直接看见的地方。补法成本低（一次 header 读取），收益是 V-2 从"装配测试"变成"运行时事实"。
3. **H3.1 的恢复口径可以先用 L-2 的降级版落地**，不必等完整事务实现；这能同时消掉 #14/#15/#0 三条残留的"不可说"状态。
4. **FR-C8（P7）应吸收 L-8 的形状**，否则 quiescence 会成为新的静默黑洞。
5. **T-1 区间化必须处理预发布元组**（autopilot CHANGELOG 0.6.4 的反例）。
6. **README 的边界段应新增一条**：与 `dsh-team-autopilot` 同时安装会出现两套互不相通的团队状态；本项目顶点不在官方名册里。

---

## 10 · 待验证（工程项，不是用户决策）

| # | 待验证 | 影响 | 验证时机 |
| --- | --- | --- | --- |
| V-1 | 0.2.1-rc.2 上 `sessions.get(childId).header` 是否真有 `provider/model/reasoningEffort`；`agents.get(id).session.header` 是否可读 | L-1 是否能落地 | 下一轮开工第一步（只读探测，不装插件） |
| V-2 | `startActivation` 的 `agentOptions` 是否受宿主 `subagentModelSelection` 白名单约束 | 若受约束，逐顶点定档可能被静默拒绝；需 fail-loud 或同步 | 与 V-1 同批 |
| V-3 | 同装 `experimental-agent-team` 时，本项目顶点是否会被官方 roster 误认为 teammate | 决定 §9 第 6 条的措辞 | 安装实验前 |
| V-4 | foreman 的 `native-team.js` 契约在 rc.2 是否成立（它只验证 rc.5） | 仅影响 L-11 的"可行性"表述 | 不阻塞 |
| V-5 | `wait_subagents` 的 `listChildren` 是否包含本项目 `startVertex` 拉起的 childId | 同装时的行为描述 | 不阻塞 |
| V-6 | 同一宿主上 `agent/status` 是否对自建 provider 拉起的子代理发事件 | T-5 能否用订阅方式解决 | P7 前 |

---

## 11 · 证据索引

| 主题 | 位置 |
| --- | --- |
| foreman 入口与依赖策略 | `foreman/lib/index.js:47-54,87-173` |
| foreman 执行/超时/释放 | `foreman/lib/engine.js:568-751` |
| foreman 路由回显 | `foreman/lib/engine.js:123-181,611-618,736-737` |
| foreman 增量调度/失败传播 | `foreman/lib/engine.js:857-992` |
| foreman 只读恢复 | `foreman/lib/engine.js:1005-1083,1114-1125` |
| foreman 原子写/Windows 重试 | `foreman/lib/store.js:350-377,396-425` |
| foreman 白名单同步 | `foreman/lib/index.js:104-114`、`foreman/lib/whitelist.js:32-80` |
| foreman 原生团队 Proxy 桥 | `foreman/lib/native-team.js:33-97` |
| autopilot 依赖与配置 | `autopilot/dist/index.mjs:1955-1986` |
| autopilot 纯规划器 | `autopilot/dist/index.mjs:262-369,424-501,514+,567-684,806-864` |
| autopilot tick 顺序 | `autopilot/dist/index.mjs:1276-1400` |
| autopilot 状态行/裁剪 | `autopilot/dist/index.mjs:916-1160` |
| autopilot 设计决策与真机记录 | `autopilot/README.md:15-196,289-506` |
| autopilot 预发布区间陷阱 | `autopilot/CHANGELOG.md:8-14` |
| better 路由守卫与包装 | `better/lib/host.js:41,47-54,92-144` |
| better 等待工具 | `better/lib/host.js:147-166,234-287,294-339` |
| better 客户端槽位 | `better/lib/client.js:740-776` |
| 本项目基座装配 | `src/host/substrate.ts:52-57,184-236,252-286` |
| 本项目 provider 语义 | `src/host/provider.ts:67-90` |
| 本项目 requested/effective | `src/service/concourse.ts:314-315`、`src/service/ledger.ts:49-52,126-157` |
| 本项目准入闸门 | `src/service/inbox-gate.ts:122-262` |
| 本项目工具作用域 | `src/tools/index.ts:27-98` |
