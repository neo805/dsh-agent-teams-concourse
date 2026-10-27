# dsh-agent-teams-concourse · 开发计划

|  |  |
| --- | --- |
| 计划版本 | **v2.7**（2026-10-27）· 取代 v2.6（2026-10-27） |
| 需求依据 | `docs/REQUIREMENTS.html` v2.0（唯一需求依据） |
| 协作规范 | `COLLABORATION.md` v2.0（角色、版本、验证阶梯、交付清单） |
| 输入 | 两份调研底稿（`docs/*-report.html`）· 13 份 research 底稿 · P0–P4 开发会话与真机测试记录 · 第 4–7 期第三方全景审计（2026-10-25） |
| 当前版本 | `0.2.1-rc.8`（0.1.0 = MVP 出口；0.2.0 = 运行时适配 + 真机 6 问题修复；0.2.1-rc.2 = T0–T4 可信性修复；rc.3 = 契约/通信/回放一致性硬化；rc.4 = 侧栏可发现性与自动打开；rc.5 = 通信/路由/UI 身份正确性与工程门禁加固；rc.6 = 硬化出口 + H3.0 协议；rc.7 = wake/全局唤醒预算/自环语义修复；rc.8 = 官方路径 wake 闭环 + 审查后实证修复） |
| 基线环境 | DSH `0.2.1-rc.2` · Node `^22.19 || >=24` · pnpm 11.7 · 测试 **60 文件 / 480 测试** |
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
| **H2** | **契约、通信与回放一致性硬化 + 侧栏可发现性** | `0.2.1-rc.4` | ✅ 已完成 | 417 测试 + 严格门禁 + Web 实机 |
| **H2.5** | **通信/路由/UI 身份正确性与工程门禁加固** | `0.2.1-rc.5` | ✅ 出品人验收通过 | 448 测试 + pack/plugin 自查 + Web/Desktop 实机验收 |
| **H2.6 / H3.0** | **硬化出口：协议先行 + 不变量测试 + 限流/契约收口** | `0.2.1-rc.6` | 🟨 代码/单测/全门禁/Web 实机完成；Desktop 已装 disabled，待出品人验收 | H3 ADR + 模型/对拍测试 + RateLimiter 有界化 + 全验证阶梯 |
| **H2.7 / RC7** | **通信语义断点修复：wake / 全局唤醒预算 / 运行期自环** | `0.2.1-rc.7` | 🟨 代码/单测/全门禁/Web 实机完成；Desktop 已装 disabled，待出品人验收 | 468 测试 + wake/账域/replay 不变量 + Web/Desktop 阶梯 |
| **H2.8 / RC8** | **审查后实证修复：官方路径 wake 闭环 + 限流/容量/身份/留痕** | `0.2.1-rc.8` | 🟨 代码/单测/全门禁/Web 实机完成；Desktop 已装 disabled，待出品人验收 | 480 测试 + 官方两轮票据 + 乱序对拍 + 完整阶梯 |
| **P5** | **旁路探针 MVP**（隔离 / 摘要 / 句柄 / 回注档） | `0.3.0-rc.1`？ | ⬜ 待 H2.6 与版本批准 | AC-1 / AC-2 / AC-3；不另建事务路径 |
| **H3.1** | **事务/恢复实现与故障注入** | `0.3.x-rc.N` | ⬜ 待 P5 | 崩溃窗口对账 + live/replay 等价 + torn-tail 策略 |
| **P6** | **探针生命周期**（七状态 / 四级丢弃 / 遮蔽 / 晋升） | `0.3.x-rc.N` | ⬜ 待 H3.1 | AC-4 / AC-5 |
| **P7** | **校准闭环 + 运行期能力**（诚实：四项技术债一起还） | `0.4.0-rc.1`？ | ⬜ 未开工 | 校准报告 + 面板读真实投影 + 静默判定 |
| **P8** | **会话加入 / T2a** | `0.4.x-rc.N` | ⬜ 未开工 | T2a 端到端 + 平级不可互派 |
| **P9** | **发布准备**（区间化 / 按层阈值 / npm 决策） | 待定 | ⬜ 未开工 | 可发布且可回滚 |

> 「？」= 需起第二位版本号时**必须先报出品人批准**（`COLLABORATION.md` §2）。

