# dsh-agent-teams-concourse · 开发计划

|  |  |
| --- | --- |
| 版本 | v1.0（2026-10-11） |
| 输入 | 《dsh-agent-teams-concourse 调研 + 需求 v1.2》（dsh-agent-teams-concourse-report.html） |
| 基线环境 | DSH 0.2.0-rc.2 · Node ^22.19 / ≥24 · pnpm |
| 目标仓库 | github.com/neo805/dsh-agent-teams-concourse（Public + MIT，**建仓与推送前另行报批**） |

本计划把报告的 M0–M5 路线重组为 **P0–P6 七个阶段**，核心原则：

1. **测试先行（TDD）**：每个阶段先交付 failing tests 与 fixtures，再写实现；测试清单是开工的第一产物。
2. **MVP 优先**：P0–P4 构成最小核心原型（v0.1.0），先验证"虚拟拓扑 + 逐顶点定档 + 通信闸门"三件事能真实跑通，再做编辑器、校准闭环、T2a。
3. **最大不确定性最早暴露**：R-9 provider 钩子链路作为独立 spike（P2）排在服务开发之前，带 Go/No-Go 决议门。

---

## 1 · 目标与 MVP 定义

### 1.1 产品目标（引报告 §7.1）

concourse 是 DSH 的组织层：把**拓扑、逐顶点模型定档、通信约束**变成可编辑的一等数据；复用官方 agent-team 底座（邮箱 / CAS 任务 DAG / invariant），不重造轮子；零美术资产、形状承载语义。

### 1.2 MVP（v0.1.0）必须证明的五件事

| # | 命题 | 对应报告 |
| --- | --- | --- |
| V-1 | 拓扑是可声明的数据：T1a / T1b / T1.5 由开放边集裁剪表达，执行底座深度恒为 1 | §7.1.2 · §7.2 |
| V-2 | 每个顶点独立的 model / reasoningEffort / toolFilter 真实生效（台账可证 requested = effective） | §7.4 |
| V-3 | 闭边消息在**收件侧**被拦截并留痕；wake 默认 never；TTL / 去重 / 速率 / 预算熔断生效 | §7.5 |
| V-4 | 全局一次审批：计划批准后运行期零组队审批打断（子节点无建队能力） | FR-2.4 · P5 |
| V-5 | UI 零图片资产，形状单独可辨，单行总览 + 待决置顶 | §7.6 |

### 1.3 明确不在 MVP 内（P5+）

计划编辑器 GUI（shell.overlay 就地编辑）· C2 静默判定 · 校准报告 · LLM 精修建议 · 飞行中改拓扑 · team_join / T2a · npm 发布。

---

## 2 · 技术选型与工程基线（2026-10-11 已与需求方确认）

| 决策 | 选择 | 依据 |
| --- | --- | --- |
| 语言 / 构建 | **TypeScript + tsdown** | team-rooms 与全部官方包同构；host + client + shared types 一处定义 |
| 测试 | **vitest + @vitest/coverage-v8 + jsdom** | team-rooms 已验证的组合；v8 覆盖率门禁 |
| Schema | kernel 内 **zod ^4**（与官方底座一致）；插件 Config 用 **@deepseek-ai/schemastery**（cordis 约定） | 两者边界见 §8 E-3 |
| Lint | oxlint（team-rooms 先例）+ 自写模块边界检查脚本 | 快、零配置 |
| 包管理 | pnpm（packageManager 字段钉版本） | 与 DSH profile 生态一致 |
| 包名 / 工具名 | `dsh-agent-teams-concourse`（unscoped）· `team_*` × 7（join 在 P6）· provider 名 `concourse` | 报告 §7.8.3 已核对无重名 |
| peerDeps | `@deepseek-ai/*` **精确钉 0.2.0-rc.2**，cordis ~4.0.4 | 报告 §7.1.1：官方无废弃信号，升级只能整栈对齐 |
| 客户端 | React 18 函数组件，自绘内联 SVG，不依赖宿主图标导出 | 报告 §7.6.4 实测约束 |

