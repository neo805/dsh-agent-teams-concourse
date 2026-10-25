# 11 · 会话中途的旁路查询（Side Inquiry）需求空间调研

> 调研对象：一条**尚未实现**的产品需求——「会话中途的旁路查询：把一个问题丢给一个隔离的执行单元，只拿回一段摘要，并且可以选择**丢弃**，全程不污染主会话上下文」。
> 调研范围：A 本机 DSH 生态已装插件 · B 外部产品同类形态 · C 设计空间 · D 与 `concourse` 五旋钮框架的接续。
> 证据纪律：本机结论带 `文件:行号` 或包内声明文件；外部结论带可点击 URL；查不到的一律写「未查到」，不编造功能、版本号、star 数。
> 时间基准：本文件写作时 `dsh` 生态快照见 §8.3。

---

## 1. 一句话定位

**旁路查询 = 在主会话的线性历史之外，临时开出一个「读了主会话、但不被写回主会话」的隔离执行单元；它的唯一对外接口是一段有归属、有生命周期、且可以被丢弃的摘要。**

它与相邻概念的差别只在一处，而这一处决定了全部设计：

- 子代理（subagent）是**任务分解**的产物——被派活、要汇报、结果进主线；
- 旁路查询是**注意力管理**的产物——不被派活、不必汇报、结果**可以不进主线**；
- 压缩（compaction）是**对已发生历史的改写**；旁路查询是**对未发生历史的选择**。

用一句话钉住需求的内核：**它要的不是"另一个 agent"，而是"一段可以被反悔的上下文"。**

---

## 2. 需求要素拆解

### 2.1 原始表述（用户口述，逐字保留）

> 思维导图与子代理拓扑有本质上的相似之处。从产品需求角度出发，本质上就是**会话的中途想要查询某些旁路信息，但又不想污染上下文**，只想以**子代理类似的状态**返回一个摘要的信息，或者**丢弃**这个子代理信息。

### 2.2 拆成五个要素

| ID | 要素 | 原文锚点 | 性质 | 可验证的验收面 |
|---|---|---|---|---|
| S-1 | **触发时机** = 会话进行中（不是开新会话） | 「会话的中途」 | 硬约束 | 主会话不中断、不新建会话 id、不切走 |
| S-2 | **查询对象** = 与主线无关的旁路信息 | 「旁路信息」 | 语义 | 与当前任务目标无直接依赖关系 |
| S-3 | **硬约束** = 不污染主上下文 | 「不想污染上下文」 | 硬约束 | 主会话 turn 序列不被插入、token 水位不被推高 |
| S-4 | **返回形态** = 摘要，且以"像一个子代理"的方式被呈现/管理 | 「以子代理类似的状态返回一个摘要」 | 形态 | 有 handle、有状态位、可被列出/查看/续聊 |
| S-5 | **关键动词** = 可丢弃 | 「或者丢弃这个子代理信息」 | 一等操作 | 存在一个"丢弃"动作，且结果符合预期 |

### 2.3 五个要素里，哪一个才是这条需求的身份？

这是本次调研最重要的一次判断，因为它决定后面所有取舍。

- S-1「会话中途」是**场景约束**：它排除了"另开一个会话去问"这种最廉价的实现（那种做法用户已经在做，需求就不成立了）。
- S-2「旁路信息」是**语义标签**：它无法被机器判定，只能由触发方声明。因此它不是实现约束，而是**分类约束**。
- S-3「不污染上下文」是**成本约束**：它其实是 S-1 的直接推论——如果结果不写回主线，就不污染。
- S-4「像子代理」是**形态约束**：它说结果不是一段裸文本，而是一个**有身份的实体**。
- S-5「可丢弃」是**一等操作**：它是全句唯一的动词，也是唯一在现有 DSH 生态里**找不到对应原语**的东西。

**结论：S-5 是这条需求的身份，S-4 是它的载体形态，S-3 是它的约束，S-1/S-2 是它的适用域。**

一个可以直接拿去用的判定式：

> 如果某个实现「旁路结果一旦产生就必然进入主线历史」，那么无论它叫不叫 side chat、subagent、scratchpad，它都**没有满足这条需求**——它只是"一次普通的工具调用"。

### 2.4 与四个相邻概念的边界（防止范围蔓延）

| 相邻概念 | 相似处 | 决定性差别 | 是否属于本需求 |
|---|---|---|---|
| 子代理（subagent） | 都是隔离上下文、都只回摘要 | 子代理的结果**必然**写回主线；旁路结果**可以选择不写回** | 是「载体」，不是「需求」 |
| 压缩（compaction） | 都降低主线 token | 压缩作用于**已发生**的历史且改写形状；旁路作用于**未发生**的选择 | 否，但机制可借鉴 |
| 检索（retrieval / search） | 都"只取所需" | 检索没有"执行单元"这一层，也没有生命周期 | 是 S-2 的一种来源 |
| 计划模式（plan mode） | 都在主线内产生可撤销产物 | plan 是**主线的状态位**（影响后续执行），不是旁路 | 否，但"可撤销"这一机制可借鉴 |

### 2.5 需求成立的最小条件（三条，缺一不可）

1. **存在一个与主线分离的执行上下文**——它读得到主线（否则 S-2 无意义），但写不回主线。
2. **存在一个显式的丢弃动作**——不是"不显示"，而是"把已产生的这段旁路内容从模型的可见视野里移除，或声明其不再有效"。
3. **丢弃之后主线仍然自洽**——主线不能因为丢了这段内容而出现悬空引用（"正如我刚才查到的……"）。

第 3 条最容易被忽略，也最容易被实现搞崩。它是本需求真正的技术难点：**丢弃不是一个写操作，是一个一致性约束。**

---

## 3. A · 本机生态现状

### 3.0 总览