### 0.1 为什么 rc.6 后先收口 rc.7，再进入 P5

第三方全景审计确认：项目没有「修好 A 后 A 又复发」的振荡，但存在同一不变量族被多轮局部修复的**同族窄化循环**；测试与门禁曾围绕实现形状而非语义闭环。基于这一事实，本计划作如下取舍：

1. **H3.0 排为 rc.6 首项，但不把完整 H3 实现前置。** 先写事务/恢复 ADR、确定不变量与故障场景，避免 P5 在共享投递/持久化路径上另造一套协议；完整实现放在 P5 后、P6 前，防止功能主线被无限硬化阻塞。
2. **rc.6 仍是最后一轮泛化硬化；rc.7 是实证违约的窄修复，不是新一轮硬化。** 审查确认 `wake` 未落到宿主调用、全局熔断误伤 never/board、运行期自环绕过计划期校验；这些问题直接影响既有 FR，必须先修。Catalog 并发、AgentDirectory、suggest 线性化、fixture 合并等优化仍不进入 rc.7。
3. **P5 仍是下一项功能主线。** 它在 T0 即可成立、实现面小且平台可行性已证实；rc.7 验收并取得第二位版本号批准后进入。TTL/correlation 的可信链元数据缺口登记为 H3.1，不在 P5 前另造第二套协议。
4. **不把预期失败测试当作债务停车场。** 当前承诺行为必须有真实全绿测试；尚未实现的 H3.1 场景先写在 ADR 与残留表，不能以 xfail 冒充交付或弱化 `verify` 的出口含义。

### 0.2 为什么 rc.7 后先做 rc.8，而不是直接进入 P5

rc.7 完成后的常规代码审查发现三类实证问题：官方/裸 `sendMessage` 仍绕过 wake/degrade 的不唤醒语义；rc.6 有界 `RateLimiter` 在乱序时间戳下与旧参考发散；容量、身份与留痕存在局部缺陷。它们都不是新功能，也不属于已登记的 H3.1 恢复实现，因此先以 `0.2.1-rc.8` 做窄修复，再看 P5。

rc.8 **不**提前 Catalog 并发、AgentDirectory、suggest/validate/UI 线性化、测试夹具合并或发布物裁剪；这些仍等待基准、P7/P8 或 P9。也不把“重排成功后写盘失败”“重启票据恢复”包装成本轮已解决：二者继续归 #15/#16。

---

## 1 · 阶段路线总览

```
P0──P1──P2──P3──P4──[0.1.0 MVP]──[0.2.0 运行时适配]
                                        │
                              H1──H2──H2.5──H2.6 / H3.0──H2.7 / RC7──H2.8 / RC8
                                                                        │
                                                                        ▼
                                                                 P5 探针 MVP
                                              │
                                              ▼
                                   H3.1 事务/恢复实现
                                              │
                                              ▼
                                   P6 探针生命周期
                                              │
                              ┌───────────────┴──────────────┐
                              ▼                              ▼
                       P7 校准/运行期能力              P8 会话加入 / T2a
                              └───────────────┬──────────────┘
                                              ▼
                                        P9 发布准备
```

依赖关系（硬）：

- **H3.0 先于 P5**：ADR 必须定义 delivered / consumed / recovered、崩溃窗口、dedup/admission 回放与 torn-tail 口径；P5 复用同一路径，不另写事务协议，也不在 H3.1 前宣称 exactly-once 或完整崩溃恢复。
- **H3.1 在 P5 后、P6 前**：用真实探针事件检验协议，再完成故障注入、对账与恢复实现；P6 的七状态与遮蔽不得建立在未对账的存储语义上。
- **P5 之前不再改 `team_*` 工具语义**。rc.7 只按既有 FR 修复 wake 投递、全局唤醒预算与自环校验；P5 本身不扩工具语义。探针复用顶点注册表、名册、预算与台账，不另做综合重构。
- **P6 依赖 P5 的句柄与存储**；遮蔽依赖平台原语（`SurfaceOp.replace`），有独立 Go/No-Go 判定。
- **P7 与 P5/P6 互不阻塞**，但校准闭环要在探针有真实使用数据之后才有意义；UI 数据桥是 P7 里唯一会动 P4 产物的项。
- **P8 最后**：T2a 需要「已存在会话加入」，而当前连"第二个会话"的身份面都没有；且宿主 `maxActiveSubagents = 8` 对 T2a 偏紧，需先确认配置覆盖方式。