---

## 3 · 仓库结构与模块边界

```
dsh-agent-teams-concourse/
├── package.json · cordis.patch.yml · README.md · README.zh.md · LICENSE
├── tsconfig.json / tsconfig.build.json / tsconfig.client.json
├── vitest.config.ts · tsdown.config.ts
├── src/
│   ├── kernel/                  ★ 纯函数内核 — 零宿主依赖（禁 import @deepseek-ai/*、node:fs）
│   │   ├── topology/   schema.ts validate.ts tier.ts edges.ts
│   │   ├── profile/    profiler.ts suggest.ts          # 7 维难度画像 + 可解释建议
│   │   ├── comms/      gate.ts hop.ts dedup.ts rate.ts budget.ts quiescence.ts(桩)
│   │   ├── budget/     tokens.ts                        # 成本估算与预算核算
│   │   └── glyphs.ts                                    # 形状符号表（P6 唯一真源，client 复用）
│   ├── host/                    宿主适配层
│   │   ├── substrate.ts          # 官方 agentTeams 薄适配：能力探测 + 降级（报告 §7.1.1）
│   │   ├── provider.ts           # concourse subagent provider：逐顶点定档注入点（§7.1.3）
│   │   └── catalog.ts            # provider/model/effort 枚举 + fail-loud 校验（FR-4.4）
│   ├── service/                 领域服务层
│   │   ├── concourse.ts          # 生命周期 draft→pending-approval→running→archived
│   │   ├── inbox-gate.ts         # 收件箱准入——权威判定（§7.5.3 第②层）
│   │   ├── ledger.ts             # 决策台账 + 通信流水 + 回声计数（FR-4.7 / FR-5.E）
│   │   └── persistence.ts        # 落盘与重启恢复（NFR-4）
│   ├── tools/                   team_* 工具组（topology/assign/link/plan/send/status，join 在 P6）
│   │   └── index.ts              # 注册与作用域：子节点不获建队工具（FR-2.4 能力剥夺）
│   ├── client/                  React UI（P4 只做最小侧栏 + 计划卡）
│   └── index.ts                 cordis 入口，惰性安装（NFR-1）
├── test/
│   ├── kernel/  host/  service/  tools/  client/        # 与 src 镜像
│   ├── fakes/                 # FakeAgentTeams / FakeSubagents / FakeLLM / FakeApproval
│   └── fixtures/              # 拓扑样例矩阵 + 建议器回归语料
├── scripts/
│   ├── check-no-assets.mjs      # NFR-3 零美术资产门禁
│   ├── check-boundaries.mjs     # 模块依赖方向静态检查
│   ├── corpus-regression.mjs    # 建议器语料回归（R-5 防线，FR-4.5 前身）
│   └── pack-smoke.mjs           # npm pack 后装载冒烟
└── docs/
    ├── decisions/               # 工程决议记录（D-P1…）
    └── spikes/                  # P2 探针报告
```

**依赖方向（CI 强制，check-boundaries.mjs）**：
`kernel → （无宿主依赖）`；`host → kernel`；`service → host + kernel`；`tools → service`；`client → kernel/glyphs + 类型`。反向 import 即构建失败。

---

## 4 · 测试策略

### 4.1 TDD 工作流（硬性流程）

1. 每个阶段开工的**第一个提交**是 failing tests + fixtures（提交信息 `test: …`）。
2. 实现提交（`feat: …`）使测试转绿；禁止"先实现后补测"。
3. 重构仅在绿灯下进行。
4. 每阶段末跑全量门禁（§4.4）后才允许合并回 main。

### 4.2 测试分层

