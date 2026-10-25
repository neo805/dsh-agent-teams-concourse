# dsh-agent-teams-concourse · 开发计划

|  |  |
| --- | --- |
| 计划版本 | **v2.0**（2026-10-25）· 取代 v1.0（2026-10-11，P0 开工前） |
| 需求依据 | `docs/REQUIREMENTS.html` v2.0（唯一需求依据） |
| 协作规范 | `COLLABORATION.md` v2.0（角色、版本、验证阶梯、交付清单） |
| 输入 | 两份调研底稿（`docs/*-report.html`）· 13 份 research 底稿 · P0–P4 开发会话与真机测试记录 |
| 当前版本 | `0.2.1-rc.2`（0.1.0 = MVP 出口；0.2.0 = 运行时适配 + 真机 6 问题修复；0.2.1-rc.2 = T0–T4 可信性修复，含 Web 多 concourse 归属修复） |
| 基线环境 | DSH `0.2.1-rc.2` · Node `^22.19 || >=24` · pnpm 11.7 · 测试 **48 文件 / 378 测试** |
| 目标仓库 | `neo805/dsh-agent-teams-concourse`（Public + MIT，**尚未建仓；建仓与首推须出品人批准**） |

---

## 0 · 现状基线（结论先行）

**团队层（第一册需求）已经交付并被真机验证；探针层（第二册需求）一行代码都还没有。**

| 阶段 | 主题 | 版本 | 状态 | 出口判据 |
| --- | --- | --- | --- | --- |
| P0 | 工程脚手架（TS + vitest + tsdown + 四道门禁） | — | ✅ 完成 | `pnpm verify` 全绿 |
| P1 | 纯函数内核（拓扑 / 画像 / 建议 / 通信 / 符号） | — | ✅ 完成 | kernel 覆盖率 ≥90%，语料回归达标 |
| P2 | 基座验证 spike（R-9 provider 钩子） | — | ✅ 完成（**证伪**） | 决议 D-P2：走路线 A |
| P3 | host + service + tools（六件套 + 绕过矩阵） | — | ✅ 完成 | 四入口全拦或留痕 |
| P4 | 最小 UI（L0–L3 面板 + 计划卡） | — | ✅ 完成 | 零资产门禁 + jsdom 断言 |
| — | **MVP 出口** | `0.1.0` | ✅ 验收通过 | V-1…V-5 有测试或冒烟证据 |
| — | 运行时适配 + 真机 6 问题修复 | `0.2.0` | ✅ 完成 | 349/349，装 Web 体检 HEALTHY |
| **H1** | **通信与状态可信性**（T0–T4） | `0.2.1-rc.2` | ✅ 代码/单测完成，Web 实机部分通过 | 真实路径矩阵 + 恢复/原子性断言 |
| **P5** | **旁路探针 MVP**（隔离 / 摘要 / 句柄 / 回注档） | `0.3.0-rc.1`？ | ⬜ 未开工 | AC-1 / AC-2 / AC-3 |
| **P6** | **探针生命周期**（七状态 / 四级丢弃 / 遮蔽 / 晋升） | `0.3.x-rc.N` | ⬜ 未开工 | AC-4 / AC-5 |
| **P7** | **校准闭环 + 运行期能力**（诚实：四项技术债一起还） | `0.4.0-rc.1`？ | ⬜ 未开工 | 校准报告 + 面板读真实投影 + 静默判定 |
| **P8** | **会话加入 / T2a** | `0.4.x-rc.N` | ⬜ 未开工 | T2a 端到端 + 平级不可互派 |
| **P9** | **发布准备**（区间化 / 按层阈值 / npm 决策） | 待定 | ⬜ 未开工 | 可发布且可回滚 |

> 「？」= 需起第二位版本号时**必须先报出品人批准**（`COLLABORATION.md` §2）。

### 0.1 为什么下一阶段是探针而团队

第二册的结论是**探针先行**，理由在需求 §4.5（NFR-14）与 §7.2：

1. **适用面严格更大**：探针在 T0（单会话、无子代理）下即可成立，不依赖团队拓扑建不建成。
2. **实现成本严格更小**：不需要拓扑、边集、任务板；只需要「隔离子代理 + 存储 + 句柄 + 一个取回工具」。
3. **可行性已被证实**：`SubagentRun.result` 由调用方 await，驱动层零写父会话 → 零回注是**纪律问题**而不是**能力问题**。