---

## 2 · 阶段详述

> 每阶段四件套：**目标 / 先写的测试 / 实现交付 / 出口标准**。工期不再给日估——按版本节奏推进，一个阶段对应一次交付。

### H2.6 / H3.0 · 硬化出口与事务协议先行

**目标**：用一次窄范围交付结束连续硬化：先把事务/恢复语义写成可评审协议，再以不变量测试约束已实现行为；只修通信核心限流与明确的工程契约，不开启新的综合优化阶段。

**范围约束**：H3.0 交付 ADR、模型/对拍测试与故障场景，**不交付完整崩溃恢复**，不宣称 exactly-once。H3.1 才实现协议。首个 Git 提交仍须是 failing tests；ADR 草拟可与测试准备并行，但不得以文档先行绕过 §3.1。

**施工 todo（DeepSeek 按顺序执行）**：

| ID | 技术路线 | 验收目标 |
| --- | --- | --- |
| **RC6-1** | 起草 `docs/decisions/D-H3-transaction-recovery.md`：统一 delivered / consumed / recovered，逐项覆盖 #14–#19、#21 的崩溃窗口、事件归属、对账、dedup/admission 回放与 torn-tail；附 rc.3–rc.5 修复复核矩阵和 P5 禁止另建事务路径的约束。 | ADR 能回答每个崩溃点「谁已可见、谁已扣账、重启后如何对账」；明确 H3.1 前能力降级与禁止声明，不留待临时决策的开放语义。 |
| **RC6-2** | 先写确定性的模型/参考对拍：RateLimiter 的 `check / wouldDegrade / reset`、dedup 完整 tuple、当前承诺范围内的 live/replay 等价；本轮触及的门禁规则各补一个 known-bad 语义 fixture，并把 RC6-4 的 React 主版本一致断言提前到首个红灯提交。覆盖 rc.5 修复，而非只测新实现。 | 测试由输入不变量驱动，固定序列含乱序时刻、窗口边界、碰撞与特殊 id；不引入大型 fuzz 依赖，不含 xfail。React 类型断言在当前基线必须变红，确保首个测试提交有真实红灯证据。 |
| **RC6-3** | 在参考模型保持绿灯后，把 `RateLimiter` 改为至多保留 `n` 个有效判决时间戳的有界结构，消除 `check / wouldDegrade` 对全部历史窗口的两次 `filter`；保留 degrade 计戳、预检不消费与显式 `at` 语义。 | 新旧实现对拍结果完全一致；单次成本不再随历史消息总数增长，连续 degrade 不造成无界窗口。记录同一本地风暴基准的前后数据，不设 CI 墙钟阈值。 |
| **RC6-4** | 复用 RC6-2 已变红的 React 主版本一致断言，将 `@types/react(-dom)` 对齐 18.x；按规范同步 lockfile，不改变 React 运行时。 | 依赖安装复现、`typecheck`、`verify` 全过；运行时仍为 React 18.x，未通过放宽 `strict` 消除错误。 |
| **RC6-5** | 删除 `verify` 外层预构建，顺序调整为静态检查 → `test:coverage`（`globalSetup` 唯一构建）→ assets → pack-smoke；保留独立 `pnpm test` 强制新构建与 worker 只读产物。 | `verify` 日志只有一轮 tsdown；assets/pack 消费当次新产物，独立测试不验证陈旧 `dist`，不恢复 worker 并发构建。 |
| **RC6-6** | 更新版本、CHANGELOG、双语 README、测试基线与残留表；同步 rc.5 已验收事实和本计划的 H3.0/H3.1 分工，随后执行完整验证阶梯。 | `pnpm verify` 全绿、四项覆盖率 ≥90%、语料不回退；pack/plugin 自查、Web 实机通过，Desktop 安装后保持 `disabled` 交出验收。不得补写无法复核的实机证据。 |

**出口标准**：RC6-1…RC6-6 全部完成；H3.0 仅承诺协议与当前行为可信性，不把 ADR 当成恢复实现。验收后冻结本轮硬化范围，直接申请 P5 / `0.3.0-rc.1` 的第二位版本号批准。

