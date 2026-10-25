# dsh-agent-teams-concourse

[English](README.md) | 中文

**版本：** `0.2.0`（DSH 基线 `0.2.1-rc.2`；团队层已过 scratch profile 真机冒烟，Desktop 实机验收待办）· [变更日志](CHANGELOG.md) · [需求文档](docs/REQUIREMENTS.html) · [开发计划](DEVELOPMENT_PLAN.md) · [协作规范](COLLABORATION.md)

DSH 的**组织层**插件：把「谁和谁能通信、每个执行单元用什么模型与思考强度、产出如何回到主线」
变成可编辑的一等数据。拓扑不是搭出来的，是**剪**出来的——底座在物理上已是完全图，本插件在其上
声明一个开放边集，于是多层树只是视图，**执行底座恒为一层**。零美术资产：形状承载语义，颜色只加速扫视。

> **开发中。** 当前是 `0.2.x`：团队层（拓扑 / 逐顶点定档 / 通信闸门 / 计划卡）今天就能用；
> **旁路探针**（不回注、按句柄取回、可丢弃的旁路查询）是下一阶段，**一行代码都还没有**。
> 下表是诚实的现状，不是愿景。

## 今天能做什么

| 能力 | 状态 |
|---|---|
| 拓扑即数据：`team_topology` 声明顶点 + 开放边集；tier 判定（T0/T1a/T1b/T1.5/T2a）；计划期容量与预算校验 | ✅ |
| 逐顶点定档：`model` / `reasoningEffort` / `budget` / `toolFilter` / `maxDepth`，越界 fail-loud | ✅ |
| 自动定档建议（启发式，输出 `rationale[]` / `signals[]` / `confidence`） | ✅ |
| 通信硬约束：开放边集 deny-by-default、`wake` 默认 never、跳数 TTL、幂等去重、速率降级、边/全局预算熔断 | ✅ |
| **收件侧权威拦截** + 绕过矩阵（4 条入口发闭边消息，全部被拦或留痕） | ✅ |
| 计划审批闸门（`team_plan` 只提交不拉起），运行期零组队审批 | ✅ |
| JSONL 台账（决策 / 通信 / 预算 / 回声计数）+ 重启回放恢复 | ✅ |
| 右侧栏面板与计划卡：组件与测试齐全，**但数据桥未接线——面板今天是占位视图** | ⚠️ |
| 旁路探针（`team_probe` / `team_peek`，`echo: handle` + `tick` 通知） | ⏳ 计划中（P5） |
| 四级丢弃 / 遮蔽 / 晋升为成员 | ⏳ 计划中（P6） |
| 会话加入与 T2a 多领队并列（`team_join`） | ⏳ 计划中（P8） |

已在 scratch profile 上做过 T1a（星形）与 T1b（多层树）的真机冒烟（`0.1.0` 期间），闭边拦截原文在案；
`0.2.0` 已装入 Web profile 并通过体检。**但 0.2.0 修复批次的真机复测没跑成**——两个 API key
被服务端判为 invalid，如实记录在此，不当作已验证。

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
dsh plugin --profile <profile> add <path-to>\dsh-agent-teams-concourse-0.2.0.tgz
```

在该 profile 的 `cordis.patch.yml` 里打开它（缺省惰性）：

```yaml
- override:
    id: concourse
    config:
      enabled: true
      storagePath: <dir>   # JSONL 台账目录；缺省探测宿主 storage，再缺席则内存存储
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
| **host**（`src/host`） | `startActivation` / `sendText` / `interrupt` 的薄适配 + provider + 模型目录 | 唯一允许触碰宿主 seam 的地方，缺 `ctx.subagents` 时降级不崩溃 |
| **service**（`src/service`） | 生命周期、**收件箱准入权威判定**、台账、JSONL 持久化与回放 | 闸门的权威落点在这里，而不是各个工具入口 |
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

## 作者与维护声明

- **按版本区间的作者**
  - `0.1.0` – `0.2.0`：**上一代 AI 协作者**（在 DeepSeek Harness 中编码；过程记录见
    `CHANGELOG.md`、`docs/mvp-exit-v0.1.0.md` 与 `docs/decisions/`）。
  - 自 `0.2.1` / `0.3.0` 起：**DeepSeek-V4.1-Flash-1017**（AI 模型，通过 DeepSeek Harness 编码）。
- **出品人 / 仓库管理员**：KEI.NEO（@neo805）—— 人类出品人，对本仓库内容负责。
- **维护范围**：这是出品人的个人业余（Vibe Coding）项目。公开仅为分享，
  **不对项目本身承诺任何源于外部需求的维护与更新**。
- **协作政策**：本仓库**不开启 Issues，不接受 Pull Requests**。欢迎在 MIT 许可下 fork 后自由演进。
- **免责**：软件按"现状"提供，无任何明示或默示担保（详见 LICENSE）。生产环境使用前请自行评估。

## 致谢与许可

MIT。品类参照与教训来源：`@nanmicoder/dsh-agent-teams`（拟人化与审批错配的反面参照）、
`dsh-team-rooms`（闸门只在外壳导致绕过的教训）、`@deepseek-ai/dsh-experimental-agent-team`
（官方基线与其"不支持嵌套"的边界）、`dsh-thoughtdag`（「线即上下文」「排除而非删除」）、
`@yfwu2020/dsh-selection-explain`（旁路查询的人类侧入口交互）。竞品与平台原语证据见 `research/`。