团队层已经做完，所以 P5 不是「先做哪个」的取舍，而是唯一剩下的主线。

---

## 1 · 阶段路线总览

```
P0──P1──P2──P3──P4──[0.1.0 MVP]──[0.2.0 运行时适配]
                                        │
              ┌─────────────────────────┴──────────────┐
              ▼                                        ▼
        P5 探针 MVP ── P6 探针生命周期            P7 校准/运行期能力
              │              │                          │
              └──────┬───────┘                          │
                     ▼                                  ▼
                 P8 会话加入 / T2a ────────────── P9 发布准备
```

依赖关系（硬）：

- **P5 之前不改 `team_*` 工具语义**。探针要复用顶点注册表、名册、预算与台账，先行重构会让两组测试一起红。
- **P6 依赖 P5 的句柄与存储**；遮蔽依赖平台原语（`SurfaceOp.replace`），有独立 Go/No-Go 判定。
- **P7 与 P5/P6 互不阻塞**，但校准闭环要在探针有真实使用数据之后才有意义；UI 数据桥是 P7 里唯一会动 P4 产物的项。
- **P8 最后**：T2a 需要「已存在会话加入」，而当前连"第二个会话"的身份面都没有；且宿主 `maxActiveSubagents = 8` 对 T2a 偏紧，需先确认配置覆盖方式。

---

## 2 · 阶段详述

> 每阶段四件套：**目标 / 先写的测试 / 实现交付 / 出口标准**。工期不再给日估——按版本节奏推进，一个阶段对应一次交付。

### P5 · 旁路探针 MVP

**目标**：AC-1（零污染）、AC-2（摘要默认不进上下文）、AC-3（模型可按句柄取回）三条判据可验收。

**先写的测试**（TDD，先红）：

| 层 | 测试 |
| --- | --- |
| `kernel/probe` | `echo` 四档判定（full / summary / handle / none）；`echoNotify` 三档（silent / tick / inline）；`echo_ratio` 计算（含 0 消耗分母保护）；句柄生成与**会话内唯一**（含回放后不撞号）；取回截断上限（默认 2000 token，超出标记 `truncated`） |
| `service/probe` | 状态机 `draft → running → done`；**零回注不变量**：探针 result **绝不**作为 tool result 返回（对每条出口路径断言）；预算熔断 → 产出标记 `incomplete` 而非丢弃；父子归属（探针必挂顶点下，不允许成为根） |
| `host/probe` | `startActivation` 装配：`delivery` **不得为 `parent`**（否则结果回注）；`contextMode: spawn` 为默认；`reference` 档的单向读入不写回 |
| `tools` | `team_probe(question, opts?) → {probeId}` 与 `team_peek(probeId, {maxTokens?})` 的 schema 边界；`team_status` 返回可枚举句柄列表（silent 档的发现路径）；memory 作用域：**P5 只允许 leader 侧发起**（member 发起留 P6 评估，见 §4 T-6 的同一根因） |
| `client` | 探针名册纯 props 视图（与成员同册、分组与权重区分）；`tick` 一行痕迹（含「未回注 · echo_ratio」） |
| 端到端 | 假 LLM 跑一个消耗 5 万 token 的探针，断言**父会话上下文增长 0**（NFR-13 的可复现形式） |

**实现交付**：

- `kernel/probe/`（纯函数：echo 策略、句柄、截断、ratio）
- `service/probe.ts`（创建 / 运行 / 落档 / 句柄注册表；**零回注不变量写在模块顶部并配断言**）
- `host/provider.ts` 增补：探针走**同一 provider**（路线 A），但 `delivery: 'caller'` + 不 await 结果
- `tools/team-probe.ts`、`tools/team-peek.ts`
- `client/ProbeRoster.tsx`、`client/ProbeTickLine.tsx`（纯 props，接线在 P7）
- 客户端面板注册沿用 P4 的两阶段注册（`sidebarRightTabs.register` + `slots.inject`）

**出口标准**：

1. AC-1 / AC-2 / AC-3 各有一条**自动化断言**，并且能在真机（scratch profile）复现；
2. `echo_ratio < 1%`（handle 档）在测试里有数值；
3. `pnpm verify` 全绿；新增测试全部先红后绿（提交成对 `test:` / `feat:`）；
4. 真机：在 Web profile 起一个 T0 会话、跑一次探针、读台账新增 `probe.*` 事件。

