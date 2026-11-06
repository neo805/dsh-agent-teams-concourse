# 人机协作规范 / Human–AI Collaboration Norms

> 本文件记录本项目的**出品人**（人类决策者）与 **AI 第一作者**
> （`deepseek-v4.1-flash-1017`，在 DSH 中工作的编码 agent）在 Vibe Coding 模式下
> 共同约定的协作规范。它是**双向约定**：双方都按它执行，不是单方面的流程说明书。
>
> 要改规范，先改这份文件。
>
> 本版于 2026-10-25 按姊妹项目 `2026.10_dsh-effort-router` 与
> `2026.10_dsh-auto-upgrade` 升级后的规范同步：角色改称**出品人 / AI 第一作者**、
> 版本号**全量带 `rc`**、新增**测试先行**与**四级验证阶梯（含 Web 实机闸门）**、
> 交付清单改为**验收通过才 push**、已知残留**必须公示**。

**English abstract.** This repository is developed in a human–AI pair-programming
("vibe coding") mode. The human is the **producer** (requirements intake, decision
authority, product-level acceptance); the AI is the **first author** (requirements,
plan, implementation, tests, packaging, deployment, evidence). This document states
the norms both sides follow: an rc-only versioning ladder with producer approval for
the second and first digits, test-first development, a fixed four-rung verification
ladder (standardized tests → Web install → AI-driven real-machine verification through
the DSH Web surface → Desktop install → producer acceptance) with a per-version Web
time budget, evidence-over-assertion reporting, rollback-first environment discipline,
public disclosure of accepted residue, approval before any outward action, and privacy
boundaries for committed documents. It intentionally contains no personal or
machine-specific information.

---

## 0. 项目定位与形态基线（规范的前提）

本项目是 **DSH 的组织层插件**：拓扑即数据（虚拟拓扑，在完全图上裁剪开放边集）、
逐顶点模型定档、通信硬约束、反拟人化高密度 UI，外加**旁路探针**这一新顶点类。
形态在 0.2.0 已定调，后续所有规范以它为前提：

> **bundle 装载，纯函数内核，收件侧权威；有 UI，但没有设置界面。**

- **bundle 装载**：以 DSH bundle 交付，`cordis.patch.yml` 只插一条插件行；
  宿主缝收敛为「注册一个 subagent provider + 注册 6 个 `team_*` 工具 + 挂一个右侧栏标签」。
  不新增 service，不挂 engine hook，不改宿主代码。
- **路线 A（自建组织层）**：P2 探针已证伪「官方 `spawnTeammate` 透传 `agentOptions`」
  这条链路，因此 concourse **自建**顶点注册表、邮箱（收件侧权威判定）、任务板映射与
  JSONL 持久化，只依赖宿主 `ctx.subagents` / `ctx.llm` / `ctx.tools` / `ctx.agents`
  四个稳定面。收益是 experimental 底座漂移风险消除；代价是 CAS 与恢复对账需自建极简版。
- **纯函数内核**：`src/kernel/` 零宿主依赖（禁 `import @deepseek-ai/*` 与 `node:*`），
  由 `scripts/check-boundaries.mjs` 硬门禁。拓扑校验、难度画像、建议、通信闸门全在这一层。
- **收件侧权威**：开放边集的权威判定在**收件箱准入**路径上，不在发送工具里。发送工具只做
  "早失败"以改善体验，不做安全保证（NFR-9 的等价落点）。
- **有 UI，但不是设置界面（永久）**：本项目**有** UI —— 右侧栏面板（`sidebar.right.pane.tab`）、
  计划审批卡、`shell.overlay` 浮层，这是需求的一部分（反拟人化高密度 UI）。
  但**不出设置页**：所有选项在插件配置文件里，客户端只做只读显示。
  **与姊妹项目的差异必须看清**：`dsh-effort-router` 与 `dsh-auto-upgrade` 永久无 UI，
  本项目**有**；不要把它们的"无 UI"哲学照抄过来。
- **零美术资产**：包内无图片、无 emoji、无头像、无人物图标；形状是语义的唯一载体，
  颜色只是扫视加速器（P1 / P6，CI 门禁）。
