# dsh-agent-teams-concourse

[English](README.md) | 中文

**版本：** `0.2.1-rc.8`（DSH 基线 `0.2.1-rc.2`；官方路径 wake 闭环、限流乱序修复、容量/身份/留痕确定性收口；待出品人验收）· [变更日志](CHANGELOG.md) · [需求文档](docs/REQUIREMENTS.html) · [开发计划](DEVELOPMENT_PLAN.md) · [协作规范](COLLABORATION.md)

DSH 的**组织层**插件：把「谁和谁能通信、每个执行单元用什么模型与思考强度、产出如何回到主线」
变成可编辑的一等数据。拓扑不是搭出来的，是**剪**出来的——底座在物理上已是完全图，本插件在其上
声明一个开放边集，于是多层树只是视图，**执行底座恒为一层**。零美术资产：形状承载语义，颜色只加速扫视。

> **开发中。** 当前是 `0.2.x`：团队层（拓扑 / 逐顶点定档 / 通信闸门 / 计划工具）今天就能用；
> 右侧栏面板仍是占位视图。**旁路探针**（不回注、按句柄取回、可丢弃的旁路查询）是下一阶段，**一行代码都还没有**。
> 下表是诚实的现状，不是愿景。

## 今天能做什么

| 能力 | 状态 |
|---|---|
| 拓扑即数据：`team_topology` 声明顶点 + 开放边集；tier 判定（T0/T1a/T1b/T1.5/T2a）；计划期容量与预算校验 | ✅ |
| 逐顶点定档：`provider` / `model` / `reasoningEffort` / `budget` / `toolFilter` / `maxDepth`，越界 fail-loud | ✅ |
| 自动定档建议（启发式，输出 `rationale[]` / `signals[]` / `confidence`） | ⚠️ 部分：仅对显式声明 profile 的任务生效；`signals[]` 与宿主上下文窗口尚未穿透真实工具路径 |
| 通信硬约束：开放边集 deny-by-default、`wake` 默认 never、跳数 TTL、幂等去重、速率降级、边/全局预算熔断 | ⚠️ 部分：主路径可用，但 live 票据重放与非文本消息身份待 rc.9；H3.1 前跳数 TTL 不是硬保证 |
| **模型准入侧权威拦截** + 真实路径矩阵（工具 / `agent-message` / 伪造 sender，闭边消息不进入模型） | ✅ |
| 计划审批闸门（`team_plan` 只提交不拉起），运行期零组队审批 | ✅ |
| JSONL 台账（决策 / 通信 / 预算 / 回声计数）+ 重启回放恢复（seq 与运行期改边可回放；离线目标 fail-loud） | ✅ |
| 右侧栏面板：组件与测试齐全，**但数据桥未接线——今天仍是占位视图**；`PlanCard` 尚未挂载 | ⚠️ |
| 旁路探针（`team_probe` / `team_peek`，`echo: handle` + `tick` 通知） | ⏳ 计划中（P5） |
| 四级丢弃 / 遮蔽 / 晋升为成员 | ⏳ 计划中（P6） |
| 会话加入与 T2a 多领队并列（`team_join`） | ⏳ 计划中（P8） |

已在 scratch profile 上做过 T1a（星形）与 T1b（多层树）的真机冒烟（`0.1.0` 期间），闭边拦截原文在案；
`0.2.0` 已装入 Web profile 并通过体检。`0.2.1-rc.4` 修复客户端 keyed slot 契约，
增加侧栏 guide 入口与会话挂载时一次自动打开，并保留 rc.3 的通信/回放硬化。核心 Web
链路已在最小 `conc03` scratch profile 验证：plan → assign → deliver → 闭边拒绝 →
重开边；重启回放状态一致；非法 model 预检零拉起。`0.2.1-rc.5` 修复去重碰撞、
熔断边恢复、`hopTTL` 校验、provider 路由、工具组回滚与 UI 身份映射，并加固边界/
发布/测试门禁。rc.5 已由出品人验收；本表述不扩大既有记录所覆盖的验证范围。
`0.2.1-rc.6` 增加 H3.0 事务/恢复协议，限流窗口改为有界结构，React 类型对齐 18.x，
并让全门禁只构建一次。Web profile 实机闭环（plan → assign → deliver → 闭边拒绝 →
child 应答）已通过；Desktop 已安装但保持 `disabled`，待出品人验收。H3.1 恢复仍只是
成文协议，不是已实现承诺。`0.2.1-rc.7` 让 `wake: never` 与广播在宿主边界真正不唤醒，
把全局熔断限定为主动唤醒投递、保留边熔断对所有投递生效，并在写台账前拒绝运行期自环。
`hops`/`correlationId` 链元数据仍是 H3.1 债务，修复前不宣称硬 TTL 或完整请求应答绑定。
rc.7 全门禁通过（60 文件 / 468 测试）；Web profile 已验证正常投递、全局熔断账域分离与
自环拒绝，空闲 child 仍受既有 `TARGET_UNAVAILABLE` 限制。Desktop 已安装 rc.7 并保持
`disabled`，待出品人验收。`0.2.1-rc.8` 收口审查发现的实证问题：官方/裸 `sendMessage`
的 never/board/degrade 现在先带票据重排到 `next-turn`，不再进入被唤醒的当前轮次；
限流器修复乱序时间戳虚假 degrade；容量校验不再把 self 领队计入子代理上限；缺失发送者
会留拒绝痕；`createdAt` 与领队身份绑定改为确定性/无失败副作用。rc.8 测试基线为
**60 文件 / 480 测试**。重排成功后写盘失败仍属 #15，重启票据恢复仍属 #16，本轮不宣称
exactly-once 或完整崩溃恢复。