---

### P6 · 探针生命周期

**目标**：AC-4（丢弃与遮蔽可区分）与 AC-5（一等呈现 + 晋升通道）。

**先写的测试**：

| 主题 | 测试 |
| --- | --- |
| 七状态机 | 全部合法转移 + 非法转移拒绝（`discarded` 不可逆；`promoted` 是出口而非回边） |
| 四级丢弃 | L1 不取回（零动作，句柄自然过期）；L2 遮蔽（可恢复、**不修改会话日志**）；L3 撤销采用；L4 硬删（二次确认 + 悬空引用检测） |
| 权限 | **模型不得自我遮蔽 / 硬删**（请求被拒并留痕）；恢复权归人；晋升只能由人发起、模型只能建议 |
| 审计 | `probe.shadowed` 与 `probe.discarded` 必须可区分；事件 append-only、不写正文 |
| 配额 | 并发上限（默认 3）、模型发起配额（每会话/每轮）、成本单列 |
| 晋升 | 探针 → 常驻成员：创建真 Vertex + 摘要/溯源迁移为初始记忆；成员 → 探针语义（降级对称） |

**实现交付**：

- 状态机 + 遮蔽原语接入（**优先 `SurfaceOp.replace` 单节点替换**，不依赖 `ctx.compaction`——宿主平面不可用）
- 审计事件族（`probe.shadowed` / `probe.unshadowed` / `probe.promoted` / `probe.discarded`）
- 探针详情浮层（`shell.overlay`）：摘要 / 全文 / 溯源 / 成本 / `[取回] [晋升] [丢弃 ▾]`
- 入口交互（借划词解读的四条：隐式入口 / 就地小窗 / 引用 / 回到刚才）

**出口标准**：

1. AC-4 / AC-5 有断言；遮蔽可恢复且日志完整可回放（NFR「遮蔽不破坏日志」）；
2. **平台风险判定**：单条粒度遮蔽在 `startSeq === endSeq` 下可用，且「摘要落在 tool call/result 之间」的拒绝边界有明确处理（这是本阶段唯一的 Go/No-Go，不通过则降级为「L2 仅在纯文本段落可用」并在计划里改需求口径）；
3. 真机：遮蔽一条已取回摘要 → 模型看不到、UI 可查可恢复。

---

### P7 · 校准闭环与运行期能力

**目标**：把「说了但没做」的与「做了但没接上」的一批债一次还清（这也是诚实把技术债写进计划的理由）。

**四项并列交付**：

| 项 | 内容 | 对应 |
| --- | --- | --- |
| ① 校准闭环 | `suggestions.jsonl`（建议 → 采纳值差异）+ 周期性校准报告（哪些维度总被上调/下调）；可选 LLM 精修，**失败回落启发式** | FR-B5 / D-6 |
| ② UI 数据桥 | 宿主侧把 `ConcourseService` 快照登记为会话投影（`ctx.sessionProjections.stateOf(session,'concourse')`），客户端面板改读投影而非空视图 | 已知残留 #3 / `src/client/BRIDGE.md` |
| ③ 静默判定 | quiescence：连续 K 轮无新增事实 → 冻结信道，后续只入板（纯函数 + 台账） | FR-C8 |
| ④ 运行期能力 | 飞行中改拓扑（走 P5 确认清单）；`contextMode: fork`（父历史 seed）；`edge.budget` 回填；catalog `tier` 数据源或本地映射表 | 残留 #4 #6 / 需求 §2.2 |

**出口标准**：校准报告能回答「哪些维度的建议总被下调」并给出数字；面板显示的是**运行期真实状态**（不是 props 假数据）；quiescence 有正反例各一组。

---

### P8 · 会话加入 / T2a

**目标**：FR-A3。这是**唯一**的拓扑升级路径，也是「用户作为最高指挥官」的落点。

**先写的测试**：`team_join(sessionId, role)` 的两种角色（子节点保持 T1.5 / 平级领队升级 T2a）；加入对象必须**已存在且非本次派生**（`origin: joined` 校验）；根间边只承载通报与协商（**断言平级领队之间无法互相指派任务**）；升级需二次审批且由**用户主动发起**；并发上限（`maxActiveSubagents = 8`）在计划期校验并给降级建议。