| 层 | 对象 | 技术 | 覆盖率门禁 |
| --- | --- | --- | --- |
| L1 纯单测 | kernel 全部 | vitest，参数化 fixtures 矩阵，确定性（禁时钟/随机依赖，注入 seed） | **行/分支 ≥ 90%**（NFR-5） |
| L2 契约测试 | host/fakes | fake 行为钉死官方已观测语义：CAS stale revision、名字永不复用、maxPending=64、投递即唤醒 | ≥ 70% |
| L3 集成测试 | service + tools + fakes | 计划全生命周期；**闸门绕过矩阵**（NFR-9） | ≥ 80% |
| L4 客户端 | client | jsdom 渲染断言 + glyph 结构断言 | ≥ 60% |
| L5 真机冒烟 | 整体 | scratch profile 装包跑样例（半自动 checklist） | MVP 出口必过 |

覆盖率设**棘轮**：CI 记录基线，只许升不许降。

### 4.3 逐模块测试清单（每阶段的"先写测试"就取自这里）

**kernel/topology（schema · validate · tier · edges）**
- 合法 T1a / T1b / T1.5 / T2a fixture 通过；T2b 一律拒绝
- 拒绝：悬挂 parent 引用 · 悬挂边端点 · 自环边 · 重复顶点 id · layer 与 parent 链深度不一致 · 多根但 tier≠T2a · origin=joined 却非根 · 根 parent≠null
- FR-2.6：顶点数超 maxActiveSubagents、预算总和溢出 → **计划期**报错而非运行时
- tier 判定：星→T1a、多层树→T1b、树+稠密子图→T1.5、森林+根间边→T2a、单点→T0；决策树 Q1–Q5 全分支
- edges：完全图枚举 = n(n−1)；**deny-by-default**（未声明即关闭）；按树形默认开边；request-reply 自动生成反向应答绑定（A2）

**kernel/comms（gate · hop · dedup · rate · budget）**
- gate：开边放行 / 闭边 typed error（附开放边候选列表）；A→B 不蕴含 B→A；收件侧权威判定与发送侧"早失败"结果一致
- hop：hops ≤ ttl 投递；hops > ttl 只记录 + HOP_LIMIT 标记（FR-5.C1）
- dedup：hash(from|to|correlationId|内容摘要) 重复丢弃 + 计数（FR-5.C3）
- rate：窗口超额 → 降级为"投递不唤醒" + 留痕（B2）；广播只入共享板不唤醒任何顶点（B3）
- budget：边超额**熔断该边**不熔断团队（D1）；全局超额暂停所有 wake≠never 投递，仅人工恢复（D2）