## 前置条件

- DSH `0.2.1-rc.2`（当前 `engines.dsh` 与 peer **精确钉版**；区间化是技术债 T-1，见开发计划 §4）。
- Node `^22.19 || >=24` 与 `pnpm`。
- 一个愿意被改动的 profile。插件 `enabled` **缺省为 false**，不显式打开零行为变更。

## 快速上手

```powershell
# 1) 构建 + 全门禁 + 打包
pnpm install
pnpm verify
pnpm pack

# 2) 装进某个 profile，然后**完全重启**宿主（宿主插件只在启动时加载）
dsh plugin --profile <profile> add <path-to>\dsh-agent-teams-concourse-<version>.tgz
```

在该 profile 的 `cordis.patch.yml` 里打开它（缺省惰性）：

```yaml
- override:
    id: concourse
    config:
      enabled: true
      storagePath: <file>  # JSONL 台账文件；缺省使用内存存储
```

然后在会话里按顺序使用：

```
team_topology   声明顶点与开放边集（拓扑即数据）
team_plan       提交完整计划待批 —— 唯一的审批闸门
team_assign     逐顶点定档并拉起（子代理经 startActivation 起）
team_send       投递消息（闭边硬拒绝，附可达候选）
team_status     拓扑 / 预算 / 通信健康度一行总览
```

## 它怎么组成

| 层 | 干什么 | 为什么在这一层 |
|---|---|---|
| **kernel**（`src/kernel`） | 拓扑校验、tier 判定、难度画像、建议、通信闸门（gate/hop/dedup/rate/budget）、形状符号表 | 纯函数、零宿主依赖，可被语料回归与单测钉死（CI 硬门禁） |
| **host**（`src/host`） | `startActivation` / `deliver` / `interrupt` 的薄适配 + provider + 模型目录 | 唯一允许触碰宿主 seam 的地方，缺 `ctx.subagents` 时降级不崩溃 |
| **service**（`src/service`） | 生命周期、**模型准入权威判定**、台账、JSONL 持久化与回放 | 闸门的权威落点在这里，而不是各个工具入口 |
| **tools / client** | 6 个 `team_*` 工具（按身份作用域分流）、React 18 右侧栏与计划卡 | 工具只做"早失败"以改善体验；UI 只做只读显示 |

**路线 A 是刻意的**：P2 探针证伪了「官方 `spawnTeammate` 会透传 `agentOptions`」这条链路，
所以本插件自建顶点注册表、邮箱、任务板映射与持久化，只依赖宿主 `ctx.subagents` / `ctx.llm` /
`ctx.tools` / `ctx.agents` 四个稳定面。代价是 CAS 与恢复对账要写极简版，收益是不再被
experimental 底座的漂移绑架。

## 闸门到底看什么

- **开放边集**：`E` 里没有的边即关闭。默认关闭（deny-by-default），忘记开 → 投递被硬拒绝并留痕，
  立刻看得见；反过来「默认开放、忘记关」会造出静默的通信通道——所以取 fail-closed。
- **收件侧权威**：判定只看 `(from, to, 内容, 跳数)`，**不认任何路由元信息**。因此伪造官方
  `send_message` 直发也走同一条判定路径。工具侧只负责"早失败"，不做安全保证。
- **绕过矩阵**（`test/tools/bypass-matrix.test.ts`）：工具调用 / service 直调 / 伪造直发 /
  裸运行时，四条入口发闭边消息，全部被拦或留痕。这是 NFR-9 的唯一验收方式。
