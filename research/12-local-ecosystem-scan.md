# 11 · 本机已装第三方插件的「旁路探针」能力勘查

勘查范围**严格限定**为：本机已装的 4 个第三方 DSH 插件，各自在「**会话中途查询旁路信息，但不污染主上下文**」这条能力轴上做到了哪一步。不涉及其他领域。

## 0. 勘查对象与路径缩写

4 个包同时在 `profiles\web\node_modules\` 与 `profiles\desktop\node_modules\` 两份并存，版本一致。本文引用 **web** 副本，缩写如下（下文所有 `文件:行号` 均相对于对应前缀）：

| 缩写 | 包 | 版本 |
| --- | --- | --- |
| `P` | `$DSH_HOME\profiles\web\node_modules\dsh-palimpsest` | 0.2.1（`P\package.json:3`） |
| `B` | `$DSH_HOME\profiles\web\node_modules\billion-context-dsh` | 0.2.27 |
| `C` | `$DSH_HOME\profiles\web\node_modules\clearai-dsh` | 0.5.4 |
| `E` | `$DSH_HOME\profiles\web\node_modules\dsh-effort-router` | 0.2.3 |

两份副本的一致性：palimpsest / billion-context / effort-router 逐文件 SHA256 一致；clearai-dsh 两份的差异**仅在嵌套 `node_modules\zod`**（only-web 有大量 zod 源文件、`different` 为空、`only-desktop` 为空），即第一方文件无差异。

---

## 1. 速答表

| 插件 | 一句话定位 | 在「旁路查询但不污染上下文」这条轴上做到哪一步 | 缺什么 |
| --- | --- | --- | --- |
| **dsh-palimpsest** | 跨会话的历史回忆工具（list / search / read 三个只读工具） | **本机最接近旁路探针**。默认零注入：不调用不花 token（`P\README.md:43`、`:110`）；会话中途按需检索，结果是**工具返回值**而非系统提示注入（`P\lib\index.js:20-24`）。有分页/条数/字符三重上限，read 带 `fromSeq` 游标可分段取回 | ① 调用即注入，没有「只看不注入」模式；② 只有字符上限、无 token 预算；③ read 是一次性正文注入，没有「先预览再取全文」的两段式；④ 旁路域硬编码同一 cwd，无跨项目开关（`P\README.md:42`） |
| **billion-context-dsh** | 不是外挂存储、不是检索代理，而是 **DSH 的 CompactionEngine 后端**（Active Context Pruning） | 它治的是「主上下文太大」，不是「想旁路查外部信息」。但 `search_context` 是「先给预览 + 回链、再按需取正文」的两段式：每次至多 5 条 × 160 字符预览 + 块回链（`B\dist\index.js:8821`、`:8823-8831`），再用 `decompress` 按 ~7K 字符/页取回正文 | ① 检索域被限定在**本会话已压缩的块**，不是跨会话/外部信息；② 它自带 `agent/pre-step` 注入路径（`B\dist\index.js:9652-9672`），天然是「影响主上下文」的设计取向；③ 无「只看不注入」模式 |
| **clearai-dsh** | 本体优先（ontology-first）的 DSH agent 预设：证据核验式研究 + 领域本体 | **不在**这条轴上。它不提供任何面向模型的「旁路查询」工具；知识视图是**宿主侧投影**（`C\lib\knowledge-view.js:606`），状态从会话记录派生、无第二份存储（`C\README.zh-CN.md:77`） | 无上下文/检索治理机制；其工具面是认识论契约（`Frame`/`Conclude`）而非检索入口 |
| **dsh-effort-router** | 按步推理档位路由：分类每一步的难度，改写 `reasoningEffort` | **不在**这条轴上。它读会话证据只为选档位（`E\lib\index.js:328` 收集信号、`:443-553` 在 `agent/request` 上改写档位），不增删上下文内容、不提供旁路查询 | 与「旁路信息」无关；无检索/存储/上下文组件 |

---

## 2. dsh-palimpsest 详解

### 2.1 挂载形态

- `P\package.json:3` version `0.2.1`；`:28-32` 通过 `dsh.bundle.patch` 声明补丁；`:34` peer 依赖 `@deepseek-ai/dsh-tools`。
- `P\cordis.patch.yml:7-9` insert 一个 id 为 `dsh-palimpsest` 的条目，**纯宿主侧**，无客户端模块。
- `P\lib\index.js:11` `name = 'palimpsest'`；`:14` `inject = ['tools','sessionQuery']`；`:20-24` `apply` 里**只做一件事**：注册三个工具（`createListTool` / `createSearchTool` / `createReadTool`）。
- **关键否定式证据**：该插件**没有任何** `ctx.on(...)` 事件订阅、没有系统提示注册、没有自动注入路径。全文只有工具注册。这是「零注入」主张的实现层依据（README 声明见 `P\README.md:43`：零注入 = 从不自动进 system prompt）。

### 2.2 三个工具的签名与默认值

**`palimpsest_list`**（`P\lib\tools\list.js`）

| 项 | 值 | 证据 |
| --- | --- | --- |
| 参数 | `limit`（默认 20，上限 100）、`includeSubagents` | `P\lib\tools\list.js:20-29` |
| 常量 | `DEFAULT_LIMIT=20`、`MAX_LIMIT=100`、`MAX_CHARS=8000` | `P\lib\tools\list.js:10-12` |
| cwd 取不到 | 返回 `UNKNOWN_CWD_NOTICE` 并失败关闭 | `P\lib\tools\list.js:56-57` |
| 渲染 | `renderSessionList(visible, { heading, maxChars: MAX_CHARS })` | `P\lib\tools\list.js:68` |

**`palimpsest_search`**（`P\lib\tools\search.js`）

| 项 | 值 | 证据 |
| --- | --- | --- |
| 参数 | `query`（必填）、`limit`（默认 10，上限 50）、`snippetChars`（默认 200，上限 500） | `P\lib\tools\search.js:22-36` |
| 常量 | `DEFAULT_LIMIT=10`、`MAX_LIMIT=50`、`DEFAULT_SNIPPET=200`、`MAX_SNIPPET=500`、`MAX_CHARS=8000` | `P\lib\tools\search.js:10-14` |
| 自动排除当前会话 | `excludeSessionId = currentSessionId(exec)` | `P\lib\tools\search.js:91`（会话 id 取自 `P\lib\tools\context.js:32-35`） |
| 私密过滤 | `hidePrivate` | `P\lib\tools\search.js:93` |
| 出参 | `publish(renderHitList(visible,{heading,maxChars:MAX_CHARS}), hidden, result.unreadable ?? 0)` | `P\lib\tools\search.js:96` |
| 降级/截断如实上报 | `headingFor` 写出降级原因与「仅扫描最近 N 个」 | `P\lib\tools\search.js:48-60` |

**`palimpsest_read`**（`P\lib\tools\read.js`）

| 项 | 值 | 证据 |
| --- | --- | --- |
| 参数 | `sessionId`（必填）、`last`（默认 30，上限 500）、`fromSeq`、`includeTools`、`maxChars` | `P\lib\tools\read.js:26-48` |
| 常量 | `DEFAULT_LAST=30`、`MAX_LAST=500`、`DEFAULT_MAX_CHARS=12000`、`MAX_MAX_CHARS=60000` | `P\lib\tools\read.js:14-17` |
| `last=0` | 不限条数（`resolveLast`） | `P\lib\tools\read.js:51-53` |
| `maxChars` 夹取 | `clampCount(..., 12000, 60000)` | `P\lib\tools\read.js:164` |
| 两种方向 | `fromSeq` 有限值 → 向前渲染；否则 → 尾部渲染 | `P\lib\tools\read.js:167-169` |
| 默认过滤 | system 与 tool/toolOnly 消息默认都**不进**（除非显式开启） | `P\lib\core\filter.js:5-10`、`:18-21` |

### 2.3 返回上限（三重）

1. **条数上限**：list 100 会话（`P\lib\tools\list.js:12`）、search 50 命中/10 默认（`P\lib\tools\search.js:11`）、read 500 条/30 默认（`P\lib\tools\read.js:15`）。
2. **条目内长度上限**：search 每个命中片段 ≤500 字符（`P\lib\tools\search.js:13`）；每个会话最多保留 3 条命中（`P\lib\search.js:17`）。
3. **整次返回的字符上限**：list/search 各 8000 字符（`P\lib\tools\list.js:12`、`P\lib\tools\search.js:14`），read 12000–60000 字符（`P\lib\tools\read.js:16-17`）。

三重上限的落点全在渲染层：`P\lib\core\limit.js:16-20` `clampTail`（保留尾部 + 写明省略了多少字符）、`:28-32` `clampHead`（保留头部 + 写明总长度）、`:41-45` `clampCount`。

`read` 的 `fromSeq` 是**真正的分页游标**：`P\lib\core\render.js:92-116` 逐条装填、超限即 break 并把 `next = item.seq`；`:109-112` 兜底——连第一条都装不下时截断展示第一条、仍给出下一条游标；`:114` 输出 `（已达输出上限，下一段用 fromSeq=${next} 继续）`。窗口切片在 `P\lib\core\window.js:11-18`。

### 2.4 结果如何进入模型上下文

- 三个工具的输出契约**只有一个自由文本字段**：`P\lib\tools\output.js:7-16` 的 `OUTPUT.schema` 形如 `{ type:'object', additionalProperties:false, properties:{ content:{type:'string', required:true} } }`，`render` 返回 `[{ type:'text', text: String(value?.content ?? '') }]`。
- 因此 **content 原文就是模型看到的全部内容**，受 2.3 的字符上限约束；**不存在第二条旁路通道**。
- 值得注意的注释：`P\lib\tools\output.js:2` 明确写着「结构化字段留给 presentationMeta，**不进入模型上下文**」——但该 `OUTPUT` 对象**没有声明 `presentationMeta` 键**。**这个通道只有注释、没有实现。**（宿主确实提供该原语，见 §5。）
- 每次调用由 `publish()` 统一包装：`P\lib\tools\publish.js:18-31` 产出**单段文本** = preface（不可信数据声明 + 打码计数）+ `` `<<<PALIMPSEST-DATA ${token}>>>` `` + 正文 + `` `<<<END-PALIMPSEST-DATA ${token}>>>` ``，`token` 是每次调用新生成的随机串（`:19` 附近），正文中的同名 token 会被替换，防止历史数据伪造边界。
- **重要细节**：边界标记与声明是在 `maxChars` 夹取**之后**拼接的（`P\lib\tools\publish.js:18-31` 对已 clamp 的 body 做包装），所以**实际占用略高于名义上限**。这在按 token 预算估算时要计入。
- 不可信数据声明本身在 `P\lib\core\privacy.js:13-16`（UNTRUSTED_NOTICE）、`:19-20`（`DATA_BEGIN`/`DATA_END`）。

### 2.5 有没有「只看不注入」的模式？——没有

- 三个工具**只有一种执行路径**：读数据 → 渲染 → `publish` → 作为工具结果返回。没有 dry-run、没有「只在 UI 显示」、没有 preview-only 开关。
- 唯一接近「先看后取」的机制是 **search 的片段**（≤500 字符，`P\lib\tools\search.js:13`）：它给出命中位置与短片段，模型可以据此再决定是否 `read`——算**半个两段式**，但 search 本身的片段也已经进上下文。
- **token 上限：未找到**。全库的额度常量都是字符数（8000 / 12000 / 60000 / 200 / 500），没有任何 token 计数或 token 预算代码。README 只用「不调用就不花 token」表述成本：`P\README.md:110`「只在需要时检索、不做自动注入：不回忆就不花 token」。

### 2.6 作用域过滤：按工作目录，不是全局

- **取 cwd 的方式**：`P\lib\tools\context.js:15-17` `currentCwd` **只读**调用方会话头 `exec.agent.session.header.cwd`，并**故意不回退** `process.cwd()`；取不到就发 `UNKNOWN_CWD_NOTICE`（`P\lib\tools\context.js:23-24`），list/search/read 三处各自提前返回（`P\lib\tools\list.js:56-57`、`P\lib\tools\search.js:86-87`、`P\lib\tools\read.js:131-133`）。这是**失败关闭**（fail-closed）设计。
- **规范化**：`P\lib\core\scope.js:18-24` `normalizeCwd` 只去尾部斜杠、不 trim，全空白视为 `undefined`；`:32-36` `matchesCwd` 是**逐字相等**比较。
- **过滤谓词**：`P\lib\core\scope.js:47-52` `inScope` = cwd 相同 **且** 排除 `excludeSessionId` **且** 默认排除子代理会话（看 `header.delegationDepth`）。
- **两条检索路径都在收口处过滤**：
  - 索引路径：`P\lib\search.js:23-27` `indexRequest` 在 cwd 存在时把 `sessionFilters:[{kind:'cwd', values:[cwd]}]` **下推给宿主索引**；`:66-68` 索引命中也再过一遍 `inScope`。
  - 扫描路径：`P\lib\search.js:99-113` `scanSessions` → `:100` 取会话列表 → `:101` `inScope` 过滤 → `:102` 按创建时间倒序 `slice(0, 40)`（`SCAN_SESSION_LIMIT=40` 在 `:11`，并发 4 在 `:14`）。
- **列表路径**：`P\lib\queries.js:130-149` `listSessionsForCwd` —— `:132` `sessionQuery.listSessions(signal)` 拿全部 → `:133` `inScope` 过滤 → `:136` 排序截断 → `:137` 取标题 → `:139` 剔除 `unreadable`。
- **候选窗口参数**：`P\lib\queries.js:18-19` `INSPECT_MIN=30`、`INSPECT_MAX=120`；`:49-52` `inspectionLimit = min(120, max(30, limit*3))`；`:11` `SUMMARY_CONCURRENCY=6`。
- README 的对应声明：`P\README.md:42` 硬范围——无跨项目开关、读取路径独立校验 cwd、cwd 取不到就失败关闭。

### 2.7 安全观察

1. **过滤发生在插件进程内，不是宿主强制的边界。** 插件调用 `sessionQuery.listSessions(signal)` 得到的是**全部**会话头，cwd 过滤是插件自己做的（`P\lib\queries.js:132-133`、`P\lib\search.js:100-101`）。这意味着 cwd 隔离的正确性依赖插件代码本身，而非运行时约束。
2. **一个看似危险的全局检索回退分支，在工具路径上不可达。** `P\lib\search.js:23-27` 在 **cwd 缺失时退回无过滤的 base（全局检索）**；但工具入口 `P\lib\tools\search.js:86-87` 已经在 cwd 为空时提前返回 `UNKNOWN_CWD_NOTICE`。所以这条分支只能被「不经过工具入口、直接调用 `searchSessions` 的代码」触发。**结论：当前不可达，但它是唯一一处「无过滤」代码路径。**
3. **read 有 Pre-check 与权威复核两层，Pre-check 失败会放行。** `P\lib\tools\read.js:107-117` 的 `headerInScope` 预检在「列表抛错或查不到该会话」时返回 **true（放行）**，理由是交给后续权威复核；权威复核是 `P\lib\tools\read.js:154` 的 `matchesCwd(session, cwd)`，在**解出正文之后**执行。**只要第 154 行在，越权读取不成立；风险集中在「复核被绕过/移除」这一种情况。**
4. **失败关闭（fail-closed）链条完整**：`P\lib\core\scope.js:32-36` cwd 缺失 → `matchesCwd=false`；`:69-80`（`P\lib\queries.js:69-80`）批量标题没回话的 id 记为 `unreadable`，随后被剔除；`P\lib\tools\read.js:143-149` 标题读不出来 → **拒绝读取**；`:85-94` 标题不可用时给出说明而非放行。
5. **私密标记只认标题，且三处各自重新取标题。** 标记集合在 `P\lib\core\privacy.js:23`（`['[私密]','[no-recall]','[不参与回忆]']`），判定 `:30-34` `isPrivateTitle`、过滤 `:41-44` `hidePrivate`；读取路径在**解正文之前**判定（`P\lib\tools\read.js:150-151`）。三处取标题的位置：`P\lib\queries.js:137-139`、`P\lib\search.js:126-130`、`P\lib\tools\read.js:145`——是**每次重新读**，不是一次性快照，所以标题被改写后能被及时反映。
6. **出口脱敏只认形态。** `P\lib\core\redact.js:128` `export function redact(input)`；`P\lib\tools\publish.js:19` 附近统计打码条数并写进 preface。README 明确承认这条防线的边界：`P\README.md:112-124`（三条防线 + 明确列出做不到什么：脱敏只认形态、声明挡不住精巧注入）。
7. **性能代价（README 自陈）**：`P\README.md:142` 每次检索要解压扫描会话日志，20 个历史会话约 4 秒。

### 2.8 与「旁路探针」需求轴的差距

- ✅ 已经做到：**默认不注入**（`P\lib\index.js:20-24` 只有工具注册，无事件订阅）；**调用即取、取多少可控**（三重上限）；**可分段**（`fromSeq` 游标）；**跨会话但限同一 cwd**；**失败不伪装**（`P\README.md:48`）。
- ❌ 缺 ①：**没有「只看不注入」模式**——三个工具的结果必然进主上下文，没有预览/试读/丢弃。
- ❌ 缺 ②：**没有 token 计价或预算**——只有字符常量，且 `publish` 的边界与声明不计入 `maxChars`（`P\lib\tools\publish.js:18-31`）。
- ❌ 缺 ③：**read 没有两段式**——search 的 500 字符片段只能算半个预览，`read` 一次就是整段正文注入。
- ❌ 缺 ④：**旁路域窄**——范围硬编码同一 cwd，没有跨项目开关（`P\README.md:42`）。
- ❌ 缺 ⑤：**没有使用宿主的结构化旁路通道**（见 §5）。

---

## 3. billion-context-dsh 详解

### 3.1 它到底做什么

**不是压缩工具、不是外挂存储、不是检索代理——它是 DSH 的 CompactionEngine 后端实现（Active Context Pruning）。**

- `B\package.json:4` description 自述：「Active Context Pruning (ACP) … as a CompactionEngine backend」。
- `B\cordis.patch.yml:7-17` 做两件事：**禁用宿主自带的 `compaction-basic`**，并**插入 `compaction-acp`**；`:27-32` 说明它插在 **host 平面**，因此四个工具对 profile 的所有模式生效。
- `B\package.json:49-68` 的 peer 面很宽（`dsh-compaction` / `dsh-session` / `dsh-llm` / `dsh-tools` / `dsh-settings` 等），所以它替换的是宿主的压缩引擎，而不是外挂一层。

### 3.2 四个工具（`B\dist\index.js:8904-8944` 的 `makeTools`）

| 工具 | 定义位置 | 作用 |
| --- | --- | --- |
| `compress` | `B\dist\index.js:8907-8915` | 把一段上下文替换成**模型自己写的**摘要 |
| `decompress` | `B\dist\index.js:8916-8924` | 按块 id 只读取回原文 |
| `search_context` | `B\dist\index.js:8925-8933` | 在**已压缩块**里检索，只回预览 + 回链 |
| `acp_status` | `B\dist\index.js:8934-8942` | 报上下文占用、可压缩范围、块 ledger |

（名称常量在 `B\dist\index.js:1005-1008`。）

### 3.3 「超出窗口的内容」怎么变得可用

**机制一：原文从不丢，摘要成为 checkpoint 节点。**
`B\dist\index.js:7140-7143` 关键一行：
`session.append('user/message', message, { surfaceOp: { op:'replace', startSeq, endSeq }, sourceEventSeqs:[...input.shadowedSeqs] })`
—— 摘要是模型写的，作为 `surfaceOp: replace` 的 checkpoint 节点挂进会话，**原文仍留在 append-only 日志里**。同一机制的第二处在 `B\dist\index.js:7253-7262`（引擎自己写的溢出抢救摘要，标记 `source: { kind:'plugin:billion-context-dsh' }`）。

**机制二：decompress 按页取回。**
- 参数：`blockId`（必填）、`offset`、`limit`（上限 100）—— `B\dist\index.js:8699-8703`。
- 页大小：`B\dist\index.js:7649-7651` `DEFAULT_DECOMPRESS_PAGE=100` / **`DEFAULT_DECOMPRESS_PAGE_CHARS = 7e3`** / `sliceDecompressPage`。
- 输出：`B\dist\index.js:8711-8758`，`:8749` `[messages a..b of total]`，`:8750` 续读提示 `More available — continue with decompress({ blockId, offset })`。
- README 给出设计理由：`B\README.md:215` 每页约 7K 字符、至多 100 条，**刻意低于宿主 tool-result 的 8192 截断阈值**。

**机制三：search_context —— 这条轴上最像「旁路探针」的部分。**
- 参数：`query`（必填）、`limit`（默认 5）—— `B\dist\index.js:8759-8762`。
- 域构建：`B\dist\index.js:8776-8815` `buildSearchDocs` **从会话日志重建**「块摘要 + 被遮蔽原文」的文档集，`searchDocsCache` 用 WeakMap 按事件数组缓存。
- 检索 + 出参：`B\dist\index.js:8821` `searchBlocks(docs, args.query, { limit: args.limit ?? 5, previewLength: 160 })`；`:8823-8831` 每个命中只写**一行** `- block bN (score X.XX): preview`，并在末尾提示可用 decompress 取回。
- **所以进入模型上下文的只有「≤5 条 × 160 字符预览 + 块回链」，正文按需再取。** 这是本机第三方插件里唯一成型的两段式（预览 → 显式取回）。

**机制四：不代表模型发言——但也不是完全沉默。**
- `B\dist\index.js:9652-9672` `ctx.on('agent/pre-step')`：先清理孤立的 surface 工具消息、再 `resyncSettings`；只在 `autoNudge` 为真时才 `:9671` `{ kind:'enter', messages:[...decision.messages, outcome.message] }` 把 nudge 注入。README 的立场：`B\README.md:45` 只建议不强令（唯一例外是 `maxOverflowRetries`）；`:202` 刻意不做自动摘要，`compactIfNeeded` 返回 null。
- 溢出兜底：`B\dist\index.js:9678-9707` 监听 `agent/request-error` 的 `CONTEXT_WINDOW_EXCEEDED`，触发自动抢救压缩后 `:9700` `{kind:'retry'}`；重试次数上限 = 配置 `maxOverflowRetries`，默认 1（`B\README.md:251`）。
- 工具调用对的隐藏：`B\dist\index.js:9636-9651` 在 `session/event` 上隐藏 compress 工具的 call/result 对。

### 3.4 其他细节

- `acp_status` 内容：`B\dist\index.js:8834-8902`；`:8881` `Nudge: ACTIVE/idle — reason`；`:8883-8885` `Checkpoint seqs (active blocks …)`；`:8898` `Surface: …`；`:8899-8901` drilldown 说明。
- README 的工作原理映射表：`B\README.md:184-200`（`:190` compress→surfaceOp replace；`:193` decompress 只读恢复；`:194` search_context 从日志重建文档集、混合检索、命中回链所属块；`:197` 分层蒸馏 T2/T3；`:200` 注入行卫生：AGENTS.md / skill 目录 / 活动用户回合硬拒绝保护）。
- 配置：`B\README.md:241-253`（`modelContextLimit` 自动探测、回退 128000；`nudgeMin` 0.45 / `nudgeMax` 0.70 / `nudgeEmergency` 0.85；`autoTools`/`autoCommand`/`autoNudge` 默认 true；`maxOverflowRetries` 默认 1）。
- 内核检索默认值供对照：`B\dist\index.js:6309` 内核 `previewLength` 默认 200，工具层把它压到 160（`:8821`）。

### 3.5 在这条轴上的判定

它**不是**旁路探针，而是**「上下文太大时的可恢复压缩」**：`compress` 减小上下文，`decompress` / `search_context` 负责把被压掉的东西**按需取回**。它的检索域是**本会话已压缩的块**，不是跨会话历史、也不是外部资料。它在本轴上的价值是**提供了一套可复用的两段式形态**（预览 + 回链 → 显式取全文），并且它在设计上就接受「影响主上下文」（`agent/pre-step` 注入 + 溢出自动压缩）。

---

## 4. clearai-dsh 与 dsh-effort-router 速览

### 4.1 clearai-dsh —— 一句话定位

**一个「本体优先」的 DSH agent 预设**：把证据核验式研究流程固化成认识论循环，并让研究结果长成领域本体。

- `C\package.json:4` description：「an ontology-first DSH agent preset — evidence-checked research that grows into a domain ontology」；`:13` main = `./lib/host.js`；`:45-60` 声明两项 `dsh.bundle.patch` 并带一个客户端模块（`dsh.client.platform = web`）；`:38-41` engines `node>=22`、`dsh>=0.2.0-rc.2`。
- **组成的三个面**（`C\README.zh-CN.md:218-220`）：一个宿主包 + 一个 agent 预设 + 一个客户端模块；**DSH 引擎一行没改**。
- 宿主半：`C\lib\host.js:25` `export const name = 'clearai-host'`；`:27` `export const inject = ['sessionProjections','sessions']`；`:21` 引入 `knowledgeView`。`C\cordis.patch.yml:5-6` 说明投影单元 `clearai` 把工具写下的变更记录折成视图，**在会话日志上注册投影、多会话共享注册表**；`:11-13` insert `clearai-host`；`:15-31` 预设本体由 `C\presets\clearai\clearai.patch.yml` 承载。
- **它涉及的上下文/检索机制 = 会话投影，而不是检索**：`C\lib\knowledge-view.js:606` `export function knowledgeView(state, derived, options)`；`:190` 定义 `L0`–`L4` 五个认识论等级；`:197` `LEVEL_WORD`（L3/L4 = 独立核验 / 人工批准）；`:200` `HANDLE_LIMIT = 12`（句柄数上限）。
- **关键设计声明**：`C\README.zh-CN.md:77`「状态从会话记录派生，**没有第二份存储**；模型的工具里没有可以宣告某一步完成的字段」。这与本轴的关系是**反面**的：它刻意不做「另一份可查询的存储」，所以也谈不上旁路检索。
- 工具面落在预设的插件里：`C\presets\clearai\plugins\clearai-kernel.js:2704` `defineTool('Frame', ...)`（立题）、`:3272` `defineTool('Conclude', ...)`（结案），另有 `:4103` / `:4177` / `:4223` / `:4611` 的 `defineTool`；`:2167` 通过 `ctx.get('sessionProjections')?.stateOf?.(session,'turnBoundary')` 读投影。这些都是**认识论契约工具**，不是检索/上下文工具。
- 预设装配位置：`C\presets\clearai\agent.cordis.yml:20` persona、`:26` agent-instructions、`:152` clearai-kernel、`:226` tool-todo、`:233` delegation、`:293` present。

**判定：clearai-dsh 不在这条能力轴上。** 它没有面向模型的「旁路查询」入口，知识视图是宿主侧投影/呈现层。

### 4.2 dsh-effort-router —— 一句话定位（确认）

**按步推理档位路由**：从任务简述与会话实时证据判断当前这一步属于哪一档难度，改写该请求的 `reasoningEffort`。

- `E\package.json:7` description 逐项列明：分类 trivial/standard/engineering/hard → 工具报错时升级 → 用滞回（hysteresis）稳定 → 夹取到目标模型实际公布的 effort 档位 → 在原生模型选择器里注入一个 `Auto` 掩码。`:33` engines `dsh >=0.2.0-rc.1 <0.2.1-0`；`:35-52` `manifestVersion: 1` + `dsh.bundle.patch` + `dsh.client.platform = web`（inject 7 个 `dsh-client-ui-*` 包）。
- `E\lib\index.js:44-45` `export const name='dsh-effort-router'` / `export const inject=[]`；`:328` `ctx.on('agent/inbox/claimed', ...)` 收集信号；`:443-553` `ctx.on('agent/request', ...)` 按步注入/改写档位（`:506-507`、`:520-521`、`:550-553` 赋 `out.reasoningEffort`）；`:318` settings 变更、`:320` `llm/adapters-updated`、`:413` `'auto'` 掩码。分类器入口：`E\lib\signals.js:99` `export function createSignals(opts)`。
- **判定：不在这条能力轴上。** 它既不增删上下文内容，也不提供任何检索/旁路查询；它唯一的「写入」是把 `reasoningEffort` 字段换掉。

---

## 5. 结论：本机生态里最接近「旁路探针」的实现是谁，差在哪

### 5.1 排名

| 名次 | 实现 | 形态 | 为什么不是满分 |
| --- | --- | --- | --- |
| **1** | **`dsh-palimpsest`** | 会话中途按需检索历史会话，**只有被调用才产生上下文**，且带分页/条数/字符三重上限 | 调用即注入；无 token 预算；read 无两段式；域限同一 cwd |
| **2** | **`billion-context-dsh` 的 `search_context`** | 预览（≤5 × 160 字符）+ 块回链 → `decompress` 按 7K/页取回，**形态上是本机唯一的成型两段式** | 检索域只有**本会话已压缩块**，不是外部/跨会话信息；本质是「压缩后取回」而不是「探针」 |
| 3 | `clearai-dsh` | 会话投影 / 知识视图 | 不提供面向模型的查询入口，且刻意不建第二份存储 |
| 4 | `dsh-effort-router` | 档位路由 | 与本轴无关 |

### 5.2 差在哪（四类缺口）

**缺口 ①：两家都只有「调用即注入」，没有「只看不注入」。**
真正零注入的结构化旁路通道其实宿主已经提供：`presentationMeta`。声明见 `...\profiles\node_modules\@deepseek-ai\dsh-tools\lib\types\index.d.ts:112`（`presentationMeta?(args, value): JsonValue`）；投影逻辑见 `dsh-tools\lib\types\index.js:1204-1212`（仅当 `exec.parent === undefined` 时投影一次并 `snapshotProjection(tool.name,'presentationMeta', projected)`）；语义见 `dsh-tools\lib\types\presentation.d.ts:256-260`——这些结构化字段**无法从模型可见文本重建**，所以经 `presentationMeta` 投影、**随会话日志持久化**，由 `presentResult` 在实时与回放两条路径上还原。
**也就是说：这条「进日志与 UI、不进模型上下文」的通道是现成的，而两个插件的处置是——palimpsest 知道它但没实现（`P\lib\tools\output.js:2` 只有注释，`OUTPUT` 未声明该键，`:7-16`）；billion-context 完全没用它。**

**缺口 ②：没有 token 计价，只有字符硬截断。**
palimpsest 全部额度都是字符（`P\lib\tools\read.js:14-17`、`P\lib\tools\list.js:10-12`、`P\lib\tools\search.js:10-14`），且 `publish` 的边界与声明**不计入** `maxChars`（`P\lib\tools\publish.js:18-31`）。billion-context 有占用率概念（nudge 阈值 0.45/0.70/0.85，`B\README.md:241-253`），但那是**本会话窗口占比**，不是「这次旁路查询花了多少」的预算。

**缺口 ③：单次返回没有「先预览、再决定取全文」的强制两段式。**
只有 billion-context 的 `search_context` 是真正两段式（预览 160 字符 + `decompress` 取全文）。palimpsest 的 `search` 片段（≤500 字符）算半个预览，而 `read` 是**一次性正文注入**（`P\lib\tools\read.js:151-170`，默认直接解出正文并 `publish`）。

**缺口 ④：旁路域窄。**
palimpsest 的域是「同一 cwd 的历史会话」——硬编码、无跨项目开关（`P\README.md:42`）；billion-context 的域是「本会话已压缩块」。本机上**没有任何插件**能做到「旁路查询任意外部语料（文件/网页/他项目）并只把指针带进上下文」。宿主层倒是有对应原语：`dsh-spill` 提供 `ctx.spillStore.saveText()`，返回不透明 locator 与字节数，README 自述其用途是「full results must remain retrievable **without filling model context**」（`...\profiles\node_modules\@deepseek-ai\dsh-spill\README.md:12`）——**但没有一个第三方插件用它来搭旁路探针**。

### 5.3 一句话

**本机最接近「旁路探针」的是 `dsh-palimpsest`**（默认零注入 + 会话中途按需检索 + 三重上限 + `fromSeq` 分页）；**它差在**：结果一定进主上下文、没有 token 预算、`read` 没有预览/取全文两段式、旁路域锁死在同一 cwd、也没有用宿主现成的 `presentationMeta` 零注入通道。形态上更接近「两段式探针」的是 `billion-context-dsh` 的 `search_context`，但它的域是「本会话被压掉的块」，不是外部信息。

---

## 6. 未确认事项

1. **宿主对单次工具结果的运行时截断阈值未在源码核对。** 「8192」这个数字只出现在 `B\README.md:215` 的插件自述里，本次未在 `dsh-tools` 源码中找到对应实现来确证。
2. **未在运行中的会话实测三个 palimpsest 工具的真实返回长度**，所有上限结论都来自常量与渲染函数（静态证据）。
3. **`normalizeCwd` 只去尾部斜杠、不 trim、`matchesCwd` 逐字比较**（`P\lib\core\scope.js:18-24`、`:32-36`）。在 Windows 上「大小写不同 / 分隔符不同 / 末尾空格不同」的同一目录是否会被判为不同项目——**这是推论，未实测**。
4. **clearai-dsh 的 `lib\fold.js`（约 151KB）与 `presets\clearai\plugins\ontology.js`（约 27KB）未逐行读**，其中是否含面向模型的检索类工具未确认；本报告对它的「不在这条轴上」判定基于 `README.zh-CN.md`、`lib\host.js`、`lib\knowledge-view.js` 与 `clearai-kernel.js` 的工具定义抽样。
5. **dsh-effort-router 的分类策略未细读**（`E\lib\policy.js` 约 26KB、`lib\routing.js`、`lib\capability.js`、`lib\client.js`），任务只要求确认定位，故仅核实了 description 与事件挂载点。
6. **billion-context-dsh 的 `compress` 在「模型不调用」时的行为**只从 README 的自述（`B\README.md:45`、`:202`）与 `compactIfNeeded` 返回 null 推断，未实测。

---

*勘查说明（非结论）：本文件按要求写入 `research\11-local-ecosystem-scan.md`，但该目录下已存在 `11-side-inquiry-requirement-space.md`，两者编号重叠，如需保持编号唯一请重命名为 `12-…`。*