**实现交付**：`team_join` 工具 + 会话身份面接入（残留 #5 的根因）+ T2a 端到端样例。

**出口标准**：T2a 端到端跑通；平级互派被硬拒绝；加入流程不产生系统打断（只有用户主动触发的一次审批）。

---

### P9 · 发布准备

**目标**：让这个包对外可发、可装、可回滚。

**清单**：

1. peer / `engines.dsh` **区间化**（技术债 T-1），并对当前宿主版本验证宿主缝仍成立；
2. 覆盖率切换为**按层阈值**（T-9）；
3. README 双语与 `docs/` 完成度复核（需求 → 计划 → 实现三者一致）；
4. npm publish 决策（当前只从 tarball 安装；`publishConfig.access = public` 已就位）；
5. 卸载/残留自检：删 bundle 行 + 删台账目录后无残留文件、无孤儿注册。

---

## 3 · 测试策略

### 3.1 TDD 工作流（硬性，`COLLABORATION.md` §3）

1. 每个阶段开工的**第一个提交**是 failing tests（提交信息 `test: …`）。
2. 实现提交（`feat: …`）使测试转绿；禁止"先实现后补测"。
3. 重构仅在绿灯下进行。
4. 每阶段末跑 `pnpm verify` 后才算完成。

### 3.2 测试分层

| 层 | 对象 | 技术 | 目标覆盖率 |
| --- | --- | --- | --- |
| L1 纯单测 | `src/kernel/**` | vitest 参数化 fixtures；确定性（注入时钟/seed，禁真实计时器） | **≥ 90%** |
| L2 契约测试 | `src/host/**` + `test/fakes` | fake 钉死宿主已观测语义（`startActivation` 返回句柄、`deliver:'parent'` 回注、`restrict` 收口） | ≥ 70% |
| L3 集成 | `src/service` + `src/tools` + fakes | 生命周期、**绕过矩阵**、探针零回注不变量 | ≥ 80% |
| L4 客户端 | `src/client` | jsdom 渲染 + 形状结构断言 | ≥ 60% |
| L5 真机冒烟 | 整体 | scratch profile 装包跑样例（半自动 checklist） | 每个版本必过 |

> **现状**：`vitest.config.ts` 仍是全局 90% 四指标阈值，按层阈值列为 T-9。现状优先于理想，不为对齐文档而改动门禁。

### 3.3 不容妥协的三组测试

1. **NFR-9 绕过矩阵**（`test/tools/bypass-matrix.test.ts`）：四条入口（`team_send` / service 直调 / 伪造直发 / 裸 `createRuntime`）发闭边消息，全部被拦或留痕。
2. **探针零回注不变量**（P5 新增）：每一条可能把探针产出返回给模型的路径都要有断言。
3. **形态红线**：`check-no-assets`（零图片零 emoji）、`check-boundaries`（kernel 零宿主依赖）、`inject` 声明与 `defineTool` 闭合 output schema 的契约测试。

---

## 4 · 技术债与规范对齐（T-\*）

| ID | 债务 | 现状 | 影响 | 处置 |
| --- | --- | --- | --- | --- |
| **T-1** | `engines.dsh` 与 6 个 peer 精确钉 `0.2.1-rc.2` | 与规范「区间化」相反 | 每次宿主小版本升级都要整栈对齐 | P9；改造前先验证宿主缝 |
| **T-2** | `contextMode: fork` 未实现 | provider 只贡献空 seed | 无法「带父记忆起新顶点」 | P7 |
| **T-3** | UI 数据桥未接线 | 面板以纯 props 渲染占位 | 面板不显示真实状态（**用户可见缺陷**） | P7（最高优先） |
| **T-4** | `edge.budget` 不回填 | kernel 无边粒度估算函数 | 计划卡显示的边预算与实际熔断账不同源 | P7 |
| **T-5** | 顶点生命周期不回推 concourse 状态 | 无宿主完成事件订阅 | 任务完成后仍显示 running | P7 |
| **T-6** | per-child 工具分流注册未接线 | `resolveScope` 有单测，宿主无身份面 | 子节点可能拿到全量工具（FR-A4 的"部分"） | P7/P8，阻塞点在宿主 |
| **T-7** | `catalog` 无 `tier` 数据源 | 宿主目录不提供价位档 | `suggest` 的 cheap/premium 池常空、走回退 | P7（本地映射表） |
| **T-8** | `create` 事件内嵌整份 spec | 台账随任务文本线性膨胀 | 长任务下台账体积大 | P7（快照文件 + 哈希引用） |
| **T-9** | 覆盖率按层阈值未启用 | 仍是全局 90% | 与 §3.2 表不一致 | P9 |
| **T-10** | 静默判定（quiescence）缺失 | 无模块 | 无法终止"礼貌性互推" | P7 |