- **可删除性**是本项目的设计红线：删掉 bundle 行并删除配置的 `storagePath`（JSONL 台账）
  与 `$DSH_HOME/profiles/<profile>/node_modules/<plugin>`，即应完全消失，
  不留下任何需要手工清理的耦合。
- **防失效优先于补救**：每次宿主升级观察到的失效模式（`startContinuable` →
  `startActivation`、`toolFilter` 从 start 期移出、`inject` 未声明属性取值抛错、
  `ctx.compaction` 在宿主平面不可用），都要沉淀为下一次升级的前置检查项
  （症状 → 检查 → 判据），写进开发计划的已知残留与验证阶梯，而不是把"有兜底"
  当成不修的理由。

## 1. 角色与决策权

| 角色 | 职责 |
|---|---|
| **出品人**（人类，KEI.NEO / @neo805） | 提交需求、裁定未决事项、批准版本位变化、批准 push / 建仓 / 打 tag、在 Desktop 上做产品出口验收 |
| **AI 第一作者**（DeepSeek-V4.1-Flash-1017） | 撰写需求与开发计划、测试先行实现、构建打包、安装到 Web、与 Web 实机通信验证、安装到 Desktop、出具证据报告、提交（commit） |

- **演进节奏由出品人控制**，控制手段只有两个：**需求提交**与**产品出口验收**。
  没有走完验收阶梯的版本不算交付。
- **AI 不得自行扩大需求范围。** 实现中发现的范围变化，回报给出品人，回到
  `docs/REQUIREMENTS.html` 重新审批，而不是"顺手做了"。
- **AI 对技术判断负责。** 出品人不承担"这个 API 还能不能用"这类判断；AI 也不把
  技术取舍包装成需求让出品人拍板。
- 本项目由 AI 作为**第一作者**：计划、对外说明、变更日志的主要撰写人。出品人保留
  否决与改写权。
- 历史沿革：`0.1.0`–`0.2.0` 由 **moonshotai-Kimi-K3** 完成（P0–P4 全阶段与 0.2.0 真机修复批次，
  过程见 `docs/mvp-exit-v0.1.0.md`、`docs/decisions/` 与对应会话记录）；`0.2.1` 起由
  **DeepSeek-V4.1-Flash-1017** 担任 AI 第一作者。规范中的"AI 第一作者"指当前在任者，
  角色可交接，规范不随之重写。

## 2. 版本号治理

版本号形如 `X.X.X-rc.X`。**本项目当前版本 `0.2.1-rc.8`**；**所有新版本号一律带
`rc` 后缀**（`package.json`、`CHANGELOG.md` 标题、README 首屏、git tag 一律一致）。
下一版本候选：`0.3.0-rc.1`（探针功能，需出品人批准第二位）。

| 情形 | 做法 | 示例 |
|---|---|---|
| 修 bug、调参数、改文案、UI 微调 | **只递增 rc 序号**，不动基三位 | `0.2.1-rc.1` → `0.2.1-rc.2` |
| 小功能演进 | **第 3 位 +1，rc 重置为 1** | `0.2.0` → `0.2.1-rc.1` |
| 大功能演进（需动第 2 位） | **必须先报出品人审批**，批准后 `0.x.0-rc.1` | `0.2.x` → `0.3.0-rc.1` |
| 动第 1 位 | 同大功能演进，须审批 | `0.x` → `1.0.0-rc.1` |

- **要谦虚。** 一串 bug 修复不值得一个 patch 号；版本号是给使用者的承诺，不是进度条的装饰。
- 版本号写在 `package.json` 的 `version`；git tag 用 `v` 前缀同名（如 `v0.3.0-rc.1`），
  **tag 只在出品人批准 push 时一并创建**。
- 一次交付只对应一个版本号；rc 序号只增不减、不复用、不回退。
- 每次版本变更**必须**同步写 `CHANGELOG.md`（[Keep a Changelog] 结构：
  `Added / Changed / Fixed / Removed`，只记对外可见的行为变化）。
- **README 首屏必须标注当前版本号**，`README.md` 与 `README.zh.md` 两版都要有，
  且与实际发布的版本号一致。