- **零美术资产**：包内扫不到 `.png/.jpg/.svg/.gif`，`src/` 全域扫不到 emoji 码位。
- **模块边界**：`kernel` 里出现 `import @deepseek-ai/*` 或 `node:*` 即构建失败。

## 安全与降级

- **惰性**：`enabled !== true` 时零注册、零监听器、零行为变更。
- **异常永不阻断对话**：`apply` 内每个装配步骤独立 `try/catch`，失败只 warn。这一点很重要——
  注册抛错会让宿主**回滚整个插件 effect**，下游报 `NO_PROVIDER`，极具迷惑性。
- **降级不崩溃**：宿主 `ctx.subagents` 缺席时 substrate 进入 degraded 模式，三个方法统一抛
  typed error，而不是让插件崩在装配阶段。
- 不读改会话日志，不改宿主代码；所有状态只落在配置的 `storagePath`（JSONL，append-only）。
- 每一次拒绝、降级、熔断都留痕。否则用户会以为消息丢了——那比引发风暴更难排查。

## 已知边界

- **面板不显示真实状态**：组件与测试齐备，但会话投影数据桥未接线（计划 §9 残留 #3，P7 修）。
- 顶点任务完成后 concourse 仍显示 `running`（无宿主完成事件订阅）。
- 没有 `contextMode: fork`、没有静默判定（quiescence）、没有模型价位档数据源——见开发计划 §4 技术债。
- 子节点工具分流注册待宿主提供会话身份面（当前只在根/领队上下文注册全量）。
- 探针整体未实现（需求 FR-D 共 20 条）。
- 未发布到 npm：从 tarball 安装。
- 工具名与官方 `team_task_*` 同族相邻（无重名），靠每个工具的 description 约定边界：
  **concourse 管拓扑与路由，官方管成员与任务**。
- **rc.9 待修的正确性问题**（2026-10-27 审查发现）：同一 `team_send` 票据在 live 重放时可能二次投递并二次扣账；
  无 text 块的图片/文件消息会被折叠成同一去重身份；重开已有边会丢失其 `rate`/`budget`。在 rc.9 落地前，
  不要依赖 live 幂等或“重开边保留配置”。
- 派发记录中的 `effective` 目前是 spec 声明值或 `inherit` 标记，**不是从宿主读回的真实路由**；
  FR-B2/B3/B7 因此仍为部分实现，待 P7 接通画像/`signals[]`/路由回显链。
- **当前 Node 24 下打包门禁未通过**：`pack-smoke` 在嵌套符号链接依赖上解析失败，待 realpath 修复；
  typecheck、lint、boundaries、assets 与 480 条测试仍通过。
- 不要与 `dsh-team-autopilot` 同时使用两套团队心智模型：它读官方 `ctx.agentTeams` 名册，
  而 concourse 使用自建顶点注册表，两者状态不可互换。

## 作者与维护声明

- **按版本区间的作者**
  - `0.1.0` – `0.2.0`：**moonshotai-Kimi-K3**（在 DeepSeek Harness 中编码；过程记录见
    `CHANGELOG.md`、`docs/mvp-exit-v0.1.0.md` 与 `docs/decisions/`）。
  - `0.2.1` – 至今：**DeepSeek-V4.1-Flash-1017**（AI 模型，通过 DeepSeek Harness 编码）。
- **出品人 / 仓库管理员**：KEI.NEO（@neo805）—— 人类出品人，对本仓库内容负责。
- **维护范围**：这是出品人的个人业余（Vibe Coding）项目。公开仅为分享，
  **不对项目本身承诺任何源于外部需求的维护与更新**。
- **协作政策**：本仓库**不开启 Issues，不接受 Pull Requests**（见 [CONTRIBUTING.md](CONTRIBUTING.md)）。欢迎在 MIT 许可下 fork 后自由演进。
- **免责**：软件按"现状"提供，无任何明示或默示担保（详见 LICENSE）。生产环境使用前请自行评估。

## 致谢与许可

MIT。品类参照与教训来源：`@nanmicoder/dsh-agent-teams`（拟人化与审批错配的反面参照）、
`dsh-team-rooms`（闸门只在外壳导致绕过的教训）、`@deepseek-ai/dsh-experimental-agent-team`
（官方基线与其"不支持嵌套"的边界）、`dsh-thoughtdag`（「线即上下文」「排除而非删除」）、
`@yfwu2020/dsh-selection-explain`（旁路查询的人类侧入口交互）。竞品与平台原语证据见 `research/`。