---

## 5 · CI 门禁（`pnpm verify` 串起全部）

| 门禁 | 命令 | 对应 |
| --- | --- | --- |
| 构建 | `pnpm build`（tsdown：宿主 + 客户端双入口） | 产物完整性 |
| 类型 | `pnpm typecheck`（tsc） | — |
| Lint | `pnpm lint`（oxlint） | — |
| 模块边界 | `pnpm check:boundaries` | kernel 零宿主依赖、依赖方向单向 |
| 零美术资产 | `pnpm verify:assets` | NFR-3 / P1 |
| 测试 + 覆盖率 | `pnpm test:coverage` | §3.2 |
| 打包冒烟 | `pnpm pack:smoke`（pack → 临时目录安装 → import 入口） | 打包完整性 |

> 语料回归（`scripts/corpus-regression.mjs`）当前由测试驱动执行，报告写入
> `docs/corpus-regression-P1.md`（**只写仓库相对路径**，不写绝对路径）。P7 把它并入 `verify`。

---

## 6 · 仓库结构与模块边界

```
dsh-agent-teams-concourse/
├── cordis.patch.yml · package.json · tsdown.config.ts · vitest.config.ts
├── README.md · README.zh.md · COLLABORATION.md · DEVELOPMENT_PLAN.md · CHANGELOG.md
├── src/
│   ├── kernel/                 ★ 纯函数内核（零宿主依赖，CI 硬门禁）
│   │   ├── topology/   schema · validate · tier · edges · issues
│   │   ├── profile/    profiler · suggest
│   │   ├── comms/      gate · hop · dedup · rate · budget
│   │   ├── budget/     tokens
│   │   ├── glyphs.ts                 形状符号表（client 复用）
│   │   └── probe/      ★ P5 新增：echo · handle · truncate · ratio
│   ├── host/                  宿主稳定面适配（路线 A）
│   │   ├── contracts.ts       共享类型契约
│   │   ├── substrate.ts       startActivation / deliver / interrupt（含 degraded 模式）
│   │   ├── provider.ts        concourse provider（continuable-only，spawn seed）
│   │   └── catalog.ts         provider/model/effort 枚举 + fail-loud
│   ├── service/               领域服务
│   │   ├── concourse.ts       生命周期 draft→pending-approval→running→archived
│   │   ├── inbox-gate.ts      收件箱准入（权威判定：gate→hop→dedup→rate→budget）
│   │   ├── ledger.ts          决策台账 + 通信流水 + 回声计数
│   │   ├── persistence.ts     JSONL 追加日志 + 回放
│   │   └── probe.ts           ★ P5 新增
│   ├── tools/                 team_* 工具组（按身份作用域分流）
│   │   └── team-probe.ts · team-peek.ts    ★ P5 新增
│   ├── client/                React 18 面板（纯 props 视图 + 两阶段注册）
│   └── index.ts               cordis 入口（惰性安装，apply 内每步 try/catch）
├── test/                      与 src 镜像 + fakes + fixtures（拓扑矩阵 / 脱敏语料）
├── scripts/                   check-boundaries · check-no-assets · corpus-regression · pack-smoke
├── docs/                      REQUIREMENTS.html · 两份调研底稿 · decisions/ · spikes/
└── research/                  13 份竞品与平台原语底稿
```

**依赖方向（`check-boundaries.mjs` 强制）**：
`kernel →（无宿主依赖）`；`host → kernel`；`service → host + kernel`；`tools → service`；
`client → kernel/glyphs + 独立声明的视图类型`。反向 import 即构建失败。

---

## 7 · 风险登记

### 7.1 沿用项（状态已更新）