**kernel/profile（profiler · suggest）**
- 7 维画像各维度边界取值；建议输出含 model/effort/tokenTier/toolFilter/maxDepth/**rationale[]/signals[]/confidence**（FR-4.2/4.3）
- 确定性：同输入 → 同输出
- fail-loud：非法 model/effort 拒绝并附可选值列表（FR-4.4）
- **语料回归**：从本机真实会话提取的标注语料（fixtures/corpus）跑 `corpus-regression.mjs`，输出命中率报告——吸取 auto-router 阈值 4→2 的教训（R-5），阈值只用回归结果标定，不拍脑袋

**kernel/glyphs**：每个状态同时具备形状+颜色；任意两状态形状两两可辨（P6 结构断言）

**host（substrate · provider · catalog）**
- substrate：官方缺席 → 降级为"自有任务图 + 无跨顶点邮箱"且**不崩溃**；每个官方方法经能力探测路由；静态检查：全仓库对 ctx.agentTeams 的引用只允许出现在 substrate.ts（R-1）
- provider：顶点规格 → SubagentStartRequest.agentOptions 正确装配；toolFilter.deny 注入官方 send_message（第①层收口）；不支持的档位 fail-loud
- catalog：listProviders / resolveModelInfo 枚举与缓存；白名单 snake_case 字段映射

**service（concourse · inbox-gate · ledger · persistence）**
- 生命周期：draft→pending-approval→running→archived 全转换；非法转换拒绝
- **绕过矩阵（NFR-9，本计划最重要的测试组）**：工具调用 / 命令入口 / Web 入口 / 直接调 service——四条路径发送闭边消息，全部被拦或留痕
- inbox-gate：与发送方解耦——伪造"官方 send_message 直发"的入站消息同样被准入校验拦截（§7.5.3 第②层语义）
- ledger：requested vs effective 档位记录；inherit_ratio=100% 时可辨（FR-4.7）；回声计数四个指标齐全（FR-5.E1）
- persistence：状态 round-trip；模拟重启后顶点/边/预算/台账可续（NFR-4）

**tools（team_\* × 6）**
- 输入 schema 全字段边界；未知字段给 Levenshtein "did you mean" 建议（借鉴 nanmicoder）
- **作用域测试**：子节点会话中建队类工具（topology/plan/link/join）不可见（FR-2.4 能力剥夺）
- description 含与官方 team_task_\* 的边界约定文案（§7.8.3）

**client（panel · plan-card）**
- L0 单行字段齐全（tier · 顶点数 · 活跃 · 开放边 x/y · 预算条 · 回声 · 熔断）
- L1 空态显式显示"无待决事项"（P2）
- L2 文字树渲染；默认折叠处**显式声明隐藏内容**（P4，规避"成员消失"缺陷）
- 计划卡渲染完整（拓扑建议 + 任务表 + 通信边表 + 审批策略 + 风险显式列出）

### 4.4 CI 门禁（scripts/ + package.json scripts）

| 门禁 | 命令 | 对应 |
| --- | --- | --- |
| 单测 + 覆盖率 | `pnpm test`（vitest run --coverage） | §4.2 阈值 |
| 类型 | `pnpm typecheck`（tsc × 2：host/client） | — |
| Lint + 边界 | `pnpm lint` + `check-boundaries` | §3 依赖方向 |
| **零美术资产** | `verify:assets`：files 清单与 src/ 全域扫描 .png/.jpg/.svg/.gif/emoji 码位 | NFR-3 · P1 |
| 装载冒烟 | `pack:smoke`：npm pack → 临时目录安装 → import 入口 | 打包完整性 |
| 语料回归 | `corpus:regression`（P1 起） | R-5 |

---

## 5 · 阶段路线

> 每阶段四件套：**目标 / 先写的测试 / 实现交付 / 出口标准**。工期为单人粗估，仅用于排序与节奏感。

### P0 · 工程脚手架（约 0.5–1 天）

- **先写测试**：vitest 冒烟测试；`check-no-assets` 对"含 png 的 fixture 包"的负例测试；`check-boundaries` 对违规 import fixture 的负例测试
- **实现**：package.json（peerDeps 钉 0.2.0-rc.2、files 清单）· tsconfig ×3 · vitest.config（含覆盖率阈值）· tsdown.config · cordis.patch.yml 骨架（Config 仅 `enabled`，默认惰性）· .gitignore · README 双语文档骨架 · scripts/ 四个门禁脚本
- **出口标准**：`pnpm test / typecheck / lint / verify:assets / pack:smoke` 全绿；`git init` + 首次提交在本阶段末完成（本地操作，已获授权）

### P1 · 纯函数内核（报告 M0；约 4–6 天，最大单阶段）

- **先写测试**：§4.3 中 kernel/topology、kernel/comms、kernel/profile、kernel/glyphs 全部清单 + fixtures（拓扑样例矩阵 ≥ 8 例；语料 fixtures 从本机 ~/.dsh/sessions 提取并标注 ≥ 50 条真实中文任务消息）
- **实现**：kernel/ 全部模块（quiescence 仅留接口桩，P5 实现）
- **出口标准**：kernel 行/分支覆盖率 ≥ 90%；语料回归报告落 `docs/corpus-regression-P1.md`，建议器阈值由回归结果标定；全门禁绿

### P2 · 基座验证 spike（报告 M1 前半 + §9.3；时间盒 1–2 天）

不写产品代码，只做三件事并留下带断言的记录：

| 验证项 | 方法 | 判据 |
| --- | --- | --- |
| **R-9** provider 钩子链路 | 最小探针插件：注册 concourse provider → 配置 tool-agent-team freshProvider 指向它 → 官方 spawnTeammate → 断言 agentOptions（model/effort/toolFilter）到达子代理 | 跑通 = 路线 C 继续；**证伪 = 切路线 A**（自行 startContinuable 拉起，放弃复用官方 roster/邮箱；kernel 与 UI 不受影响） |
| ctx.tools.guard() 覆盖范围 | 对官方 scoped send_message 发起调用，断言 guard 是否拦截 | 决定第③层兜底的可靠性（§7.5.3） |
| 并发/深度上限行为 | maxActiveSubagents=8 / maxDepth=1 的配置覆盖方式与超限行为 | 计划期容量校验的报错文案依据（R-3） |

- **出口标准**：`docs/spikes/R-9-provider-hook.md`（含逐条断言结果）+ Go/No-Go 决议记录 `docs/decisions/D-P2-route.md`

### P3 · 服务与工具（报告 M1 后半 + M2；约 5–7 天）

- **先写测试**：fakes 契约测试 → substrate 降级测试 → service 生命周期 + **绕过矩阵** → tools schema/作用域测试 → persistence round-trip（清单见 §4.3）
- **实现**：host/ 三个模块 · service/ 四个模块 · tools/ 六个工具（team_topology / team_assign / team_link / team_plan / team_send / team_status）· cordis 入口接线（惰性安装，NFR-1；异常永不阻断对话，NFR-2）
- **通信闸门落地**：第①层 toolFilter 收口 + 第②层**收件箱准入权威判定** + 第③层 guard 兜底 + 第④层全量留痕（§7.5.3）
- **出口标准**：绕过矩阵全绿（四入口闭边消息全拦或留痕）；service 覆盖率 ≥ 80%；官方缺席降级路径有测试证据

### P4 · 最小 UI（报告 M3 裁剪版；约 3–4 天）

- **先写测试**：§4.3 client 清单（jsdom）
- **实现**：侧栏面板（sidebar.right.pane.tab：L0 单行总览 / L1 待决队列 / L2 文字拓扑树 / L3 任务表）· 会话内计划审批卡（渲染 §7.6.3 全部信息，编辑通过 team_* 工具在审批前完成）· 审批接线（ctx.approval）
- **出口标准**：零图片资产门禁绿；灰度/纯文本导出后状态完整可读（P6）；默认折叠均显式声明隐藏内容（P4）

### 🏁 MVP 出口标准（v0.1.0，P0–P4 完成后判定）

1. T1a 与 T1b 两个端到端样例在真实 DSH profile 跑通（L5 冒烟 checklist）
2. §1.2 的 V-1 … V-5 五命题全部有测试或冒烟证据
3. 全 CI 门禁绿；kernel ≥ 90% / service ≥ 80% 覆盖
4. 此时**提请需求方验收**，验收通过后打 tag `v0.1.0`

### P5 · 完善第一批（报告 M4；MVP 后）

计划编辑器 GUI（shell.overlay 就地编辑，FR-4.1 全交互）· C2 静默判定 · suggestions.jsonl 校准报告（FR-4.5 完整闭环）· 飞行中改拓扑（走 P5 确认清单）· LLM 精修建议（D-6，失败回落启发式）· T1.5 端到端样例

### P6 · 会话加入 / T2a（报告 M5）

team_join 工具 · 加入角色选择（子节点 / 平级领队）· 根间边只承载通报与协商的权限测试（FR-2.3）· 升级 T2a 的二次审批流（用户主动发起）· T2a 端到端样例

---

## 6 · Git 与 GitHub 方案

| 操作 | 授权状态 | 内容 |
| --- | --- | --- |
| 本地 git | ✅ 已获授权 | `git init`；main 主干 + `phase/*` 短分支；Conventional Commits；`test:`/`feat:` 成对提交体现 TDD；P0 末首次提交 |
| **建仓 + 推送** | ⛔ **执行前另行报批** | `gh repo create neo805/dsh-agent-teams-concourse --public --source=. --remote=origin` + `git push -u origin main`（gh CLI 已确认登录 neo805，repo scope 齐备）。建议首推时机二选一：P0 完成（骨架可读）或 MVP 完成——届时请你定夺 |
| tag / release | 随报批一并确认 | MVP 验收后打 `v0.1.0`；之后语义化版本 |
| npm publish | 不在本计划内 | 需要时另议 |

`.gitignore`：node_modules · dist · coverage · *.local · .dsh-test-profile。

---

## 7 · 风险登记（沿用报告 R-1…R-9，新增工程风险 E-\*）

| ID | 风险 | 缓解（落点） |
| --- | --- | --- |
| R-1 | 官方基座漂移（experimental、无废弃信号） | substrate.ts 薄适配 + 能力探测 + 降级（P3）；静态检查禁止绕开适配器；peerDeps 精确钉版 |
| **R-9** | provider 钩子未实测——路线 C 成立前提 | **P2 spike 最先做**，Go/No-Go 决议；退路路线 A 不影响 kernel/UI |
| R-3 | 并发 8 / 深度 1 上限偏紧 | kernel 计划期容量校验（FR-2.6）；P2 确认配置覆盖方式 |
| R-4 | 硬约束误伤合法协作 | 全部约束计划期可见可调；每次拒绝必留痕（FR-5.E2） |
| R-5 | 建议校准失败（auto-router 前车之鉴） | P1 语料回归是**必需**出口项，不是可选项 |
| R-8 | 闸门无法落在官方服务层 | 权威判定在收件箱准入（第②层）；绕过矩阵测试钉死（P3） |
| E-1 | fake 与官方语义漂移 | L2 契约测试把 fake 钉在官方已观测语义上；升级官方版本时先跑契约套件 |
| E-2 | client store 类型不可解析（报告 §7.6.4 已警示） | 自行声明 .d.ts；client 只依赖 kernel/glyphs + 最小宿主类型 |
| E-3 | zod v4（kernel）与 schemastery（Config）混用边界 | 分工钉死：zod 只进 kernel/service；cordis Config 只用 schemastery；边界检查脚本覆盖 |
| E-4 | 语料隐私 | 语料只取自本机会话、脱敏后落 fixtures，不出仓库以外的任何位置 |

---

## 8 · 命名与版本钉死清单（实施时照此执行，不再临时决策）

- 包名 `dsh-agent-teams-concourse`；provider 名 `concourse`；工具 `team_topology / team_assign / team_link / team_plan / team_send / team_status`（P6 加 `team_join`）
- peerDeps：`@deepseek-ai/dsh-experimental-agent-team` 及 dsh-agent / dsh-llm / dsh-session / dsh-subagent 全部 `0.2.0-rc.2`；`@deepseek-ai/cordis ~4.0.4`；engines `dsh: 0.2.0-rc.2`、`node: ^22.19.0 || >=24`
- 依赖：zod `^4.4.3` · @deepseek-ai/schemastery `~3.18.4`；devDeps：typescript ^5.9 · vitest ^3.2 · @vitest/coverage-v8 · jsdom · tsdown · oxlint · react@18 类型 · @deepseek-ai/dsh-agent-loop-testkit `0.2.0-rc.2`
- 与官方 `team_task_*` 的边界约定写进每个 team_* 工具 description：**concourse 管拓扑与路由，官方管成员与任务**

---

*本计划经需求方评审后生效；阶段出口标准的任何放宽（尤其覆盖率与绕过矩阵）需显式记录于 docs/decisions/。*
