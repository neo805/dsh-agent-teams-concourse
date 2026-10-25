# D-H3 · 事务、投递与恢复协议（H3.0）

|  |  |
| --- | --- |
| 日期 | 2026-10-25 |
| 版本 | `0.2.1-rc.6` 协议基线；实现目标 `0.3.x-rc.N`（H3.1） |
| 状态 | H3.0 施工稿；Web 实机已通过，Desktop 已装 rc.6 并保持 disabled，待出品人验收；H3.1 实现前不得宣称更强保证 |
| 范围 | 单 DSH 进程、插件自建组织层；不跨进程、不跨 DSH 实例 |
| 依据 | 需求 §4.5 / NFR-4 / FR-C9；`D-0.2.1-rc.3-hardening.md`；第 4–7 期第三方全景审计 |

## 1. 决议摘要

1. **不承诺 exactly-once。** 宿主 inbox 没有跨进程事务，插件也不得假装拥有它。
2. **投递语义选择保守的“至多一次自动发布 + 未知显式暴露”。** 崩溃窗口内无法证明是否已受理时，标记 `PUBLICATION_UNKNOWN`，不自动重发，不以成功掩盖。
3. **准入票据先于投递持久化。** `comm.admit` 是幂等与预算预留的权威记录；`comm.deliver` / `comm.degrade` 是发布回执，必须携带同一个 `admissionId`。
4. **预算按预留计。** admit 一旦落盘即占用预算；已知投递失败才释放。未知窗口保持预留，宁可保守少发，也不让风暴在无预算状态下继续。
5. **恢复只做对账，不自动续跑。** 中断的 approve、未回执的 admission、torn-tail 都必须以可枚举状态暴露给用户/领队；自动继续需要显式命令。
6. **H3.1 前保持现状能力口径。** P5 可以复用当前投递路径，但不得另建第二套事务语义，也不得宣称完整崩溃恢复；新增 probe 事件必须遵守本 ADR 的票据/回执边界。
7. **不接受预期失败测试作为出口。** 当前承诺行为必须由全绿测试证明；尚未实现的故障场景登记在本文与 §9，H3.1 用故障注入把它们转绿。

## 2. 术语与权威源

| 术语 | 定义 | 权威来源 |
| --- | --- | --- |
| **票据 / admission** | 一次发送尝试的唯一身份、路由、内容摘要、预算预留与去重键 | 插件 JSONL `comm.admit` |
| **已发布 / published** | 宿主 `target.send(...)` 返回且插件已写发布回执 | 插件 `comm.deliver` / `comm.degrade` 回执 |
| **已消费 / consumed** | 预算从剩余额度转为已用；与是否唤醒无关 | 预算账本（由 admit 预留与失败释放重演） |
| **未知 / PUBLICATION_UNKNOWN** | 已有 admit，无发布回执，且崩溃/写盘失败使真实发布不可判定 | 恢复对账结果 |
| **已拒绝 / rejected** | 准入判定为拒绝，消息未进入目标 inbox | `comm.reject` |
| **恢复 / recovered** | 启动时从 JSONL 有效前缀重建状态并列出未决项，不包含自动重放业务动作 | `replay` + 对账报告 |
| **torn-tail** | 文件末尾半写记录；不是合法事件，也不是可静默丢弃的坏事件 | 存储加载器隔离区 |

**唯一原则：** 事件日志是插件状态的唯一持久权威；内存是派生缓存。任何“内存已改、日志未写”的状态都不得在重启后被当作已提交。

## 3. 消息发布协议

### 3.1 正常路径

```text
evaluateInbound（只读预检）
  → append comm.admit（ticket + dedupKey + tokens + 路由 + 内容摘要）
  → target.send(...)（宿主受理）
  → append comm.deliver | comm.degrade（同 admissionId）
  → 返回 published / degraded
```

- `admissionId` 使用 UUID；`dedupKey` 使用完整无歧义 tuple，不得用 32 位摘要替代。
- `comm.admit` 写入失败：不投递、不返回成功。
- `target.send` 抛错：追加 `comm.delivery-failed` 并释放预留；返回真实错误。
- 发布回执写入失败：**必须**向调用方返回 `PUBLICATION_UNKNOWN`（消息可能已被宿主受理），不得返回 deliver。
- 同一 `admissionId` 的回执只能出现一次；重复回执按协议损坏处理并告警，不双扣。

### 3.2 崩溃窗口