- **版本区间要写宽。** `engines.dsh` 与 `@deepseek-ai/dsh-*` peer **一律写区间**，
  不写精确 `peerDependencies`——本插件自己就是被版本闸门伤过的那个（0.2.0 为适配
  `0.2.1-rc.2` 要整栈对齐，`startContinuable` → `startActivation` 全量改道）。
  **现状偏差**：当前 `engines.dsh` 与 6 个 peer 仍精确钉 `0.2.1-rc.2`，
  区间化列为技术债 T-1，改造前必须先验证宿主缝仍成立（见开发计划 §4）。

[Keep a Changelog]: https://keepachangelog.com/

## 3. 测试先行（Test-first，硬性）

- **所有新功能**遵循：先写测试（红）→ 实现（绿）→ 重构。测试必须先因"功能尚不存在"
  而失败；直接写出"一次就绿"的测试视为无效，报告里要说明红灯证据。
- **所有 bug 修复**必须先补一个能复现该 bug 的回归测试，再修。
- 测试命令固定：
  - 单测：`pnpm test`（`vitest run`，include `test/**/*.test.ts(x)`）
  - 全门禁：`pnpm verify`（typecheck → lint → boundaries → coverage（globalSetup 唯一构建）→ assets → pack-smoke）
- **覆盖率阈值是全局 90%**（lines / branches / functions / statements）。
  设计上的按层阈值（kernel ≥90 / service ≥80 / host ≥70 / client ≥60）尚未在
  `vitest.config.ts` 启用，列为技术债 T-9。
- 报告里给出通过数与覆盖率；**测试基线 60 文件 / 480 测试**（2026-10-27 rc.8 实测），
  数字变化时同步更新到本文件 §8 与开发计划，不让它变成过时数字。
- 纯文档、纯配置变更可豁免测试先行，但必须在交付报告里写明豁免理由。
- 覆盖率不是目标：**不为凑数字写造作测试**。不可达的防御分支允许留空，但要在报告里点名。

## 4. 验证阶梯（顺序固定，不可跳级）

每次交付按以下四级推进，**上一级未通过不得进入下一级**：

1. **标准化测试**：`pnpm verify` 全绿；`pnpm pack` 出 tarball；`plugin_check` 自查通过
   （必要非充分，边界见 §13）。
2. **安装到 DSH Web**：先备份 profile 的 `package.json`、`cordis.patch.yml`
   （戳 `yyyyMMdd-HHmmss`），再安装，再**逐文件哈希比对**。安装后三项自查：
   裸 import 预检（`node -e "import('<入口>')"`）、`dsh --profile <p> --dump-config`
   无跳过警告、profile 体检。**勿裸 `pnpm add`**（用户 pnpm 与 ASAR pnpm store
   不匹配会打坏同 profile 其他插件）；若本机装了 profile 安全安装技能，优先用它。
3. **Web 实机验证**：由 AI **直接与 DSH Web 通信**（建会话、发指令、读回结果）完成，
   不能只看日志。`/` 与 `/api` 对没有 cookie 的请求一律 `401`，但链路是通的：
   - **取 token 换 cookie**：`dsh web` 启动行是 `dsh web: http://127.0.0.1:<port>/?token=…`；
     stdout 已重定向就直接读日志文件，否则重启宿主并重定向后再读。用
     `WebRequestSession` GET 这条 URL 拿到 cookie，后续请求复用（无 cookie 即 401）。
     **token 不写进报告、不贴进对话。**
   - **调 RPC**：`POST /api/<endpoint>`，body **手写 JSON**：
     `{"type":"client-request","rpcId":"<uuid>","method":"<endpoint>","payload":{"args":{…}}}`
     —— `args` 内恰好一个 plain object；响应看 `result.ok` / `result.value`。
   - **三个端点够用**：`session/create`、`session/selectModel`、`session/prompt`。
   - **本项目特有的低成本取证**：读该 profile 里插件自己的落盘台账
     （配置的 `storagePath`，JSONL append-only），核对**新增事件**
     （`comm.deliver` / `comm.reject` / `budget.consume` / `vertex.started`），
     做"预期 vs 实际"比对；**不要只看 RPC 返回 `ok`**。
   - **两个坑**：PowerShell 的 `ConvertTo-Json` 会把空嵌套对象序列化成网关不认的形状
     （报 `Remote payload must contain exactly one plain-object args field`），故 body
     手写；**换 `node_modules` 不会让运行中的宿主换代码** —— Web 要重启 `dsh web`，
     Desktop 用 `plugin_manager` disable→enable 重挂载，且同值 `set_plugin` 不会触发重载
     （返回 `changed:false`）——是否生效要用**可观测行为**判定。
   - **通道确实不通时**：如实报告阻塞（原始错误 + 已试路径），把可复制的验收步骤交回
     出品人；不把"没测"说成"测过"。