**验证记录（2026-10-25）**：

- 首个测试提交红灯：`4 failed / 22 passed`（React 主版本、verify 双构建/顺序、RateLimiter 10,000 戳无界）。
- `pnpm verify`：**60 文件 / 456 测试全绿**；coverage statements/lines `98.42%`、branches `90.92%`、functions `99.09%`。
- 单次构建已证实：verify 输出只有 `test:coverage` 内的 globalSetup 一轮 tsdown；pack-smoke 与零资产通过。
- H3 ADR：`docs/decisions/D-H3-transaction-recovery.md`；仅协议，不宣称崩溃恢复。
- Web profile：rc.6 安装 17/17 文件 SHA-256 一致；`--dump-config` 退出 0，concourse 行启用；裸 import `apply`/`inject` 正常。
- Web 实机（`session-446b9632-edeb-4d82-900d-75c83aefb18b`，port 53179）：六步 `team_plan → team_assign → team_send → team_link(close) → team_send(reject) → team_status` 完成；child `1ed49c98-b967-49d5-9049-9677f087fe35`；台账 13 条，`deliver=2`、`reject=1(EDGE_CLOSED)`，预算先后 3/86 tokens 各扣一次；文件 SHA-256 `6E29E5CF…A9325`、2909 bytes。最终 child 应答已回到 lead。
- `plugin_check --profile web` 仅报告既有 `dsh-excel-chat` 的 npm 版本依赖问题；concourse 未报问题。
- Desktop：`plugin_manager` 从最终 tarball 安装 rc.6，17/17 文件哈希一致；`include:concourse` 最终 `enabled:false`、`fiberPhase:null`，patch 为 `disabled:true`。未重启 Desktop，视觉/功能验收留给出品人。
- 标准 tarball 与安装专用 tarball SHA-256 同为 `DC1E8CDA…F073F863`；安装专用副本仅用于绕过 pnpm 同路径同版本不刷新文件的限制，内容完全一致。

**明确不进入本阶段**：Catalog 有界并发、AgentDirectory、suggest/validate/UI 投影线性化、mock fixture 合并、测试专用导出删除、发布物裁剪。它们分别等待基准证据、P7/P8 或 P9，不再成为 P5 前置条件。

---

### H2.7 / RC7 · 通信语义断点修复

**目标**：修复审查确认的三项既有 FR 违约——`wake` 未落到宿主唤醒参数、全局熔断误伤 `wake=never`/board、运行期开边绕过 `SELF_LOOP` 校验；不开启新的综合优化或硬化轮次。

| ID | 技术路线 | 验收目标 |
| --- | --- | --- |
| **RC7-1** | 先补穿过 service→substrate 的 wake 矩阵，再按 `verdict=deliver && plan.wake≠never` 计算宿主 `wakeup`。 | never/board/degrade 不唤醒；on-reply/always 唤醒；断言实际投递请求。 |
| **RC7-2** | 全局预算明确为主动唤醒账域：`BudgetBook` 增加缺省 true 的 `consumeGlobal`，AdmissionPlan 与两处扣账共用，`budget.consume` 落盘并由 replay 兼容旧事件。 | 全局熔断只拒 wake≠never；never/board 的边熔断仍生效；live/replay 全等。 |
| **RC7-3** | 在 `service.link` 写台账前拒绝 `action=open && from===to`，保留 close 清理历史坏数据。 | 工具与直调均返回 INVALID_SPEC，零 edge-open，拓扑不变。 |
| **RC7-4** | 修订 H3 ADR 的边账/全局唤醒账口径；登记 hops/correlation 可信链缺口到 H3.1 与残留表；同步 rc.7 版本与文档。 | 文档不再宣称 TTL/request-reply 具硬保证；需求范围不扩。 |
| **RC7-5** | 跑完整验证阶梯：verify、pack/plugin_check、Web 实机、Desktop disabled，再本地提交。 | 四项覆盖率 ≥90%，实机证据可复核，未经批准不 push。 |

**验证记录（2026-10-27）**：