| 崩溃点 | 日志可见状态 | 重启后行为 | 用户可见结果 |
| --- | --- | --- | --- |
| admit 之前 | 无票据 | 可安全重试 | 无副作用 |
| admit 之后、send 之前 | admit，无回执 | 标记 `UNRESOLVED`；不自动 send | 票据可枚举；显式重试需新票据，旧票据先结案 |
| send 期间/之后、回执之前 | admit，无回执 | 标记 `PUBLICATION_UNKNOWN`；预算保持预留 | 保守不重发；不伪造成功 |
| 回执之后、内存更新之前 | admit + 回执 | replay 恢复为 published/degraded | 同一幂等键返回原结果 |
| 回执写盘失败 | admit，无回执 | 同 `PUBLICATION_UNKNOWN` | 调用方得到未知错误，不自动重发 |

### 3.3 重试与幂等

- 同一 `dedupKey` 已有 published/degraded 回执：返回缓存结果，不再调用宿主。
- 同一 `dedupKey` 只有未决 admit：返回 `PUBLICATION_UNKNOWN`，不自动重发。
- 用户/领队显式重试时，旧未决票据必须先被决议：
  - `published`：不重发；
  - `not-published`：释放预留后可新建票据；
  - 无法判定：保持 unknown，要求人工确认；不得用“再发一次”代替对账。
- dedup 身份在 concourse 生命周期内保持；不得用有损哈希换取更小内存。

### 3.4 预算

- admit 时按 `tokens` 预留；预算不足按现有 FUSE 逻辑拒绝，不产生 admit。
- deliver/degrade 回执不再次扣账（防止双扣）。
- `delivery-failed` 明确释放预留；`PUBLICATION_UNKNOWN` 保持预留。
- 旧版事件流（rc.5 及以前）按既有 `budget.consume` 语义重演，**不得**追溯套用新协议；事件格式必须带 schema 版本。

## 4. 生命周期与审批

### 4.1 approve

- 先写 `approve-intent`：包含 approvalId、parent session、拓扑指纹、逐顶点启动规格；写失败则零拉起。
- 每个顶点在宿主返回 activation 后写 `vertex-start`（vertexId、childId、requested/effective）；回执失败即停止继续拉起并进入中断对账。
- 全部成功写 `approve` 回执并转 `running`；中途失败按现有回滚语义中断已拉起顶点，并写 `rollback` 明细。
- 重启看到 intent 无 approve/rollback：状态为 `pending-approval` + `approval-interrupted`，列出已拉起 childId；**不自动 adopt，不自动续拉**。
- 是否 adopt 一个仍存活的 child 必须由显式恢复命令决定；H3.1 没有宿主存活证据时标记 orphan，不重复拉起。

### 4.2 create + submit

- `team_plan` 的 create 与 submit 合并为单一可重放命令事件（含 spec、目标状态 `pending-approval` 与 commandId）。
- 崩溃后只有 create 没有 submit：不得留下“无入口 draft”；重放按命令完成状态恢复为 pending-approval，或按未提交 draft 明确列出。
- 旧日志保留 create/submit 两事件解释，不重写。

### 4.3 archive 与通信

- archived 是通信硬边界：任何新 admit 一律拒绝（`CONCOURSE_ARCHIVED`）。
- 票据绑定 from/to/content 摘要；目标 pre-step 消费票据时校验绑定，拒绝错投。
- 已 archived 的 concourse 恢复后不得因迟到回执重新进入 running。

## 5. JSONL 与恢复

### 5.1 事件格式

- 每条事件带 `schemaVersion`、`seq`、`at`、`concourseId`、`commandId?`、`admissionId?`。
- 新事件不改写旧事件含义；读取器遇到更高版本必须 fail-loud，不猜测字段。
- 事件只追加；不得原地修改、换序或删除。

### 5.2 torn-tail

- 启动按行读取；**仅文件末尾**的不完整/不可解析行可隔离到 `*.torn.<timestamp>` 并告警。
- 文件中间坏行不得跳过：进入 degraded/fail-loud，保留原文件供人工处理，不静默丢事件。
- 隔离动作本身必须幂等；重复启动不得复制/覆盖已有隔离文件。

### 5.3 恢复报告

启动后必须可枚举：

- 未决 admissions：admissionId、from/to、tokens、状态（unresolved/unknown）；
- 中断 approvals：concourseId、approvalId、已拉起 childIds；
- quarantined torn-tail：路径、行数、时间；
- 版本不兼容事件：停止装配并报警，不进入半可用状态。