4. **安装到 Desktop + 置于 disable 状态 + 出品人验收**：AI 负责安装与自查，并在交出验收前
   将本插件置为 `disabled`，避免宿主重启时自动挂载引发崩溃；出品人确认宿主稳定后，
   再按需启用并完成产品出口验收。**实机验证分先后：先在 DSH Web 上验证，通过后再在
   DSH Desktop 上验证**，两者先后分开；Web 未通过前不动 Desktop。

**Web 实机测试闸门（防止测试成本爆炸）**：

- 每条测试必须设**合理的 timeout**；超时即判定失败或中断，不允许无限等待。
- 必要时**主动中断测试会话**（kill / 关闭会话），并把中断原因与已得结论写入报告。
- **本项目仍在起步阶段：单个版本的 Web 实机测试总时长不超过 45 分钟**（含创建会话、
  调用、等待、重试）。超预算即收束为"已验范围 + 未验范围"的结论，不得擅自延长。
- 重大功能（如探针的 AC-1 零污染验证）确有必要增加预算时，**向出品人申请**，说明已用
  时长、剩余待验项、预计追加量；获准后按批准额度执行并记录。

- 不允许跳过第 2、3 级直接做 Desktop 验收；不允许把"自动化测试通过"表述为"已实机验证"。
- 实机验证的证据形态：会话 id、工具调用与返回摘要、耗时、落盘台账新增条目、
  UI 类附截图或结构描述。
- **UI 类改动的最终验收权归出品人**：自动化测试通过 ≠ 功能可用。仅当出品人明确表示
  "该项留到大版本升级时复测"，AI 才可以把该项挂起，并登记到开发计划的已知残留。

## 5. 环境纪律与回滚优先

- **改动已安装环境前先留退路**：备份 profile 的 `package.json` 与 `cordis.patch.yml`，
  记录时间戳（`yyyyMMdd-HHmmss`），使回滚可追溯到具体一次操作；插件目录在覆盖前同样
  留一份快照。
- **破坏性操作先确认**：删除/覆盖/移动文件、批量替换、清空 `node_modules` 等，
  先说明影响范围并取得确认。
- 不在进程内替换正在运行的宿主或自身；需要重启才能生效的改动，如实报告
  "已装文件、待重启生效"，不把待生效说成已生效。
- 宿主插件只在**进程启动**时加载：验证 patch/profile 改动必须完全重启应用，刷新页面不算。

## 6. 实证优先（Evidence over assertion）

- 关于状态的任何结论都要有**可复核的证据**，而不是记忆或推断：
  - 仓库状态 → 实际跑 `git log` / `git status`；
  - 功能可用 → `pnpm test` 实际通过数（当前基线 **60 文件 / 480 测试**）；
  - 安装成功 → **构建产物与已安装文件的哈希逐一比对**，而不是"拷过去了"；
  - 接线生效 → `dsh --profile <name> --dump-config` 实际输出 + 裸 import 预检；
  - 通信闸门生效 → 台账里**新增的事件条目**（reject / degrade / deliver）。
- **不确定就说不确定**；失败要如实、完整地报告，包括失败的原始错误文本，不绕过、
  不改断言去迎合结果。
- 报告结论时**带上数值与路径**（版本号、提交号、通过数、哈希、耗时、会话 id、台账路径），
  让出品人能独立复核。

## 7. 追根因，不打补丁