| ID | 风险 | 状态 | 缓解 |
| --- | --- | --- | --- |
| R-1 | 官方基座漂移（experimental，无废弃信号） | **已降级**（路线 A 只依赖四个稳定面） | `substrate.ts` 薄适配 + degraded 模式；升级前 `--dump-config` 闸门 |
| R-2 | 官方自己补上嵌套团队 | 长期 | 重心放在官方不会做的部分：反拟人化 UI、成本治理、飞行中改拓扑、建议校准 |
| R-3 | 并发 8 / 深度 1 上限偏紧 | 活跃（P8 前必须解决） | 计划期容量校验已实现；T2a 提供降级到 T1b 的建议路径 |
| R-4 | 硬约束误伤合法协作 | 中 | 约束计划期可见可调；每次拒绝留痕（否则用户以为消息丢了） |
| R-5 | 建议校准失败（auto-router 前车之鉴） | **部分缓解**（语料 effort 96.3% / ±1 100% / tier 98.1%） | 校准闭环 P7；阈值只用回归结果标定 |
| R-6 | 与已装插件命名冲突 | **已收敛** | `team_*` 短前缀逐个核对无重名；与官方 `team_task_*` 靠 description 边界约定消解 |
| R-7 | 纯文字 UI 表达力上限（>20 顶点） | 中 | P4 渐进披露 + 按子树折叠；保留纯文本导出 |
| R-8 | 闸门无法落在宿主服务层 | **已解** | 权威判定在收件箱准入（与发送方解耦）；绕过矩阵钉死 |
| R-9 | provider 钩子链路未实测 | **已解除**（证伪 → 路线 A） | 结论与证据在 `docs/spikes/R-9-provider-hook.md` |

### 7.2 探针新增（P-\*）

| ID | 风险 | 影响 | 缓解 |
| --- | --- | --- | --- |
| P-R1 | **零回注纪律被破坏**：某条路径把探针 result 当 tool result 返回 | AC-1 直接失败，整条需求失效 | 把「绝不返回探针产出」写成模块硬不变量 + 每条出口配断言；`delivery` 禁止 `parent` |
| P-R2 | **单条粒度遮蔽不可得**，或摘要落在 tool call/result 之间导致配对不平衡被拒 | AC-4 降级 | P6 先做最小原型再动规格；降级方案 = 「L2 仅在纯文本段落可用」并改需求口径 |
| P-R3 | 模型把主线任务偷偷外包给探针 | "看起来交付了、实际是旁路产物" | FR-D20 明令禁止 + 配额 + UI 上探针产出与交付物视觉区分 |
| P-R4 | 句柄过期造成悬空引用 | 上下文引用了不存在的产物 | 过期只清全文、保留摘要；过期句柄在 UI 显示为灰色不可点 |
| P-R5 | `tick` 行被自动压缩掉，模型丢失"这里有句柄"的记忆 | 探针白跑 | 句柄注册表独立于对话流；`team_status` 始终可枚举 |
| P-R6 | UI 安装约束：客户端模块扫描只扫宿主 Loader 的行 | 面板在"预设"分发下不可见 | 宿主半边负责全部 UI 挂载，预设只做配置 |
| P-R7 | 摘要质量不足导致取回后仍需探索 | 污染没省掉 | FR-D9 溯源保留 + 摘要须标注覆盖范围 |

---

## 8 · 版本节奏

| 版本 | 内容 | 是否需要批准 |
| --- | --- | --- |
| `0.2.0` | 已发布（运行时适配 + 6 问题修复）。 | — |
| `0.2.1-rc.2` | T0–T4 通信与状态可信性修复（本轮，含 Web 发现的归属修复） | 不需要（第三位） |
| `0.3.0-rc.1` | P5 探针 MVP | **需要**（动第二位） |
| `0.3.x-rc.N` | P6 修正与遮蔽降级 | 不需要 |
| `0.4.0-rc.1` | P7 + P8 | **需要** |
| `1.0.0-rc.1` | 对外稳定承诺 | **需要**，且须先完成 P9 |

版本号规则、tag 时机、CHANGELOG 义务见 `COLLABORATION.md` §2。

---

## 9 · 已知残留登记（必须公示）

> 口径：现象 / 影响 / 缓解 / 归属。上游问题与本项目问题分开定性。

