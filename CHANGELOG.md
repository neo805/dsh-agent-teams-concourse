# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与
[语义化版本](https://semver.org/lang/zh-CN/)。版本变更须在此登记。

## [0.2.1-rc.6] — 2026-10-25 · 硬化出口与 H3.0 协议

### Added

- `docs/decisions/D-H3-transaction-recovery.md`：定义 admission/回执/预算预留、`PUBLICATION_UNKNOWN`、崩溃窗口对账、torn-tail、approve 中断与 P5 约束；H3.1 实现前不宣称完整恢复。
- RateLimiter 旧实现参考对拍、dedup 穷举单射、当前 live/replay 协议模型，以及 `verify` 构建单一权威的门禁测试。
- 「防止同族窄化循环」规则：复核上轮修复、不变量优先、门禁 known-bad fixture、不以 xfail 充当出口。

### Changed

- RateLimiter 只保留至多 `n` 个判决所需时间戳并维护不可逆剔除水位；显式 `at` 回退、degrade 计戳与预检不消费语义保持不变，连续降级不再积累全历史。
- `@types/react` / `@types/react-dom` 对齐 React 18.x 运行时；新增主版本一致断言，不改变运行时。
- `pnpm verify` 不再在测试前预构建：顺序为静态检查 → `test:coverage`（globalSetup 唯一构建）→ assets → pack-smoke。

### Fixed

- 连续降级下限流窗口无界增长及每消息全窗口扫描。
- React 18 运行时与 React 19 类型契约漂移。
- `verify` 每次执行重复完整构建。

### Known limits

- H3.1 的崩溃恢复、票据重放、torn-tail 隔离仍只成文未实现；`PUBLICATION_UNKNOWN` 不自动重发。
- Catalog 并发、AgentDirectory、suggest/validate/UI 投影、mock fixture 合并与空客户端 dts 按计划留待 P7/P8/P9。
- rc.5 的面板数据桥、PlanCard 挂载、逐顶点工具分流等已知残留不变。

## [0.2.1-rc.5] — 2026-10-25 · 通信正确性、路由与门禁加固

### Changed

- 逐顶点 `provider` 现在贯穿模型白名单预检、`VertexStart` 与宿主 `agentOptions`；同名模型跨 provider 时按显式路由判定，不再误用目录第一条。
- `team_topology` 与 `team_plan/service.create` 共用唯一 `analyzeConcourse` 管线；未知字段键集直接从 Zod shape 派生，编辑距离与预算账本/估算各只有一个实现入口。
- 工具组注册改为局部事务：中途失败时逆序撤销已注册工具，入口仍不抛出，也不留下半套 `team_*`。
- `interrupt` 成功释放后清除 parent Agent 强引用，以有界 tombstone 保持重复调用幂等。
- 边界门禁改用 TypeScript AST，覆盖 `require`/动态 import，未登记层默认拒绝；pack 冒烟只链接 manifest 声明的 dependencies + peerDependencies。
- 零资产检查覆盖 `package.json` 的发布集合；pack 契约补客户端 `index.d.cts`；语料测试改由 Vitest globalSetup 每次调用构建一次，worker 不再并发写共享 `dist`。
- 移除无消费方的 `@deepseek-ai/dsh-experimental-agent-team` peer/dev 依赖与 workspace 例外。

### Fixed

- 熔断边 close→open 后旧 fuse 残留：删除预算边时同步丢弃其熔断标记，live 与 replay 均可恢复投递。
- `team_link` 接受 `hopTTL<=0`：开边现在写台账前复用 `Edge` schema 校验，返回 `INVALID_SPEC` 且拓扑不变。
- 32 位内容摘要碰撞导致合法消息误判 `DUPLICATE`：去重身份改为完整无歧义 tuple，同一消息重放仍被拦截。
- 拓扑树折叠标记按字符串子串误贴到兄弟顶点；树渲染新增结构化行并按顶点 id 关联，`__proto__` 状态不再丢失。
- 计划卡通信边 React key 改用无歧义有向 tuple framing。

### Known limits

- 去重/admission 的容量与持久化窗口、成功发送的三次同步 JSONL 写、启动全事件深拷贝仍留待 H3 事务/快照协议处理。
- 模型目录独立异步枚举仍为串行；按上限并发与 `AgentDirectory` 身份索引随 P7/P8 处理。
- 面板数据桥仍未接线，`PlanCard` 尚无运行期挂载入口；无回调动作仍会渲染为可点击，随 P7 一并接线。

## [0.2.1-rc.4] — 2026-10-25 · 侧栏可发现性与自动打开

### Added

- 右侧栏页型定义补充 `guide` 条目（id `panel`、order 50），使“添加标签/guide”能发现 Concourse。
- 客户端在会话挂载时自动打开一次 Concourse tab（每个 session 一次；用户关闭后不反复抢回）。
- 客户端注册失败在没有宿主 logger 时回退到 `console.warn`，不再静默吞掉装配错误。

### Changed

- `client.inject` 增加 `sidebarRight`；无该服务时仍可完成类型/body 注册但不自动打开。

### Fixed

- 仅注册类型与 keyed body 不会让右侧栏出现页面类型；这是 Web 视觉验收“无 Concourse 标签”的根因。

## [0.2.1-rc.3] — 2026-10-25 · 契约、通信与回放一致性硬化

### Added

- 客户端面板 keyed slot 使用当前宿主契约的 `key`，页型注册接入 `ctx.effect`；注册失败输出 warning 而不是静默消失。
- 共享预算规范化纯函数：`team_topology` 与 `team_plan/create` 对预算回填/溢出给出一致结论。
- `approve` 在写 intent、拉起任何顶点之前，对全部显式 model/effort 做 Catalog 白名单预检。
- 边界门禁正向白名单与 `index` 层；corpus 原始比例门禁与陈旧 `dist` 拒绝；pack 实物文件契约；资产门禁覆盖 `dist`。

### Changed

- Substrate 的 parent/activation 表改用全局唯一 `childId`；dispose 成功后才移除句柄，失败可重试。
- 速率降级的真实投递也恰好扣一次预算；准入预检与提交共用同一时间戳，不再事后翻转 wakeup/verdict。
- 改边只重建新增或配置变化的 rate limiter，未变边的滑动窗口继续有效。
- live/replay 共用“拓扑 + edgeBudgets + withEdgeBudgets”reducer；`createdAt` 跨重启恢复。
- `requestedVsEffective` 按 `(concourseId, vertexId)` 查询；Ledger 用派生索引提供 echo/RVE。
- 启动只读取一次事件存储；JSONL 目录只确保一次；移除重复 `order` 数组与工具层未使用的 substrate 依赖。
- kernel 复合键统一 JSON tuple framing；特殊字符串 ID/effort 不读原型链；task id 增加唯一性校验；suggest/预算共用 effort 归一化；英文关键词按词边界匹配。
- `tsdown` 迁移到 `deps.neverBundle`；移除无引用的 `schemastery` 与 `dsh-agent-loop-testkit` 依赖。

### Fixed

- 多 concourse 复用同名顶点时的跨团队误 dispose。
- degraded 消息绕过预算、窗口边界 verdict 反转、改边清空限流窗口。
- close/open 预算边在重启前后熔断结果不同。
- `team_link` 失败伪造 `openEdges:0` 并改写领域错误码。
- 客户端 keyed slot 因 `id`/`key` 混淆而不注册。
- 特殊 ID 引发预算字符串拼接/NaN、glyph 渲染崩溃，以及复合键碰撞。

### Known limits

- 审批中断的完整恢复、post-delivery 写盘失败、dedup/admission 重启回放、`team_plan` 部分成功与 torn-tail 策略仍未实现；登记于开发计划 §9，需另立事务/恢复协议。本轮不宣称 exactly-once 或完整崩溃恢复。
- Web 核心链路已在 `conc03` scratch profile 实机验证；`web` 与 Desktop profile 均已安装 rc.4 并启用配置，但都需重启后由出品人验收 Concourse tab 的真实视觉与交互。客户端 slot、guide 入口与一次性自动打开由严格契约测试和 pack-smoke 覆盖。

## [0.2.1-rc.2] — 2026-10-25 · 通信与状态可信性

### Added

- `agent/pre-step` 模型准入闸门：以宿主 durable `agent-message.senderSessionId` 映射真实发送方，
  官方 `send_message` / 裸 `subagents.sendMessage` 的闭边消息在进入模型前被移除并留痕。
- `team_send` 使用真实 `exec.agent` 身份凭据；身份与 `from` 不一致时 `IDENTITY_MISMATCH`。
- `DeliveryRequest` / `Substrate.deliver`：直接写目标 Agent inbox，支持 `wakeup=false` 的不唤醒投递；
  目标不在线时 `TARGET_UNAVAILABLE`，不再伪造成功。
- `Ledger` 支持事件快照恢复 seq/查询/echo；`replay` 识别 `edge-open` / `edge-close` 与领队 session id。

### Changed

- 通信预检与提交拆为 `evaluateInbound` / `commitInbound`：只有真实投递成功后才扣预算、记 deliver；
  发送失败写 `delivery-failed`，不消费预算、不污染去重。
- 速率降级改为真实“投递但不唤醒”：限流消息仍进入收件箱，`wakeup=false`，不再丢弃。
- `team_link` 收进 `ConcourseService.link`：边事件先落盘，再由同一 reducer 更新拓扑与预算运行时。
- 生命周期写盘顺序改为“sink 成功才发布内存状态”；`approve` 增加 single-flight、取消透传与完整回滚。
- 预算回填后复查最终不变量；`storagePath` 明确为 JSONL 文件路径，缺省内存存储。
- 工具与 UI 的“开放边 x/y”统一为有向完全图 `n(n-1)` 口径。

### Fixed

- 重启后 `Ledger` seq 归零、echo 统计丢失、闭边重开。
- Web 实机发现：同一领队下多个 concourse 时，模型准入按 target 误选第一条；现以唯一 sender
  反查所属 concourse，闭边 reject 记到正确实例（rc.2 修复）。
- `team_send` 发送失败仍记 deliver / 扣预算；`NOT_STARTED` 路径提前消费准入。
- `concourse` / `edge` 的 `wallclockMs` 被共享未知键集放行后又被 Zod 静默剥离。
- corpus 回归测试不再改写入库报告或临时移动共享 `dist` 文件。

### Known limits

- 重启后目标子 Agent 未 live 时，发送返回 `TARGET_UNAVAILABLE`；冷恢复投递留待恢复语义阶段。
- 模型准入闸门阻止消息进入模型，但不会删除已提交的会话 inbox 事件；需求口径已在文档中写明。
- `team_link` 的 P7 人工确认交互仍未实现，当前只统一领域语义与回放一致性。

## [Unreleased] — 2026-10-25 · 文档与工作流重构（无代码行为变更）

### Added

- `docs/REQUIREMENTS.html`（需求文档 v2.0）：**唯一需求依据**。合并两册调研，统一需求编号
  （FR-A 拓扑 / FR-B 定档 / FR-C 通信 / FR-D 探针，共 45 条 + NFR 14 条），纳入 P2 路线 A
  决议对架构的修正，并给出每条需求的实现状态（已实现 / 部分 / 未实现）。

### Changed

- `COLLABORATION.md` 升级到姊妹项目同代规范：角色改称**出品人 / AI 第一作者**、
  版本号**全量带 `rc`**、**测试先行**、**四级验证阶梯**（标准测试 → Web 安装 →
  Web 实机验证 → Desktop + 出品人验收，含 Web 实机闸门与 45 分钟预算）、
  交付清单改为「验收通过才 push」、已知残留必须公示、文档隐私边界。
- `DEVELOPMENT_PLAN.md` 重写为 v2.0：P0–P4 与 `0.1.0` / `0.2.0` 归档为已完成；新增
  **P5 旁路探针 MVP / P6 探针生命周期 / P7 校准闭环与运行期能力 / P8 会话加入 T2a /
  P9 发布准备**；技术债 T-1…T-10、风险 P-R1…P-R7、已知残留 13 条全部公示。
- `README.md` / `README.zh.md` 双语重写：现状表（诚实标注未完成项）、快速上手、
  四层结构、闸门口径、已知边界、按版本区间的作者声明。
- 两份调研报告移入 `docs/`（`dsh-agent-teams-concourse-report.html`、
  `dsh-side-inquiry-probe-report.html`），继续作为调研底稿。

### Fixed

- `scripts/corpus-regression.mjs`：报告改为写**仓库相对路径**（此前把绝对路径写进入库文档）。
- 入库文档与脚本的机器路径清理：`research/01–13`、`cordis.patch.yml`、
  `scripts/_mount-concourse.cjs` 内共 46 处 `C:\Users\<user>\…` 替换为
  `$DSH_HOME` / `<DSH_INSTALL>` / `<TEMP>` / `<NPM_GLOBAL>` 等占位符；
  挂载脚本改为从 `$DSH_HOME` 与命令行参数解析，不再硬编码任何机器路径。

## [0.2.0] — 2026-10-18

运行时基线升级到 DSH 0.2.1-rc.2（不兼容 0.2.0 系列），并修复真机测试
（session-69172a02）报告的 6 个问题。

### Changed

- **运行时适配**：`startContinuable` → `startActivation`（持有 Activation 句柄，
  interrupt = 中断信号 + `dispose()` 释放）；`interrupt` 授权改为
  `{ kind: 'ancestor', agent }`；provider capabilities 对齐 0.2.1 契约
  （`agentOptions/agentPreset/outputSchema/depthLimit`）。
- **peerDependencies / devDependencies / engines.dsh** 全部升到 `0.2.1-rc.2`；
  `inject` 增补 `agents`（逐顶点工具面收口所需）。
- **逐顶点 toolFilter** 改道：0.2.1 起 start 期不再接受 toolFilter，改为
  `startActivation` 成功后经 `ctx.agents.get(childId).ctx.tools.restrict()` 应用；
  失败即 dispose + fail-loud（`START_FAILED`）。

### Fixed

- **F5（高）自动 id 重启后必撞号**：进程内计数器不随回放恢复。现在构造时以
  snapshot 中 `concourse-<n>` 的最大序号播种，且 `ensureId` 撞号自动跳过。
- **F4（中）team_plan 结构错误直出 ZodError 多行 JSON、issues 为空**：现返回
  规范化 `SCHEMA` issues（含 path），message 为单行中文摘要；render 打印 path。
- **F1（中）原生 effort 档名按 default 位次零距离胜出**：新增别名表
  （`max→high`、`medium→default`、`minimal→off` 等），rationale 文案补齐
  `off<low<default<high` 并注明原生档位归一化。
- **F2（低）未知字段守卫真机不可达**：改为在 spec 内部逐层扫描未知键，产出
  `UNKNOWN_FIELD` issue（附 did-you-mean），parse 失败时与结构错误一并返回。
- **F3（低）parse 阶段 render 双空格**：无 path 时不再产生空占位。

### Documented (accepted, no code change)

- **F6（低）create 事件内嵌整份 spec**：台账随任务文本线性膨胀。回放需要完整
  concourse 才能重建，去掉内嵌等价于引入外部引用与一致性风险，MVP 接受并记入
  已知限制。

### Infrastructure

- `pnpm-workspace.yaml` 增加 `allowBuilds.koffi: true`（pnpm 11 的新白单位置；
  0.2.1 运行时依赖 koffi 的 install 脚本）。

## [0.1.0] — 2026-10-17

首个 MVP 出口版本：P0–P4 全阶段交付（内核四簇 / 运行时探针 / host+service+tools /
最小 UI），V-1..V-5 证据归集完成。