- 红灯证据：RC7-1 `team-send` 2 failed（never/board 的实际 `wakeup` 为 true）；RC7-2 全局账域 3 failed；RC7-3 自环工具/直调各 1 failed。
- `pnpm verify`：**60 文件 / 468 测试全绿**；coverage statements/lines `98.44%`、branches `90.93%`、functions `99.09%`；boundaries/assets/pack-smoke 通过。
- 标准 tarball：17 文件，SHA-256 `E1AAEBCA…2BF40`；安装专用副本内容相同、哈希相同。
- Web：rc.7 安装 17/17 文件哈希一致；`--dump-config` 退出 0、concourse 行启用、裸 import 正常；`plugin_check` 未见 concourse 问题（仅既有 `dsh-excel-chat` 的 npm 依赖问题）。
- Web 实机（`session-ccb5a1b8-19c2-443f-ab54-419439aa2ec8`，port 62260）：`team_plan → team_assign` 成功；长任务 live child 下，never 投递为 `consumeGlobal:false`、on-reply 为 `true`（ledger seq 32–37）。全局熔断场景（seq 49–53）：on-reply `FUSE_GLOBAL`，随后 never 仍 `deliver` 且全局账未变；`team_status` 报全局熔断为“是”。`team_link` 自环返回 `INVALID_SPEC`，`edge-open=0`。
- 限制：child 自然结束后再次投递得到既有 `TARGET_UNAVAILABLE`（seq 55–56），因此未能用空闲 live child 直接观察 never/on-reply 的 turn 差异；该差异由 service/host 单测覆盖，不把本条实机结果升级为 wake 已验证。
- Desktop：rc.7 安装 17/17 文件哈希一致；`include:concourse` 为 `enabled:false`、`fiberPhase:null`，patch `disabled:true`；未重启 Desktop，视觉/功能验收留给出品人。`--dump-config` 被宿主拒绝仅因 Electron 管理 profile，不是插件失败。

**明确不进入本阶段**：TTL/correlation 实现（并入 H3.1 票据协议），以及 Catalog 并发、AgentDirectory、UI 数据桥、suggest 线性化等既有 P7/P9 项。

---

### H2.8 / RC8 · 审查后实证修复

**目标**：修复 rc.7 审查确认的官方路径 wake 断点、RateLimiter 乱序回归、self 容量误计、缺失发送者无留痕、创建时刻双读与失败发送身份副作用；不增加新功能，不提前 P7/P9 优化。

**施工 todo**：

| ID | 技术路线 | 验收目标 |
| --- | --- | --- |
| **RC8-1** | 官方/裸 `agent-message` 在 never/board/degrade 时生成 admission，克隆消息带 `source.concourse` 重排 `next-turn`；当前 pre-step 排除原文，requeue 成功后才 commit/admissions。 | 首次唤醒不进入模型请求；后续票据只消费一次；FIFO/混合批/requeue 失败覆盖；team_send 不回归。 |
| **RC8-2** | 删除 `RateLimiter.purgeFloor`；每次 check 都按当前 floor 清理现存 stamps，再做判定、插入与 largest-n 截断。 | 最小反例、`>=` 误修反例、短序列穷举与旧参考全等；窗口 ≤n。 |
| **RC8-3** | 容量只统计 `origin !== 'self'` 的顶点。 | self+8 spawned 通过、self+9 拒绝；自定义上限一致。 |
| **RC8-4** | 缺/非法 senderSessionId 仍移除消息，但写 `UNKNOWN_VERTEX` reject。 | reject=1、deliver/budget/admission 均为 0；其他路径不回归。 |
| **RC8-5** | `createdAt` 取 create 事件 `at`；审批前 self 识别用临时值，成功 commit 后才落 `rootSessionId`。 | 异时钟 live/replay 一致；失败发送不污染后续身份。 |
| **RC8-6** | 同步工具描述、文档、版本与验证阶梯；登记本轮不施工项。 | 480 测试、全门禁、pack/plugin_check、Web 实机与 Desktop disabled。 |

**明确不进入 RC8**：Catalog 并发与裸 model 多 provider 歧义、AgentDirectory、suggest/validate/UI 线性化、测试专用导出清理、BMP emoji 门禁扩展、H3.1 恢复/重启票据恢复。

**验证记录**：

