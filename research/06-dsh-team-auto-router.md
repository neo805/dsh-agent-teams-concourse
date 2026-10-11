# 06 · dsh-team-auto-router 深度调研（一手精读）

> 调研人：Captain（本人）直接精读全部源码（仅 5 个文件 / 30.8 KB，未压缩）
> 版本：`0.1.2` · 作者仓库：https://github.com/snow930/dsh-team-auto-router
> 安装位置：`C:\Users\KEI.NEO\.dsh\profiles\web\node_modules\dsh-team-auto-router`
> 许可证：MIT

---

## 1. 定位与需求

它不是"组队插件"，而是 **`@nanmicoder/dsh-agent-teams` 的宿主端伴生插件（companion plugin）**。

它要解决的问题是：**用户不会主动说"用 AgentTeams 做 X"**。原生 agent-teams 依赖三种激活路径——用户敲 `/agent-teams` 手势、用户自然语言显式要求、或 captain 自己判断——三者都要求"有人先想到要组队"。auto-router 补上第四种：**由宿主自动识别"这条任务够复杂，值得组队"**。

一句话：**它是 agent-team 品类的"入场闸机"，不是"组织能力"本身。**

设计哲学（README 原文，`README.md:9`）：

> **默认 `autoTrigger: off`，安装本身不改变任何会话行为。**

这是它的核心工程美德：**惰性安装**。`apply()` 在 mode 为 `off` 时**直接 return，连监听器都不注册**（`lib/index.js:76`）。这跟 dsh-team-rooms 的 patch 注释里"安装即改行为"形成对比。

---

## 2. 完整机制：六道门触发流水线

`lib/index.js:79-113` 挂在 `agent/pre-step` waterfall 上。**任何一道门不放行，原决策原样通过**（`return decision`），会话完全无感：

| 门 | 位置 | 逻辑 | 证据 |
|---|---|---|---|
| 门 1 开关 | `index.js:73-76` | `autoTrigger: off` → 不注册监听器 | `if (mode === 'off') return;` |
| 门 2 来源过滤 | `goal.js:15-26` | 只认 `source.kind === 'user'`；取批次中**最新一条**非空 user 文本 | 倒序遍历，`message?.source?.kind !== 'user'` 即跳过 |
| 门 3 手势避让 | `index.js:62`、`index.js:86` | goal 以 `/agent-teams` 开头（后接空白或结尾）→ 跳过 | `const GESTURE = /^\/agent-teams(?=$|[\t\n\r ])/u` |
| 门 4 评分 | `scorer.js:165-247` | 硬否决或 `score < scoreThreshold` → 放行 | 见下节 |
| 门 5 冷却 | `index.js:92-94` | 距上次触发不足 `cooldownMinutes` → 放行 | `let lastFiredAt = 0`（**仅进程内存**） |
| 门 6 注入 | `index.js:96-110` | `throwIfAborted` 后注入指令消息 | 返回 `{ kind:'enter', messages:[...decision.messages, activation] }` |

**门 3 的巧思**：两条激活路径永不叠加在同一条消息上。

**门 6 的关键安全属性**：注入的消息是**追加**（`[...decision.messages, activation]`），**从不修改或拒绝**原决策的消息。构造消息时内联复制了 `@deepseek-ai/dsh-llm` 的 `freezeMessage/createMessage` 语义——`structuredClone + deepFreeze + randomUUID`（`index.js:27-42`），以避免对宿主已提供的 `dsh-llm` 产生清单层重复依赖与遮蔽警告。

**异常安全**：整个评分+注入包在 try/catch 里，任何异常都 `return decision` 并 `logger.warn`（`index.js:108-112`）。README 明确："绝不阻断正常对话"。

---

## 3. 评分器（`lib/scorer.js`）——本报告最重要的可复用资产

**纯函数、零 LLM 调用、零宿主依赖、可完全单测**（248 行）。作者定位很清楚（`scorer.js:4-6`）：