- 症状出现时，**逐层定位到机制层的根因再修**，不用"看着像好了"的绕过。
- 定位到哪一层，就在那一层修：根因在数据构造/投影层，就不要在渲染/选择器层打补丁。
- **归罪前先验证**：宿主报"failed to import"却不给真实异常时，用裸 import 预检
  （`node -e "import('<入口>')"`）区分「插件坏了」与「环境遮蔽」。
- 每次排查都问：这是**什么时候开始错的**？如果答案是"从第一天就错"，那要修的是最初的
  设计，而不是最近一次改动。
- 排查过程要产出**结论**（试过什么、为什么不行），避免重复走同一条死路。

## 8. 交付清单（每次改动都走完）

1. **改动过依赖声明时**（`package.json` 的 dependencies / devDependencies /
   peerDependencies / `dsh.client`）：先 `pnpm install --lockfile-only` 同步
   `pnpm-lock.yaml`，再 `pnpm install --frozen-lockfile --ignore-scripts` 复现 CI 的
   安装检查，**必须通过**。依赖声明没动时跳过本步。
2. `pnpm verify` —— build / typecheck / lint / 边界 / 零资产 / 覆盖率 / pack-smoke 全绿。
   `dist/` 与 `coverage/` 已 gitignore：**构建产物不入库**，但装包前必须重建。
3. `pnpm test` 单独记下通过数（当前 **480/480**，60 文件）与新增测试清单（§3）。
4. 按 §2 调整版本号；同步 `CHANGELOG.md` 与 README 首屏（中英双版）。
5. `plugin_check` 自查打包元数据（§13），并明确它只是必要非充分。
6. `pnpm pack` —— 出 tarball。
7. 安装到 **Web profile**：备份 → 安装 → 逐文件哈希比对 → 裸 import 预检 →
   `--dump-config` 无跳过 → 体检。
8. **Web 实机验证**（§4 第 3 级，受 45 分钟闸门约束）。宿主若需重启才能加载新代码，
   如实报告"已装文件、待重启"，并给出重启后的一次性验证步骤。
9. 安装到 **Desktop profile**：备份 → 安装 → 哈希比对 → 将本插件置为 `disabled` 后交出验收。
10. `git add -A && git commit` —— **本机提交，不以出品人验收为前提**：提交信息说明
    **改了什么、为什么**。工作区不长期挂着一堆未提交改动。