- 红灯：RC8-1 6 failed、RC8-2 3 failed、RC8-3 1 failed、RC8-4 1 failed、RC8-5 2 failed；对应测试提交在实现前独立落盘，历史按 test/fix 成对保留。
- `pnpm verify`：**60 文件 / 480 测试全绿**；coverage statements/lines `98.26%`、branches `90.72%`、functions `99.09%`；typecheck/lint/boundaries/assets/pack-smoke 通过。
- 标准 tarball：17 文件，SHA-256 `E32189A9F3694F6D0928CB95AFF2146233B6C75296087A4D6954C6D95F177866`。
- Web profile：rc.8 安装 17/17 文件哈希一致；`--dump-config` 退出 0、concourse 行启用；裸 import 返回 `apply/inject` 正常；`plugin_check --profile web` 未见 concourse 打包问题（仅既有 `dsh-excel-chat` 条目）。
- Web 实机（lead `session-fe2d2f94-a383-42cf-bee7-a52a7c9906fe`，worker `69711f76-f6ff-4e5c-8595-2f0a4816112c`）：`team_plan → team_assign` 成功，worker 完成首任务并 idle。官方 `send_message` 发 `OFFICIAL_NEVER_MARKER_9137` 到 never 边后，worker 的 turn 2 以 `blocked` 结束、无 `request/header`；台账 seq 64–66 为唯一 deferred admit + deliver。随后 `team_link` 开 on-reply 边（seq 67）并 `team_send`（seq 68–70）显式唤醒；worker turn 3 才进入模型并看到官方标记，turn 4 看到 trigger；官方标记只出现一次，未见重复 admission 或扣账。rc8 台账共 20 条事件。
- 限制：Web 测试只覆盖本轮官方路径两轮与工具链；H3.1 的 commit 失败/重启票据恢复仍不在此证据范围。
- Desktop：rc.8 安装 17/17 文件哈希一致；loader entry `include:concourse` 为 `inactive`，patch 行 `disabled: true` 保持；`plugin_check --profile desktop` 未见 concourse 问题（仅既有 `dsh-excel-chat` 条目）。未重启 Desktop，视觉/功能验收留给出品人。
- 未执行：push / tag / 建仓。以上结果均为本地证据。

---

### P5 · 旁路探针 MVP

**目标**：AC-1（零污染）、AC-2（摘要默认不进上下文）、AC-3（模型可按句柄取回）三条判据可验收。

**前置约束**：H2.8 / rc.8 已验收，且出品人已批准第二位版本号。探针事件与句柄存储必须遵守 H3.0 ADR；不得另建投递/恢复协议，不得在 H3.1 前宣称 exactly-once 或完整崩溃恢复。P5 不新增多跳转发依赖；TTL/correlation 在 H3.1 前不构成硬保证。

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
4. 真机：在 Web profile 起一个 T0 会话、跑一次探针、读台账新增 `probe.*` 事件；
5. 探针复用 H3.0 规定的事件与提交边界，新增恢复场景全部登记为 H3.1 故障注入输入，没有第二套事务实现。

---

### H3.1 · 事务/恢复实现与故障注入

**目标**：把 H3.0 ADR 变成可恢复实现，并用 P5 的真实事件形态验证协议没有遗漏。

**先写的测试**：approve 各中断点的故障注入、post-delivery 写盘失败、create+submit 部分成功、dedup/admission 重放、torn-tail 隔离与对账；同一操作序列下 live 与恢复后的可见状态、预算和幂等结果等价。

**实现交付**：按 ADR 落地事件格式、恢复对账、幂等窗口与批量提交/快照策略；不得只调换 append 顺序或简单改异步来掩盖分叉。

**出口标准**：ADR 中每个崩溃场景都有自动化故障注入与恢复断言；P5 的 probe 事件同样通过；不静默丢弃坏行，不伪造 deliver，不宣称未覆盖的故障已解决。

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
5. 卸载/残留自检：删 bundle 行 + 删台账目录后无残留文件、无孤儿注册；
6. 类型消费冒烟：临时消费包 + `tsc` 验证 `./client` 的真实导出；修复空 dts 或移除误导的 types 条件，并精准裁剪开发专用产物，不能误删运行所需共享 chunk。

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

### 3.4 防止同族窄化循环