> The score is deliberately coarse — its job is to gate a confirmation prompt, not to make an irreversible decision (that remains the user's).

### 3.1 加法信号

| 信号 | 分值 | 判定 | 证据 |
|---|---|---|---|
| `implement` | **+2** | 命中显式实施短语（"开始实施/按方案执行/proceed with the plan" 等 16 条） | `scorer.js:132-156` |
| `structure` | **+2** | `列表项数 + 并列连词数 + (紧凑枚举?2:0) >= 2` | `scorer.js:177-194` |
| `scope` | **+2** | 去重后 ≥2 个路径型/包名型 token | `scorer.js:196-216` |
| `task-type` | +1 | 命中批量/迁移/审计/重构类中英关键词 | `scorer.js:218-223` |
| `length` | +1 | 文本 > 200 字符 | `scorer.js:225-228` |

### 3.2 两道硬否决（一票否决，得分再高也不触发）

- **`too-short`**：`trimmed.length < minLength`（默认 50）→ `ok:false`（`scorer.js:173-175`）
- **`qa-shaped`**：`看起来像提问` 且 **无结构信号** 且 **无祈使提示词** → `ok:false`（`scorer.js:231-233`）

**双重豁免**：命中 `implement` 时，两道硬否决**全部豁免**（`scorer.js:169-175`、`231`）。理由：`"确认，开始实施"` 只有几个字，却是最强信号（`scorer.js:127-131`）。

### 3.3 几个值得偷师的细节工程

1. **否定守卫**：命中位置**前 4 字符**内出现 `别/不/没/莫/勿/尚未` → 该处不计（`scorer.js:139-156`）。`"先别开始实施"` 是拒绝不是批准。同一短语多处出现**逐处判断**（`from = at + phrase.length` 循环）。
2. **嵌套连词去重**：短词含于长词时只计长词——`"然后分别"` 命中后不再重复计 `"然后"`（`scorer.js:182-184`）。避免中文口语里的过度计数。
3. **紧凑内联枚举**（`scorer.js:79-104`）：识别 `"1改宽侧边栏 2保持点击切换"` 这种**无标点连续升序数字对**。排除项设计得很细：
   - 数字后跟**量词**（个/位/条/项/次/…共 27 个）→ 是数量不是枚举
   - `(?![.、)）%])` 排除小数与百分号
   - 行首列表（`LIST_ITEM`）另行计数，不重复
   - 必须**连续升序**且前一个在 1..8 之间
4. **包名型 scope token**：`"dsh-agent-teams 和 dsh-mneme"` 无斜杠也算多目标（`PACKAGE_SHAPE`，长度 >6 才计）；且若已被某个路径 token 覆盖则去重——`"/x/git/dsh-foo"` 与 `"dsh-foo"` 算**同一个**目标（`scorer.js:206-213`）。
5. **中文疑问词用 `startsWith` 不用 `\b`**：CJK 字符周围没有单词边界（`scorer.js:54-59` 注释明确）。

### 3.4 ⚠️ 最有价值的一条经验：**启发式必须用真实语料校准**

更新日志 `README.md:191-196` 记录了 0.1.1 的**重大失败与修复**：

> 评分器对真实中文表达的校准（**此前阈值 4 下真实任务消息最高仅得 1 分**）

也就是说：初版按"理想化长任务描述"设计信号，实际用户消息**根本打不到阈值**——真实中文任务消息短、口语化、少路径、少列表。修复动作三项：

1. 新增紧凑内联枚举信号（口语用户会写 `1做A 2做B` 而不是 markdown 列表）
2. 补口语并列连词：`然后/另外/还有就是/还要/再把`
3. `qa-shaped` 否决放宽：疑问开头但含祈使提示（帮我/请/修复/排查…）时正常进入评分

并把推荐配置从 `scoreThreshold:4, minLength:50` 下调为 **`scoreThreshold:2, minLength:30`**。

**对新插件的直接教训**：任何"自动建议"能力，如果只用纯启发式且不拿真实会话语料回归，几乎必然校准失败。→ 见需求文档 FR-5 的"建议可解释 + 可校准 + 双通道"设计。

---

## 4. 激活模式与注入指令

`lib/directive.js` 只做一件事：**构造注入文本**。文本刻意保持英文，以匹配 captain 协议的语言（`directive.js:5-8`）。

| 模式 | 注入内容 | 语义 |
|---|---|---|
| `ask` | "router 给这条请求打了几分、命中了哪些信号；先用**最多三句话**解释为什么这任务适合多智能体，然后调 `ask_user_question` 问一次确认；确认才激活协议，拒绝就**当作没发生过，且不要再提 router**" | **人类在环** |
| `auto` | "router 判定达到阈值，现在激活 AgentTeams 协议，你是 captain" | 确定性激活 |

**`ask` 档的措辞有很强的产品意识**：要求"最多三句话"限制解释长度（防啰嗦）、要求"拒绝后不要再提 router"（防骚扰）。这是把"提示即用户体验"当回事的写法。

`auto` 档刻意**不复刻 gesture**：`source.kind` 保持 `'team-auto-router'`，让日志能区分两条路径（`directive.js:32-38`）。

---

## 5. UI 呈现

**零 UI。** `package.json` 没有 `dsh.client` 字段，没有 `exports["./client"]`，没有 `dsh.client.inject`。它是一个**纯宿主端插件**——唯一产物是注入到对话流里的一条文本消息。

这正是它的克制之处：**它不做界面，它只做决策**。对新插件的启示：**"决策"与"呈现"是可以彻底分离的两层**。

---

## 6. 硬约束与安全评估

| 维度 | 实现 | 评价 |
|---|---|---|
| 误触发防护 | 六道门 + 两道硬否决 + 冷却窗口 | 分层充分 |
| 注入内容可信度 | 只认 `source.kind === 'user'` | 插件注入/工具结果/外部文本**无法触发**——这是防"注入放大"的关键一道 |
| 决策不可逆性 | 无。`ask` 档最终决定权在用户 | 作者明确："not to make an irreversible decision" |
| 异常隔离 | 全路径 try/catch + 原样放行 | 强 |
| 与显式激活的冲突 | 手势避让 + 冷却，**但不做活跃团队感知** | ⚠️ 已知缺陷 |

### 已知限制（作者自述，`README.md:165-171`）

1. **不做活跃团队感知**：显式 `/agent-teams` 建队后，router 仍可能对后续新消息触发。防线只有 cooldown 与 ask 档的用户确认。
2. 启发式必然误报/漏报。
3. **状态仅存进程内存**（冷却时间戳），**重启即复位，无磁盘状态**——重启后可以立刻再次触发。

---

## 7. 兼容性与工程化

- 依赖极小：仅 `@deepseek-ai/schemastery ^3.18.1`（`package.json`）
- 配置用 schemastery 描述（`index.js:50-55`），带 `z.natural().default()`，并且**防御性归一化**：profile 层写了非法值时回退 `off`（`index.js:73-75`）
- 打包：`files` 只含 `lib`/`cordis.patch.yml`/`README.md`；**无构建步骤**（纯 ESM JS），`prepublishOnly: npm test`
- 测试：`node --test test/*.test.js`，20 例（0.1.2 后），覆盖 scorer/goal/directive 全部纯逻辑
- 测试策略值得注意：**把宿主依赖全部推到边界的薄适配层**（`index.js`），把所有可测逻辑放进零依赖纯函数模块。这是它 20 个用例就能覆盖核心逻辑的原因。

---

## 8. 与用户的"自动分配建议"需求的映射

用户需求原文：

> 我更希望在每次任务需要多子代理共同协作时，能够手动确定每一个子代理（结合其任务难度）所使用的模型和思考强度，当然通过 `dsh-team-auto-router` 类似的逻辑提出**自动分配建议**也是很实用的。

**auto-router 能提供的 & 不能提供的：**

| 能力 | auto-router 现状 | 新插件需要做到 |
|---|---|---|
| 判断"该不该组队" | ✅ 有（二值：触发/不触发） | ✅ 复用同一套门控骨架 |
| 判断"该用什么拓扑" | ❌ 无（只会激活单一 captain 协议） | 🆕 需要把打分扩展成**拓扑建议**（T1a/T1b/T1.5/T2a/T2b） |
| 判断"每个子代理用什么模型/强度" | ❌ 无（完全不涉及模型） | 🆕 需要**逐子任务的难度画像 → 档位映射** |
| 建议的可解释性 | ✅ 强（`signals[]` 逐条列出，注入文本里还要求 captain 复述） | ✅ 必须保留并加强 |
| 用户可否覆盖 | ✅ 通过 `ask_user_question` 确认/拒绝 | ✅ 需升级为**可逐个编辑**的建议表 |
| 学习/校准闭环 | ❌ 无（阈值靠人工按实测调） | 🆕 需要记录"建议 vs 实际采纳"，供校准 |

**关键差距**：auto-router 的打分粒度是**整条用户消息**；用户要的是**每个子任务**的粒度。后者需要先有任务分解（DAG），再逐任务打分——这只能发生在**计划阶段**（staged plan），因此新插件的自动建议必须内嵌在"计划编辑器"里，而不是 pre-step 注入。

**结论**：auto-router 是"入口处的粗筛"，新插件需要的是"计划期的细排"。两者可共存：auto-router 决定**是否进入 concourse**，concourse 内部再逐任务排布模型与拓扑。

---

## 9. 可复用清单（给新插件）

| 机制 | 复用价值 | 说明 |
|---|---|---|
| `agent/pre-step` waterfall 的"追加不修改"注入模式 | ⭐⭐⭐ | 安全地在对话流里放一条"系统建议"而不破坏原决策 |
| 六道门分层 gating | ⭐⭐⭐ | 每层独立、任一层否决即透传，易测易解释 |
| `source.kind === 'user'` 来源白名单 | ⭐⭐⭐ | 防注入放大的第一道防线 |
| 纯函数评分器 + 边界薄适配层 | ⭐⭐⭐ | 让核心逻辑可以被真实语料回归测试 |
| `signals[]` 可解释输出 | ⭐⭐⭐ | 用户信任自动化的前提 |
| `ask` 模式的措辞规范（限长、拒绝后不再提） | ⭐⭐ | 防骚扰的产品细节 |
| 防御性配置归一化 | ⭐⭐ | profile 层写坏值不能崩 |
| 惰性安装（off 时零副作用） | ⭐⭐⭐ | 插件生态的基本礼貌 |
| 阈值需真实语料校准 | ⭐⭐⭐ | **反面教训，必须内建校准机制** |
| 无 UI 的纯决策层 | ⭐⭐ | 决策与呈现分离 |