核查了 `$DSH_HOME\profiles\web\node_modules\` 与 `$DSH_HOME\profiles\node_modules\` 下全部相关包，加上官方 `@deepseek-ai` 套件中与"隔离执行单元/上下文治理/回注"相关的包。

| 包 | 一句话定位 | 在这条需求轴上做到了哪一步 | 缺什么 |
|---|---|---|---|
| `dsh-palimpsest` | 新会话里按需检索同工作目录历史会话 | **做到 S-2 的一半**：只读检索、有摘要、有范围闸 | 结果是**工具结果**，必然注入主线；无丢弃、无 handle、无生命周期 |
| `billion-context-dsh` | 模型驱动的上下文压缩引擎（ACP） | **做到 S-5 的一半**：压缩可逆、可检索恢复 | 丢弃粒度是"区间"不是"条目"；无隔离执行单元 |
| `clearai-dsh` | 本体优先的 DSH agent 预设（证据校验式研究） | 与需求基本无关 | — |
| `dsh-effort-router` | 按步路由推理强度 | 与需求基本无关（是"深度"而非"隔离"） | — |
| `dsh-lit-search` | 学术文献检索/引用工具 | 只提供 S-2 的一种**内容来源** | 与隔离、丢弃无关 |
| `dsh-annotation` | **不存在**（目录实测缺失） | — | — |
| `dsh-find-plugin` | 在 agent 内找 DSH 插件 | 与需求无关 | — |
| `@deepseek-ai/dsh-tool-subagent` | 模型面向的子代理委派工具 | **做到 S-4 的一半**：结果只回最终文本、中间步骤不出子代理 | prompt + result 必然留在主线历史 |
| `@deepseek-ai/dsh-subagent-fork-in-process` | 以父 log 前缀为种子跑子代理 | **做到 S-1 的一半**：fork（带前缀）这种隔离度已存在 | 只服务于任务委派，无丢弃语义 |
| `@deepseek-ai/dsh-spill` + `dsh-spill-policy` | 超长工具文本落盘并返回定位符 | **做到「只留指针」这一档回注策略** | 无检索/删除 API；策略是自动的，不是人选的 |
| `@deepseek-ai/dsh-session-reference` | 跨会话快照引用 + 持久不可信上下文 | 做到"引用另一个会话" | 是"注入"而非"旁路"，且是持久化的 |
| `@deepseek-ai/dsh-tools`（presentationMeta） | 工具结果的 UI 专用投影 | **做到「模型看不见但 UI 能看到」这条通道** | 只读投影，无生命周期，无丢弃 |

**没有找到任何一个插件或官方包实现了完整的 S-1..S-5。** 最接近的两个，各自只覆盖一半，而且覆盖的是**不同的两半**——这一点后面 §3.10 会展开。

---

### 3.1 `dsh-palimpsest`（重点核查）

#### 3.1.1 定位（包内声明）

- 包声明：`dsh-palimpsest` version `0.2.1`，description = 「让 DSH 智能体在新会话里按需检索同一工作目录下历史会话的记忆」——`dsh-palimpsest/package.json:4`
- 宿主侧注释：「注册三个只读工具，让智能体在**新会话**里按需取回同一工作目录下历史会话的记忆」——`dsh-palimpsest/lib/index.js:2`
- 依赖注入：`export const inject = ['tools', 'sessionQuery'];`——`dsh-palimpsest/lib/index.js:14`
- 注册三个工具：`palimpsest_list` / `palimpsest_search` / `palimpsest_read`——`dsh-palimpsest/lib/index.js:21-23`
- **它是纯宿主侧插件，没有前端半边**：「插件只跑在宿主侧（没有 dsh.client 半边），不向前端投递任何代码」——`dsh-palimpsest/cordis.patch.yml:2`

#### 3.1.2 核心问题：检索结果如何进入模型上下文？

**答案：作为普通的工具结果文本，直接进入模型上下文。没有任何"只看不注入"的模式。**

证据链：

1. 三个工具都用同一个输出契约，而该契约**只有**一个字符串字段，且由 `render` 渲染成给模型读的 text block：

   ```js
   export const OUTPUT = {
     schema: { type:'object', additionalProperties:false,
               properties: { content: { type:'string', required:true } } },
     render: (_args, value) => [{ type: 'text', text: String(value?.content ?? '') }],
   };
   ```
   ——`dsh-palimpsest/lib/tools/output.js:7-16`

   该文件顶部注释明确了设计意图：「三个工具共用的输出契约：一段给模型直接阅读的文本。结构化字段留给 presentationMeta，不进入模型上下文。」——`dsh-palimpsest/lib/tools/output.js:2`

   **值得记一笔：这条注释声称结构化字段走 `presentationMeta`，但代码里 `OUTPUT` 对象并没有声明 `presentationMeta`。** 也就是说，"模型看不见、UI 看得见"这条通道在本插件里**是写在注释里的意图，不是实现**。这是一个真实的实现空缺，不是我们的推测。

2. `palimpsest_search` 的返回值就是给模型的正文：

   ```js
   return { content: publish(renderHitList(visible, { heading, maxChars: MAX_CHARS }), hidden, result.unreadable ?? 0) };
   ```
   ——`dsh-palimpsest/lib/tools/search.js:95-97`

   其中 `MAX_CHARS = 8000`——`dsh-palimpsest/lib/tools/search.js:14`

3. `palimpsest_read` 同理：`return { content: publish(content) };`——`dsh-palimpsest/lib/tools/read.js:170`

   预算上限：`DEFAULT_MAX_CHARS = 12000`、`MAX_MAX_CHARS = 60000`——`dsh-palimpsest/lib/tools/read.js:16-17`

   `MAX_LAST = 500`（`last` 参数上限）——`dsh-palimpsest/lib/tools/read.js:15`

4. `palimpsest_list` 也走同一契约（`lib/tools/list.js`，长度 2991 字节）。

#### 3.1.3 它做了哪些"防污染"的努力？

它做了**四条**防线，但**没有一条是"丢弃"**：

| 防线 | 机制 | 证据 | 与 S-5 的关系 |
|---|---|---|---|
| ① 注入点选择 | 明确**不注入 system prompt**，只走工具结果通道 | `lib/core/privacy.js:3-5`：「竞品常见做法是把记忆快照注入 system prompt，那等于开一条跨会话提示注入通道；本插件不做注入，但工具结果这条通道同样需要这道声明」 | 降低污染等级，但**仍是污染** |
| ② 不可信数据声明 + 随机边界 | 每次调用生成 `randomUUID` 前 12 位作为数据边界 token | `lib/tools/publish.js:21-22`、`lib/tools/publish.js:24-30` | 防提示注入，与丢弃无关 |
| ③ 凭据打码 | `redact(rendered)` | `lib/tools/publish.js:19` | 与丢弃无关 |
| ④ 整段会话排除闸 | 标题带 `[私密]` / `[no-recall]` / `[不参与回忆]` 的会话整段退出检索 | `lib/core/privacy.js:23`、`lib/core/privacy.js:41-44`（`hidePrivate`） | **这是最接近"遮蔽"的机制，但方向相反**：它遮蔽的是"别人的会话"，不是"我这次查的结果" |

#### 3.1.4 逐要素打分

| 要素 | 做到没有 | 说明 |
|---|---|---|
| S-1 会话中途触发 | **部分** | 它是"新会话里回忆旧会话"，与"会话中途"正交；但工具本身可在任意 turn 调用 |
| S-2 旁路信息 | **是** | 检索就是典型的旁路查询；且用 `matchesCwd` 限定了范围（`lib/core/scope.js`，`lib/tools/read.js:107-117`、`lib/tools/read.js:154`） |
| S-3 不污染上下文 | **否** | 结果是工具结果文本，必然进入主上下文 |
| S-4 摘要 + 子代理式呈现 | **半个** | 有摘要（`renderHitList` / `renderTranscript`），有行号级引用；但**没有 handle、没有状态位、不能列在侧栏、不能续聊** |
| S-5 可丢弃 | **否** | 完全没有丢弃动作。检索到的内容一旦进入主线，只能靠压缩（改变历史形状）或 spill（落盘）间接缓解 |

**净结论：`dsh-palimpsest` 是本机生态里最接近的"只读旁路检索器"，但它把"不污染"理解成了"少污染"（省 token、打码、划边界），而不是"可丢弃"。它缺的正是这条需求的动词。**

---

### 3.2 `billion-context-dsh`

- 包声明：version `0.2.27`，description = 「Active Context Pruning (ACP) for the DeepSeek Harness — model-driven context management as a CompactionEngine backend」——`billion-context-dsh/package.json:4`
- 它就是本会话正在运行的 ACP 机制（`acp_status` / `compress` / `decompress` / `search_context` 来自它）。
- 挂载方式：bundle patch **禁用宿主的 `compaction-basic`**，再插入 `compaction-acp`；注释列出的能力面为「model tools (`compress`, `decompress`, `search_context`, `acp_status`), the `/acp-prune` command, the advisory nudge, and the guidance section」——`billion-context-dsh/cordis.patch.yml`（文件头部注释块 + 两条 patch 行）
- 它的关键性质：**压缩掉的原始内容并没有消失，而是可以通过 `decompress` / `search_context` 恢复**。本会话的运行时提示也确认：「decompress: 恢复一个压缩块的原始内容……（只读；不会 unshadow）」。

**在需求轴上的位置：**

- 它提供了 **"丢弃 = 遮蔽（模型看不见但可恢复）"这一档的机制原型** ——这正是 §5.6 里最被低估的一档。
- 但它有三个不匹配：
  1. **粒度**：它作用于**区间**（range / block），不是一个"条目"或"一个执行单元"。你不能"丢这个旁路单元"，只能"压缩这段区间"。
  2. **触发方**：它由模型自主决定、或由 `/acp-prune` 手动触发；它不是"人为一个旁路问题开一个单元"。
  3. **没有隔离执行单元**：ACP 不跑子推理，它只对已有历史做治理。

**结论：ACP 是"可丢弃性"的**机制供给方**，不是需求实现方。** 任何旁路查询插件的丢弃语义，最自然的落法就是复用 ACP 的 block/shadow 抽象（如果它愿意暴露成可寻址的 handle）。

---

### 3.3 `clearai-dsh`

- 包声明：version `0.5.4`，description = 「ClearAI: an ontology-first DSH agent preset — evidence-checked research that grows into a domain ontology」——`clearai-dsh/package.json:4`
- 它是一个 **agent preset**（本体优先的证据校验式研究），不是隔离机制。
- 唯一与本需求沾边的地方：它的前端注入列表里有 `@deepseek-ai/dsh-client-ui-sidebar-right`——`clearai-dsh/package.json`（`dsh.client.inject` 字段）。这证明**右侧栏是一个可被第三方插件占用的插槽面**，是"侧栏折叠可见性"的基础设施供给方。
- 挂载：`- insert: - id: clearai-host / name: 'clearai-dsh'`——`clearai-dsh/cordis.patch.yml`
- 注释里有一条对 DSH 0.2.0+ 预设注册机制的说明（预设不再靠目录扫描，而是组合里的 `- id: preset-<id>` 声明行）——`clearai-dsh/cordis.patch.yml`。

**在需求轴上：0 分。但它的前端注入列表是一条有用的"插槽可用性"证据。**

---

### 3.4 `dsh-effort-router` / 3.5 `dsh-lit-search` / 3.6 `dsh-annotation` / 3.7 `dsh-find-plugin`

三个"在需求轴上 0 分"的包，以及一个不存在的包——合并陈述：

| 包 | 声明证据 | 与需求轴的关系 |
|---|---|---|
| `dsh-effort-router` v`0.2.3` | `package.json:4`：「context-aware per-step **reasoning-effort** routing. Classifies each step (trivial/standard/engineering/hard) … escalates on tool errors, stabilizes with hysteresis, clamps to the target model's advertised efforts, and injects an 'Auto' mask into the native model selector」；挂载 `cordis.patch.yml`：`- id: effort-router / name: dsh-effort-router` | 它管**"用多深的脑子"**，不管"用多隔离的上下文"。**0 分，但是一条旁证**：DSH 生态已经出现过"会话中途注入策略而不打断主线"这类插件，说明宿主能力上这条路是通的 |
| `dsh-lit-search` v`0.1.3` | `package.json:4`：「Academic literature search, citation and BibTeX tools … (Crossref + OpenAlex)」；注册 `lit_search` / `lit_cite` / `lit_bib` / `lit_related` 四个工具（`README.md` Usage 节） | 它只提供 **S-2 的一种内容来源**（查文献是旁路查询最常见的用途之一），结果同样以工具结果形式进入主上下文。**0 分** |
| `dsh-annotation` | **目录不存在**（实测 `$DSH_HOME\profiles\web\node_modules\dsh-annotation` 缺失，`Get-ChildItem` 返回空） | **未查到任何名为 `dsh-annotation` 的已装插件。** 需求清单里的这个名字在本机不成立 |
| `dsh-find-plugin` v`0.3.7` | `package.json:4`：「Find DeepSeek Harness plugins inside the agent — live GitHub dsh-plugin topic search, ranked by stars」；实时搜索 `dsh-plugin` topic，按 star 降序，5 分钟缓存，匿名 API（`README.zh.md` "工作方式"节） | **0 分**，但是本次调研的**方法论注脚**：本机生态的插件发现是可行的，所以"没找到实现"不是"没搜"，而是"搜了、确实没有" |

---

### 3.8 官方 `@deepseek-ai` 套件（与本需求直接相关的四组）

#### 3.8.1 子代理三件套

| 包 | version | description |
|---|---|---|
| `@deepseek-ai/dsh-subagent` | `0.2.0-rc.2` | 「Abstract subagent seam (ctx.subagents): named-provider registry for delegating to child agents」 |
| `@deepseek-ai/dsh-tool-subagent` | `0.2.0-rc.2` | 「Model-facing subagent delegation tool over the ctx.subagents seam」 |
| `@deepseek-ai/dsh-tool-subagent-control` | `0.2.0-rc.2` | 「Globally named send_message, interrupt_agent, and list_agents tools over ctx.subagents continuations」 |

（各自的 `package.json:4`）

**子代理结果如何回注主线——官方文档说得很清楚：**

- 前台模式：

  > 「The call retains the description and prompt. Success contains only the child's final text; other outcomes become `Error: <stop reason>` … Intermediate child steps stay out of the parent.」
  > ——`dsh-tool-subagent/README.md:180`

  > 「The prompt and result remain in parent history until compaction; child working context remains in the child.」
  > ——`dsh-tool-subagent/README.md:184`

  **这一行是整份调研里最关键的一句本机证据。** 它同时给出了两件事：
  1. 子代理的**隔离是单向的**——子代理的工作上下文不出子代理（隔离成立）；
  2. 但**父侧的 prompt + result 是永久留在主线历史的**，只能等压缩（"until compaction"）。**没有"丢弃"这个动作。**

- 后台模式：

  > 「The acknowledgement is retained; a one-shot final output enters parent history only when collected or injected, while a continuable child's output never returns through this tool — its settlement notice arrives independently of any tool result.」
  > ——`dsh-tool-subagent/README.md:198`

  > 「In continuable mode this tool returns no result of its own: the child's settlement reaches the parent as a service-owned notice … and the child's transcript by its id is the source of its detailed output.」
  > ——`dsh-tool-subagent/README.md:194`

  **这条更接近"只留指针"**：continuable 子代理的详细输出**根本不经过父会话**，只在结算时有一条 notice，要细节就凭 childId 去读子代理自己的 transcript。

  但已知限制里明确写了：

  > 「**Background runs expose no result through this tool** — a one-shot task's final output is collected through the generic task surface, and a continuable child's output stays in its own session, read by its subagent id.」
  > ——`dsh-tool-subagent/README.md:211`

  以及一条与"回注"直接冲突的限制：

  > 「**Shipped fork tools cannot select a child LLM route** — they inherit the parent's provider and model to keep the copied conversation prefix eligible for KV Cache reuse.」
  > ——`dsh-tool-subagent/README.md:213`

  （这条说明 fork 型子代理为了复用 KV cache，不能换模型。对旁路查询是个重要的**成本推论**，见 §5.7。）

#### 3.8.2 fork 后端（隔离度的现成供给）

- `@deepseek-ai/dsh-subagent-fork-in-process` version `0.2.0-rc.2`，description = 「In-process fork subagent backend: runs a child agent seeded with a prefix of the parent's log」——`dsh-subagent-fork-in-process/package.json:4`
- **这就是 §5.1 里"fork 当前会话（带前缀）"这一档的直接供给。** 它已经存在、已经在跑，只是**只被用于任务委派，没有被用于旁路查询**。
- 与之并列的还有 `dsh-subagent-in-process-driver`、`dsh-subagent-spawn-in-process`（"干净上下文"那一档的供给）。

#### 3.8.3 官方文档里那句关于上下文继承的话（设计含义重大）

> 「The tool's description derives from `provider.inheritsParentContext`: a fresh child gets "it does not see this conversation" wording, a forked child gets "it does not see the current in-flight turn" wording, so the model never restates or omits context that does not exist.」
> ——`dsh-tool-subagent/README.md:95`

**含义**：DSH 已经在 provider 层面把"子代理是否继承父上下文"做成了一等属性（`inheritsParentContext`），并且**把它暴露进了工具描述文案**，让模型自己知道边界在哪。这意味着 §5.1 的隔离度维度**在宿主层已有原生开关**——旁路查询不需要自建隔离机制，只需要复用这个属性并配上丢弃语义。

#### 3.8.4 `presentationMeta`：官方唯一的"模型看不见"通道

- 类型声明：`presentationMeta?(args: unknown, value: JsonValue): JsonValue;`——`dsh-tools/lib/types/index.d.ts:112`
- 运行期条件（**极其重要**）：

  ```js
  if (exec.parent === void 0 && tool.output.presentationMeta !== void 0) {
  ```
  ——`dsh-tools/lib/index.js:3554`

  **翻译**：`presentationMeta` **只在顶层执行（不是子代理的执行）时才被调用**。也就是说，**一个在子代理里跑的工具，无法向 UI 投递模型看不见的结构化数据。** 这对"旁路执行单元"的设计是一个硬约束——如果旁路单元被实现为子代理，它就不能用 presentationMeta 往 UI 送东西。

- 语义（官方类型文档）：

  > 「the read tool projects them through its `output.presentationMeta` (persisted with the session log) and `presentResult` narrows that metadata back into this view on live and replay paths alike.」
  > ——`dsh-tools/lib/types/presentation.d.ts:256-258`

  它同样出现在 `dsh-tools/lib/types/schema.d.ts:192` 与 `dsh-tools/lib/types/types.d.ts:112`。

**结论：`presentationMeta` 提供了"模型看不见但 UI 看得见且随会话日志持久化"的通道（正是 §5.3 的"仅落盘/侧栏"与 §5.6 的"遮蔽"所需的一半基础设施），但它只服务于**顶层工具的渲染投影**，既没有生命周期也没有"丢弃"动作，且对子代理不可用。**

#### 3.8.5 `dsh-spill` + `dsh-spill-policy`：官方已经实现的"只留指针"

- `@deepseek-ai/dsh-spill` version `0.2.0-rc.2`，description = 「Abstract spill storage seam (ctx.spillStore) for the DeepSeek Harness — save oversized tool text and return a retrieval locator」——`dsh-spill/package.json:4`
- 词汇表（这是"指针"策略的正式定义）：

  ```ts
  /** Opaque model-facing handle for one spilled artifact. ... Consumers render it with {@link SpillRef.retrievalHint}, but do not parse it. */
  export type SpillLocator = Branded<'SpillLocator'>;
  ```
  ```ts
  export interface SpillRef { locator: SpillLocator; bytes: number; retrievalHint: string; }
  ```
  ——`dsh-spill/lib/types/types.d.ts:16`、`dsh-spill/lib/types/types.d.ts:67-71`

- 官方自述的取舍：

  > 「Choose it when full results must remain retrievable without filling model context.」
  > 「The API does not offer retention, replacement, retrieval, or search operations. A save rejects on storage failure, leaving the caller to keep the content inline or fail.」
  > ——`dsh-spill/README.md:12`

- 明确的能力边界：

  > 「**No retrieval or deletion API** — consumers can only render the backend's locator and guidance; lifecycle and access semantics remain backend-specific.」
  > ——`dsh-spill/README.md:136`

- 以及一条与"丢弃"直接相关的所有权说明：

  > 「Storage is grouped by the owning session: forked sessions inherit existing locators from the seeded log without copying or re-owning them, and new spills after a fork use the child session id.」
  > ——`dsh-spill/README.md:62`

- `@deepseek-ai/dsh-spill-policy` version `0.2.0-rc.2`，description = 「Token-budgeted tool-result retention with recoverable text and image paths」——`dsh-spill-policy/package.json:4`
- 组合用法（官方 README）：

  > 「Mount a backend and the policy together; with `maxInlineTokens` set, an oversized text/image tool result becomes a preview plus a locator automatically.」
  > ——`dsh-spill/README.md:36`

**结论：这是 §5.2「只留指针」这一档的完整先例，而且是官方的、可组合的。** 缺的只是：策略是**自动按 token 预算触发**的，不是**人可以选择**的；而且没有删除 API（`dsh-spill/README.md:136`），所以它连"丢弃"都不支持——只能"少注入"。

#### 3.8.6 其他相关官方包（供 §5 设计空间引用）

| 包 | version | description | 对本需求的意义 |
|---|---|---|---|
| `dsh-session-reference` | `0.2.0-rc.2` | 「Cross-session snapshot references and durable **untrusted** model context (ctx.sessionReferenceResolver)」 | "跨会话引用"的现成供给；注意它自我定位为 **durable**，即与"可丢弃"相反 |
| `dsh-compaction-basic` | `0.2.0-rc.2` | 「Token-meter-driven compaction policy and LLM summarization backend」 | 自动压缩（本机已被 ACP 顶替） |
| `dsh-command-compact` | `0.2.0-rc.2` | 「Human-facing slash command for explicit session compaction」 | **人类侧"整理上下文"的入口先例**——`/compact` 这种加一个 slash command 的路径是可复制的 |
| `dsh-compaction-tool-result-pruner` | `0.2.0-rc.2` | 「Replay-safe model-free head/middle/tail pruning for tool-result surface nodes」 | **"重放安全"的移除**：说明 DSH 已经在做"移除已发生内容且不破坏重放"这件事，只是粒度是工具结果节点、且是 model-free 的裁剪 |
| `dsh-output-retention` | `0.2.0-rc.2` | 「Zero-dependency bounded-retention primitive: ItemRetainer/TextRetainer + neutral notice helpers (what did we keep, what did we omit)」 | **"我们丢掉了什么"的告知原语**——丢弃语义的 UI 侧必需件，官方已有 |
| `dsh-client-ui-sidebar-right` | `0.2.0-rc.2` | 「Right Sidebar: the docking surface's session-bound state, its panel and header expand control, and the navigation service over it」 | §5.3「侧栏折叠」的基础设施；`clearai-dsh` 已在用 |
| `dsh-session-query-sqlite` | `0.2.0-rc.2` | 「Concrete ctx.sessionQuery backend with SQLite FTS5 search」 | palimpsest 的检索底座；也是旁路产物"可检索化"的现成需求 |
| `dsh-plan-mode` | `0.2.0-rc.2` | 「Logged per-agent plan mode with deployment guidance, a direct slash command, and a user-reviewed exit」 | **本机唯一"有进入/退出、且状态被记录"的模式**——旁路会话的模式设计可参照 |
| `dsh-goal` | `0.2.0-rc.2` | 「Event-sourced same-session goal state and lifecycle service」 | 事件溯源的生命周期供给 |
| `dsh-jobs` | `0.2.0-rc.2` | 「Background job registry (ctx.jobs) … shared ids, **owner isolation**, polling, cancellation, and completion listeners」 | **§5.7「成本与配额 / 并发上限」的现成记账与取消供给**；`owner isolation` 恰好是旁路单元需要的归属语义 |
| `dsh-schedule` | `0.2.0-rc.2` | 「Host-wide durable reminders with shared management and original-Session delivery」 | 旁路产物的延迟投递可参照 |

**一处实测异常（如实记录）**：`$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh-tool-subagent-report` 在目录列表中可见，但它是一个 **Junction（Mode `l----`）**，目标 `<NPM_GLOBAL>\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-tool-subagent-report` **`Test-Path` 返回 `False`**，即**断链**。本机当前 dsh 版本下该包实际不可读，故本报告不对它做任何功能结论。

---

### 3.10 A 小节结论：最接近的实现是谁？

**答案是"两个各占一半，而且恰好是互补的两半"：**

- **`dsh-palimpsest` 占了"旁路"这一半**：它是本机唯一一个**为了"取信息而不改变主线"而存在**的插件。它懂范围闸、懂不可信数据、懂 token 预算。
- **`@deepseek-ai/dsh-tool-subagent`（+ fork 后端）占了"隔离执行单元 + 摘要回注"这一半**：官方文档 `dsh-tool-subagent/README.md:184` 那一句"prompt and result remain in parent history until compaction"精确地划出了缺口的位置。

**两者拼起来，还差三块：**

1. **人类侧入口**：palimpsest 和 tool-subagent 都是**模型调用的工具**。没有 `/side` 这样的人类入口。
2. **handle 与生命周期**：palimpsest 的结果是文本，不是实体；tool-subagent 的 continuable 子代理**有** `childId`（`dsh-tool-subagent/README.md:194`），这是本机唯一接近"旁路 handle"的东西——但它归属"任务委派"语义，不是"旁路查询"语义。
3. **丢弃原语**：全生态没有。最接近的是 ACP 的 block 遮蔽与 `dsh-compaction-tool-result-pruner` 的重放安全裁剪。

---

## 4. B · 外部同类形态

> 检索纪律：只写读到原文的。读了摘要/二手文章的，明确标注。完全没查到的，写"未查到"。

### 4.1 Cursor：Side Chats（**外部最接近的实现，几乎逐条对应**）

**官方发布记录**：Cursor changelog 版本 **3.11**，日期 **Jul 10, 2026**，标题「Side Chats and Conversation Search」——[Side Chats and Conversation Search · Cursor](https://cursor.com/en-US/changelog/side-chat)

官方帮助页（本次读到全文）：[Side chats · Cursor](https://cursor.com/help/ai-features/side-chats.md)

逐条对齐需求五要素：

| 要素 | Cursor 的做法 | 原文证据（帮助页） |
|---|---|---|
| 一句话定义 | **durable child conversation attached to a parent agent** | 「Side chats are durable child conversations attached to a parent agent.」 |
| S-1 会话中途 | 用 `/side` 或 `/btw`，或在 chat 面板顶部加号；主对话**不中断** | 「Use `/side`, `/btw`, or the plus button at the top of the chat panel to create a new side chat」；「without interrupting your main agent conversation」 |
| S-2 旁路信息 | 官方推荐用途就是旁路：澄清问题、探替代方案而不承诺转向、给决定做体检 | 「By default, side chats focus on reading, searching, and answering. Use them to ask clarification questions, research alternatives without committing to a pivot, and sanity-check a decision while the main agent continues running.」 |
| S-3 不污染上下文 | **父历史作为 hidden reference context 复制给模型，但不渲染进 side chat 的 transcript**；side chat 的追问也不进父 transcript | 「The parent's conversation history is copied in as reference context for the model. That history does not appear in the side-chat transcript.」；「The parent history is available to the model as hidden reference context. It is not rendered in the side-chat transcript. Only your side-chat prompt and any follow-ups show up in the side chat.」；「Follow-up messages stay in the side chat and do not appear in the parent transcript.」 |
| S-4 摘要 + 子代理式呈现 | **完整 durable 会话，可续聊、可回访、有独立 transcript**；官方明说这是"full agent conversation" | 「A side chat is a full agent conversation that runs next to your main chat.」；「A side chat is a full durable conversation.」 |
| S-5 可丢弃 | **关闭 = 归档（archive），不是删除**；「closing archives the side-chat agent; it does not delete the conversation」 | 见下 |

**S-5 的细节（这是本次调研最有价值的一条外部证据）：**

> 「Click the **X** (close) button on a side chat to archive it. Closing archives the side-chat agent; it does not delete the conversation. The durable thread stays usable until you archive it by closing it.」

**翻译成设计语言：Cursor 选择了 §5.6 里的「丢弃 = 遮蔽/归档」，而不是「不可逆删除」。** 而且它区分了"归档"和"删除"两个概念。

**回注通道（Cursor 的答案，对应 §5.2）：**

> 「@-mention the side chat in the main thread. Cursor pulls that side chat's context into the main conversation so you can keep building on what you found.」

**即：默认完全不回注，回注必须由人显式 @ 一次。** 这是 §5.2 里"完全不回注、只落为可检索产物"那一档 + 一个人工回注开关。

**Cursor 明确排除的两件事（同样有设计价值）：**

> 「**Is a side chat the same thing as forking a conversation?** No. Forking copies the parent conversation into a new chat. … A side chat only seeds the model with the parent history as hidden context. It does not reproduce the parent transcript. A side chat is a parallel thread, not a fork.」

> 「**Can I create a side chat inside another side chat?** No. Nesting is not supported.」

其余已知边界（全部来自帮助页）：

- side chat **绑定父会话**：换到别的会话，side chat 仍挂在原父上，直到归档——「A side chat is scoped to its parent agent.」
- 目前 **仅本地**，不支持 Cloud Agents——「Side chats are local-only for now.」
- 触发方式还包括选中文本/diff 后 **Ask in Side Chat**，以及快捷键 Mac `Shift+Cmd+S` / Windows `Shift+Ctrl+S`。

**Cursor 没做的**：没有"丢弃/不可逆删除"语义（只有归档）；没有把 side chat 提升为正式拓扑节点的机制（@-mention 是"拉上下文"而非"并入团队"）；没有嵌套。

---

### 4.2 OpenAI ChatGPT：Temporary Chat（**只覆盖 S-5，且方向不同**）

官方来源：[Temporary chat in ChatGPT | OpenAI Help Center](https://help.openai.com/en/articles/8914046-temporary-chat-faq)（本次读到全文）

- 「A temporary chat stays out of your chat history and is not used to improve OpenAI models **while it remains temporary**.」
- 开始方式：新会话 → 选 **Temporary** → 发第一条消息前选 Personalized 或 Unpersonalized（Unpersonalized 不用 memory / custom instructions / plugins）。「Neither option creates or updates memories while the chat remains temporary.」**「You cannot change personalization after the conversation starts.」**
- 可转正：「Saving converts it into a regular chat」。**不转正的后果**：「it will not appear in your history and cannot be reopened from history after you leave it.」
- 保留期：「OpenAI may keep a copy of a temporary chat for up to 30 days for safety purposes.」；enterprise 客户可通过 Compliance API 访问 30 天。
- 安全例外：不排除为有限的**安全与安保目的**使用此前对话信息。

**判定：Temporary Chat 是"新会话级"的隐私开关，不是"会话中途的旁路查询"。** 它满足"不落历史"，但**没有父会话**（不满足 S-1）、**没有隔离执行单元**（不满足 S-4）、**没有摘要回注**（S-4）。

两条可借鉴之处：① 它证明了"丢弃"这个用户动词在消费级产品里有强需求（否则不会有这个功能），但**把它实现成"另开一个会话"就牺牲了 S-1**；② **personalization 必须在对话开始前选定且之后不可改**——这是"旁路单元的配置要在创建时冻结"的先例（§5.7）。

---

### 4.3 Anthropic Claude Code

本次读到官方文档与官方工程博客的可确认部分如下；未读到的部分明确标注。

**(a) 子代理架构（官方工程博客，读到全文）**

来源：[Effective context engineering for AI agents · Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)（Published **Sep 29, 2025**）

> 「Sub-agent architectures provide another way around context limitations. Rather than one agent attempting to maintain state across an entire project, specialized sub-agents can handle focused tasks with clean context windows. The main agent coordinates with a high-level plan while subagents perform deep technical work or use tools to find relevant information. **Each subagent might explore extensively, using tens of thousands of tokens or more, but returns only a condensed, distilled summary of its work (often 1,000-2,000 tokens).**」

> 「This approach achieves a clear separation of concerns — the detailed search context remains isolated within sub-agents, while the lead agent focuses on synthesizing and analyzing the results.」

**这是"返回一段摘要"最权威的量化锚点：1,000–2,000 tokens。**

**(b) 压缩（同一篇博客）**

> 「**Compaction** is the practice of taking a conversation nearing the context window limit, summarizing its contents, and reinitiating a new context window with the summary.」

> 「In Claude Code, for example, we implement this by passing the message history to the model to summarize and compress the most critical details. The model preserves architectural decisions, unresolved bugs, and implementation details while discarding redundant tool outputs or messages. The agent can then continue with this compressed context plus the five most recently accessed files.」

> 「One of the safest lightest touch forms of compaction is **tool result clearing**, most recently launched as a feature on the Claude Developer Platform」

**"tool result clearing"是"丢弃已发生内容"的官方轻量形态**——对旁路查询的丢弃语义很有参考价值：先丢工具结果，再谈丢推理过程。

**(c) 结构化笔记 / agentic memory（同一篇博客）——对应"只落盘不回注"**

> 「**Structured note-taking**, or agentic memory, is a technique where the agent regularly writes notes persisted to memory **outside of the context window**. These notes get pulled back into the context window at later times.」

> 「As part of our Sonnet 4.5 launch, we released a **memory tool** in public beta on the Claude Developer Platform that makes it easier to store and consult information outside the context window through a file-based system.」

**(d) "just in time" 上下文 / 轻量标识符——对应"只留指针"**

> 「Rather than pre-processing all relevant data up front, agents built with the "just in time" approach **maintain lightweight identifiers (file paths, stored queries, web links, etc.) and use these references to dynamically load data into context at runtime using tools.**」

**这一段是 §5.2「只留指针」在官方工程口径里的正面表述。**

**(e)–(h) 四条只确认存在性、未读原文的（明确不下断言）**

| 线索 | 官方来源 | 可确认 | 未确认 |
|---|---|---|---|
| **Checkpointing** | [Checkpointing · Claude Code Docs](https://code.claude.com/docs/en/checkpointing) | 页面目录含 `How checkpoints work` / `Automatic tracking` / `Rewind and summarize` / `Rewind past a cleared conversation` / `Guide a summary`——说明它支持"回退 + 重新摘要"，且能跨越 `/clear` 后回退 | 存储位置、保留策略、是否支持不可逆删除（**正文被截断**） |
| **子代理文档** | [Create custom subagents](https://code.claude.com/docs/en/sub-agents) | 检索片段显示可向 Claude 索要 agent ID、或在 transcript 文件里找 ID；另一片段为「Foreground subagents block the main conversation until complete」 | 结果进入主会话的精确格式、是否可丢弃 |
| **自动压缩** | [How the agent loop works](https://code.claude.com/docs/en/agent-sdk/agent-loop) | 片段：「When the context window approaches its limit, the SDK automatically compacts the conversation: it summarizes older history to fr…」（截断） | 语义细节 |
| **best practices** | [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices) | 检索片段出现「Conversations are persistent and reversible」——**二手，未读原文** | — |

**术语核对：`sidechain` —— 未查到。** 本次调研**未查到任何 Claude Code 官方文档确认存在名为 "sidechain" 的 transcript 机制**，该词未出现于任何官方来源。**不编造。**

---

### 4.4 VS Code + GitHub Copilot Chat

**只拿到二手来源，标记为待确认。**

- 二手文章：[VSCode 標準のフォーク機能(/fork)で Copilot Chat の会話を分岐する | DevelopersIO](https://dev.classmethod.jp/articles/shoma-vscode-built-in-fork-feature-copilot-chat-conversation-branching/) ——标题与摘要指出 VS Code **内置 `/fork` 命令**用于分叉 Copilot Chat 会话。
- 官方 release notes（**未读原文**）：[February 2026 (version 1.110)](https://code.visualstudio.com/updates/v1_110)、raw 源 [v1_110.md](https://raw.githubusercontent.com/microsoft/vscode-docs/main/release-notes/v1_110.md)
- GitHub 官方 changelog（**未读原文**）：[GitHub Copilot in Visual Studio Code v1.110 - February release](https://github.blog/changelog/2026-03-06-github-copilot-in-visual-studio-code-v1-110-february-release/)

**可确认的结论：本报告不宣称 VS Code / Copilot 具备"旁路提问"能力。** 目前只有"存在一个 `/fork` 命令用于分会话"这一条二手证据，而 fork 与 side chat 在 Cursor 的官方口径里**被明确区分为两件事**（`cursor.com/help/ai-features/side-chats.md`）。因此 VS Code 的 `/fork` 即便存在，也**大概率是 §5.1 的"fork（带前缀）"而非旁路查询**。

**未查到**：Copilot Chat 的 Ask/Edit/Agent 模式中是否有"不进入会话历史"的选项。**不作断言。**

---

### 4.5 学术界 / 工程界的术语核对（**逐一如实说明**）

用户要求核对七个术语是否有真实文献支撑。核对结果如下——**其中大部分没有找到权威文献，"术语"与"能力"之间存在可观的命名真空**：

| 术语 | 检索结果 | 置信度判定 |
|---|---|---|
| `speculative execution` for LLM agents | **未查到学术论文**。仅见一个工程仓库的 issue：`feat: Agent namespace forking for speculative execution (Agent OS Phase 0) · Issue #1273 · nexi-lab/nexus`——[GitHub Issue](https://github.com/nexi-lab/nexus/issues/1273)。这是 issue，不是论文 | **只是工程口语用法**，无文献支撑 |
| `ephemeral sub-agent` / `ephemeral agent` | **未查到权威定义**。检索命中最接近的是 *Ephemeral Recursive Learning Agents (ERLA)* — Hana Omori / AIMF LLC, Jan 2026, Zenodo——[PDF](https://zenodo.org/records/18422395)。**该文与"会话中途旁路"是否相关未能确认，且非同行评审** | **低置信度**，不作为支撑 |
| `scratchpad agent` | **未查到**任何以此命名且被引用的工作 | **未查到** |
| `branch and discard` | **未查到**以此命名的概念。相邻的真实机制是：LangChain 的 subgraph state 隔离——[Isolating Subgraph State When Calling Graphs from Tools](https://support.langchain.com/articles/6131002418-isolating-subgraph-state-when-calling-graphs-from-tools)，以及 LangGraph checkpointing——[How do I configure checkpointing in LangGraph?](https://support.langchain.com/articles/1242226068-how-do-i-configure-checkpointing-in-langgraph) | **未查到该术语；但"状态隔离"有工程文档** |
| `context quarantine` | **未查到**。检索无有效命中 | **未查到**（本报告正文不使用该词作为术语） |
| `sidechain` / `side conversation` | `side chain` 在检索中命中的是别的东西（Go 包 `kvmmu`、`fak` 仓库）；`side conversation` 未在 agent 文献中出现。**唯一确凿的对应物是 Cursor 的 "side chat"**（产品名，非学术术语） | **术语未查到；产品名存在（Cursor）** |
| Anthropic context engineering 博客 | **确凿存在**，读到全文：[Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)，Sep 29, 2025。给出了 compaction / structured note-taking / sub-agent architectures 三条杠杆 | **高置信度官方来源** |
| LangChain / LangGraph subgraph / ephemeral state | `deepagents` subagents 文档存在：[Subagents · Docs by LangChain](https://docs.langchain.com/oss/python/deepagents/subagents)（**未读原文**）；subgraph state 隔离支持文档存在（同上） | **中置信度**（存在性已确认，内容未读） |

**核对结论（这一条本身就是一个有用的发现）：**

> **"会话中途的旁路查询"目前是一个没有学术名字的需求。** 最接近的命名都来自厂商产品（Cursor 的 *side chat*），而工程界描述同一件事时用的都是**机制名**（subgraph state isolation、checkpointing、compaction、tool result clearing），不是**需求名**。
> 这解释了为什么这条需求"感觉很自然但找不到对标"——**它不是没人做，是没人给它起名字。**

---

### 4.6 外部形态对比总表

| 形态 | S-1 中途 | S-2 旁路 | S-3 不污染 | S-4 摘要+实体 | S-5 可丢弃 | 回注通道 | 归属 |
|---|---|---|---|---|---|---|---|
| **Cursor Side Chat** | ✅ `/side` `/btw` | ✅ 官方推荐用途 | ✅ 父历史 hidden、双向 transcript 隔离 | ✅ durable 会话 | ⚠️ 归档（archive）非删除 | 人工 `@`-mention 拉回 | 绑定父 agent；不可嵌套 |
| **ChatGPT Temporary Chat** | ❌ 是新会话 | ✅（任意话题） | ✅ 不落历史 | ❌ | ⚠️ 不保存即无法从历史重开；可保存转正 | 无 | 独立会话 |
| **Claude Code 子代理** | ✅ | ❌ 是任务委派 | ⚠️ 子上下文隔离，但父侧 prompt+result 落主线 | ✅ 摘要 1k–2k tokens | ❌（官方口径里只有 compaction） | 自动全文回注 | 归主 agent |
| **Claude Code Compaction** | ✅ | — | ⚠️ 是改写已发生历史 | ✅ 摘要 | ⚠️ 可 checkpoint/rewind 回退 | 隐式 | 会话级 |
| **DSH 官方子代理** | ✅ | ❌ 是任务委派 | ⚠️ 见 `dsh-tool-subagent/README.md:184` | ✅ 只回最终文本 | ❌ | 前台自动；后台仅 notice + childId | 归父 agent |
| **DSH `dsh-spill`** | ✅（工具级） | — | ⚠️ 降低注入量，非不注入 | ⚠️ 预览 | ❌ 无删除 API | locator + retrievalHint | 归 session |
| **DSH `dsh-palimpsest`** | ✅ | ✅ 只读检索 | ❌ 工具结果必注入 | ⚠️ 有摘要无实体 | ❌ | 自动 | 无 |

**表里最刺眼的一格：S-5 那一列，六个形态里没有一个是干净的 ✅。** 这不是巧合——它是本需求的真实空白。

---

## 5. C · 设计空间七维

> 这一节是本报告的核心增量。每一维给出 2–4 个备选，并说明**选它的代价是什么**。代价栏是本节的重点：备选本身是可列举的，代价才是决策依据。

### 5.1 维度一 · 上下文隔离度

**问题**：旁路单元能看见主线的多少？

| 档位 | 定义 | DSH 现状 | 代价（选它的代价是什么） |
|---|---|---|---|
| **A1 完全新会话** | 不带主线任何前缀，只带任务描述 | 现成：`dsh-subagent-spawn-in-process`（干净上下文） | 代价最大：用户必须把问题重述一遍，且无法问"这段代码为什么这样写"这类**必须看上文**的问题。**S-2 的"旁路"变成"另起炉灶"，S-1 名存实亡** |
| **A2 fork 当前会话（带前缀）** | 以主线 log 的前缀为种子启动 | 现成：`dsh-subagent-fork-in-process`（"seeded with a prefix of the parent's log"）；provider 属性 `inheritsParentContext` 已在工具文案里体现（`dsh-tool-subagent/README.md:95`） | **KV cache 代价**：官方明确说 fork 型子代理为了复用前缀缓存**不能换模型**（`dsh-tool-subagent/README.md:213`）。即"用便宜模型跑旁路"与"fork 前缀"不可兼得。另一个代价：前缀越长，旁路启动成本越高——旁路本该便宜 |
| **A3 只读检索不推理** | 不启动执行单元，只做检索/读取 | 现成：`dsh-palimpsest` 三工具 | 代价：**无法回答需要推理的问题**（"这两种方案哪个更适合我们的场景"）。而且它的结果**必然注入主线**（§3.1.2），所以它**不满足 S-3**——这是最反直觉的一个代价：最"轻"的档位反而最容易污染，因为它没有实体承载，只能靠工具结果文本落地 |
| **A4 主上下文内联但标注可删** | 在主线内就地跑，但把产出标记成"可丢弃块" | 部分现成：`presentationMeta` 是"模型看不见"通道（`dsh-tools/lib/types/presentation.d.ts:256-258`），但它只在顶层执行可用（`dsh-tools/lib/index.js:3554`） | 代价：**这是"假隔离"**。只要内容进了主线 token 流，就已经推高了水位；"标注可删"只解决后续清理，不解决"不污染"。**如果 S-3 是硬约束，A4 直接出局**——但它是唯一能零启动成本回答"必须看上文"问题的档位 |

**权衡要点**：A1/A2 是**真隔离**，A3/A4 是**轻隔离**。这条需求同时要求"不污染"（要真隔离）和"顺手"（要轻）。**这两条在 A1–A4 里没有任何一档同时满足。** 这正是为什么它需要新机制，而不是配置一个开关。

**推荐落点**：A2 为默认（带前缀 fork），A1 为可选（省钱/隐私场景），**A3 必须被视为"另一条通路"而不是"轻量版"**——因为它的污染特性与 A2 相反。

---

### 5.2 维度二 · 结果回注策略（**最关键的两维之一**）

**问题**：旁路单元跑完之后，那段摘要怎么处理？

| 档位 | 定义 | 外部先例 | DSH 现状 | 代价 |
|---|---|---|---|---|
| **B1 自动全文回注** | 结果整段进主线 | Claude Code 子代理（`dsh-tool-subagent/README.md:180` 同构） | 现成 | **直接违反 S-3。** 且旁路返回的常常是"用不上但看起来有用"的内容，全文回注是最差的信噪比 |
| **B2 自动摘要回注** | 只回一段压缩摘要 | Anthropic 官方口径：子代理"returns only a condensed, distilled summary … often 1,000-2,000 tokens" | 现成（子代理前台模式） | 代价是**摘要不可反悔**：一旦注入，你无法判断它值不值。**它满足了"少污染"，不满足"可丢弃"** |
| **B3 只留指针** | 主线里只出现 `"我查过 X，见 <handle>"` | Anthropic "just in time" 明确写了这个模式；**DSH 有完整实现**：`dsh-spill` 的 `SpillLocator` + `retrievalHint`（`dsh-spill/lib/types/types.d.ts:16`、`dsh-spill/README.md:12`、`dsh-spill/README.md:36`） | 现成，但**是自动按 token 预算触发的**，不是人选的 | 代价：**模型会"忘记"自己去查过什么**。指针本身就是一点上下文开销，而且如果模型不去解引用，旁路就白跑了。另外 `dsh-spill` 明确**没有 retrieval / deletion API**（`dsh-spill/README.md:136`），所以指针目标的生命周期要另找归属 |
| **B4 完全不回注，只落为可检索产物** | 主线里连指针都没有；内容只落盘，靠用户或后续检索发现 | Cursor：默认不回注，**必须人工 `@`-mention 才拉回**（`cursor.com/help/ai-features/side-chats.md`）；Anthropic structured note-taking："notes persisted to memory outside of the context window. These notes get pulled back into the context window at later times" | **无**。`dsh-session-reference` 是反面（自我定位为 *durable* model context） | 代价：**旁路因此不在模型的可选动作集里**。模型不知道有这个产物，就无法自主利用；这会削弱"模型自主发起旁路"的价值（见 §5.5）。同时它对 UI 的要求最高——用户得有个地方看得见它 |
| **B5 回注后可由人或模型撤销** | 先注入，再提供撤销 | 无直接先例。最接近的机制拼图：ACP 的 compress/decompress（可逆遮蔽）；`dsh-compaction-tool-result-pruner`（replay-safe 裁剪） | **无** | 代价：**一致性成本最高**。撤销之后，主线里可能出现"正如我刚才查到的……"这种悬空引用。要真正可用，必须配套 §5.6 的"遮蔽"语义（模型看不见但历史仍在），而不是真删除 |

**权衡要点**：B1→B4 是一条**单调降低污染、单调提高"模型自主性损失"**的曲线。

- **B4 最干净**，但它要求"人类是唯一回注通道"——这就是 Cursor 的选择（`@`-mention）。
- **B3 是最优的中间点**，而且 DSH 已经有实现（`dsh-spill`）。
- **B5 是最有产品力的**（"先看看，不好就撤"），但它把成本从"注入"转移到了"一致性"。

**推荐落点**：默认 **B4**（完全不回注，落盘 + 侧栏可见），提供**显式的、单次的**回注动作（对应 Cursor 的 @-mention），并在回注后提供 **B5 的撤销**。**把 B1/B2 作为可配置项而不是默认**——因为"自动回注"正是当前所有子代理实现的默认，也正是这条需求要打破的东西。

---

### 5.3 维度三 · 可见性

**问题**：用户在哪里看到这个旁路单元？

| 档位 | 定义 | DSH 现状 | 代价 |
|---|---|---|---|
| **C1 主对话流内可见** | 像普通工具调用一样出现在主流里 | 现成（子代理、palimpsest 都是这样） | 代价：**可见即污染**。它占用主流视觉空间，也（在多数实现里）占用模型上下文。若 S-3 是硬约束则不成立 |
| **C2 侧栏折叠** | 右侧栏可折叠面板，不占主流 | **基础设施现成**：`@deepseek-ai/dsh-client-ui-sidebar-right`——「Right Sidebar: the docking surface's session-bound state, its panel and header expand control, and the navigation service over it」；`clearai-dsh` 已在使用该插槽（`clearai-dsh/package.json` 的 `dsh.client.inject`） | 代价：**需要前端半边。** `dsh-palimpsest` 明确是"纯宿主侧（没有 dsh.client 半边）"（`dsh-palimpsest/cordis.patch.yml:2`）——这解释了为什么它的产物没有侧栏承载。任何有侧栏的方案都必须接受"要写前端代码 + 要处理客户端模块扫描只扫宿主 Loader 行"这一限制（见 `clearai-dsh/cordis.patch.yml` 关于"预设里的行浏览器看不见"的注释） |
| **C3 完全不可见，仅落盘** | 只在文件系统里有，UI 不露出 | **有半套机制**：`presentationMeta` 随会话日志持久化但模型看不见（`dsh-tools/lib/types/presentation.d.ts:256-258`）；但**它只在顶层执行时投影**（`dsh-tools/lib/index.js:3554`），子代理里不可用 | 代价：**用户不知道旁路发生过**。对"可丢弃"这个动词是致命的——你无法丢弃一个你看不见的东西。**C3 单独使用不成立，必须配一个"曾经有过一个旁路单元"的告示** |
| **C4 只在结束/丢弃时通告** | 平时不露出，只在需要用户决策（保留/丢弃）时提醒 | 无先例。相邻原语存在：`@deepseek-ai/dsh-output-retention`——「neutral notice helpers (what did we keep, what did we omit)」 | 代价：**通告时效性差**。用户在旁路跑完后才看到，此时已经产生了成本；且"从不打扰"与"及时决策"必然冲突 |

**权衡要点**：C1 与 S-3 直接冲突，**出局**。C2 是最自然的落点但成本最高（要前端）。C3+C4 组合是低成本方案：**落盘 + 一次性通告**。

**这条轴上有一个必须注意的耦合**：如果旁路单元通过子代理实现，则 `presentationMeta` 通道对它**不可用**（`dsh-tools/lib/index.js:3554` 的 `exec.parent === undefined` 条件）。**"用子代理实现旁路"与"用 presentationMeta 做 UI 投影"不可兼得**——这是本报告发现的一条硬约束，任何设计方案必须绕开。

---

### 5.4 维度四 · 生命周期与归属

**问题**：这个旁路单元活多久，归谁？

| 档位 | 定义 | 外部先例 | 代价 |
|---|---|---|---|
| **L1 一次性即焚** | 出一段摘要就结束，不保留 | 无直接先例；`dsh-jobs` 的一次性任务接近 | 代价：**无法追问**。用户看到摘要后 90% 会想"那第二点能展开吗"——此时只能重新开一个旁路，而它**看不到上一个旁路的上下文**（除非把摘要塞回去，那就污染了）。**L1 把成本推迟到了下一次提问** |
| **L2 保留可续聊** | durable 会话，可追问、可回访 | **Cursor Side Chat 正是这一档**："a durable, full agent conversation that you can follow up on, revisit later"（`cursor.com/en-US/changelog/side-chat`）；DSH 有对应供给：`dsh-tool-subagent-control` 的 `send_message` over continuations，以及 `dsh-tool-subagent/README.md:194` 说的"the child's transcript by its id is the source of its detailed output" | 代价：**归属与清理问题**。L2 的旁路单元必须挂在某个父上（Cursor 的做法是"scoped to its parent agent"，换会话也不脱钩）；换会话、压缩父会话、fork 父会话时它怎么办？**`dsh-spill` 已经给出了一个先例答案**：「forked sessions inherit existing locators from the seeded log without copying or re-owning them」（`dsh-spill/README.md:62`）——但那是**定位符**的继承，不是**活会话**的继承 |
| **L3 提升为一等子代理** | 从"旁路"升级成主线任务图里的一个节点 | 无先例（Cursor 只有"@ 拉上下文"，不是"并入团队"） | 代价：**语义污染**。一旦提升，它就从"注意力管理"变成了"任务分解"，开始接受指派、需要汇报、需要失败恢复（D5）——**它会被卷进 concourse 的全部五旋钮**。技术上可行，但要显式承认这是一次**跨类别的迁移**，而不是一个状态位 |
| **L4 提升为团队成员** | 进一步并入 agent 团队，参与协作 | 无先例 | 代价最大：需要身份、权限、通信边、记账。**这是 concourse 主线的接续点**（§6.4），但也是最容易失控的地方——旁路本为省钱，提升为成员后它会开始消耗团队预算 |

**权衡要点**：L1→L4 是一条**能力递增、成本递增、语义漂移递增**的曲线。**L2 是最优默认**（Cursor 已验证），L3/L4 必须是**显式的、由人确认的**迁移动作。

**归属问题必须回答三个子问题**（这三个问题目前没有任何实现给出完整答案）：

1. 父会话被压缩时，旁路单元的历史算什么？（是否也要被压缩？）
2. 父会话被 fork 时，旁路单元是共享、复制还是重新归属？（`dsh-spill/README.md:62` 给了一种答案：定位符继承、不复制不重新归属）
3. 父会话结束后，旁路单元还在吗？（Cursor：还在，直到归档）

---

### 5.5 维度五 · 触发方

**问题**：谁发起旁路？

| 档位 | 定义 | 先例 | 代价 |
|---|---|---|---|
| **T-A 人显式提问** | 用户输入 `/side` 或在 UI 上点 | **Cursor**：`/side`、`/btw`、加号按钮、选中文本后 Ask in Side Chat、快捷键 `Shift+Cmd+S` / `Shift+Ctrl+S` | 代价：**需要人类侧入口。** DSH 现有的三方（palimpsest / subagent / spill）**全部是模型调用的工具**，没有一个是人类入口。`dsh-command-compact` 证明了"加一个 slash command"这条路在本机是通的（「Human-facing slash command for explicit session compaction」） |
| **T-B 模型自主发起** | 模型在推理中发现需要旁路信息，自己开 | 现成：所有 DSH 工具都是模型调用的（`palimpsest_*`、`subagent`、`web_search`） | 代价：**模型不知道自己的上下文什么时候该被"旁路化"。** 模型无法感知"我这次查询会污染后面"，它只会觉得"我需要这个信息"。因此 T-B 单独使用会退化成"普通的工具调用"——**这正是现状**：所有现有机制在模型眼里就是工具，不是旁路 |
| **T-C 人预授权 + 模型自主** | 人开启一个"允许旁路"的模式，模型在此模式下自主开旁路；或人给出预算，模型在预算内自主 | 无直接先例。**最接近的本机先例是 `dsh-plan-mode`**——「Logged per-agent plan mode with deployment guidance, a direct slash command, and a user-reviewed exit」：有进入、有部署指导、有**用户审阅过的退出** | 代价：**多了一层需要管理的状态**。模式本身又是一份上下文（"你现在处于 X 模式"），而且模式的进出需要 UI。但这是唯一能同时保住"省钱"与"不打扰"的档位 |
| **T-D 外部触发** | 由 hooks / 定时器 / 另一个 agent 触发 | 本机有供给侧：`dsh-hooks-claude-code`（「run a Claude Code hooks.json / settings hook config on the DSH interception seams」）、`dsh-hooks-codex`、`dsh-schedule`、`dsh-jobs` | 代价：**可观测性与成本失控**。旁路本是"人想知道点什么"，改成外部触发后它会变成"系统在背后自己花钱"。只有在有硬配额时才成立（见 §5.7） |

**推荐落点**：**T-A 必须做**（它是当前的最大缺口），T-C 是理想形态（可参照 plan mode 的"进入/退出/审阅"三件套），T-B 作为 T-C 之下的默认行为。

---

### 5.6 维度六 · 丢弃语义（**最关键的两维之一**）

**问题**：「丢弃」这个动词，到底删什么？

| 档位 | 定义 | 先例 | 代价 |
|---|---|---|---|
| **X1 丢弃 = 从上下文移除但磁盘留存** | 模型看不见了，但文件还在 | 无干净先例。最接近的机制是 ACP 的 compress（把区间换成摘要，原文可 decompress 恢复）——本机在跑；以及 `dsh-compaction-tool-result-pruner`（「Replay-safe model-free head/middle/tail pruning for tool-result surface nodes」） | 代价：**"移除"需要新原语。** DSH 现有两类机制都不等价：压缩是**改写形状**（区间 → 摘要节点，历史形态变了）；裁剪是**model-free 的自动行为**（不是人的选择）。要做 X1，需要一个"按 handle 移除已注入内容、且保持 log 可重放"的操作。**`dsh-tool-subagent/README.md:184` 那句话（"until compaction"）说明官方目前把这件事交给了 compaction，没有独立原语** |
| **X2 丢弃 = 不可逆删除** | 物理删除，无法恢复 | Cursor 明确**不这么做**：「Closing archives the side-chat agent; **it does not delete the conversation**」（`cursor.com/help/ai-features/side-chats.md`）；ChatGPT temporary chat 也留 30 天安全副本 | 代价：**不可逆意味着不可审计。** 与 DSH 的会话日志设计（`dsh-session-persistence-jsonl`、`dsh-session-query-sqlite`）直接冲突：日志是 append 的、可检索的。真删除需要一条"墓碑"记录，否则重放会崩。**这可能是最不划算的一档**，除非有强合规要求 |
| **X3 丢弃 = 遮蔽（模型看不见但 UI 能看到，可恢复）** | 视图级遮蔽，不动底层数据 | **Cursor 的 archive 就是这个语义**（归档而非删除，thread 仍 usable）；**ACP 的 compress/decompress 也是这个语义**（本机在跑，"decompress 恢复原始内容（只读；不会 unshadow）"）；`dsh-compaction-tool-result-pruner` 的 "replay-safe" 说明官方已在做重放安全的视图裁剪 | 代价：**必须回答"遮蔽了什么"的元问题。** 遮蔽不是一个动作，是一对动作（遮蔽/解除遮蔽），因此需要：① 一个稳定的 handle；② 一个记录"当前被遮蔽了什么"的地方；③ UI 上的一致呈现（否则用户以为删了但没删）。**`dsh-output-retention` 已经在做第三件**：「neutral notice helpers (what did we keep, what did we omit)」 |
| **X4 丢弃 = 标记失效（内容还在，但声明它不再有效）** | 不遮蔽，只在语义层作废 | 无先例 | 代价：**对 token 水位毫无帮助。** 内容仍在上下文里占位，模型仍会被它影响（只是被告知"忽略它"——这是最不可靠的指令类型）。**除非与 X3 组合，X4 单独没有工程价值** |

**这一维的关键判断：**

> **"丢弃"的正确语义是 X3（遮蔽），不是 X2（删除）。** 三条独立证据支持：
> ① Cursor 官方明说关闭是 archive 不是 delete；
> ② DSH 自己的 ACP 已经把"可恢复的遮蔽"实现出来了，并在运行；
> ③ DSH 的会话日志是 append-only + 可重放的设计，不可逆删除会造成重放不一致（`dsh-compaction-tool-result-pruner` 的 "replay-safe" 一词表明官方非常在意这一点）。

**但 X3 有一个 Cursor 没解决的问题**：Cursor 的 archive 是针对**一整个 side chat**（粗粒度），而旁路查询真正需要的是**细粒度丢弃**——"这次查的**这一点**我不要了"。ACP 的 block 粒度（区间）比 side chat 粒度更细，但仍不是"一条结论"。

**因此本维的推荐落点是：X3 的语义 + 比 ACP block 更细的粒度（以旁路单元为最小可丢弃单位）。**

---

### 5.7 维度七 · 成本与配额

**问题**：旁路花的钱谁记账，能不能看见，有没有上限？

| 档位 | 定义 | 本机供给 | 代价 |
|---|---|---|---|
| **Q1 与主线同一账本，不区分** | 旁路 token 混进主会话账单 | 现成（现状） | 代价：**旁路会变成隐性成本。** 用户看到的是"这次会话贵了"，而不是"旁路花了多少"。**对于"旁路本为省钱"的初衷，这是最坏的记账方式** |
| **Q2 独立记账，可见** | 旁路单元有自己的 token 计数，UI 可见 | **供给侧现成**：`@deepseek-ai/dsh-token-meter`（存在）、`dsh-jobs`（「Background job registry (ctx.jobs) … shared ids, **owner isolation**, polling, cancellation, and completion listeners」）、`dsh-session-stats` | 代价：**需要归属模型。** 旁路单元归哪个 session 的账？归属父会话？还是算"用户的旁路预算"？`dsh-jobs` 的 `owner isolation` 提供了归属原语，但"记账"这件事没有现成聚合器 |
| **Q3 并发上限** | 同时最多 N 个旁路单元 | **供给侧现成**：`dsh-jobs`（registry + cancellation）；`dsh-sandbox`/`dsh-timeout` 类包提供超时 | 代价：**上限设多少是个产品问题，不是技术问题。** 与 Cursor 的对比：Cursor **禁止嵌套**（"A side chat cannot spawn its own side chats"）——这是最干净的天然上限（深度=1）。**建议直接采用这个约束**：旁路单元不能自己再开旁路 |
| **Q4 模型/算力降档** | 旁路默认用更便宜/更快的模型 | **这里有一个硬冲突**：官方明确说 fork 型子代理**不能选子模型**——「Shipped fork tools cannot select a child LLM route — they inherit the parent's provider and model to keep the copied conversation prefix eligible for KV Cache reuse」（`dsh-tool-subagent/README.md:213`） | 代价：**这是 §5.1 与 §5.7 的直接冲突，必须二选一**：<br>· 要 KV cache 复用（省 prefix 成本）→ 不能降档模型；<br>· 要降档模型（省生成成本）→ 不能 fork 前缀，只能 A1（干净上下文）。<br>**这是本报告发现的第二条硬约束，且它是量化的**：旁路的成本优势到底来自"复用前缀"还是"降档模型"，取决于前缀长度与生成量的比值。**短前缀 + 长生成 → 降档更省；长前缀 + 短生成 → 复用更省** |
| **Q5 时间/步数预算** | 旁路单元有硬超时与最大步数 | 供给侧现成：`dsh-timeout`、`dsh-tool-call-timeout-policy`；已有的 `subagent`/`dispatch` 支持 `maxTokens` 与 `maxDepth` 字段（本会话的工具集中可见） | 代价：**预算太紧会让旁路不可用**（问到一半被砍）；太松会失控。Anthropic 给的量化锚点可作参考：子代理摘要目标 **1,000–2,000 tokens** |

**推荐落点**：**Q2（独立记账）+ Q3（深度=1 的硬上限，照抄 Cursor）+ Q5（显式预算）**；**Q4 必须与 §5.1 联合决策**，不能单独拍。

---

### 5.8 正交性核对：这七维真的正交吗？

| 对 | 是否正交 | 说明 |
|---|---|---|
| 5.1 隔离度 × 5.2 回注策略 | **正交** | Cursor 是 A2×B4；DSH 子代理是 A2×B2；palimpsest 是 A3×B1 |
| 5.1 × 5.7 成本 | **不正交（硬冲突）** | 见 Q4：fork 前缀 ⟂ 换便宜模型（`dsh-tool-subagent/README.md:213`） |
| 5.2 × 5.6 丢弃 | **强耦合** | 选了 B1/B2（自动回注）之后，X 系列的丢弃成本会陡增（要撤销已注入的内容）；选了 B4（不回注）则"丢弃"退化成"删除一个落盘产物"，成本极低。**这是七维里耦合最强的一对** |
| 5.3 可见性 × 实现载体 | **不正交（硬冲突）** | 若用子代理实现，`presentationMeta` 不可用（`dsh-tools/lib/index.js:3554`）→ C2/C3 的 UI 投影路径被堵死 |
| 5.4 生命周期 × 5.6 丢弃 | **强耦合** | L3/L4（提升为节点/成员）之后，丢弃就不再是"撤一段上下文"，而是"解散一个团队成员"——语义完全不同 |
| 5.5 触发方 × 5.7 成本 | **耦合** | T-B（模型自主）若不配 Q3 上限，成本不可控 |
| 5.3 × 5.4 | **正交** | 侧栏折叠的一次性单元是合理的（C2×L1） |

**结论：七维名义上正交，实际存在两条硬冲突与三对强耦合。** 这两条硬冲突是本需求最容易踩的坑：

1. **fork 前缀 ⟂ 模型降档**（`dsh-tool-subagent/README.md:213`）
2. **子代理载体 ⟂ presentationMeta 投影**（`dsh-tools/lib/index.js:3554`）

### 5.9 最具决定性的两维

在七维中，**②结果回注策略**与**⑥丢弃语义**是最具决定性的，理由有三条：

1. **它们是需求的身份所在。** §2.3 的判定式说得很清楚：只要"旁路结果必然进入主线历史"，无论叫什么名字都没满足需求。这个性质**完全由 ② 与 ⑥ 决定**，与 ①③④⑤⑦ 无关。
2. **其他五维都有现成基础设施，只有这两维没有。**
   - ① 隔离度 → `dsh-subagent-fork-in-process` + `inheritsParentContext` 已存在；
   - ③ 可见性 → `dsh-client-ui-sidebar-right` 插槽 + `presentationMeta` 通道已存在；
   - ④ 生命周期 → `dsh-jobs`（registries + owner isolation）+ `dsh-tool-subagent-control`（continuations）已存在；
   - ⑤ 触发方 → 缺的只是一个 slash command，而 `dsh-command-compact` 证明这条路通；
   - ⑦ 成本 → `dsh-token-meter` / `dsh-jobs` / `dsh-timeout` 已存在。
   - ② → 部分存在（`dsh-spill` 的 locator），但**"人来选"这一层不存在**；
   - ⑥ → **完全不存在**。
3. **它们强耦合（§5.8），必须一起设计。** 单独决定任何一个都会锁死另一个。而它们共同决定了其他五维的合理取值域——例如选了 B4（不回注）+ X3（遮蔽），则 ③ 必须有侧栏（否则用户看不见可丢弃物），⑤ 必须有人类入口（因为模型不会主动丢），④ 倾向 L2。

**一句话：①②⑥ 的顺序应该是 ⑥ → ② → 其余。**

---

## 6. D · 与 concourse 五旋钮的接续

### 6.1 报告 §7.3 的五个正交旋钮（原文摘录）

来源：`docs/dsh-agent-teams-concourse-report.html` 第 1671 行（`<h3 id="s73">7.3 · 五个正交旋钮（解答 U-8）</h3>`）与第 1676–1687 行的表格。

| ID | 维度 | 中央端 | 对等端 | nanmicoder | team-rooms |
|---|---|---|---|---|---|
| **D1** | 控制权归属 | 中央调度（captain 分配） | 自主认领（成员 claim） | 中央 | 对等 |
| **D2** | 顶点生命周期 | 任务型（完成即销毁） | 常驻型（跨任务保留记忆） | 任务型 | 常驻型 |
| **D3** | 通信拓扑 | 星型 / 树 | 网状 | 星型 | 网状 |
| **D4** | **上下文策略** | **`spawn`（干净上下文）** | **独立会话（天然隔离）** | `spawn` | 独立 |
| **D5** | 失败恢复 | 中央重派 | 各自重试 | 中央 | 各自 |

（表格行位置：D1 = 第 1680 行、D2 = 第 1681 行、D3 = 第 1682 行、D4 = 第 1683 行、D5 = 第 1684 行。）

报告 §7.3 的两条关键论断（第 1691–1693 行、第 1714–1715 行）：

> 「领队中心式与扁平分布式不是两个品类，是同一张图上的两种形状。把它们绑在一起的不是任何技术必然性，而是五个独立的实现选择恰好被同时选到了同一端。」

> 「这也是为什么五个旋钮在虚拟拓扑下真正正交了——D3 变成了一个纯粹的策略集合，不再与 D1/D2/D4/D5 争夺同一份实现结构。」

### 6.2 旁路查询落在哪个旋钮的哪个档位？

**答：它落在 D4（上下文策略），而且落在 D4 两个档位之间的一个真空里。**

- D4 的**中央端**是 `spawn`（干净上下文）：子代理看不见主线。
- D4 的**对等端**是"独立会话（天然隔离）"：会话之间天然看不见。

**这两端都描述"隔离"，但都没有描述"隔离之后怎么办"。** 旁路查询需要的正是这个"之后"：

- 它需要**读得到主线**（否则无法回答"这段代码为什么这样写"）→ 排斥 D4 中央端的"干净上下文"；
- 它需要**不写回主线**（S-3 硬约束）→ 但这**不是 D4 的语义**，D4 只说了子代理看不见主线，**没说过主线看不见子代理的结果**。事实上 DSH 的现状恰好相反：`dsh-tool-subagent/README.md:184` 说 prompt 和 result 都留在父历史里。

**所以精确的落点是：D4 需要一个中间档位——"带前缀 fork，且结果默认不回注"。**

- 「带前缀 fork」这一类在 DSH **已存在**（`dsh-subagent-fork-in-process/package.json:4`：「runs a child agent seeded with a prefix of the parent's log」；provider 属性 `inheritsParentContext` 见 `dsh-tool-subagent/README.md:95`），但**在 concourse 报告的五旋钮表里没有它的位置**——D4 只列了 `spawn` 与"独立会话"两端。
- 「结果默认不回注」**在任何旋钮里都没有位置**。

### 6.3 是"新增一个旋钮"还是"某个旋钮的一个新档位"？

**结论：两件都要做，但只有一件是"新旋钮"。**

| 变化 | 类型 | 落点 |
|---|---|---|
| **"带前缀 fork"**（读得到主线、又保持隔离） | **D4 的一个新档位**（第三档，位于 `spawn` 与"独立会话"之间） | 改 D4 的取值域：`spawn` / **`fork-prefix`（新增）** / 独立会话 |
| **"结果回注与丢弃策略"** | **必须新增一个旋钮 D6** | 新维度 |

**为什么"回注与丢弃"不能塞进已有五旋钮？**

逐个检验：

- **塞进 D4？** 不行。D4 的语义是"执行单元与主线的上下文关系"，它是**单向的**（谁能读谁）。回注是**反向的**（结果写给谁）+ **时间维的**（之后能不能撤）。把两者塞进一个旋钮会破坏 D4 的正交性——而报告第 1714–1715 行刚刚才论证完 D4 的正交性，不能自毁。
- **塞进 D2（顶点生命周期）？** 不行，但**最接近**。D2 管的是"任务完成后节点销毁还是常驻"。丢弃管的是"上下文里那段内容留着还是撤掉"。一个节点的生命周期结束（任务型，立即销毁）**并不蕴含**它的产出从主线上下文里消失——事实上 DSH 现状正好是反面（`dsh-tool-subagent/README.md:184`）。**二者必须分开。**
- **塞进 D1（控制权）/ D3（通信拓扑）/ D5（失败恢复）？** 完全无关。

**因此：D6 是必需的，且建议定义如下（与 D1–D5 同构的"两端 + 中间档"写法）：**

> **D6 · 结果回注与丢弃策略**
>
> | 端 | 取值 |
> |---|---|
> | 自动端 | 自动摘要回注，不可撤（当前所有子代理实现的默认） |
> | 手动端 | 不回注，仅落盘可检索；回注需人工显式触发（Cursor 的做法） |
> | **中间档（推荐默认）** | **可回注 + 可撤销**：注入一段带 handle 的摘要，handle 上的丢弃动作 = 视图级遮蔽（X3 语义） |

**D6 与 D2 的关系需要在需求文档里显式写明**（这是最容易混淆的一对）：

- D2 回答：**这个执行单元**还活着吗？
- D6 回答：**它的产出**还在我的上下文里吗？
- 两者独立：可以有"D2 任务型（节点已销毁）+ D6 可回注（产出还在上下文）"，也可以有"D2 常驻型 + D6 已遮蔽（节点还在但产出被遮）"。**这两个组合目前在 DSH 里都表达不出来。**

### 6.4 与已有拓扑层级 T0–T2b 的关系：旁路单元算不算一个拓扑节点？

先复述报告 §7.2.2 的六级谱系（第 1468–1507 行）：

| 层级 | 名称 | 定义（原文要点） | 可得性 |
|---|---|---|---|
| **T0** | 单体 | 单会话，无子代理。`E = ∅` | 默认可得 |
| **T1a** | 单层领队 | 星型。所有开放边从根射出，无横向边 | 默认可得 |
| **T1b** | 多层领队 | 树形外观，执行底座仍是一层；"父子"是权限与可见性标注 | 默认可得 |
| **T1.5** | 混合 | 树 + 某个子树内部网状 | **默认上限** |
| **T2a** | 多领队并列 | 森林 + 根间横向边；**只能由"中途加入已存在的独立会话"达成** | 需会话加入 |
| **T2b** | 全扁平 | 对等网状，无根。**不提供** | 不提供 |

报告的立论（第 1511–1514 行）：

> 「这六种形态不是六个功能，而是同一个图模型的不同参数——更准确地说，是同一张完全图上不同的开放边集。」

**答案：旁路单元不算一个拓扑节点。理由如下。**

1. **拓扑谱系的判定量是"开放边集"，不是"存在几个执行单元"。** 报告明确定义 T0 为 `E = ∅`（第 1474 行）。旁路单元不接收任何**任务指派边**，也不发出任何**汇报边**——它不改变 `E`。因此**旁路单元的存在不改变 T 级**。

2. **两者回答的是不同的问题。**
   - 拓扑谱系回答：**任务怎么被分解、指派、汇报**（责任关系）。
   - 旁路查询回答：**注意力怎么被隔离、提取、丢弃**（上下文关系）。
   - 一个旁路单元是**图外的孤立顶点**：它读得到图（因为 fork 前缀），但它不在 `E` 里——**它既不指派人，也不被指派，也不汇报**。

3. **有一个容易搞错的边界必须写清。** 按字面读，T0 = "单会话，**无子代理**"（第 1474 行）。如果旁路单元在实现上被做成一个子代理（`dsh-subagent-fork-in-process` 就是这么做的），那么**字面上 T0 就不成立了**——一个"单体会话"里跑着子代理。这会产生一个荒谬结论：**仅仅因为用户想问一句旁路问题，拓扑就从 T0 掉到 T1a。**

   **因此本报告建议对 §7.2.2 的定义做一处修订**：

   > T0 的定义应从「单会话，**无子代理**」修订为「单会话，**无任务分解**（`E = ∅`）」。
   >
   > 理由：拓扑谱系度量的是**责任关系图**，执行单元的物理实现（进程内 fork / 独立会话 / 远程）不应影响层级判定。否则"旁路查询"这一纯粹的注意力操作会意外地改变拓扑，这与报告的立论（第 1513 行"拓扑是可编辑数据，不是代码常量"）一致——**旁路不应是拓扑数据的一部分。**

4. **那"提升"呢？** §5.4 的 L3（提升为一等子代理）/ L4（提升为团队成员）**恰恰是旁路单元进入拓扑的那一刻**。当旁路结论被采纳为任务输入、或旁路单元开始接受指派时，它**才**成为 T1a 星型里的一个节点。**因此"提升"就是"从图外进入图内"这个动作本身。** 这也解释了为什么 L3/L4 在 §5.4 里被标为"代价最大"——它是一次**跨类别的语义迁移**，而不只是一个状态位。

5. **与 T2a"会话加入"的对照（两者形似而神不同）。**

   | | T2a 会话加入（报告 §7.2.3） | 旁路单元提升（L3） |
   |---|---|---|
   | 加入前的身份 | **已存在的独立会话**，先前各自独立工作过 | 本次会话派生出的旁路单元 |
   | 触发条件 | 用户**本来就已经有**多个独立会话 + 显式要求 | 用户显式要求 |
   | 加入后 | 成为子节点（保持 T1.5）或平级领队（升级 T2a） | 成为 T1a 星型的一个节点 |
   | 边 | 产生任务边（子节点→报告；平级→notify 边） | 产生任务边 |

   **关键差别**：报告第 1529 行明确要求 T2a 的会话"**先前各自独立工作过，不是本次任务派生的**"。旁路单元**恰好相反**——它是本次任务派生的。**因此旁路提升不能复用 T2a 的"会话加入"通道；它需要一条新的、单元级的提升通道。** 这是 §6.5 的一条修改建议。

### 6.5 对 concourse 需求文档的修改建议（四条）

| # | 建议 | 依据 |
|---|---|---|
| **M-1** | 五旋钮扩为**六旋钮**：新增 **D6 · 结果回注与丢弃策略**（自动回注 / 不回注仅落盘 / 可回注+可撤销），并在表格里给出"现有实现落在哪端"（现状：**全部落在自动端**） | §6.2、§6.3 |
| **M-2** | **D4 扩为三档**：`spawn` / **`fork-prefix`（新增）** / 独立会话。并在文档里显式记录 D4 与 §5.7 Q4 的**硬冲突**：带了 fork 前缀就不能换子模型（依据 `dsh-tool-subagent/README.md:213`） | §5.1、§5.7、§6.3 |
| **M-3** | 修订 §7.2.2 的 **T0 定义**：从「单会话，无子代理」改为「单会话，**无任务分解**（`E = ∅`）」，并明确**旁路单元是图外孤立顶点，不改变 T 级** | §6.4 第 2、3 点 |
| **M-4** | 在 §7.2.3 的"升级路径"之外**新增一条单元级提升通道**（旁路单元 → T1a 节点），并明确它与 T2a"会话加入"的区别：T2a 要求**先前独立存在**，旁路提升则是**本次派生**，二者不可复用同一通道 | §6.4 第 5 点（对照报告第 1529 行的条件①） |

---

## 7. 三个最关键的空白点

按"不解决就无法交付"排序。

### 空白点 1 · 「丢弃」在 DSH 里不是一个一等动词（**最关键**）

**现状**：全生态（含官方套件）没有任何一个"把已注入内容按 handle 移除"的原语。现有三类机制都不等价：

| 机制 | 它做什么 | 为什么不是丢弃 |
|---|---|---|
| ACP 的 `compress` | 把**区间**换成摘要节点，原文可 `decompress` 恢复 | 粒度是区间不是单元；触发方是模型或 `/acp-prune`；它**改写历史形状**而非撤销一次选择 |
| `dsh-spill` | 落盘并给 locator | **明确没有 retrieval / deletion API**（`dsh-spill/README.md:136`）；策略是自动按 token 预算触发的 |
| `dsh-compaction-tool-result-pruner` | replay-safe 的 head/middle/tail 裁剪 | model-free、自动、不是人的选择 |

**缺的具体件**（三件套）：

1. **稳定的 handle**——"这一段旁路产出"得有个可寻址的名字。本机唯一接近的是 continuable 子代理的 `childId`（`dsh-tool-subagent/README.md:194`），但它归"任务委派"语义。
2. **视图级遮蔽原语**——`shadow` / `unshadow` 这一对。本机唯一接近的是 ACP 的 block 遮蔽（并明确"decompress 不会 unshadow"），但它的寻址单位是区间。
3. **遮蔽状态的告知原语**——"我们丢掉了什么"。**这一件官方已经做了**：`@deepseek-ai/dsh-output-retention`（「neutral notice helpers (what did we keep, what did we omit)」）。缺的是把它接到 1 和 2 上。

**为什么它最关键**：§2.5 的判定式与 §2.3 的结论都指向它。**没有这件东西，这条需求就退化成"又一次普通的工具调用"。**

---

### 空白点 2 · 人类侧入口与"侧栏承载"这两块拼图同时缺失

**现状**：

- **入口**：`dsh-palimpsest`（`lib/index.js:14,21-23`）、`dsh-tool-subagent`、`dsh-spill-policy` **全部是模型调用的工具**，没有一个人类入口。
- **承载**：`dsh-palimpsest` 是纯宿主侧、没有前端半边（`dsh-palimpsest/cordis.patch.yml:2`），所以它的产物**在 UI 上根本没有承载面**。而侧栏插槽 `@deepseek-ai/dsh-client-ui-sidebar-right` 是有的，`clearai-dsh` 已经在用。

**这一块为什么比看起来难**：它同时涉及两侧。

- **人类入口**不难（`dsh-command-compact` 证明 slash command 路径通）。
- **侧栏承载**有基础设施（`dsh-client-ui-sidebar-right`），但要接受一条脏约束：客户端模块扫描只扫宿主 Loader 的行，**预设里的行浏览器看不见**（`clearai-dsh/cordis.patch.yml` 注释：「客户端模块扫描只扫宿主 Loader 的行 —— 预设里的行浏览器看不见，面板就长不出来」）。也就是说，**面板必须由宿主平面的 bundle patch 装**，不能藏在预设里。
- **最硬的一条**：如果旁路单元用子代理实现，则 `presentationMeta` 通道对它不可用——`dsh-tools/lib/index.js:3554` 的条件 `exec.parent === void 0` 把子代理排除在外了。**"旁路做成子代理"与"旁路用 presentationMeta 投影到 UI"二者不可兼得。** 这是本报告发现的最有价值的单条实现约束。

---

### 空白点 3 · 从"旁路"到"主线节点"的升级通道没有定义

**现状**：

- Cursor 有 `@`-mention 把 side chat 上下文**拉回主线**（`cursor.com/help/ai-features/side-chats.md`），但**没有**"把 side chat 变成一个团队成员"的动作。
- DSH 有 `send_message` / continuations（`dsh-tool-subagent-control`），能让一个子代理**继续说话**，但**没有**"把一个已完成的旁路单元提升为任务图节点"的动作。
- concourse 报告有一条会话级的升级（T2a 会话加入，第 1517–1541 行），但它的触发条件明确要求"先前各自独立工作过，不是本次任务派生的"（第 1529 行）——**旁路单元恰好是本次任务派生的，因此这条路走不通**。

**缺的具体件**：

1. 一个**单元级**的提升动作（不是会话级）。
2. 提升时的**语义转换规则**：一变节点，它就要接受 D1（控制权）、D3（通信边）、D5（失败恢复）的约束——**这些约束在旁路态下是不适用的**。谁来决定这些取值？用户，还是父 agent？
3. 提升的**可逆性**：提升之后能退回旁路态吗？如果能，D2（顶点生命周期）会变成一个可来回切换的状态位，这与 D2 现在的"任务型/常驻型"二分并不完全兼容。

**为什么它重要**：它是这条需求与 concourse 主线的**唯一接续点**（§6.4 第 4 点）。在完成它之前，"旁路查询"只能是一个独立插件；完成它之后，它才可能成为 concourse 的一个能力面。

---

## 8. 未确认事项与来源链接

### 8.1 未确认事项（明确列出，不编造）

| # | 事项 | 状态 |
|---|---|---|
| U-A1 | `dsh-annotation` 插件 | **目录不存在**（实测 `$DSH_HOME\profiles\web\node_modules\dsh-annotation` 缺失）。用户清单里的这个名字在本机不成立 |
| U-A2 | `dsh-tool-subagent-report` 的功能 | 目录项存在但为**断链 Junction**（目标 `<NPM_GLOBAL>\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-tool-subagent-report`，`Test-Path` = `False`）。**本机不可读，不作功能结论** |
| U-A3 | `dsh-palimpsest` 的 `presentationMeta` 是否**曾经**在旧版本里实现过 | 当前版本 `0.2.1` 的 `lib/tools/output.js` 只有 `schema` + `render`，没有 `presentationMeta`。注释提到它但代码未声明。**历史版本未核查** |
| U-A4 | `billion-context-dsh` 的 README 正文（39KB） | **未读全文**。本次只读了 `package.json` 与 `cordis.patch.yml` 的注释块。其压缩/恢复的精确 API 语义引用自 DSH 运行时提示与本会话实际工具行为，未逐条核对 README |
| U-A5 | `clearai-dsh` 的 README / CHANGELOG（18KB / 92KB） | **未读**。结论仅基于 `package.json` 的 description 与 `dsh.client.inject` 列表 |
| U-B1 | Claude Code `checkpointing` 的存储位置、保留策略、是否支持不可逆删除 | **未确认**（页面正文被截断，只读到目录结构） |
| U-B2 | Claude Code 子代理结果的精确注入格式与是否可丢弃 | **未确认**（`code.claude.com/docs/en/sub-agents` 未读原文，只有检索片段） |
| U-B3 | Claude Code 是否存在 `sidechain` transcript | **未查到**任何官方来源提及 |
| U-B4 | VS Code / GitHub Copilot Chat 是否有"旁路提问"能力 | **未确认**。只有二手来源指出存在 `/fork` 命令；官方 release notes（v1.110）**未读原文**。本报告不宣称其具备旁路能力 |
| U-B5 | OpenAI Codex（CLI / Cloud）是否有 subagent 或旁路执行 | **未查到**官方文档确认。检索命中的均为第三方文章与 npm 包，不可作为依据 |
| U-B6 | OpenAI Agents SDK 的 handoff 是否算旁路 | **未查**（本轮未检索） |
| U-C1 | `speculative execution for LLM agents` 的学术文献 | **未查到论文**。仅见一个工程 issue（nexi-lab/nexus #1273） |
| U-C2 | `ephemeral sub-agent` 的权威定义 | **未查到**。检索命中的 *Ephemeral Recursive Learning Agents*（Zenodo, Jan 2026, 非同行评审）与本题的相关性未确认 |
| U-C3 | `scratchpad agent` | **未查到** |
| U-C4 | `context quarantine` | **未查到**（检索无有效命中） |
| U-C5 | `branch and discard` | **未查到该术语**。相邻的工程文档存在（LangChain subgraph state isolation / LangGraph checkpointing），但**未读原文** |
| U-C6 | LangChain `deepagents` subagents 文档正文 | **未读**（存在性已确认） |
| U-D1 | concourse 报告 HTML 中 §7.2/§7.3 是否还有本次未覆盖的相关段落 | 本次只读了两节的正文与表格。报告共 2579 行（`Get-Content | Measure-Object -Line`），**其余段落未读**（按任务要求只读这两节） |

### 8.2 来源链接

**读到原文（高置信度）**

- [Side chats · Cursor Help](https://cursor.com/help/ai-features/side-chats.md)
- [Side Chats and Conversation Search · Cursor Changelog](https://cursor.com/en-US/changelog/side-chat) — 版本 **3.11**，**Jul 10, 2026**
- [Temporary chat in ChatGPT · OpenAI Help Center](https://help.openai.com/en/articles/8914046-temporary-chat-faq)
- [Effective context engineering for AI agents · Anthropic Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — **Sep 29, 2025**
- [Checkpointing · Claude Code Docs](https://code.claude.com/docs/en/checkpointing) — 仅目录结构

**只确认存在性，未读原文**

- [Create custom subagents · Claude Code Docs](https://code.claude.com/docs/en/sub-agents)
- [How the agent loop works · Claude Code Docs](https://code.claude.com/docs/en/agent-sdk/agent-loop)
- [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)
- [February 2026 (version 1.110) · VS Code](https://code.visualstudio.com/updates/v1_110)
- [v1_110.md · microsoft/vscode-docs](https://raw.githubusercontent.com/microsoft/vscode-docs/main/release-notes/v1_110.md)
- [GitHub Copilot in Visual Studio Code v1.110 · GitHub Changelog](https://github.blog/changelog/2026-03-06-github-copilot-in-visual-studio-code-v1-110-february-release/)
- [Isolating Subgraph State When Calling Graphs from Tools · LangChain](https://support.langchain.com/articles/6131002418-isolating-subgraph-state-when-calling-graphs-from-tools)
- [How do I configure checkpointing in LangGraph? · LangChain](https://support.langchain.com/articles/1242226068-how-do-i-configure-checkpointing-in-langgraph)
- [Subagents · Docs by LangChain](https://docs.langchain.com/oss/python/deepagents/subagents)
- [Ephemeral Recursive Learning Agents (ERLA) · Zenodo](https://zenodo.org/records/18422395) — 白皮书，非同行评审，相关性未确认

**二手来源（明确标注）**

- [VSCode 標準のフォーク機能(/fork)で Copilot Chat の会話を分岐する · DevelopersIO](https://dev.classmethod.jp/articles/shoma-vscode-built-in-fork-feature-copilot-chat-conversation-branching/)
- [feat: Agent namespace forking for speculative execution · Issue #1273 · nexi-lab/nexus](https://github.com/nexi-lab/nexus/issues/1273) — issue，非论文

**本机报告（只读指定小节）**

- `docs/dsh-agent-teams-concourse-report.html` §7.2（`<h3 id="s72">` 第 1414 行；7.2.2 第 1468 行；7.2.3 第 1517 行）
- `docs/dsh-agent-teams-concourse-report.html` §7.3（`<h3 id="s73">` 第 1671 行；旋钮表第 1676–1687 行；D1–D5 分别在第 1680–1684 行）

### 8.3 本机证据索引（`文件:行号`）

**`dsh-palimpsest`（`$DSH_HOME\profiles\web\node_modules\dsh-palimpsest\`）**

| 位置 | 内容 |
|---|---|
| `package.json:4` | description = 「让 DSH 智能体在新会话里按需检索同一工作目录下历史会话的记忆」；version `0.2.1` |
| `lib/index.js:2` | 「注册三个只读工具，让智能体在**新会话**里按需取回同一工作目录下历史会话的记忆」 |
| `lib/index.js:14` | `export const inject = ['tools', 'sessionQuery'];` |
| `lib/index.js:21-23` | 注册 `palimpsest_list` / `palimpsest_search` / `palimpsest_read` |
| `lib/tools/output.js:2` | 「三个工具共用的输出契约：一段给模型直接阅读的文本。结构化字段留给 presentationMeta，不进入模型上下文。」 |
| `lib/tools/output.js:7-16` | `OUTPUT` 对象：只有 `schema`（单一 `content: string`）与 `render`（→ text block）。**无 `presentationMeta`** |
| `lib/tools/search.js:14` | `const MAX_CHARS = 8000;` |
| `lib/tools/search.js:95-97` | `return { content: publish(renderHitList(visible, { heading, maxChars: MAX_CHARS }), ...) }` |
| `lib/tools/read.js:15-17` | `MAX_LAST = 500`、`DEFAULT_MAX_CHARS = 12000`、`MAX_MAX_CHARS = 60000` |
| `lib/tools/read.js:170` | `return { content: publish(content) };` |
| `lib/core/privacy.js:3-5` | 「…竞品常见做法是把记忆快照注入 system prompt，那等于开一条跨会话提示注入通道；本插件不做注入，但工具结果这条通道同样需要这道声明。」 |
| `lib/core/privacy.js:23` | `export const PRIVATE_MARKERS = ['[私密]', '[no-recall]', '[不参与回忆]'];` |
| `lib/core/privacy.js:41-44` | `hidePrivate(entries)` —— 把带私密标记的会话从结果里剔除 |
| `lib/tools/publish.js:19` | `const { text, count } = redact(rendered);` |
| `lib/tools/publish.js:21-22` | `const token = randomUUID().replaceAll('-','').slice(0,12);` |
| `lib/tools/publish.js:24-30` | 用 `${DATA_BEGIN} ${token}>>>` / `${DATA_END} ${token}>>>` 包住正文 |
| `cordis.patch.yml:2` | 「插件只跑在宿主侧（没有 dsh.client 半边），不向前端投递任何代码。」 |

**`billion-context-dsh`**

| 位置 | 内容 |
|---|---|
| `package.json:4` | description = 「Active Context Pruning (ACP) for the DeepSeek Harness — model-driven context management as a CompactionEngine backend」；version `0.2.27` |
| `cordis.patch.yml`（头部注释 + 两行 patch） | 注释列出能力面：`compress`, `decompress`, `search_context`, `acp_status` + `/acp-prune` + advisory nudge + guidance section；两行 patch = `- id: compaction-basic / disabled: true` 与 `- insert: - id: compaction-acp / name: 'billion-context-dsh'` |

**其他本机插件**

| 位置 | 内容 |
|---|---|
| `clearai-dsh/package.json:4` | description = 「ClearAI: an ontology-first DSH agent preset — evidence-checked research that grows into a domain ontology」；version `0.5.4` |
| `clearai-dsh/package.json`（`dsh.client.inject`） | 注入列表含 `@deepseek-ai/dsh-client-ui-sidebar-right` |
| `clearai-dsh/cordis.patch.yml` | 「客户端模块扫描只扫宿主 Loader 的行 —— 预设里的行浏览器看不见，面板就长不出来」；patch 行 `- id: clearai-host / name: 'clearai-dsh'` |
| `dsh-effort-router/package.json:4` | per-step reasoning-effort routing；version `0.2.3` |
| `dsh-effort-router/cordis.patch.yml` | `- id: effort-router / name: dsh-effort-router` |
| `dsh-lit-search/package.json:4` | 「Academic literature search, citation and BibTeX tools … (Crossref + OpenAlex)」；version `0.1.3` |
| `dsh-lit-search/README.md`（Usage 节） | 注册四个工具 `lit_search` / `lit_cite` / `lit_bib` / `lit_related` |
| `dsh-find-plugin/package.json:4` | 「Find DeepSeek Harness plugins inside the agent — live GitHub dsh-plugin topic search, ranked by stars」；version `0.3.7` |
| `dsh-find-plugin/README.zh.md`（"工作方式"节） | 实时搜索 `dsh-plugin` topic，按 star 降序，5 分钟缓存，匿名 API |
| `dsh-annotation` | **目录不存在**（实测） |

**官方 `@deepseek-ai` 套件（`$DSH_HOME\profiles\node_modules\@deepseek-ai\`）**

| 位置 | 内容 |
|---|---|
| `dsh-tool-subagent/README.md:95` | 「The tool's description derives from `provider.inheritsParentContext`: a fresh child gets "it does not see this conversation" wording, a forked child gets "it does not see the current in-flight turn" wording…」 |
| `dsh-tool-subagent/README.md:180` | 「Success contains only the child's final text; … Intermediate child steps stay out of the parent.」 |
| **`dsh-tool-subagent/README.md:184`** | **「The prompt and result remain in parent history until compaction; child working context remains in the child.」** |
| `dsh-tool-subagent/README.md:194` | 「In continuable mode this tool returns no result of its own: the child's settlement reaches the parent as a service-owned notice … and the child's transcript by its id is the source of its detailed output.」 |
| `dsh-tool-subagent/README.md:198` | 「The acknowledgement is retained; … a continuable child's output never returns through this tool…」 |
| `dsh-tool-subagent/README.md:211` | 「**Background runs expose no result through this tool** …」 |
| **`dsh-tool-subagent/README.md:213`** | **「Shipped fork tools cannot select a child LLM route — they inherit the parent's provider and model to keep the copied conversation prefix eligible for KV Cache reuse.」** |
| `dsh-subagent-fork-in-process/package.json:4` | 「In-process fork subagent backend: runs a child agent seeded with a prefix of the parent's log」；version `0.2.0-rc.2` |
| `dsh-subagent/package.json:4` | 「Abstract subagent seam (ctx.subagents): named-provider registry for delegating to child agents」 |
| `dsh-tool-subagent-control/package.json:4` | 「Globally named send_message, interrupt_agent, and list_agents tools over ctx.subagents continuations」 |
| **`dsh-tools/lib/index.js:3554`** | **`if (exec.parent === void 0 && tool.output.presentationMeta !== void 0) {`** —— presentationMeta **只在顶层执行时投影** |
| `dsh-tools/lib/types/index.d.ts:112` | `presentationMeta?(args: unknown, value: JsonValue): JsonValue;` |
| `dsh-tools/lib/types/schema.d.ts:192` | `presentationMeta?(args: InferArgs<S>, value: InferValue<NoInfer<O>>): JsonValue;` |
| `dsh-tools/lib/types/presentation.d.ts:256-258` | 「…projects them through its `output.presentationMeta` (**persisted with the session log**) and `presentResult` narrows that metadata back into this view on live and replay paths alike.」 |
| **`dsh-spill/lib/types/types.d.ts:16`** | **`export type SpillLocator = Branded<'SpillLocator'>;`** —— 「Opaque model-facing handle for one spilled artifact… Consumers render it with `retrievalHint`, but do not parse it.」 |
| `dsh-spill/lib/types/types.d.ts:67-71` | `export interface SpillRef { locator; bytes; retrievalHint }` |
| `dsh-spill/README.md:12` | 「Choose it when full results must remain retrievable without filling model context. … **The API does not offer retention, replacement, retrieval, or search operations.**」 |
| `dsh-spill/README.md:36` | 「Mount a backend and the policy together; with `maxInlineTokens` set, an oversized text/image tool result becomes a preview plus a locator automatically.」 |
| `dsh-spill/README.md:62` | 「Storage is grouped by the owning session: **forked sessions inherit existing locators** from the seeded log without copying or re-owning them…」 |
| **`dsh-spill/README.md:136`** | **「No retrieval or deletion API — consumers can only render the backend's locator and guidance…」** |
| `dsh-spill-policy/package.json:4` | 「Token-budgeted tool-result retention with recoverable text and image paths」 |
| `dsh-session-reference/package.json:4` | 「Cross-session snapshot references and **durable untrusted** model context (ctx.sessionReferenceResolver)」 |
| `dsh-output-retention/package.json:4` | 「…ItemRetainer/TextRetainer + neutral notice helpers (**what did we keep, what did we omit**)」 |
| `dsh-compaction-tool-result-pruner/package.json:4` | 「**Replay-safe** model-free head/middle/tail pruning for tool-result surface nodes」 |
| `dsh-compaction-basic/package.json:4` | 「Token-meter-driven compaction policy and LLM summarization backend…」 |
| `dsh-command-compact/package.json:4` | 「Human-facing slash command for explicit session compaction」 |
| `dsh-client-ui-sidebar-right/package.json:4` | 「Right Sidebar: the docking surface's session-bound state, its panel and header expand control, and the navigation service over it」 |
| `dsh-jobs/package.json:4` | 「Background job registry (ctx.jobs) … shared ids, **owner isolation**, polling, cancellation, and completion listeners for long-running tool work」 |
| `dsh-plan-mode/package.json:4` | 「Logged per-agent plan mode with deployment guidance, a direct slash command, and **a user-reviewed exit**」 |
| `dsh-goal/package.json:4` | 「Event-sourced same-session goal state and lifecycle service…」 |
| `dsh-schedule/package.json:4` | 「Host-wide durable reminders with shared management and original-Session delivery」 |
| `dsh-session-query-sqlite/package.json:4` | 「Concrete ctx.sessionQuery backend with SQLite FTS5 search」 |
| `dsh-hooks-claude-code/package.json:4` | 「Bridge plugin: run a Claude Code hooks.json / settings hook config on the DeepSeek Harness interception seams」 |

---

## 附 · 一页纸速查

```
需求        会话中途的旁路查询：隔离执行单元 → 一段摘要 → 可丢弃 → 不污染主线
身份        ⑤可丢弃（唯一动作） 载体 ④像子代理（有 handle） 约束 ③不污染
判定式      若旁路结果必然进入主线历史 → 未满足需求（无论叫什么名字）

A 本机最接近 两个各占一半：
             dsh-palimpsest        = 旁路检索（S-2 的一半），但结果必注入主线，无丢弃
             dsh-tool-subagent     = 隔离+摘要（S-4 的一半），但 README.md:184 明说结果留主线
             两者都不是模型：无人类入口、无 handle 归属、无丢弃原语
             官方机制供给：dsh-spill（指针）· presentationMeta（UI-only）· ACP（可逆遮蔽）

B 外部最接近 Cursor Side Chat —— /side /btw；父历史 hidden；@-mention 回注；close=archive 非 delete
             次之：Anthropic 子代理摘要锚点 1,000–2,000 tokens；"just in time" 轻量标识符
             反例：ChatGPT Temporary Chat（只覆盖"不落历史"，是新会话不是中途旁路）
             术语核对：speculative execution / ephemeral sub-agent / scratchpad agent /
                      context quarantine / branch-and-discard —— 全部未查到权威文献

C 七维       ①隔离度 ②回注策略 ③可见性 ④生命周期 ⑤触发方 ⑥丢弃语义 ⑦成本配额
             最决定性 = ② 与 ⑥（唯二没有现成基础设施，且强耦合，必须一起设计）
             顺序 ⑥ → ② → 其余
             两条硬冲突：
               ①fork 前缀 ⟂ 换便宜模型（README.md:213）
               ②子代理载体 ⟂ presentationMeta 投影（dsh-tools/lib/index.js:3554）
             推荐落点：A2 fork-prefix · B4 默认不回注+人工回注 · C2侧栏+C4通告 · L2 保留可续聊
                      T-A 人类入口（必须）· X3 遮蔽语义（不是删除）· Q2独立记账+深度=1

D 接续       落点：D4（上下文策略）——但落在 spawn 与"独立会话"之间的真空里
             D4 需扩档：spawn / fork-prefix（新增）/ 独立会话
             D6 需新增：结果回注与丢弃策略（自动回注 / 不回注仅落盘 / 可回注+可撤销）
             与 T 级：旁路单元【不是】拓扑节点；它是图外孤立顶点，不改变 E，不改变 T 级
                     → 建议修订 T0 定义为「单会话，无任务分解（E=∅）」
                     → "提升"（L3/L4）= 从图外进入图内的那个动作本身
                     → 不能复用 T2a"会话加入"通道（后者要求先前独立存在，报告第 1529 行）

三个空白     1. 「丢弃」不是一等动词（缺 handle / shadow-unshadow / 遮蔽告知三件套）
             2. 人类侧入口 + 侧栏承载同时缺失（且子代理实现堵死 presentationMeta）
             3. 旁路 → 主线节点的单元级提升通道未定义（concourse 接续点）
```