1. **每阶段固定复核上一轮修复**：审查输入必须包含上一阶段的 fix 清单与对应不变量，不能只搜索新代码或重复登记旧债。
2. **测试围绕不变量，而非实现形状**：优先使用确定性模型、参考实现对拍、状态机与故障注入；例子测试可以保留，但不能成为语义的唯一证据。
3. **门禁必须自证能拒绝**：本轮触及的每条门禁规则至少有一个 known-bad fixture；文件存在、schema 有字段不等于内容满足契约。
4. **不以 xfail 充当出口**：已接受但尚未实现的场景进入 ADR 与 §9，不混入必须全绿的 `verify`；修复协议先于扩大调用面。
5. **硬化必须有出口**：没有新的高危缺陷或明确协议阻塞时，不自动追加「再硬化一轮」；性能优化需基准或明确复杂度证据。

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
| **T-11** | 事务/恢复协议未完成（approve 中断、post-delivery 写盘、dedup/admission replay、torn-tail） | 仅局部止损/登记 | 崩溃窗口可能双活、重复或假失败 | H3.0 / rc.6 先成文，H3.1 在 P5 后实现 |
| **T-12** | React 18.3.1 运行时搭配 `@types/react(-dom)` 19.x | ✅ 已由 RC6-4 对齐 18.x | 后续 UI 可能按新 API 通过类型检查却在旧运行时失败 | 已解决；主版本一致断言守护 |
| **T-13** | `./client` 的 types 指向仅含 `export {}` 的 `dist/client/index.d.cts` | 宿主装载不受影响，TS 消费契约无效 | pack 存在性检查不能发现空声明 | P9 增加消费包 + tsc 冒烟并修 dts 或移除误导 types 条件 |
| **T-14** | `withEdgeBudgets` 对同 key 改预算仍保留旧 remaining/fuse | 当前 `team_link` 不改预算，属未来改预算隐患 | 新预算可能与余额/熔断状态矛盾 | P7 先定义重基或重置语义，再做 live/replay 对等测试 |

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