| # | 现象 | 影响 | 处置 |
| --- | --- | --- | --- |
| 0 | 重启后目标子 Agent 未 live，`team_send` 返回 `TARGET_UNAVAILABLE`（不伪造成功；cold-resume 投递未接线） | 跨重启直接追消息不可用 | 已登记，恢复冷启动留待后续 |
| 1 | 顶点任务完成后 concourse 仍显示 `running`（无宿主完成事件订阅） | 面板状态滞后 | T-5 / P7 |
| 2 | 顶点拉起时的 prompt 即首任务，`team_send` 只用于后续追加 | 与"先建队再派活"的直觉不同 | 接受，用户文档明示 |
| 3 | UI 数据桥未接线，面板以纯 props 占位 | **面板不显示真实状态**（用户可见） | T-3 / P7 最高优先 |
| 4 | `edge.budget` 不回填 | 计划卡边预算与实际熔断账不同源 | T-4 / P7 |
| 5 | 子节点工具分流注册未接线 | 子节点可能拿到全量工具 | T-6 / P7-P8，阻塞点在宿主身份面 |
| 6 | `catalog` 无 `tier` 数据源 | cheap/premium 目标档候选池必空、走回退；`tier` 目前只是标签 | T-7 / P7（本地映射表） |
| 7 | 未知字段守卫（did-you-mean）真机不可达 | Web GUI 在 `execute` 前按 schema 归一化入参，笔误降级为"缺字段" | **上游行为**，结案；离线/直调路径仍有 17 条测试覆盖 |
| 8 | `toolFilter` 改为挂载后收口（0.2.1 起 start 期不再接受） | 与声明式透传相比有毫秒级生效窗口 | 接受（`D-P3-runtime-0.2.1`）；失败即 dispose + fail-loud |
| 9 | `inject` 新增 `agents` | 宿主缺该服务时插件按 cordis 语义不激活（fail-loud，不静默降级） | 接受 |
| 10 | `create` 事件内嵌整份 spec | 台账随任务文本线性膨胀 | T-8 / P7（快照 + 哈希引用） |
| 11 | `contextMode: fork` 未实现 | 不能"带父记忆起新顶点" | T-2 / P7 |
| 12 | 静默判定（quiescence）未实现 | 无法终止"礼貌性互推" | T-10 / P7 |
| 13 | 探针（FR-D 全 20 条）未实现 | 第二册需求整体未交付 | P5 / P6 |

---

## 10 · Git / GitHub 与权限

| 操作 | 授权状态 | 内容 |
| --- | --- | --- |
| 本地 git | ✅ 已授权 | `main` 单主干；Conventional Commits；`test:` / `feat:` 成对体现 TDD；每次交付末提交 |
| **建仓** | ⛔ **执行前报批** | `gh repo create neo805/dsh-agent-teams-concourse --public --source=. --remote=origin`（gh CLI 已登录 `neo805`，repo scope 齐备；`package.json` 的 `repository` 字段已就位） |
| **push / tag** | ⛔ **逐次报批** | 建仓后首次推送；此后每次 push、打 tag 都须出品人明确批准。**tag 只在批准 push 时一并创建** |
| npm publish | ⛔ 不在本计划内 | 需要时另议（P9 决策点） |

`.gitignore`：`node_modules/` · `dist/` · `coverage/` · `tmp/` · `*.tgz` · `*.local` · `.dsh-test-profile/` · `.tmp-*` · `.pnpm-store/`。

---

## 11 · 命名与版本钉死清单（实施时照此执行，不再临时决策）

- 包名 `dsh-agent-teams-concourse`；provider 名 `concourse`
- 工具：`team_topology / team_plan / team_assign / team_link / team_send / team_status`（已实现 6 个）
  + `team_join`（P8）+ `team_probe / team_peek`（P5）
- 子节点最小工具集：`team_send` + `team_status`（P5 起评估是否加 `team_probe`）
- 与官方 `team_task_*` 的边界约定（写进每个工具 description）：
  **concourse 管拓扑与路由，官方管成员与任务**
- 依赖：`zod ^4.4.3` · `@deepseek-ai/schemastery ~3.18.4`；devDeps 见 `package.json`
- peer / engines：**目标写区间**（`COLLABORATION.md` §2），当前精确钉 `0.2.1-rc.2`，区间化见 T-1
- 事件命名：`concourse.*` / `vertex.*` / `comm.*` / `budget.*` / `probe.*`（见需求 §6.3）
- 台账：JSONL append-only，路径由配置 `storagePath` 决定（不入库）

---

*本计划经出品人评审后生效。阶段出口标准的任何放宽（尤其探针零回注不变量与绕过矩阵）需显式记录于 `docs/decisions/` 并同步进需求文档。*
