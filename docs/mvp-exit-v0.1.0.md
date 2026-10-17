# MVP 出口证据归集 · v0.1.0 候选（2026-10-11）

对照 DEVELOPMENT_PLAN.md §1.2 五命题与出口标准。判定：**五命题全部有测试或真机冒烟证据，全 CI 门禁绿**。
提请需求方验收；通过后打 tag `v0.1.0`。

## 门禁总账

| 门禁 | 结果 |
| --- | --- |
| vitest 全量 | 333/333 绿（44 文件，含 storageDir 回归 8/8） |
| tsc --noEmit / oxlint / check-boundaries / check-no-assets / corpus-regression / pack-smoke | 全部通过 |
| 覆盖率 | kernel ≥ 90% 达标；service 98.31%；tools ≈85% |

## V-1 · 拓扑是可声明的数据

- kernel/topology：T1a/T1b/T1.5/T2a fixture 全过；T2b 一律拒绝；tier 决策树 Q1–Q5 全分支；
  边 deny-by-default、完全图枚举 n(n−1)、request-reply 反向绑定（测试锁定）。
- 真机冒烟：T1a 星形（3 顶点 2 开放边）与 T1b 多层树（layer 0→1→2）均真机创建成功，
  谱系判定正确（T1b 样例中 lead→leaf 未开边被正确识别为闭边）。

## V-2 · 逐顶点 model / reasoningEffort / toolFilter 真实生效

- P2 探针乙（运行时）：startContinuable 的 agentOptions（model/reasoningEffort）+ toolFilter
  端到端生效；负面对照（不存在模型名）fail-loud。
- substrate 装配透传测试锁定 VertexStart→startContinuable 全字段映射；
  台账 requestedVsEffective 记录请求 vs 生效档位（inherit 可辨，冒烟中两 worker 均 inherit 无降级）。

## V-3 · 收件侧权威拦截 + 通信约束生效

- 绕过矩阵（NFR-9）：四条路径（team_send / service 直调 / 伪造官方 send_message 直发 /
  裸 createRuntime）闭边消息全部 EDGE_CLOSED 拦截，台账恰 4 条 deliver 0 条。
- 真机冒烟 T1b 第 5 步：lead→leaf 闭边被拦，原文
  「已拦截（EDGE_CLOSED；mid 可达）：消息未投递，台账已留痕」——含可达替代路径提示。
- wake 默认 never（冒烟投递回执 mode=notify wake=never）；TTL/去重/速率/预算熔断
  kernel 层测试全覆盖；预算计价真机可见（60000→59991）。

## V-4 · 全局一次审批

- 生命周期 draft→pending-approval→running→archived 全转换 + 非法转换拒绝（service 测试）。
- team_plan 只提交不拉起；team_assign 为唯一审批执行点（冒烟走通）。
- 作用域测试：member 最小工具集 = team_send/team_status（FR-2.4 能力剥夺）；
  运行期零组队审批打断。

## V-5 · UI 零图片资产 + 形状承载语义

- check-no-assets 门禁绿；StatusGlyph 形状+颜色双通道（色盲可辨五色），
  任意两状态形状两两可辨（结构断言）。
- L0 单行总览（tier/顶点/活跃/开放边/预算条/回声/熔断）+ L1 待决置顶（空态显式
  「无待决事项」）+ L2 折叠处显式声明隐藏内容 + 计划卡 §7.6.3 五段齐全（jsdom 30 测试）。

## 真机冒烟记录（scratch profile r9probe，未触碰 web/desktop）

- 安装：`dsh plugin --profile r9probe add <仓库路径>`（bundle patch 自动挂载 id concourse）；
  profile patch 追加 `enabled: true` + `storagePath`。
- T1a：5/5 步通过（topology→plan→assign→send→status），2 个真实 childId，回执 OK。
- T1b：6/6 步通过，闭边拦截原文在案。
- 冒烟修复（已提交）：cordis 对未在 inject 声明的 context 属性（storageDir）取值直接抛错，
  曾拖垮装配步骤 2 → 探测隔离 try + Proxy 回归测试钉死。

## 已知限制（接受为 MVP 口径，列 P5 候选）

1. **顶点生命周期不回推 concourse 状态**：子代理任务完成后 concourse 仍显示 running
   （无宿主完成事件订阅）；状态收敛待 P5。
2. **首任务即初始 prompt**：顶点拉起时 prompt 即首任务，team_send 用于后续追加——
   语义符合路线 A 设计，但需在用户文档中明示。
3. **UI 数据桥未接线**：面板组件以纯 props 视图模型完整实现+测试，
   宿主投影（ctx.sessionProjections）接线留 P5（src/client/BRIDGE.md）。
4. **edge.budget 不回填**：kernel tokens 无边粒度估算函数（簇 B 偏差记录）。
5. per-child 工具分流注册待宿主身份面（member 最小集已由 resolveScope 单测锁定）。
6. **catalog 无 tier 数据源**（真机测试 F-3）：宿主 LlmCatalogLike 不提供模型价位档，
   枚举只采集 {provider, model, efforts}，suggest 的 `m.tier ?? 'balanced'` 使
   cheap/premium 目标档第一轮候选池必空、必走「回退到全部合格候选」——tier 目前
   只是标签，无选型效应。待宿主目录面暴露 tier 或引入本地映射表（P5）。
7. **assertKnownKeys 真机不可达**（真机测试 TC-11）：Web GUI 工具调用在到达
   execute 前按参数 schema 归一化，入参根层未知字段被丢弃——did-you-mean 守卫
   仅在离线/直调路径生效（单测 17/17 锁定）。笔误在真机上会降级成 zod「缺字段」
   类报错。无代码修复面，属宿主行为记录。
8. **toolFilter 改为挂载后收口**（DSH 0.2.1-rc.2 适配，见
   `docs/decisions/D-P3-runtime-0.2.1.md`）：0.2.1 起子代理 start 期不再接受
   toolFilter，本插件在 startActivation 成功后经子 Agent 的
   `ctx.tools.restrict()` 应用同一 restriction；失败即 dispose + fail-loud。
   与 0.2.0 的声明式透传相比存在毫秒级生效窗口。
9. **inject 新增 `agents`**（0.2.1 适配）：cordis 对未在 inject 声明的属性取值会
   直接抛错；逐顶点工具面收口需要 `ctx.agents`，故声明。宿主缺失该服务时插件
   按 cordis 语义不激活（fail-loud，不静默降级）。

### 真机测试修复批次（2026-10-17，session-68cefdca 交叉核验后，commit aec9172）

- **F-1**：DifficultyProfile schema 显式声明 `signals` 可选字段——zod strip 不再
  吞掉 profiler 可解释性信号，`confidence = 0.5 + 0.1×n` 恢复生效（修复前恒 0.50）。
- **F-2**：team_topology 输出补 `toolFilter`，render 展示 rationale 全文与工具
  过滤禁用清单（FR-4.4 可解释派发对用户可见）。
- **F-4**：`EFFORT_ORDER = ['off','low','default','high']`——`off` 显式置于 `low`
  之下，wanted=default 时 `off` 不再因「未知档按 default 位次」距离 0 直接胜出
  （修复前中等认知任务会退化成零推理）。

## 提交序列

`91b7698` P0 测试 → `6aadfa2` P0 脚手架 → `ed32c42` R-9 spike → `3f81d54` P1 内核
→ `1557931`/`2af42e0` P2 探针+D-P2 → `60e3c67` P3 → `8c1931e` P4 → 本次（MVP 出口）。