> 语料回归（`scripts/corpus-regression.mjs`）由测试驱动执行，但测试只写**临时报告**，
> 不修改入库文档；只有显式运行该脚本时才更新 `docs/corpus-regression-P1.md`
> （**只写仓库相对路径**，不写绝对路径）。Vitest `globalSetup` 在每次测试调用开始时
> 只构建一次，worker 只读共享 `dist`；脚本拒绝早于源码的 `dist`；门禁判定使用原始
> 计数比例而非展示百分比。

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
| `0.2.1-rc.2` | T0–T4 通信与状态可信性修复（含 Web 发现的归属修复） | 不需要（第三位） |
| `0.2.1-rc.3` | 契约、通信与回放一致性硬化；恢复协议登记为后续设计 | 不需要（第三位） |
| `0.2.1-rc.4` | 侧栏 guide 入口 + 会话挂载自动打开；浏览器 warning 兜底 | 不需要（第三位） |
| `0.2.1-rc.5` | 通信/路由/UI 身份正确性、单一校验管线、AST 边界与发布/测试门禁加固；出品人已验收 | — |
| `0.2.1-rc.6` | H3.0 协议、不变量测试、RateLimiter 有界化与工程契约收口；最后一轮泛化硬化；施工完成待验收 | 不需要（仅递增 rc） |
| `0.2.1-rc.7` | wake 投递、全局唤醒预算账域与运行期自环修复；TTL/correlation 登记 H3.1 | 不需要（仅递增 rc） |
| `0.2.1-rc.8` | 官方路径 wake 闭环、限流乱序、self 容量、缺身份留痕与确定性小修 | 不需要（仅递增 rc） |
| `0.3.0-rc.1` | P5 探针 MVP | **需要**（动第二位） |
| `0.3.x-rc.N` | H3.1 事务/恢复实现，随后 P6 修正与遮蔽降级 | 不需要 |
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
| 14 | `approve` 崩溃恢复未完成：replay 忽略 `approve-intent/vertex-start/rollback`，中断审批仍可再次 approve | 可能双活/遗留 Activation，无对账依据 | H3 恢复协议（ADR D-0.2.1-rc.3）；当前不宣称完整崩溃恢复 |
| 15 | 真实投递成功后的 commit/写盘失败仍可能造成 inbox/内存/JSONL 分叉（含 RC8-1 requeue 成功后的 commit 失败） | 假失败、重复或预算不一致 | H3 事务对账；不得靠 append 换序假装修复 |
| 16 | dedup/admission 不随 replay 恢复（事件暂未存 dedupKey/消费回执；含 RC8-1 parked next-turn 票据） | 重启后幂等窗口失效，旧票据不可恢复 | H3 事件格式与对账协议 |
| 17 | `team_plan` 的 create+submit 仍有两个 append 的部分成功窗口 | 失败后可能留下无入口的 draft | H3 组合命令可恢复语义 |
| 18 | archived concourse 未作为通信硬边界；admission 票据未绑定 from/to/content | 领域 API/未来工具接线存在误投递面 | P7/P8 前补领域边界与票据校验 |
| 19 | JSONL torn-tail 无隔离策略；坏行会使 service 跳过装配 | 停电/半写恢复需人工处理 | H3 故障注入后定策略，不静默丢事件 |
| 20 | `catalog` 对 provider/model 的独立异步探测完全串行；一次 preview/审批需等待全部结果 | 目录较大时首次延迟线性累加 | P7 catalog/价位档改造时加有上限并发，保持输出顺序与单点失败降级 |
| 21 | dedup/admission 内存窗口无界；成功 `team_send` 产生 3 次同步 JSONL 写；启动仍深拷贝整份事件流 | 长驻进程内存增长、消息路径阻塞、启动峰值偏高 | H3 随幂等窗口/事务批次/快照压缩一起设计，禁止简单改异步或加缓冲 |
| 22 | `PlanCard` 未进入运行期组件树；无回调时动作按钮仍可点击 | 计划卡不可达、未来接线后出现假 affordance | P7 与 T-3 数据桥、审批动作接线一起验收；接线前不宣称计划卡可用 |
| 23 | `./client` types 对应的 `dist/client/index.d.cts` 仅含 `export {}` | 宿主运行不受影响，TS 消费方得不到 manifest 暗示的导出 | T-13 / P9；用消费包 + tsc 做语义验收，不停留在文件存在检查 |
| 24 | `withEdgeBudgets` 对同 key 改预算仍保留旧 remaining/fuse | 当前 `team_link` 不改预算，未来改预算可能出现余额超过新额度或旧熔断残留 | T-14 / P7；先定义重基或重置，禁止夹入无行为变化重构 |
| 25 | AgentDirectory、suggest/validate/UI 投影等仍有重复查找或遍历；mock catalog 双份维护 | 当前默认 8 顶点下不构成高危性能故障，大目录/高频投影时可能放大 | 不阻塞 P5；以基准或对应 P7/P8 功能为触发，避免连续优化轮次 |
| 26 | hops 由调用方自报且未随 DeliveryRequest/source 传播；correlationId 也未形成端到端绑定 | FR-C7 的 TTL 与 FR-C2 的 request-reply 在真实多跳链路不构成硬保证；负数/伪造 hops 可绕过 | H3.1 票据/链元数据与可信父票据一并设计；修复前文档明确降级，P5 不新增多跳依赖 |
| 27 | 裸 model 在多个 provider 同 id、spec 省略 provider 时，effort 预检只取目录第一条 | 可能误拒后续 provider 支持组合，或把实际继承路由不支持的组合拖到 start 才失败 | 后续 Catalog 正确性用例：同名多路由且省略 provider 时要求显式 provider，或纳入父有效路由；不与 #20 性能项混修 |
| 28 | `check-no-assets` 的 emoji 正则只覆盖补充平面，漏掉 ⭐/⌚/❤ 等 BMP 码位 | 当前树未见对应违规，但门禁存在假阴性 | P9/下次触及资产门禁时以 Unicode 语义加 known-bad fixture；不为它单独开硬化轮次 |
| 29 | 多个 kernel 导出只剩测试自证（`contentDigest` / `completeGraphPairs` / `formatOverviewLine` / normalize wrapper）；`scripts/_mount-concourse.cjs` 是无备份写 profile 的一次性留档 | 维护面与误用风险，当前无运行时故障 | P9 发布物裁剪时决定保留为内部 API 或删除；旧挂载脚本移除前须确认无引用 |

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