## 6. 内存与批处理

- dedup/admission 索引从 admit/receipt 重建；没有持久票据的窗口不得声称幂等。
- 成功发送路径的多次同步写允许在 H3.1 合并为一次批次，但必须满足：先落盘再发布可见状态、失败不提交内存。
- 启动深拷贝改为快照/有效前缀 + 懒加载；不得为降低峰值而跳过校验。
- 任何异步化不得改变 call return 与日志提交顺序。

## 7. P5 / probe 约束

1. probe 事件沿用 `concourse.*` 命名与同一 admission/回执边界；不得新增第二套投递器。
2. 探针结果仍绝不作为 tool result 回注；H3.1 不得以“恢复需要”为由把探针产出写回父上下文。
3. probe 的句柄/生命周期事件必须可重放或明确标为不可恢复；不得依赖内存注册表作为唯一权威。
4. P5 验收不宣称 exactly-once、完整崩溃恢复或跨重启 live 投递；这些只在 H3.1 出口声明。

## 8. 与当前已知残留的映射

| # | 当前现象 | H3.1 处置 | rc.6 口径 |
| --- | --- | --- | --- |
| 14 | approve 中断无法 adopt/对账 | intent + vertex-start + 恢复报告 | 仍不宣称恢复 |
| 15 | post-delivery 写盘失败分叉 | 票据/回执 + PUBLICATION_UNKNOWN | 仍可能未知，但不伪造成功 |
| 16 | dedup/admission 不随 replay 恢复 | 持久票据与回执重建 | 仍不承诺重启幂等 |
| 17 | create+submit 部分成功 | 单一命令事件 | 仍可能留 draft |
| 18 | archived/ticket 未成硬边界 | archived 拒绝 + 票据绑定 | P7/P8 前 |
| 19 | torn-tail 无隔离 | 尾行隔离、中间坏行 fail-loud | 仍需人工处理 |
| 21 | 同步写/全量深拷贝/无界窗口 | 批量提交 + 快照；不改变提交顺序 | 仍为当前性能限制 |

## 9. H3.1 验收矩阵

1. 每个崩溃点均有故障注入：admit 前、admit 后、send 后、回执前、回执后、写盘失败。
2. 同一操作序列在 live 与重启恢复后的可见状态、预算、幂等结果等价；未知窗口只能收敛为 published 或 not-published。
3. approve 中断可列举、可显式 adopt/rollback，不自动双活。
4. dedup/admission 重放后旧票据不可被重复消费。
5. torn-tail 只隔离尾部；中间坏行 fail-loud；不静默丢事件。
6. P5 probe 事件通过同一恢复矩阵；零回注断言不回归。
7. `pnpm verify` 全绿；无 xfail；所有验收有可复核测试与台账证据。

## 10. rc.3–rc.5 修复复核矩阵

| 结构 | 历史修复 | 复核结论 | 后续动作 |
| --- | --- | --- | --- |
| `withEdgeBudgets` | rc.3 边键归一；rc.5 只保留在场边 fuse | 同 key 改预算仍保留旧 remaining/fuse，当前 team_link 不可达 | P7 定义重基/重置，T-14 |
| `check-boundaries` | rc.3 allowDirs → rc.5 AST | 正向门禁已有 known-bad fixture；未知层/require 覆盖补齐 | 保持 |
| `pack-contract` | rc.3 实物文件 → rc.5 加入客户端 d.cts | 空 d.cts 仍能通过存在性检查 | P9 消费包 + tsc 语义门禁，T-13 |
| `dedup` | rc.3 tuple framing → rc.5 去掉 FNV 身份 | 完整 tuple；新增穷举单射测试 | 保持，禁止有损哈希 |
| 侧栏 tab | rc.3 keyed key → rc.4 guide/auto-open | 用户可见路径已验证；空 props 数据桥另属 P7 | 保持，UI 验收归出品人 |
| React 类型 | 长期未对齐 | 18.3.1 运行时 vs 19.x 类型 | RC6-4 对齐 + 主版本断言 |

## 11. 明确不承诺

- 跨进程/跨 DSH 实例 exactly-once；
- 自动重发、自动 adopt、自动恢复对话；
- 未登记故障场景的“应该没问题”；
- 在 H3.1 完成前把 PUBLICATION_UNKNOWN 说成成功或丢弃为普通失败。

---

_本 ADR 由 H3.0 施工产生；任何语义加强须另立决议并同步需求、开发计划与测试。_