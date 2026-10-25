# 划词解读 · 插件端精读

> 调研对象：`@yfwu2020/dsh-selection-explain` v0.12.0
> 解包位置：`$DSH_HOME\tmp\audit-selection-explain\src\package\`
> 证据等级：A = 直接读源码并给出 `文件:行号`；B = 读 README/注释；C = 推断
>
> **本报告只记录我亲自核对过的内容。** 未能逐行读的部分（`lib/client.js` 475.6KB、
> `lib/host/effort.js`、`lib/host/filters.js`、`lib/host/history-store.js`、`lib/host/speech.js`、
> `native/mic-probe.c`）集中在第 14 节列为未确认，不做猜测。

---

## 1. 一句话定位

一个**完全不碰主会话**的平行对话：选中文字 → 浮层小窗 → 直接 `ctx.llm.stream()` 出结果，
历史存自己的 JSON。唯一的外写动作是「升格」，而它做的是**新建一个正式会话**，不是回注当前上下文。

---

## 2. 包与环境

| 项 | 值 | 证据 |
| --- | --- | --- |
| 包名 | `@yfwu2020/dsh-selection-explain`（**带 scope**，裸名 `dsh-selection-explain` 在 npm 上 404） | `package.json:2` · A |
| 版本 | 0.12.0 | `package.json:3` |
| 许可 | MIT | `package.json:12` |
| 作者 / 仓库 | yfwu2020 · `github.com/yfwu2020/dsh-selection-explain` | `package.json:13-19` |
| 入口 | `./lib/index.js`（只做 re-export，实现在 `host/`） | `lib/index.js:1-21` |
| 契约面 | `inject = ['webServer', 'llm']` | `lib/host/constants.js:22` · A |
| bundle patch | `./cordis.patch.yml`，insert 一行 `id: selection-explain` | `cordis.patch.yml:27-35` |

**`inject` 只有两个服务**，这一条本身就排除了「它偷偷建会话」的可能——`sessionController`
不在注入列表里，需要时是用 `ctx.get('sessionController')` 动态取的（见第 7 节）。

---

## 3. 模型调用路径（关键问题一）

**结论：`ctx.llm.stream()`，会话无涉。整个 `analyze.js` 里没有 `sessionController`、没有 `agent.inject`、没有 `ctx.subagents`。**

```
lib/host/analyze.js:567   const stream = ctx.llm.stream({          // 首轮
lib/host/analyze.js:896   const resume = ctx.llm.stream({          // 追问 / 续答
```

对一个 65.8KB 的文件做全文检索，`ctx.llm` 只出现这两处，且都是 `.stream(`。
`sessionController` / `agent.` / `ctx.subagents` / `inject(` 在该文件中**零命中**。

### 传入的参数（`analyze.js:567-593`）

| 参数 | 值 / 条件 | 备注 |
| --- | --- | --- |
| `provider` / `model` | `route.provider` / `route.model` | 由 `models.js` 解析，支持"跟随主线"或单独指定 |
| `sessionId` | 有则传 | **见第 13 节第 1 条，这是最容易踩的坑** |
| `system` | `undefined` | 不用 system 字段，改走 `systemMessageOf()` 别名 |
| `messages` | `checkedMessages([...])` | 过一层校验再交给 llm |
| `tools` | `toolSchemas.length > 0` 时每轮都带 | **收尾轮也不摘**，见第 13 节第 2 条 |
| `temperature` | 仅当 `>= 0` 才传 | 默认 `-1` = 不传，交给供应商 |
| `maxTokens` | 仅当 `> 0` 才传 | 默认 `0` = 不限制 |
| `reasoningEffort` | `ReasoningEffortId(roundEffort)` | **逐轮可变**，见第 8 节 |
| `signal` | `controller.signal` | 可取消 |

---

## 4. 零注入的证明（关键问题二）

三条独立证据：

1. **契约面**：`inject` 无会话服务（`constants.js:22`）。
2. **实现面**：`analyze.js` 全文不写任何会话（第 3 节检索结果）。
3. **落地面**：历史写在自己的文件 `~/.dsh/selection-explain/history.json`（`README.md:189`，B 级）。

**一次普通解读结束后，主会话里没有新增事件、没有消息、没有 surface 变化。**
这是本机唯一一个把「旁路查询」做到生产级且真的零回注的实现。

> 对照：`dsh-palimpsest` 是"调用即注入"——结果直接作为工具返回进上下文；
> `dsh-tool-subagent` 是"完成时回注"。只有这一个在默认路径上完全不写。

---

## 5. 上下文组装

`lib/index.js:7` 导出了两个组装函数：`transcriptOf` / `quoteContextOf`（实现在 `host/context.js`，本报告未逐行读）。

配置面（`config.js`）显示它是**三段预算**而不是一个总数：

| 段 | 配置项 | 说明 | 证据 |
| --- | --- | --- | --- |
| 会话背景 | `sessionContext`（开关）+ `sessionContextMaxMessages` + `sessionContextMaxChars` + `sessionContextFastMessages` | 是否附带主线消息、附带多少条、多少字符 | `config.js:32-35` |
| 引用上下文 | `quoteContextRounds` + `quoteContextMaxCharsPerTurn` + `quoteContextMaxChars` | 引用时向前/后取几轮、每轮多少字符、总量 | `config.js:36-38` |
| 选中文字 | `maxSelectionChars` | 默认 4000 | `config.js:29`；`cordis.patch.yml:16` |

`context.js` 里还有一个 `sessionIdOf(body)`，被 `promote.js:2` 引用——说明入参里带来源会话 id。

---

## 6. 容量预算与摘要（关键问题四）

实现在 `lib/chat-context.js`（84 行，纯函数，可单测）。四个机制：

### 6.1 预算三重取小

```js
// lib/chat-context.js:69-73
export function contextBudget(configured, window, output = 8192, tools = 2048) {
    if (!window || !Number.isFinite(window) || window <= 0) return configured;
    return Math.floor(Math.min(configured, window * 0.8, window - output - tools));
}
```

**先给回答和工具留位置，再谈历史能吃多少。** `window` 来自宿主提供的模型容量，拿不到时退回配置值。

### 6.2 压缩切口的不变量

```js
// lib/chat-context.js:75-83
export function chooseCompactionEnd(turns, target, price) {
    let remaining = turns.reduce((n, t) => n + price(t), 0);
    for (let i = 0; i < turns.length - 2; i++) {
        remaining -= price(turns[i]);
        if (i + 1 > 0 && turns[i + 1].role === 'user' && remaining <= target)
            return i + 1;
    }
    return -1;
}
```

两条不变量：**① 切口永远落在 `user` 消息之前**（不会把一轮问答切两半）；
**② 循环上界是 `length - 2`，保证至少保留最新一整轮原文。**

### 6.3 摘要状态的指纹校验

```js
// lib/chat-context.js:28-37（节选）
export function historyDigest(turns, initial = EMPTY_DIGEST) {  // EMPTY_DIGEST = '811c9dc5'
    ... // FNV-1a：hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0
}
```

压缩结果是一个带指纹的信封：

```js
{ version: 1, source, through, digest, summary(≤12000), background{transcript(≤200000), marked}, sessionId? }
// lib/chat-context.js:3-19 readContextState
```

重放时（`prepareChatHistory`，`:42-60`）：先按当前可见历史重算 digest，
**对不上就 `state = null` 整段作废重来**，绝不拿错位的摘要硬拼。
注释原话：`Rolling consistency fingerprint, not an authorization credential`（`:27`）。

### 6.4 被排除轮次的占位（"UI 留痕、模型不可见"的民间实现）

```js
// lib/chat-context.js:20-26
function modelTurn(turn) {
    if (turn.contextExcluded)
        return { role: ..., text: turn.role === 'assistant'
            ? '（该轮未生成回答。）'
            : '（该提问未提交给模型，原始内容仍保存在界面历史中；需要时请重新引用必要部分。）' };
    ...
}
```

**这是全套代码里对我们最有参考价值的一段**：它没有等官方 `presentationMeta` 通道，
自己用占位符把「界面可见、模型不可见」做出来了。

### 6.5 token 估算

```js
// lib/chat-context.js:61-68
export function estimateTextTokens(text) {
    // ASCII ~3 chars/token；其他 UTF-16 单元 ~1 token
}
```

粗糙但方向明确：**不按字符数当 token 数用**——这正是 `dsh-palimpsest` 的短板。

---

## 7. 「升格」到底做了什么（关键问题五）

**结论：新建一个正式会话，把讨论搬进去。不是往当前会话注入。**

```js
// lib/host/promote.js:47-51
const controller = ctx.get('sessionController');
if (typeof controller?.create !== 'function' || typeof controller?.prompt !== 'function') {
    sendJson(res, 503, { error: '当前部署不支持创建会话（sessionController 不可用）' });
```

完整流程：

| 步 | 动作 | 证据 |
| --- | --- | --- |
| 1 | `ctx.get('sessionController')` 动态取服务（不在 `inject` 里） | `promote.js:47` |
| 2 | 能力检查：`create` 与 `prompt` 都得是函数，否则 503 | `promote.js:48-51` |
| 3 | 从入参取来源会话 id，解析其 `cwd` | `promote.js:52-53` |
| 4 | 用 `workspaceRegistry.resolveByPath(cwd)` 找 workspace | `promote.js:56-67` |
| 5 | **`controller.create(...)` 新建会话** | `promote.js:71` |
| 6 | 若 workspace 索引未收录，`workspace.attachSession()` 双保险挂载 | `promote.js:78-88` |
| 7 | `controller.rename()` 设置标题「划词解读：<前 24 字>」 | `promote.js:89-92` |
| 8 | 写一条上下文消息，`source.kind = PLUGIN_SOURCE_KIND` | `promote.js:179-180` |
| 9 | 对新会话 `controller.prompt(...)` 发首轮 | `promote.js:249-251` |

### 2 个必须记住的入参约束

```js
// lib/host/promote.js:69-71
// 注意：session.create 的 workspaceId 与 cwd 互斥（同时传会报
// "session.create accepts workspaceId or cwd, not both"）——有 workspace 就只传它
const created = await controller.create(workspaceId ? { workspaceId } : cwd ? { cwd } : {});
```

**`workspaceId` 与 `cwd` 互斥**，同时传会直接报错。这是实测得来的注释，不是文档里的。

### 语义结论

| | 是 | 不是 |
| --- | --- | --- |
| 升格 | 毕业成独立会话（≈ Cursor 的 durable child conversation） | 回注当前上下文（D6 的 `full`） |
| 结果 | 用户得到一个可以继续的新会话 | 主线模型不会因此看到任何东西 |

**所以它连 AC-3（模型按 handle 取回）和 AC-5（进同一份名册）都没做到。**
它做到的是"旁路可以毕业"，而不是"旁路可以并入"。

---

## 8. 分阶段 reasoningEffort（关键问题六）

三档分离（`config.js:9-11`），语义在 `cordis.patch.yml:11-13` 有注释：

| 字段 | 作用阶段 | 默认 | 证据 |
| --- | --- | --- | --- |
| `translationReasoningEffort` | 首轮（翻译/解读/注释） | `off` | `cordis.patch.yml:31` |
| `reasoningEffort` | 详解（展开） | `off`（首字约 1.9s，实测） | `cordis.patch.yml:32-33` |
| `chatReasoningEffort` | 追问 | `high` | `cordis.patch.yml:13` |

### 自适应退让

`analyze.js:560-563` 显示存在一套**逐轮可变的档位逻辑**：

```js
let effortRetries = sentEffort.length > 0 ? EFFORT_RETRY_LIMIT : 0;
const triedEfforts = new Set(sentEffort ? [sentEffort] : []);
let firstSentEffort = sentEffort;
let roundEffort = sentEffort;   // 每轮可能变
```

配合 `lib/index.js:10` 导出的 `looksLikeUnsupportedTier` / `looksLikeReasoningRequired` /
`pickNextEffort` / `mapEffortToModel`（实现在 `host/effort.js`，**本报告未逐行读**），
可以确定设计意图是：**模型不认这个档位就换一个，而不是整轮失败**。

> 未确认：`effort.js` 的具体退让序（降一档还是跳到 off）、`EFFORT_RETRY_LIMIT` 的实际数值。

---

## 9. 工具与读取边界（关键问题七）

### 9.1 白名单 + 兜底补位

```js
// lib/host/tools.js:14-25
export function resolveToolNames(preferred, fallback, visible) {
    const present = new Set(visible);
    const out = preferred.filter((name) => present.has(name));
    const hasSearch = preferred.some((name) => SEARCH_TOOL_NAMES.includes(name) && present.has(name));
    if (!hasSearch) {
        for (const name of fallback) {
            if (name && present.has(name) && !out.includes(name)) out.push(name);
        }
    }
    return out;
}
```

规则很克制：**只在"联网工具一个都不在"时才补 fallback，且只补联网这一类**（注释 `:8-13`）。

默认白名单：`advanced_search, platform_search, read, grep, glob`（`cordis.patch.yml:19`）。

### 9.2 路径边界：`isInsideRoot`

```js
// lib/host/tools.js:95-107
export function isInsideRoot(root, target) {
    if (!root) return true;                       // 空 = 不设限
    if (!raw) return true;
    if (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')) return false;
    const base = resolve(root);                   // 只做词法解析，不跟随符号链接
    const full = resolve(base, raw);
    return full === base || full.startsWith(base.endsWith(sep) ? base : base + sep);
}
```

**为什么需要它**（`tools.js:88-94` 注释原文）：

> "read/grep/glob 能读**用户有权读的任何文件**（`~/.ssh/id_rsa`、`.env`、`~/.dsh/settings.yaml`……），
> 而划词的触发源（选中文字/上下文/搜索结果）**可能是别人写的**。
> 这里只做词法判断，挡住'顺着一段被注入的文字去读项目外的机密'。"

**这就是 prompt injection 的正面防御**，而且写在了工具边界上，不是写在提示词里。

`toolReadRoot` 三态（`cordis.patch.yml:20-21`）：`''` = 会话工作目录 · `'*'` = 不限制 · 其他 = 写死目录。越界在**执行前**被拒。

### 9.3 第二张名单：本次附带的文件

```js
// lib/host/tools.js:199-206
export function isReadAllowed(root, target, attached) {
    if (isInsideRoot(root, target)) return true;
    if (!attached || attached.size === 0) return false;
    return attached.has(resolve(String(target).trim()));
}
```

注释（`:179-198`）记录了一个真实的坑：附件的只读副本存在 `~/.dsh/attachments/…`，
而 `readRoot` 默认是会话工作目录——**两者没有交集**，于是模型必然去读、必然被拒，
"工具轮就这么被烧光：实测连续两轮 `emitted=0 / finish=tool-calls`"。

**解法不是调大 readRoot**（那等于给整段对话开口子），而是**只放行"这次请求里真的拼进消息的那些文件"**。
放开范围严格等于用户意图。

### 9.4 自己跑工具循环

```js
// lib/host/tools.js:144-178
export async function runTool(ctx, name, args, signal, maxChars, agent) {
    const registry = ctx.get('tools');
    const result = await registry.execute({ callId, name, arguments: args, signal, ...(agent ? { agent } : {}) });
    // 按 maxChars 累加截断，超出写 "…（已截断）"
}
```

**插件自己执行工具、自己拼 tool result、自己控制上限**（`toolResultMaxChars`，`config.js:59`）。
所以小窗内部是一个**完整的 agent 循环**，只是不落在任何 Session 上。

### 9.5 能力探测：不给模型装了也跑不动的工具

`webFetchUsable()`（`tools.js:73-87`）会探测本机 DNS 是否落在 fake-IP 段，
如果是，说明 `web_fetch` 每次都会因为 SSRF 防护失败（"resolves to a non-public IP address"），
**于是干脆不给这个工具**，省掉白跑的一轮。缓存 5 分钟。

判断用的 `isPublicAddress`（`:33-72`）口径与 `dsh-web-fetch-http` 一致，含 `198.18.0.0/15` 基准测试段。

---

## 10. 附件与降级（关键问题八）

配置与 README 层面的事实（`README.md:82-88`、`:103`，B 级）：

- 附件存宿主附件库，**历史只存引用不存字节**（"存的是引用而不是字节，历史文件不会因为几张截图变胖"）。
- 追问时**最近 2 张图片重新带给模型**，更早的图片**降级成一行文字说明**；文件不占这个额度。
- 拖到小窗的文件只进小窗，不落主会话输入框。
- 升格时附件一并带进新会话。

对应配置：`toolResultMaxChars`、`chatContextTokens`（`config.js:16,59`）。
`lib/host/chat-materials.js`（4.5KB）从名字与引用看是"把历史里的材料重新取回给模型"的通道。

> 未确认：`chat-materials.js` 的具体接口，以及"最近 2 张图片"这个数写在哪。

---

## 11. think 过滤器（关键问题九）

`lib/index.js:8` 导出 `createThinkFilter` / `splitLeakedReasoning` / `looksLikeLeakedReasoning`
（实现在 `lib/host/filters.js`，6.2KB，**未逐行读**）。

从命名与导出位置可确定：它处理的是**流式输出里混入推理文本**的问题——
把 `think` 段切出去（`splitLeakedReasoning`）、探测是否漏出来（`looksLikeLeakedReasoning`）、
在流上做过滤（`createThinkFilter`）。

> 未确认：具体的标记识别方式（是认 `Thinking...` 之类文本，还是认结构化字段）。

---

## 12. 客户端 UI（关键问题十）

**已确认的部分**：

- 客户端 bundle 是 `lib/client.js`（**475.6KB**，未压缩前的构建产物），`package.json:37-49` 声明 `dsh.client`，`inject: []`。
- 服务端注册了 20 条路由，`API_PREFIX = '/selection-explain/api'`（`constants.js:24`），
  覆盖 `attach / attachment / analyze / settings / route / ping / history / panel / pill / mic / models / promote / quote-context / speech / speech/transcribe / speech/prepare`（`plugin.js:24-43`）。
- 浮层形态：`README.md:175-181` 说明它用**自己的浮层**，显示在最近会话列表与完整视图之上，空白处可点穿；
  并与 `dsh-full-view` / `dsh-recent-sessions` 做了 Esc 层级协调。
- 侧栏 iframe 划词桥：`bridgeSidebarPreview`（`cordis.patch.yml:23-26`）会给预览帧补 `allow-scripts`
  **但不加 `allow-same-origin`**，所以预览页仍读不到 GUI 数据。这是有意识的权限收敛。

**未确认**：划词监听的具体事件、浮层的 DOM 挂载方式（是否为官方 slot）、
"最近 / 引用 / 升格 / 展开详解"四个入口分别对应哪些组件。这些都在 475.6KB 的 bundle 里，本次未读。

---

## 13. 三条会静默失败的集成细节（最值钱的一节）

这三条都写成了源码注释，因为**它们报错的方式都很隐蔽**。

### 13.1 漏传 `sessionId` → 长回答被上游掐断

```js
// lib/host/analyze.js:570-572
// 带上会话 id：主会话 agent loop 一直传它，适配器会据此设置上游的会话头。
// 插件以前没传，结果是所有小窗请求共用静态会话头 —— 而中继是按会话跟踪的（实测长回答被掐）。
...(sessionId ? { sessionId: sessionId } : {}),
```

**这是 `ctx.llm.stream()` 的一个隐性契约**：它虽然不写会话，但**要拿 `sessionId` 去设置上游会话头**。
不传 → 所有请求共用一个静态头 → 上游中继按会话跟踪，长回答被掐。
症状是"回答莫名截断"，很难归因到"少传了一个参数"。

### 13.2 收尾轮摘工具 → 模型把工具标记写进正文

```js
// lib/host/analyze.js:586-588
// 工具**每轮都在请求里**（照主会话的做法）：收尾轮以前故意不带工具"逼结论"，
// 结果模型退到文本层、把工具调用标记写进正文（实测 wrapUp 轮 raw=726 → emitted=0）。
// 主会话从不摘工具，模型也就从不写这种标记 —— 这里与它保持一致。
```

**"逼结论"这个直觉是错的**：摘掉工具会让模型退化成文本层，把 `invoke/parameter` 这类标记
当正文吐出来（注释在 `:581-582` 还专门点名了 "DeepSeek 的 DSML 写法"）。
正确做法是用收尾提示词约束（`:581`），而不是撤工具。

### 13.3 peer 范围跨版本 → 函数签名不一致

```js
// lib/host/analyze.js:575-579
// 第二参数（组装这段提示词的插件名）：**新老版本签名不一样，两边都得能编译**——
//   · npm 上按 peer 范围 `>=0.1.5-rc <2` 解析到的是 0.1.5-rc.3：`(text, plugin)` 两个必填（TS2554）；
//   · 本机 / 新版运行时（0.1.7-rc.x）：只剩 `(text)`，多传的参数会被忽略。
// 所以统一走 systemMessageOf 这个宽松别名，两边都调得动。
```

**peer 范围开得宽，就要自己兜住签名漂移**。它不是改依赖版本，而是写一个宽松别名，
让新旧两边都能编译、运行时都能调通。这个手法值得直接抄。

### 13.4 附带的一条：生命周期必须收干净

```js
// lib/host/plugin.js:35-37
// 探针是懒启动的（第一次有人问才起），但**卸载时要收干净**：
// 否则插件热重载几次就会留下一串没人管的 mic-probe 进程。
ctx.effect(() => () => stopMicProbe(), `${name}: mic probe process`);
```

### 13.5 附带的一条：v4 会话格式要求 producer-owned kind

见 `constants.js:3-20` 的长注释，核心：`source.kind` 必须是 `plugin:<完整包名>`，
不能用 v3 的 `kind:'plugin'` + `plugin` 字段。失败症状是 **HTTP `ok:true` 但 artifact 一字未落盘**，
且**离线测试全绿**（校验在真实内核里）。报告 §5.3.5 已完整引用。

---

## 14. 与「旁路探针」需求的契合度

### 它做到的

| 判据 | 状态 | 依据 |
| --- | --- | --- |
| AC-1 零污染 | ✅ | `inject` 无会话服务；`analyze.js` 全文不写会话 |
| AC-2 默认不回注 | ✅ | 唯一外写是显式「升格」 |
| 人类侧入口 | ✅✅ | 隐式入口（选中即浮出），比命令式更好 |
| 分阶段定档 | ✅ | 三档 reasoningEffort + 双路模型 |
| 多维预算 | ✅ | `contextBudget` 三重取小 + 摘要指纹 |
| 硬约束 | ✅ | 白名单 + `toolReadRoot` + 限流 40/min |

### 它缺的

| 判据 | 状态 | 缺口 |
| --- | --- | --- |
| AC-3 模型按 handle 取回 | ❌ | 无可寻址句柄；模型无法主动发起或取回 |
| AC-4 可丢弃 | ❌ | 只有 LRU（`historyMaxEntries`），无丢弃动作、无遮蔽/删除之分 |
| AC-5 一等公民 | ❌ | 升格是"新开一个会话"，不进同一份名册 |
| 跨源聚合 | ❌ | 一次小窗 = 一次划词 |

### 一句话

**它证明的是通道，不是顶点。** 通道（默认不回注、人类入口、显式升级）已被验证到生产级；
缺的是"把每一次旁路变成一个可寻址、可编排、可丢弃的实体"。

---

## 15. 未确认事项（不臆测）

1. `lib/client.js`（475.6KB）未读：划词监听事件、浮层 DOM 挂载方式（是否走官方 slot）、四个交互入口的组件实现。
2. `lib/host/effort.js` 未读：档位退让的具体序列、`EFFORT_RETRY_LIMIT` 的数值、`mapEffortToModel` 的映射表。
3. `lib/host/filters.js` 未读：think 段的识别方式。
4. `lib/host/context.js` 未读：`transcriptOf` / `quoteContextOf` 的具体截取策略（只从配置项反推了三段预算）。
5. `lib/host/chat-materials.js` 未读："最近 2 张图片"这个常量写在哪、旧材料如何按句柄回取。
6. `lib/host/history-store.js` 未读：`history.json` 的实际结构、LRU 淘汰的精确实现（以及"升格记录是否参与淘汰"这个文档矛盾在代码里到底怎么写的）。
7. `lib/host/speech.js` + `native/mic-probe.c` 未读：语音链路与本需求无关，仅记录其存在与体积成本。
8. `lib/host/attach.js`（12.9KB）未读：附件落库与哈希推路径的实现。
9. 三个"文档不一致"的判定（README:189 / config.js:14 / cordis.patch.yml:15）是基于文本比对，**未在 `history-store.js` 里验证哪一种为真**。