11. 向出品人报告：结论、证据（数值/哈希/会话 id/**commit 号**）、Desktop 验收步骤、
    已知残留、下一版本候选内容。
12. **验收与 push / 打 tag**：出品人验收通过并明确批准后，才推送（§10）。
    验收不通过时，改动继续留在本地，按反馈修完再来一遍。推送前再跑一次
    `plugin_check` 与全量测试，把数字写进批准请求里。

> 顺序的用意：**本地先固定，对外最后走**。commit 是本地动作，随时可改可退；
> push 是对外动作，必须等验收与批准。

## 9. 已知残留必须公示

- 无法立即解决、或经权衡后**有意接受**的问题，登记在 `DEVELOPMENT_PLAN.md` 的
  **§9 已知残留**表里，标明现象、影响范围、缓解手段与归属阶段，**不得静默丢弃**。
- 上游问题与本项目问题要分开定性：确认属上游的（例如 Web GUI 在工具调用到达
  `execute` 前按 schema 归一化入参、导致未知字段守卫离线可见真机不可达），
  记录结论与证据后结案，不要挂在本项目的待办里冒充未完成工作。

## 10. 权限边界与对外动作

- **`git push` 必须先问。** 公开仓库 `neo805/dsh-agent-teams-concourse` 已于
  2026-11-06 建仓并完成首次推送，`main` 已跟踪 `origin/main`。此后**每次** push、
  打 tag 仍须出品人逐次明确批准；AI 只能按批准范围通过 `git` CLI 操作，不得自行
  扩大推送内容。
- 提交（commit）可自行完成并保持本地领先（§8 第 10 步，装到 Desktop 之后即提交，
  **无需出品人验收**）。
- **不得**：未经批准 push / 建仓、自行升大版本号、静默丢弃已知问题、把未验证的事说成
  已完成、在会话内直接替换正在运行的宿主或自身。
- 仓库**不开启 Issues、不接受 Pull Requests**（见 `CONTRIBUTING.md`）。

## 11. 文档与隐私

- **面向出品人的报告用中文**；仓库文档遵循既有双语习惯（`README.md` /
  `README.zh.md`；其余文档中文为主）。
- 文档分层与可追踪性：
  - `docs/REQUIREMENTS.html` —— **唯一需求依据**；
  - `docs/dsh-agent-teams-concourse-report.html`、`docs/dsh-side-inquiry-probe-report.html`
    —— 调研底稿（含竞品与平台原语证据）；
  - `research/01–13-*.md` —— 逐条 文件:行号 证据；
  - `docs/decisions/`、`docs/spikes/` —— 工程决议与探针报告；
  - `DEVELOPMENT_PLAN.md` —— 施工依据与已知残留。
  以上均**入库可追踪**。
- **入库文档不得包含个人隐私或机器专属信息**：
  - 绝对路径中的用户名、真实姓名、邮箱、账号、token / 密钥；
  - 机器专属的运维日志、provider 凭据、回滚记录、会话全文；
  - 真实用户语料（语料只用脱敏后的仿真数据，见 `docs/decisions/D-P0-environment.md`）。
- 写路径时用环境变量或占位符表达，例如 `$DSH_HOME/profiles/<profile>/…`。
- 提交前自检：这份文档如果被陌生人看到，会不会暴露维护者的个人信息或本机结构？

## 12. 沟通约定

- **结论先行**：先说结论与影响，再说依据与细节。
- **数值说话**：版本、提交号、通过数、哈希、耗时，能量化就量化。
- **不夸大**：不用"完美/彻底解决"这类词描述未经验证的结果；验证过了才说验证过了。
- **UI 类交付**：附组件结构与预期视觉效果（本项目的 UI 是需求的一部分），并把截图反馈
  纳入下一轮输入。
- 出品人指出规范层面的问题时，AI 应当**把结论固化进本文件**，而不是只记住这一次。

## 13. 开发依据与验收工具（本项目专属）

**开发依据：按技能指导进行。** 插件开发遵循技能 `cordis-plugin-development`
（含 `references/host-plugin`、`ui-plugin`、`practices`、`user-actions`、`verification`）；
开工前先读技能与对应 reference，**不要凭记忆写 API**，用 `cordis_inspect_query` 读实际
契约，或直接读宿主产物核对。宿主参考副本要与**运行中的宿主版本**对齐，核对前先确认版本。

**本项目的四条形态红线（违反即静默失效，且报错极具迷惑性）**：

- 必须 `export const inject`（本项目为 `['subagents','agents','llm','tools']`）；
  缺失即静默不激活，且 cordis 对未声明属性取值会直接抛错。
- `ctx.tools.register` 只收 `defineTool` 产物，output schema 必须是闭合对象
  （`additionalProperties:false`）；注册抛错会**回滚整个插件 effect**，下游报
  `NO_PROVIDER`。
- `apply` 内每步独立 `try/catch`，绝不 throw（NFR-2 防 effect 回滚）。
- NFR-1 惰性安装：`enabled !== true` 时零行为变更。

**验收工具：`plugin_check`（必要非充分）。** 每次交付用 `plugin_check` 自查，并明确边界：
它只读打包元数据、不读代码，检查五类打包问题（`patch-shipped`、`rows-resolvable`、
`client-half-shipped`、`prebuilt`、陈旧版本区间）。**没有报告 ≠ 插件安全或可用**，
仍须走 §8 的构建、测试、哈希比对与出品人实机验收。

**本项目特有的门禁**：`check-boundaries`（kernel 零宿主依赖）、`check-no-assets`
（零图片零 emoji）、`pack-smoke`（tarball 装载冒烟）、以及 **NFR-9 绕过矩阵**
（四条入口发闭边消息，全部被拦或留痕）。

---

_本规范随项目演进；每次修订请在本文件中直接改动，并在提交信息中说明原因。_
