# dsh-thoughtdag 0.5.17 源码逆向分析报告

> 分析对象：npm 包 `dsh-thoughtdag@0.5.17`（作者 Xia Chen / chatchan92，MIT），解压于 `<TEMP>\tdag\package\`。
> 上游单体仓库 `github.com/chenxiachan/thoughtdag`，`dsh/` 是插件端，其余是 Electron 桌面应用 + CLI。
> 本报告所有行号以 `read` 工具行号为准（`lib/index.js` 共 1392 行）。凡未在本次分析中实读源码、仅依据 README/注释/外部描述得出的结论，一律显式标注 **【高置信度推断】** 并汇总到附录 A。

---

## 1. 一句话定位

`dsh-thoughtdag` 是一个**同源挂载式的 DSH 只读/半写桥接插件**：host 半把上游 ThoughtDAG 的 SPA（`dist-app/`，Vite 构建）挂到 DSH 自带 webServer 的 `/thoughtdag/` 前缀下，client 半在 DSH Web UI 里注入一个浮动「对话 | 思维图」开关和一个全屏 iframe；SPA 通过 `/thoughtdag/api/*` 桥拿到「列会话 / 读会话日志 / 读别人家 CLI 的 session 文件 / 流式调模型」，并通过三条窄写入原语（`fork` / `inject` / `followup`）把画布上的思考写回 DSH 会话，同时用一个 prepend 的 `approval/request` waterfall 监听器把工具审批「抢」到自己手上转发给画布。

功能取向上它**不是**多智能体编排器，而是一个「把思考过程图形化 + 把历史会话变成可检索证据」的视觉/记忆层。`lib/index.js:1-68` 的顶部注释自己给出了这个定位与文件布局说明。

---

## 2. 注册面总览

### 2.1 插件身份

| 项 | 值 | 证据 |
|---|---|---|
| 插件名 | `thoughtdag` | `lib/index.js:78` `export const name = 'thoughtdag'` |
| 依赖注入声明 | 11 个服务 | `lib/index.js:79` `export const inject = ['webServer','sessions','sessionController','agents','llm','attachments','web','tools','commands','systemPrompt','approval']` |
| 配置入口 | `export async function apply(ctx, config)` | `lib/index.js:1066` |
| 插件版本 | 读自身 `package.json` | `lib/index.js:89`（`PLUGIN_VERSION`），`latestPluginVersion()` 每天最多查一次 npm registry，5s 超时、失败静默 `lib/index.js:91-99` |

`inject` 里 11 个服务**全部**都在代码中真实消费（见 2.7）。

### 2.2 HTTP 路由（`ctx.webServer.register`，3 条）

| 注册 | 形状 | 证据 |
|---|---|---|
| `{ kind:'exact', path: prefix }` | 302 → `prefix + '/'` 的裸路径重定向 | `lib/index.js:1386` |
| `{ kind:'prefix', path: prefix + '/api' }` | 桥 API handler | `lib/index.js:1387` |
| `{ kind:'prefix', path: prefix }` | 静态 SPA handler（`staticHandler`） | `lib/index.js:1388` |

默认 `prefix = '/thoughtdag'`（`lib/index.js:1067-1069`），三条都包在 `ctx.effect(...)` 里以获得随 fiber 自动卸载。静态侧另有 `assetPath()` 做根内约束（`lib/index.js:165-172`），`/api/` 路径永不落入静态表（`lib/index.js:1375`）。

`api` handler 内是**手写路由表**（一个 `async (req,res)`，靠 `path` 字符串/正则分派，`lib/index.js:1074-1369`），不是 express 式 router。逐条清单：

| 方法 | 路径（`prefix+'/api'` 之后） | 作用 | 证据 |
|---|---|---|---|
| GET | `/disksessions` | 扫盘列 DSH 历史会话 | `lib/index.js:1082-1099` |
| GET | `/disksessions/<id>` / `<id>/log` | 单会话元数据 / 整份 JSONL | `lib/index.js:1100-1112` |
| GET | `/sessions` | 进程内 live store 会话清单 | `lib/index.js:1114-1117` |
| GET | `/sessions/<id>` / `<id>/log?since=` | 单会话元数据 / JSONL（可增量） | `lib/index.js:1118-1129` |
| GET | `/why/status` | why 层注册状态 | `lib/index.js:1130` |
| GET | `/why/find`·`/turns`·`/recall`·`/memories`·`/suggest`·`/topics`·`/by-topic`·`/sample`·`/dossiers`·`/dossier`·`/dossier/new` | 画布侧的 why 检索面（JSON 版） | `lib/index.js:1132-1154` |
| POST | `/why/topics`·`/why/label/start`·`/why/label/stop`·`/why/dossier`·`/why/dossier/delete`·`/why/dossier/pending` | 标签/主题/档案写回 | `lib/index.js:1180-1189` |
| GET | `/version` | 插件版本 + 最新版本 | `lib/index.js:1155` |
| GET | `/roots` | 三个外部 session 根 | `lib/index.js:1157-1161` |
| GET | `/roots/<key>/(list\|head\|read\|range\|stat)` | 外部 CLI 会话文件分页读 | `lib/index.js:1162-1177` |
| POST | `/judge` | **通用 HTTP 转发**（任意 URL + 任意请求头 + 任意 body） | `lib/index.js:1191-1199` |
| POST | `/fetch-url` | 经 `ctx.web.fetch` 的有界抓取 | `lib/index.js:1201-1213` |
| ANY | `/agents/*` | 转发给 `agentsHttp().handle(...)`（外部 CLI 运行时） | `lib/index.js:1216-1219` |
| GET | `/models` | 模型目录（含 harness agent 条目） | `lib/index.js:1221` |
| POST | `/probe-models` | 拿 baseURL+apiKey 探 `/models` | `lib/index.js:1224-1243` |
| POST | `/runtime-providers` | 浏览器存的第三方 provider 清单（仅内存） | `lib/index.js:1244-1248` |
| POST | `/approvals/<id>` | 画布回传审批决定 | `lib/index.js:1249-1258` |
| POST | `/stream` / `/claude` | 流式/一次性模型调用（三种后端分支） | `lib/index.js:1259-1316` |
| GET | `/sessions/<id>/turns` | turn 边界（fork 用） | `lib/index.js:1318-1324` |
| POST | `/sessions/<id>/(fork\|inject\|followup)` | **三条写入原语** | `lib/index.js:1325-1361` |
| — | 兜底 | `404 {error:'not found'}` | `lib/index.js:1362` |

`/stream|/claude` 有三分支：`harness/agent*` 模型走 DSH 自己的 agent loop（`lib/index.js:1261-1277`，其中 `/claude` 是一次性调用、`/stream` 是 SSE）；浏览器注册的「人自己的接口」走 `ownCall/ownStream` 直连 OpenRouter 兼容端点（`lib/index.js:1279-1293`）；其余走 `ctx.llm.stream`（`lib/index.js:1294-1315`）。

### 2.3 四个原生工具（`ctx.tools.register`）

`lib/index.js:1029-1048` 循环注册，逐条 `ctx.effect(...)`：

```js
ctx.tools.register({                       // lib/index.js:1036-1042
  name,                                    // TOOL_NAMES[t.name] ?? t.name
  description: t.description,              // 直接复用 why.mjs 的 MCP schema 文案
  parameters: t.inputSchema,               // 直接复用 JSON Schema（MCP_TOOLS 的 inputSchema）
  output: { schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: String(value) }] },
  async execute(args, exec) { return ask(t.name, args ?? {}, cwdOfSession(exec?.agent?.session)) },
})
```

命名映射在 `lib/index.js:997`：

```js
const TOOL_NAMES = { why_check:'why_check', why_file:'why_file', find:'why_find', recall_turn:'why_recall' }
```

注释说明动机是「一个家族、不和 harness 自带的 read/find 工具撞名」（`lib/index.js:996`）。

### 2.4 一个斜杠命令（`ctx.commands.register`）

```js
ctx.commands.register({                    // lib/index.js:1049-1059
  name: 'why',
  description: 'ThoughtDAG: which past conversations touched this file, URL or paper',
  input: { hint: '<path | url | arxiv:id>' },
  async handler(inv) { ... inv.rawInput ... inv.agent?.session ... }
})
```

有输入 → `why_file`；无输入 → `{kind:'error', text:'usage: /why <path | url | arxiv:id>'}`；抛错 → `{kind:'error'}`（`lib/index.js:1054-1057`）。

### 2.5 一个系统提示段（`ctx.systemPrompt.section`）

```js
ctx.systemPrompt.section({ name:'thoughtdag-why', order: 900, text: WHY_PROMPT })   // lib/index.js:1062
```

`WHY_PROMPT` 全文 4 行（`lib/index.js:1000-1003`）：告诉模型「编辑有历史的文件前先 `why_check(path)`」「有历史就 `why_file(path)` 看谁改过、问了什么、答案怎么解释」「`why_find(phrase)` 找原话、`why_recall(session, turn)` 读完整一轮」「引用要简短，不要复述整轮」。

注意 `wantPrompt && wantTools` 是**与条件**：关掉 `whyTools` 会连带关掉 prompt（`lib/index.js:1062`）。

### 2.6 approval waterfall 钩子（1 个）

`installApprovalAnswerer(ctx)` 在 `apply` 末尾调用（`lib/index.js:1390`），内部：

```js
ctx.on('approval/request', async function (req, next) { ... }, true)   // lib/index.js:773 + 801
```

第三参 `true`。**这是「抢在 harness 自家面板之前」的机制**——Cordis 的 `ctx.on(name, listener, options?: boolean | EventOptions)` 明确写着「a boolean is shorthand for `prepend`」（`node_modules/@deepseek-ai/cordis/lib/types/events.d.ts:85`、`:94`、`:103`：`/** Add the listener before existing listeners for the same event. */ prepend?: boolean`）。详见第 5 节。

### 2.7 client 半（浏览器注册面）

声明在 **package.json**，不在 client.js：

```json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" },
         "client": { "platform": "web",
                     "inject": ["@deepseek-ai/dsh-client-modules",
                                "@deepseek-ai/dsh-api-session-controller",
                                "@deepseek-ai/dsh-client-connection",
                                "@deepseek-ai/dsh-client-ui-workspace"],
                     "immediately": false } }
```

`package.json:36-49`。运行期只再注入两个服务：`module.exports.inject = ['sessions','uiWorkspace']`（`lib/client.js:25`）。**没有注册任何 slot**——详见第 7 节。

### 2.8 服务消费点对照表

| inject 项 | 实际调用点 |
|---|---|
| `webServer` | `register` ×3，`lib/index.js:1386-1388` |
| `sessions` | `ctx.sessions.list()` `lib/index.js:1115`；`ctx.sessions.get?.(id) ?? ctx.sessions.sessionOf?.(id)` `lib/index.js:373` |
| `sessionController` | `fork` `lib/index.js:1341`；`prompt` `lib/index.js:1359`；`create`（runAgentTurn 内）；`modelCatalog()` `lib/index.js:541-566`；`resolveAgent` `lib/index.js:974`；`selectModel`（runAgentTurn 内） |
| `agents` | `ctx.agents.get(id)` `lib/index.js:972` |
| `llm` | `ctx.llm.stream(options)` `lib/index.js:1298`/`:1305`；`ctx.llm.listModels(providerId)` `lib/index.js:531-538` |
| `attachments` | `ctx.attachments.saveImage({data,mediaType,name:'canvas-image'})` `lib/index.js:692-725` |
| `web` | `ctx.web.fetch({url}, signal)` `lib/index.js:1206` |
| `tools` | `register` `lib/index.js:1036` |
| `commands` | `register` `lib/index.js:1049` |
| `systemPrompt` | `section` `lib/index.js:1062` |
| `approval` | `ctx.on('approval/request', ...)` `lib/index.js:773` |

另有两个**事件监听**（非服务）：`agent/assistant-stream`（`lib/index.js:882`）与 `session/event`（`lib/index.js:890`），只在一次 agent turn 内挂/摘。

---

## 3. why 层四工具（重点）

### 3.1 来源与复用方式

四个工具的 schema **不是插件手写的**，而是直接复用打包进来的上游 CLI 库 `lib/why.mjs` 里为 MCP 准备的定义（`why.mjs:3443-3448`），插件只做「改名 + 参数里 path 转绝对 + 换 cwd + 把返回字符串塞进 content block」。这是本插件最值得学的**一次建模、多处复用**手法：同一份 JSON Schema 同时服务 MCP server、`thoughtdag` CLI 和 DSH 原生工具。

### 3.2 完整 schema（原文逐字）

**`why_check`**（`why.mjs:3444`）

```json
{ "name": "why_check",
  "description": "Cheap first question before editing a file: does this artifact have any history in local agent sessions? One line; history true/false.",
  "inputSchema": { "type": "object",
    "properties": { "path": { "type": "string", "description": "file path (absolute or relative to cwd), URL, or arxiv:<id>" } },
    "required": ["path"] } }
```

**`why_file`**（`why.mjs:3445`）

```json
{ "name": "why_file",
  "description": "The turns across local Claude Code, Codex, DeepSeek Harness, Pi and ThoughtDAG sessions that touched a file, URL or paper: when, what changed (Δ, observed), what was asked, what the answer said about it (≈, a candidate explanation, not a verified reason). Each hit carries a deep link.",
  "inputSchema": { "type": "object",
    "properties": { "path": { "type": "string" },
                    "include_read": { "type": "boolean", "description": "also list turns that only read it (default false)" },
                    "limit": { "type": "number", "description": "max hits (default 10)" } },
    "required": ["path"] } }
```

**`why_find`**（上游原名 `find`，`why.mjs:3446`）

```json
{ "name": "find",
  "description": "Where these exact words were asked (Q), answered (A) or attached (M) across local sessions, canvases and the memories Claude Code and Codex keep for themselves. Exact, case-insensitive match; every hit is a verbatim snippet with a pointer.",
  "inputSchema": { "type": "object",
    "properties": { "phrase": { "type": "string" },
                    "in": { "type": "string", "enum": ["q","a","m","all"] },
                    "limit": { "type": "number" } },
    "required": ["phrase"] } }
```

**`why_recall`**（上游原名 `recall_turn`，`why.mjs:3447`）

```json
{ "name": "recall_turn",
  "description": "One turn in full — the question, the answer, the tool calls with their diffs — by session id (or prefix) and turn number as shown by why_file.",
  "inputSchema": { "type": "object",
    "properties": { "session": { "type": "string" }, "turn": { "type": "number" } },
    "required": ["session","turn"] } }
```

注意 `why_find.in` 枚举里**没有** `"all"` 的兜底写法问题——`mcpCall` 用 `["q","a","m"].find(x => x === a.in) ?? "all"` 兜底（`why.mjs:3467`），传非法值等价于 `all`。

### 3.3 返回结构

四个工具在 DSH 侧的统一返回形状由注册时的 `output` 决定（`lib/index.js:1040`）：

- `output.schema = { type:'string' }` —— 即**每个工具的返回值就是一个字符串**；
- `render(_args, value) => [{ type:'text', text: String(value) }]` —— 整串作为**一个 text content block** 进入模型可见面。

底层 `why.mjs` 的 `mcpCall(name, a)`（`why.mjs:3449-3471`）对四个名字分别返回：

| 工具 | 返回 | 证据 |
|---|---|---|
| `why_check` | 一行摘要：`"<arg>: 12 turns in 5 sessions · 3 edits/writes · 9 reads · latest 2026-01-02  →  thoughtdag why <arg>"`；无历史时 `"<arg>: no history"` | `why.mjs:3450-3454` + `renderCheck` `why.mjs:2930-2940` |
| `why_file` | 多行报告：命中 turn 的 `Q/Δ/≈` 三类行 + deep link；无命中时回候选文件清单（**最多 20 个**）或 `no match in this workspace (N elsewhere)` 或 `no session touched X` | `why.mjs:3456-3463` + `renderWhy` `why.mjs:2771-2841` |
| `why_find` | 标题行（`when runner 「title」 #turn link`）+ 一行 `where: snippet`；无命中时提示换词（精确匹配） | `why.mjs:3465-3468` + `renderFind` `why.mjs:2899-2922` |
| `why_recall` | `## Question`（全文）+ `## Answer`（全文）+ `## Tools (N)`（逐条：名字/路径；`edit`/`write` 打印 `call.slice(0,1200)`；`other` 且结果以 error 开头时打印首行 `slice(0,200)`） | `why.mjs:3470` + `renderRecall` `why.mjs:2963-2993` |

### 3.4 是否只读？

**结论：语义上只读，但并非「纯只读」——调用本身可能触发本地索引重建写入。**

- 四个工具都没有任何写会话/写文件语义：它们只查 `~/.thoughtdag` 下已建好的索引（`why.mjs` 的 `loadFacts/loadCache/findHits`）。
- **但** `why_check` 走 `factsForCheck(false)`，索引超过 `CHECK_FRESH_MS = 10*6e4`（10 分钟）就会 `ensureFresh()` 重建（`why.mjs:2924-2928`）；`why_file`/`why_find`/`why_recall` 直接 `await ensureFresh()`（`why.mjs:3457`、`:3466`、`:3470`）。`ensureFresh()` 内部会 `buildIndex(false)` 并写 `FACT_FILE`/`CACHE_FILE`/`TEXT_FILE`（`why.mjs:2626-2656`）。因此**一次工具调用可能写 `~/.thoughtdag/`**（纯派生缓存，非用户数据）。
- 插件侧**没有**声明任何 read-only / mutating 标记：注册对象只有 `name/description/parameters/output/execute` 五个字段（`lib/index.js:1036-1042`），而 DSH 的 `ToolDefinition` 本身也没有 `readOnly` 字段，工具类别由展示层 `ToolCallKind`（`'read'|'edit'|'delete'|'move'|'search'|'execute'|'fetch'|'other'`）描述，插件未设置 → **【高置信度推断】四个工具在 DSH UI 里会落到默认类别（≈`other`），不会被染成「读」的样式**。`node_modules/@deepseek-ai/dsh-tools/lib/types/presentation.d.ts:13`、`index.d.ts:115-128`。

### 3.5 会不会把大量文本灌进上下文？有没有上限？

**会，且上限极其宽松。这是四个工具最需要在部署时警惕的一点。**

| 工具 | 条数上限 | 单条文本上限 | 证据 |
|---|---|---|---|
| `why_check` | 天然一行 | — | `why.mjs:2937-2939` |
| `why_file` | `limit`，缺省 `10`（`Number(a.limit ?? 10) || 10`，注意 `0` 会被 `||10` 吃掉变成 10） | **不截断**（`renderWhy` 逐 hit 打印全文语义行） | `why.mjs:3463`、`why.mjs:2771-2841` |
| `why_find` | `limit`，缺省 `10`（同样 `||10`） | snippet ≈ 140 字符（`snippetAround(text, needle, width=70)`） | `why.mjs:3468`、`why.mjs:2842-2848` |
| `why_recall` | **完全没有条数/长度上限** | Question 全文、Answer 全文、每个 tool call `slice(0,1200)` | `why.mjs:2963-2993` |

- 插件侧**没有任何 token/字符数截断或预算控制**：`output.render` 直接 `String(value)`（`lib/index.js:1040`）。
- 因此 `why_recall` 一圈下来可能把「一整轮问答 + 所有 diff（每个 1200 字符）」原样塞进模型上下文；`why_file` 的 `limit` 只限制**命中轮数**，不限制每轮正文。
- **【高置信度推断】** DSH 侧可能有更外层的工具结果裁剪策略（宿主行为，不在本包内），但**插件自己没有设防**。
- 反过来看优点：`why_check` 被刻意设计成「改文件前的廉价第一问、一行、history true/false」（`why.mjs:3444`），这是很值得借鉴的「先花 1 个 token 判断要不要花 1000 个 token」的两级检索设计。

### 3.6 参数与路径解析

- 只对 `path` 一个参数做相对路径解析：`const PATH_ARGS = new Set(['path'])`（`lib/index.js:998`），循环里 `if (typeof a[k] === 'string') a[k] = resolveAgainst(cwd, a[k])`（`lib/index.js:1026`）。
- `resolveAgainst(cwd, q)`：去掉前导 `@`；空串 / `http(s)://` / `arxiv:` 开头 / 已是绝对路径 / 无 cwd → **原样返回**；否则 `resolve(cwd, s)`（`lib/index.js:986-990`）。
- cwd 来源：`cwdOfSession(exec?.agent?.session)` = `session?.header?.cwd ?? session?.header?.meta?.cwd ?? null`（`lib/index.js:982`）——即**每次调用都取当前会话头里的工作目录**，这正是上游库层缺失的能力：`why.mjs` 的 `resolveQuery` 用 `process.cwd()`（`why.mjs:2698`、`:2711`），在 DSH 里那是 harness 进程的 cwd，不是会话的 cwd。插件层的这层「补 cwd」是必要的适配。
- `why_find` **不传 cwd**：`mcpCall` 的 find 分支直接调 `findHits(facts, phrase, scope)`（`why.mjs:3465-3468`），不经过支持 `opts.cwd` 过滤的 `findJson`（`why.mjs:2994-3012`）→ **`why_find` 是全局跨工作区检索**，与 `why_file`（工作区内优先）语义不同。这是 schema 里没写、只能读源码才知道的行为差异。

---

## 4. 三条会话写入原语

三条都在同一个正则分支里（`lib/index.js:1325-1361`），body 上限 `MAX_WRITE_BODY_BYTES = 4 * 1024 * 1024`（`lib/index.js:112`），body 先经 `contentOf(body)` 校验（`lib/index.js:1348`）。

### 4.1 公共前置：`contentOf` 与 `SOURCE`

```js
function contentOf(body) {                                    // lib/index.js:414-423
  if (Array.isArray(body?.blocks)) {
    const blocks = body.blocks.filter(b => b && b.type === 'text' && typeof b.text === 'string' && b.text.length > 0)
                                .map(b => ({ type:'text', text: b.text }))
    if (blocks.length === 0) throw new HttpError(400, 'blocks: no text block with content')
    if (blocks.length !== body.blocks.length) throw new HttpError(400, 'blocks: only { type: "text", text } is accepted here')
    return blocks
  }
  if (typeof body?.text === 'string' && body.text.length > 0) return [{ type:'text', text: body.text }]
  throw new HttpError(400, 'body needs text or blocks')
}
const SOURCE = { kind: 'plugin', plugin: 'dsh-thoughtdag' }    // lib/index.js:425
```

注释明说「现在只收 text block，图片以后经 attachment store 走」（`lib/index.js:411-413`）——即**注入面刻意挡住多模态**，与 `/stream` 的图片路径（`lib/index.js:692-725` 走 `ctx.attachments.saveImage`）形成对比。

### 4.2 `POST /sessions/<id>/fork` → `ctx.sessionController.fork`

```js
const r = await ctx.sessionController.fork({ sessionId: id, ...(atSeq !== undefined ? { atSeq } : {}) })   // lib/index.js:1341
return sendJson(res, 200, { session: r.sessionId, parent: id, atSeq: atSeq ?? null })                        // lib/index.js:1342
```

边界确定（`lib/index.js:1330-1339`）：显式 `body.atSeq`（number）优先；否则 `body.afterTurn`（number）→ 取该会话事件、`turnsOf(events).find(x => x.turn === body.afterTurn)`；找不到 → 400；`t.endSeq === null`（turn 未闭合）→ **409 `'turn N is still open; a fork needs a completed turn'`**；否则 `atSeq = t.endSeq`。

错误映射（`lib/index.js:1343-1346`）：`error.code ?? error.name` 含 `NOT_FOUND` → 404，其余 → 409，body 带 `{error, code}`。

DSH 侧对应 API：`SessionStore.fork(source: SessionForkSource, boundary?: SessionSeq, childSessionId?: SessionId): Session`，文档写明 **`boundary` 是 inclusive 的源事件 seq**，「被省略时取源当前最后一个事件」「开放尾巴会收到合成的 tool result 与 step/turn 收尾」（`node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts:453-469`）。这解释了插件为什么必须拒绝 open turn：不是 DSH 不允许，而是插件选择了「只切闭合 turn」的保守语义以对齐画布的节点模型（它自己算 `endSeq`）。**注意 `sessionController.fork({sessionId, atSeq})` 的对象参数形状来自本插件的调用点**——`dsh-api-session-controller` 未随工作区安装，无法在本地核对这一层包装的参数名（见附录 A）。

### 4.3 `POST /sessions/<id>/inject` → `agent.inject`（真·不唤醒）

```js
const agent = await agentOf(ctx, id)                                              // lib/index.js:1350
const message = { id: 'td-' + randomUUID(), role: 'user', content, source: SOURCE } // lib/index.js:1351
agent.inject(message)                                                             // lib/index.js:1352
return sendJson(res, 200, { accepted: true, session: id, messageId: message.id })  // lib/index.js:1353
```

`agentOf`（`lib/index.js:971-977`）：

```js
async function agentOf(ctx, id) {
  const live = ctx.agents.get(id)
  if (live !== undefined) return live
  const r = await ctx.sessionController.resolveAgent(id)   // 冷会话会被「复活」
  if ('agent' in r) return r.agent
  throw new HttpError(404, 'no such session: ' + (r.error?.code ?? r.error?.message ?? 'unknown'))
}
```

**它是否真的「不唤醒」？——是，且这一点在 DSH 自己的类型文档里有权威定义：**

```ts
/** Queue model-facing context for the next pre-step without waking the
 *  driver. A running driver claims it at the nearest later step boundary;
 *  idle drivers leave it pending until follow-up or steering
 *  wakes them. It may miss a request whose pre-step already claimed its
 *  batch. Cancellation or disposal may discard pending context. */
inject(message: UserMessage): void;
```

`node_modules/@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts:201-209`。同一文件里对照着看更清楚：`send(message, target, wakeup)`（`:186`）、`followup(message)`=「Queue an ordinary follow-up turn **and wake the driver**」（`:187-192`）、`steer(message)`（`:193-200`）、`inject(message)`=**without waking**（`:201-209`）。

**注入的内容在会话日志里长什么样？** 它是一条普通的 `user/message` 事件，与人类直发消息同在模型可见面，靠 `source` 区分：

```ts
/** A user-role message on the model-visible surface: a direct human prompt
 *  (the queued message claimed for this turn), a synthetic `agent.inject()`
 *  context (file-change notices, subdir AGENTS.md, skill content, cron
 *  notifications, …), or an entered goal continuation round. All three
 *  project their `content` verbatim; `source` tells them apart. */
'user/message': UserMessage;
```

`node_modules/@deepseek-ai/dsh-session/lib/types/types.d.ts:287-294`。所以本插件注入的行会带 `source = {kind:'plugin', plugin:'dsh-thoughtdag'}`（`lib/index.js:425`），与 README 所述「shows in the transcript as injected context from dsh-thoughtdag」一致（README:31-52 表的 inject 行）。

**幂等 / 去重 / 大小限制：**

- **无幂等键**：每次调用生成全新 `'td-' + randomUUID()`（`lib/index.js:1351`），同一文本连发两次就是两条独立事件。
- **无去重**：没有「最近注入过的 hash」「同 session 内相同 content 跳过」之类逻辑；`pendingApprovals` 是审批专用 Map（`lib/index.js:768`），与 inject 无关。
- **大小限制**：只有 HTTP 层的 `MAX_WRITE_BODY_BYTES = 4MB`（`lib/index.js:112`、`:1328`），以及 `contentOf` 要求「至少一个非空 text block」。**没有字符数/token 上限**。
- **副作用**：`inject` 不需要 turn 是闭合的，也不返回任何 seq/事件引用——只有 `{accepted:true, session, messageId}`（`lib/index.js:1353`）。调用方拿不到「这条注入会在哪一步被消费」。

### 4.4 `POST /sessions/<id>/followup` → `ctx.sessionController.prompt`

```js
const requestId = 'td-' + randomUUID()                                                    // lib/index.js:1357
const mode = body?.mode === 'steer' ? 'steer' : 'queue'                                   // lib/index.js:1358
await ctx.sessionController.prompt({ requestId, sessionId: id, mode, content }, AbortSignal.timeout(30000))  // lib/index.js:1359
return sendJson(res, 200, { accepted: true, session: id, requestId, mode })                // lib/index.js:1360
```

- `mode` 只接受 `'steer'` 或默认 `'queue'`（白名单，非法值静默降级 `queue`）。
- 30 秒超时的 `AbortSignal`——**这是一条会「唤醒」的路径**，与 inject 的静默相对。
- 注释（`lib/index.js:1355-1356`）：`followup: a person's prompt from the canvas — the controller owns the user source and the queue/steer semantics the UI uses` —— 即**插件故意不复用 `SOURCE`**，把 user 归属权交给 controller，这样画布上发出的提问在会话里表现为「人发的」（和 inject 的 plugin 来源形成刻意的语义分层）。
- `requestId` 的用途在 agent-turn 路径里看得很清楚：`runAgentTurn` 生成 `requestId='td-'+randomUUID()`，然后监听 `session/event` 里 `user/message` 且 `source.rpcId === requestId` 来认出「自己那条提问」（`lib/index.js:863`、`:890-932`）。**同一条消息在 inject 路径下也带 `id`，但 followup 路径下带 `rpcId`** —— 两者是不同字段，这也解释了为什么 `inject` 的分支不需要 `requestId`。**【高置信度推断】** `prompt()` 会把 `requestId` 写进所产生 `user/message` 的 `source.rpcId`（依据是监听端的匹配逻辑），未能直接核对 controller 实现。

### 4.5 三条原语对照

| | fork | inject | followup |
|---|---|---|---|
| DSH API | `ctx.sessionController.fork({sessionId, atSeq})` | `agent.inject(UserMessage)` | `ctx.sessionController.prompt({requestId, sessionId, mode, content}, signal)` |
| 证据 | `lib/index.js:1341` | `lib/index.js:1350-1352` | `lib/index.js:1357-1359` |
| 唤醒 | 不适用（建新会话） | **否**（`runtime-types.d.ts:201-209`） | **是**（queue 或 steer） |
| 来源标记 | 继承源事件 | `SOURCE={kind:'plugin',plugin:'dsh-thoughtdag'}` | controller 自定（表现为人的消息） |
| 前置校验 | turn 必须闭合，否则 409 | 至少一个非空 text block | 至少一个非空 text block |
| 上限 | 无（继承源） | 4MB（HTTP） | 4MB（HTTP）+30s 超时 |
| 幂等 | 无 | 无（每次新 UUID） | 无 |

---

## 5. approval waterfall 抢占

### 5.1 机制

Cordis 的 waterfall 语义（`node_modules/@deepseek-ai/cordis/lib/types/events.d.ts:67-77`）：

> Dispatch an event whose last argument is a `next` continuation. **Each listener wraps the rest of the chain: calling `next()` invokes the next listener (finally the built-in behavior); not calling it vetoes.**

加上 `ctx.on(name, listener, true)` 的 `prepend`（`events.d.ts:85`/`:103`），本插件就获得了「排在 harness 自家审批面板之前，且可以决定是否把请求交给后面」的能力。**关键：`return outcome` 而不调 `next()` 就是「接住」。**

### 5.2 完整流程（`lib/index.js:772-802`）

```js
function installApprovalAnswerer(ctx) {
  ctx.on('approval/request', async function (req, next) {           // :773（第三参 true 在 :801）
    const entry = canvasTurns.get(req?.agent?.id)                   // :774 这条会话上有画布 turn 吗
    if (!entry) return next()                                       // :775 没有 → 原样下传
    if (entry.turn === null || entry.current() !== entry.turn) return next()  // :778 别人的轮次 → 下传
    const id = 'td-' + randomUUID()                                 // :779
    const call = req.callId !== undefined ? entry.calls.get(req.callId) : undefined  // :780
    const name = call?.name ?? req.toolName                         // :781
    entry.emit({ approval: { id, toolName: req.toolName, callId: req.callId ?? null,
                             reason: req.reason ?? null, name,
                             query: call ? toolQuery(name, call.arguments) : '',
                             arguments: typeof call?.arguments === 'string' ? call.arguments
                                      : (call?.arguments ? JSON.stringify(call.arguments) : null) } })  // :782-785
    let clear
    const decision = new Promise(resolve => { pendingApprovals.set(id, { resolve, sessionId: req.agent.id }) })  // :787
    const closed = new Promise(resolve => { const t = setInterval(() => { if (entry.isClosed()) { clearInterval(t); resolve('closed') } }, 500); clear = () => clearInterval(t) })  // :788
    const aborted = new Promise(resolve => { if (!req.signal) return
      if (req.signal.aborted) resolve('aborted')
      else req.signal.addEventListener('abort', () => resolve('aborted'), { once: true }) })  // :789-793
    const r = await Promise.race([decision, closed, aborted])       // :794
    pendingApprovals.delete(id); clear?.()                          // :795-796
    if (r === 'closed') return next()                               // :797 流断了 → 降级回传
    const outcome = r === 'aborted' ? 'cancelled' : r               // :798
    entry.emit({ approvalDecided: { id, outcome } })                // :799
    return outcome                                                  // :800 接住！
  }, true)
}
```

### 5.3 三道「不下手」的护栏（设计上很克制）

1. **只接管画布自己发起的轮次**：`canvasTurns` 只在 `runAgentTurn` 且 `answerApprovals=true` 时写入（`lib/index.js:841`），且 `entry.current() !== entry.turn` 直接放行——注释写明理由：「an approval raised by another turn of the same session (the person's own tool call, running before or after ours) stays with the harness UI」（`lib/index.js:776-777`）。**同会话里人自己触发的工具审批不会被抢走**，这点很重要，避免插件把人的交互吞掉。
2. **画布流断开就还回去**：`r === 'closed'` → `return next()`（`:797`），注释与 README 一致（README:74-82「if the canvas stream is gone, the request falls through to the harness panel unchanged」）。断流检测是 **500ms 轮询 `entry.isClosed()`**（`:788`），即最坏 500ms 的额外延迟。
3. **请求被取消就回 `'cancelled'`**：不是回 `next()`，而是直接给出 `'cancelled'` 结果（`:798`）。这与「流断了要下传」形成有意区分：**取消是外部权威决定，断流只是没人听**。

### 5.4 回传通路

画布 → `POST /thoughtdag/api/approvals/<id>`（`lib/index.js:1249-1258`）：

```js
const pending = pendingApprovals.get(id)
if (!pending) return sendJson(res, 404, { error: 'no such pending approval' })     // :1254
const outcome = APPROVAL_OUTCOMES.has(body?.outcome) ? body.outcome : 'rejected'  // :1255
pending.resolve(outcome)                                                          // :1256
```

`APPROVAL_OUTCOMES = new Set(['allowed-once','rejected'])`（`lib/index.js:770`）——**白名单只有两个值**，任何其它输入（包括漏传、乱传）静默降级为 `'rejected'`，即 fail-closed。但 `'cancelled'`（`:798` 的 abort 分支）不在白名单里，**只会由插件自己产生、不会由画布产生**——这个不对称值得注意：画布**不能**主动取消审批。

### 5.5 与 harness 自家面板的相对关系

- 本插件是 **prepend**（`true`，`:801`），因此排在已注册的监听器之前。
- 「harness 自家面板」具体以什么 id 注册、注册在哪个 fiber、是否也 prepend，本包无从得知；本报告只确认了「本插件 prepend + 不调 next = 抢占」这一半，见附录 A。
- `pendingApprovals` 是**模块级全局 Map**（`lib/index.js:768`），key 带 `'td-'` 前缀的 UUID，理论上跨会话不冲突。

---

## 6. 配置 schema

### 6.1 声明处（`cordis.patch.yml:3-16`）

```yaml
- insert:
    - id: thoughtdag
      name: dsh-thoughtdag
      config:
        mountPrefix: /thoughtdag          # 第 8 行
        trustedHosts: []                  # 第 11 行（localhost 与 127.0.0.1 始终允许，第 9-10 行注释）
        whyTools: true                    # 第 14 行
        whyPrompt: true                   # 第 16 行
```

### 6.2 代码消费与默认值

| 键 | 消费点 | 默认 | 语义细节 |
|---|---|---|---|
| `mountPrefix` | `lib/index.js:1067-1069` | `'/thoughtdag'` | 三重校验：必须是 string、必须 `startsWith('/')`、长度 > 1；**任一不满足就整体回退默认**（不是部分修正）。末尾 `/+` 会被剥掉（`replace(/\/+$/,'')`） |
| `trustedHosts` | `lib/index.js:1070` | `Set(['localhost','127.0.0.1'])` | 与用户数组求并集；每项 `String(h).trim().toLowerCase()`，空值过滤；**只在内存**，不回写 yml |
| `whyTools` | `lib/index.js:1009`、`:1029` | `true` | 判定是 `!== false`，即**只有显式 `false` 才关**；`undefined`/`null`/`0`/`''` 都是开 |
| `whyPrompt` | `lib/index.js:1010`、`:1062` | `true` | 同上 `!== false`；**且必须 `whyTools` 也为真才生效**（`:1062` 是 `wantPrompt && wantTools`） |

- `installWhyLayer` 的早退：两者都关 → `return`，连 `import('./why.mjs')` 都不执行（`lib/index.js:1011`）。这是很好的懒加载姿态：关闭即零成本，`why.mjs`（139KB）不进内存。
- 失败可见性：加载失败写入 `whyStatus.error` 并 `logger.warn` + `console.error`（`lib/index.js:1017-1020`）；注册状态经 `GET /why/status` 暴露（`lib/index.js:1130`，结构 `{loaded, tools, command, prompt, error}` 定义于 `lib/index.js:994`）。
- **没有任何 schema 校验对象**：全文没有 `schemastery` / `export const Config` / `Schema` 之类声明（grep `schemastery|Schema|export const Config` 在 `lib/index.js` 只命中 `:1030` 注释、`:1039` 参数、`:1067-1068` 的 mountPrefix 判断）。**配置是原样透传的 `config?.X`**，非法类型靠上面这些手写判断兜。**【高置信度推断】** 因此 DSH/配置面板无法为本插件生成表单或提前报错。

---

## 7. 客户端半

### 7.1 结构（`lib/client.js`，157 行）

```js
window.__ModuleLoader__.load({ id: 'dsh-thoughtdag', factory: () => { ... } })  // lib/client.js:18-20
module.exports.inject = ['sessions', 'uiWorkspace']                            // lib/client.js:25
module.exports.apply = ctx => { ... }                                          // lib/client.js:26
```

头注释（`lib/client.js:1-16`）自述这是「最轻量的浏览器 shim」，并记录了三段版本考古：0.4.18 把开关移进会话标题栏后**空态不可见**，0.4.19 撤回；0.4.20 改成「画布打开后由 SPA 顶部栏显示同一开关，pill 在 SPA 就绪后隐藏」。

### 7.2 注册了哪些 slot / 全局？

- **注册 slot：无。** 没有 slot 注册调用、没有面板/组件原语。
- **全局**：往 `document.body` append 一段自造 DOM（`lib/client.js:58-60`）——一个 `.dsh-td-switch`（内含 `<i class="dsh-td-mark">` + 两个 `<button data-view="dialog|map">`）、一个 `.dsh-td-bar`（brand + 同一开关 + `.dsh-td-title`，初始 `hidden`）、一个 `.dsh-td-overlay`（内含 `<iframe title="ThoughtDAG" data-src="/thoughtdag/">`，初始 `hidden`）。
- **样式**：注入一个 `<style>`（`lib/client.js:35-56`，类名 `.dsh-td-switch` / `.dsh-td-bar` / `.dsh-td-overlay`），pill `position:fixed; top:12px; left:60%` 居中 + `-webkit-app-region:no-drag` + `z-index:120`；band `z-index:121` + `data-window-drag`；桌面平台读 `--dsh-frame-top-clearance` / `--dsh-frame-leading-clearance` / `env(titlebar-area-width)` 让位红绿灯与 Windows 标题栏按钮。
- 取版本号：`fetch('/thoughtdag/api/version')`（`lib/client.js:62-64`）。

### 7.3 「对话 | 思维图」浮动开关怎么实现

状态**完全在 DOM 上**，没有 DSH 的视图状态参与：

- `setView(map)`（`lib/client.js:83-88`）：切 class + 维护 `aria-pressed`（空态时「对话」为 active 且 `aria-pressed=true`）。
- `close()`（`:89`）：`overlay.hidden=true; bar.hidden=true; switchEl.hidden=false; setView(false)`，并 `send('td:view', {shown:false, bar:false, desktop})`。
- `showBand()`（`:90`）：`bar.hidden = !barUp()`，再 `send('td:view', {...})`。`barUp()` 只在 macOS 且有 top clearance 时为真（`:76`），注释说明 Windows 上 band 会盖住宿主菜单（引用宿主 issue #55）。
- `mapBtn` 点击（`:100-113`）：显示 overlay → `setView(true)` → 按需显示 band → 隐藏 pill；**首次打开才写 `frame.src`**（`data-src + '?dv=' + pluginVersion`），注释解释原因：`display:none` 的 frame 里 SPA 量到 0×0 会白屏。然后 `syncCurrent(); showBand();`，再 `setTimeout(400ms)` 重来一次以等 SPA 监听器就绪。
- `dialogBtn` / band 里的「对话」→ `close()`（`:92`、`:114`）。

### 7.4 `td:current-session` / `td:select-session` 的走向

**全走 postMessage，且双向都校验 origin + source 标记。**

- 发（插件的 client 半 → iframe）：`const send = (type, payload) => frame.contentWindow?.postMessage({ source:'dsh-thoughtdag', type, ...payload }, location.origin)`（`lib/client.js:93`）。
- `td:current-session`：只能在 `syncCurrent()` 里发出（`lib/client.js:95-98`），payload 是 `{session}`，其中 `session = {id, title: session.displayTitle ?? null, cwd: session.cwd ?? null}`，数据来自 `ctx.sessions.list.getSnapshot()` 的 `snapshot.current` → `snapshot.byId[id]`（`lib/client.js:27-33`）。触发时机：手动 `mapBtn`、iframe 主动 `td:request-current`、SPA 就绪后 400ms。
- 收（iframe → 插件）：`window.addEventListener('message', ...)`（`lib/client.js:116-152`），门禁 `if (event.origin !== location.origin || event.data?.source !== 'dsh-thoughtdag') return`（`:117`），然后按 `type` 分派：
  - `'td:close'` → `close()`（`:119`）；
  - `'td:pick-cwd'` → `ctx.uiWorkspace?.pickDirectory`，不是函数就回 `{requestId, path:null, unsupported:true}`，否则 `Promise.resolve(pick.call(ctx.uiWorkspace))`，成功回 `{requestId, path}`、失败/取消回 `{path:null, unsupported:true}`，经 `send('td:picked-cwd', ...)`（`:120-131`）；
  - `'td:request-current'` → 置 `spaReady=true`、隐藏 pill、`syncCurrent()`（`:136-139`）；
  - `'td:title'` → `barTitle.textContent = event.data.name`（`:140-143`）；
  - `'td:select-session'` 且 `session` 是 string → `const select = ctx.sessions.open ?? ctx.sessions.select; select.call(ctx.sessions, event.data.session); if (event.data.close !== false) close(); syncCurrent()`（`:144-149`）；注释记录 0.1.2 把 `select` 改名 `open`、**旧运行时仍叫 select**，所以做了双名回退。
- `td:view`（`:89`、`:90` 发出）是反向的「告诉画布开关状态」，README 未提。

### 7.5 有没有用到 iframe 之外的 DSH UI 原语？

**没有。** 只用两个能力：`ctx.sessions`（读快照 / 切会话）与 `ctx.uiWorkspace.pickDirectory`（目录选择器）。其余全部是原生 DOM + 原生 `postMessage`。这与它「最轻量 shim」的自述一致（`lib/client.js:1-16`），也解释了 README 为什么把「Canvas why panel / 写桥的画布 UI」列进 roadmap（README:106-107）——这些确实还没做。

---

## 8. 会话读取与安全

### 8.1 磁盘会话读取（zstd 连接帧）

DSH 的会话日志是 **zstd concatenated frames**（README:49-52）。插件的做法是**不依赖外部 zstd 二进制**，先做结构性帧边界扫描再用 `node:zlib` 逐帧解码：

- `ZSTD_MAGIC = 4247762216`（即 `0xFD2FB528` 小端）（`lib/index.js:238`）。
- `scanZstdFrames` 手写 frame 容器解析（`lib/index.js:239-278`）：magic → 描述符（`contentSizeFlag` / `singleSegment` / `checksum` / `dictionaryFlag`）→ 跳过剩余头字节 → 逐 3 字节 block header 读 `lastBlock` / `blockType` / `blockSize`；`blockType === 1`（RLE）时 payload 只有 1 字节 → 最后按 `checksum` 跳 4 字节。
- `decompressZstdToText` 对每帧 `zstdDecompressSync` 后 concat 成 utf8；**任何异常返回 `''`**（`lib/index.js:281-289`）——静默降级，不抛。
- 会话文件匹配：`SESSION_LOG_RE = /^session(?:\.v(\d+))?\.jsonl\.zstd?$/`（`lib/index.js:300`），`findSessionFiles(dshHome)` 走 `$DSH_HOME/sessions/<ws>/<sessionDir>/`，同名多版本时**按 `Number(b.m[1] ?? 0)` 降序取最高版本**（`lib/index.js:301-323`；注释标注 v3=0.1.5、v4=0.2 desktop）。
- 标题/元数据只读头部：`HEAD_READ_BYTES = 256*1024`（`lib/index.js:328`），带 `headCache`（key `${f.log}|${f.size}|${f.mtime}`，>4000 条清空，`lib/index.js:331-340`），`sessionTitleFromHead` 解析 `type==='session'`→`{id,cwd}` 与 `type==='session/title'`→`data.title`（`lib/index.js:341-368`）。
- 对外输出：`sessionToJsonl` 把 live 会话序列化成 JSONL，**首行是合成的 `{type:'session', version:0, id, createdAt?, cwd?, parentSession?, seedLength}`**（`lib/index.js:202-219`）；`eventsJsonlSince(session, since)` 只吐 `seq > since` 的行（`lib/index.js:223-227`），支持前端增量拉日志。
- `DSH_HOME` 解析：`process.env.DSH_HOME || join(os.homedir(), '.dsh')`（`lib/index.js:1083`、`:1103`）。

### 8.2 越权风险

| 面 | 实现 | 评价 |
|---|---|---|
| 静态资源路径穿越 | `assetPath(rel)`：`normalize` → `resolve(APP_DIR, ...)` → `if (abs !== APP_DIR && !abs.startsWith(APP_DIR + sep)) return null`，调用处回 403（`lib/index.js:165-172`、`:1376-1377`） | 正确。注释记录了一个真实教训：Windows 反斜杠曾导致**每次请求都被拒**（宿主 issue #23） |
| 外部 session 根穿越 | `fileInRoot(rootKey, rel)`：未知 key→404，`rel` 非串/空→400，resolved 后 `abs !== root && !abs.startsWith(root + sep)` → **400 `'rel escapes its root'`**（`lib/index.js:437-444`） | 正确。三根为 `~/.claude/projects`、`~/.codex/sessions`、`~/.pi/agent/sessions`（`lib/index.js:429-433`） |
| 符号链接逃逸 | **无 `realpath` 校验** | **【高置信度推断】根内一个指向根外的 symlink 可以绕过 `startsWith(root+sep)` 检查**。风险有限（只读、且需要先在本机建 symlink） |
| 单文件读取上限 | `FILE_READ_MAX = 256MB`，`read` 超限回 413 并提示改 `range`（`lib/index.js:434`、`:1170-1174`） | 合理 |
| 分页与限额 | `headOfFile` clamp `[1024, 524288]`（`lib/index.js:474`）；`rangeOfFile` 长度 clamp `[65536, 32MB]` 且非 EOF 时按最后一个 `\n` 对齐（`lib/index.js:480-499`） | 合理 |
| 递归列目录 | 深度 ≤ 5，只收 `.jsonl`，5s `listCache`（`lib/index.js:446-470`） | 合理 |
| Body 上限 | `MAX_BODY_BYTES=32KB`（`readJson` 默认）、`MAX_WRITE_BODY_BYTES=4MB`、`MAX_CALL_BODY_BYTES=24MB`（`lib/index.js:110-114`）；超限 413（`lib/index.js:143-152`） | 分层合理 |

### 8.3 Host 头防护的具体实现

```js
const trustedHosts = new Set(['localhost', '127.0.0.1', ...[...(config?.trustedHosts ?? [])].map(h => String(h).trim().toLowerCase()).filter(Boolean)])  // lib/index.js:1070
...
const hostname = (typeof req.headers.host === 'string' ? req.headers.host : '').replace(/:\d+$/, '').toLowerCase()   // lib/index.js:1076
if (!trustedHosts.has(hostname)) return sendJson(res, 403, { error: 'untrusted Host header' })                       // lib/index.js:1077
```

要点与观察：

- 剥端口用 `replace(/:\d+$/, '')`，然后 lowercase、**精确 membership 判断**（不是 `endsWith`），因此 `evil-localhost` 之类后缀伪造无效。这是防 DNS rebinding 的标准姿势。
- **只对 `/api` 生效**：`staticHandler`（`:1371-1384`）**不做 Host 检查**。
- 默认白名单只有 `localhost` 与 `127.0.0.1`：**`[::1]`、`localhost:port` 形式（端口已被剥掉所以没事）、自定义 hostname 都会被 403** —— IPv6 loopback 属于**人为的可用性缺口**（【高置信度推断】：未见 `[::1]` 特判）。
- **没有 token / cookie / CSRF 校验**：Host 头是本插件唯一门禁。
- **最大的安全观察点是 `POST /api/judge`（`lib/index.js:1191-1199`）**：它接收任意 `body.url`（只要求 `http(s)://`）+ 任意 `body.headers` + 任意 `body.body`，用 `fetch` 转发并把响应原样回吐（状态码透传，`:1198`）。注释自述用途是「the judge (a System One decision endpoint) forwarded for the canvas; **the key rides in the request**」（`:1190`）——即**画布把 API key 放在请求里经这个端点转发**。相比 `POST /api/fetch-url` 走的是 `ctx.web.fetch` 有界抓取器（`:1201-1213`），`/judge` 是一个**无界的通用 HTTP 转发器**（60s 超时，无域名白名单、无出站过滤）。在本地可信前提下是可接受的取舍，但它把「Host 头对不对」当成了唯一授权边界，值得在部署评审时单独记一笔。

---

## 9. 与多智能体的关系

**结论：确证「没有」。这个插件里不存在任何 DSH 意义上的子代理、团队、拓扑、任务分派概念。**

### 9.1 关键词层面的否证

对 `lib/` 全目录 grep `topology|topo|teams|membership|orchestrator|scheduler|task queue|assignee|agentTeam|agent_team`：**零命中**。

对 `subagent|sub-agent|Subagent|delegate|dispatch|childSession|spawn(` 一类词的命中分两类，**没有一类是「本插件派生子代理」**：

1. `lib/index.js:926` 只出现**事件名** `'tool/code-dispatch-start'` 与 `'tool/ptc-dispatch-start'`——这是 DSH 自己的工具派发事件，插件只是**监听**以在画布上显示工具调用。
2. `lib/runtime/agents/*.cjs` 的 `spawn`/`execFile` 全部是**启动外部 CLI 程序**（第 11 节详述），不是 DSH 子代理 API。
3. `lib/why.mjs` 里所有 `subagent` 相关命中，语义都是**「解析别人家运行时自己记的子代理会话文件」**：`adoptSubagentSessions`（`why.mjs:467`）、`attachSubagentBranches`（`why.mjs:493`）、从 Claude Code 的 Task/agent 工具调用里提取 `{agent, task, prompt, output}`（`why.mjs:626`、`:673`）、`toSubagentSession()`（`why.mjs:700`）、Codex 的 subagent/thread 标记（`why.mjs:898`、`:915`）、`subagentRuns()`（`why.mjs:1197`）、判定式 `const subagent = "subagent" in s ? !!s.subagent : runner === "claude-code" && /\/subagents\//.test(file)`（`why.mjs:2246`）、渲染时标注 `(subagent)`（`why.mjs:2793`、`:2824`）。也就是说：**它能「看见」别的 agent 的子代理痕迹，但自己从不派生。**

### 9.2 概念层面的否证

- 插件注册面（第 2 节）里没有任何 agent 创建、任务队列、成员/角色、消息路由到多个 agent 的端点。唯一的 agent 相关写入是 `inject`/`followup` 到**一个指定 session**（`lib/index.js:1349-1360`）。
- `runAgentTurn` 的模型入口是**单个** `agentTargetOf(body.model)` → `selectModel` → 一个 agent（`lib/index.js:843-851`）。
- `canvasTurns` 的 key 是 sessionId，不是团队/图节点（`lib/index.js:766`）。
- 唯一与「多 agent」沾边的是**模型目录里的 agent 条目命名**：`AGENT_GROUP = '__agent__'`、`AGENT_MODEL = 'harness/agent'`、条目 id 形如 `harness/agent/<provider>/<model>`（`lib/index.js:515`、`:519-527`）。这是「让画布上的模型下拉框能选『用 DSH 自己的 agent loop 回答』」，**不是多智能体协作**。

### 9.3 与「agent teams」主题的相关性

如果本项目（`2026.10_dsh-agent-teams-concourse`）关心的是**多智能体协作/编排**，那么 `dsh-thoughtdag` 的价值不在编排，而在两处：**(a)** 它是「把外部多个 runtime（Claude Code / Codex / Pi）的历史统一读成一张证据网」的现成实现（`why.mjs` 是这层的核心资产）；**(b)** 它示范了「插件如何 prepend 抢占 harness 的审批瀑布 + 用 500ms 轮询做优雅降级」。**它没有团队、没有拓扑、没有分派。**

---

## 10. roadmap 与 `replace`

### 10.1 原文（README:104-110）

```markdown
## Not yet (roadmap)

- Canvas why panel (a node's file → its history through `/thoughtdag/api`)
- Canvas UI for the write bridge: name a fork point on a node, hand a compiled context to `inject`, continue with `followup`; the client already switches the chat to a session the canvas names (`td:select-session`)
- `replace`: shadow a surface range from the canvas (DSH's compaction primitive); needs a live check of how the chat renders a replaced range
- Theme and language sync with the harness UI
- Open the chat's current session on the canvas automatically when the view switches
```

`replace` 的原话即 README:108：

> ``- `replace`: shadow a surface range from the canvas (DSH's compaction primitive); needs a live check of how the chat renders a replaced range``

### 10.2 代码里有预留吗？

**没有。**

- grep `lib/index.js` 的 `compaction|shadow|replace range|compact` → 只命中 `lib/index.js:915` 的一句无关注释：`// deltas did not reach us live (a compacted row, or a runtime whose ...)` —— 说的是「被压缩过的行不会再收到实时增量帧」，属于 `agent/assistant-stream` 监听里的补发逻辑（`lib/index.js:882-889`），与 `replace` 无关。
- 路由表（`lib/index.js:1074-1362`）里没有 `/replace`、`/compaction`、`/shadow` 任何分支；写入原语正则只有 `fork|inject|followup` 三个（`lib/index.js:1325`）。
- `lib/client.js` 里也没有任何 `replace` 相关消息类型（消息白名单见 `lib/client.js:116-152`）。

**结论：`replace` 是纯粹的文字路线图项，零代码痕迹。** 有意思的是它暴露了作者对该原语的两点认知：一是把它定性为「DSH 的 compaction primitive」（即压缩/遮蔽面 range 的机制），二是它的阻塞原因不是实现难度，而是**「需要先实地确认聊天 UI 如何渲染一个被替换的 range」**——即依赖宿主渲染行为的不确定性。

---

## 11. 运行时适配器（`lib/runtime/agents/`）

### 11.1 它们是「调用外部 CLI」还是「调用 DSH 子代理 API」？

**确证：全部是调用外部 CLI 程序。** 三个适配器都 `require('node:child_process')` 并 `spawn` 本机可执行文件：

| 适配器 | 外部程序与协议 | 证据 |
|---|---|---|
| `pi.cjs` | `pi --mode rpc`，JSONL 双向（下行命令带 id，上行 response 行 + 会话事件）；**每个工作目录一个常驻子进程** | `lib/runtime/agents/pi.cjs:16`（`const { spawn, execFile } = require('node:child_process')`）、`:50-51` `const args = ['--mode','rpc', ...(opts.noSession ? ['--no-session'] : ['-e', GUARD, ...extra])]` / `spawn(bin, args, {cwd, env: childEnv(), stdio:['pipe','pipe','pipe']})` |
| `codex.cjs` | `codex app-server`，JSON-RPC 2.0 over stdio；先 `initialize{clientInfo:{name:'thoughtdag',...}}` 再 `initialized` | `lib/runtime/agents/codex.cjs:1`（头注释）、`:11`、`:96` `proc = spawn(b, ['app-server'], {env: childEnv(), stdio:['pipe','pipe','pipe']})` |
| `claude.cjs` | `claude -p --output-format stream-json --input-format stream-json --verbose --include-partial-messages ...`，**一个 turn 一个进程** | `lib/runtime/agents/claude.cjs:11`、`:157` `const proc = spawn(b, args, {cwd, env: childEnv(), stdio:['pipe','pipe','pipe']})` |

统一的运行时 surface 在 `lib/runtime/agents/README.md:3` 有权威描述：

> One file per runtime (CommonJS, `.cjs`, …): `pi.cjs` over `pi --mode rpc`, `codex.cjs` over `codex app-server`, `claude.cjs` over `claude -p` with stream-json both ways.

工厂返回同一套方法：`available()`、`models()`（返回 `{installed, models:[{provider,id,name,reasoning,vision,efforts,defaultEffort}], default}`，找不到时 `{installed:false, searched:[dirs]}`；`efforts` 是 **CLI 自己列出来的档位**）、`run(request, onEvent)`（立刻返回 runId）、`abort(runId)`、`answer(runId, requestId, {confirmed}|{value}|{cancelled:true})`、`shutdown()`（`lib/runtime/agents/README.md:3-20`）。事件种类：`session`/`message_update`/`tool_execution_start|end`/`question`（`confirm|select|input|editor`）/`question_answered`（`auto:true` 表示按既有规则自动决定、没问人）/`fs_changes`/`run_end`/`run_error`（`README.md:10-20`）。

**关键设计声明**（`README.md:24-26`）：

> The finished turn is adopted from the session file by the atlas's adapter for that runtime; **the stream is for showing, the file is the truth.**

即：实时流只用于「显示」，**权威记录是 CLI 自己写的 session 文件**，收尾时从文件回读采纳。这是个很值得借鉴的「流是提示，文件是真相」的容错取向。

**`where.cjs` 是「外部程序」的最强旁证**：它专门解决「CLI 不在 PATH 上」的问题——`loginPath()` 用 `$SHELL -ilc 'printf "%s" "$PATH"'` 解析登录 shell 的 PATH（fish 特判），`managerDirs()` 覆盖 nvm/fnm/volta/n/p/nodenv/asdf/mise/proto/pnpm/yarn/deno/cargo 与 Windows 的 `%APPDATA%\npm`、`%LOCALAPPDATA%\pnpm|Volta\bin|Programs\nvm`、`%ProgramFiles%\nodejs`，`COMMON_HOMES` 兜底 `/opt/homebrew/bin`、`/usr/local/bin`、`~/.bun/bin` 等，`childEnv()` 把加宽后的 PATH 注入子进程（`lib/runtime/agents/where.cjs:12`、`:20`、`:23-38`、`:45-65`、`:67`、`:87-97`）。**如果调的是 DSH 自己的 API，这一整套逻辑根本不需要存在。**

**在 DSH 侧如何暴露**：`lib/runtime/agents/http.cjs` 提供 `createAgentsHttp({workspaceRoot = ~/.thoughtdag/workspaces, log})`，路由 `GET /agents/available`、`GET /agents/models?runtime=`、`GET /agents/events`（SSE 订阅 + 20s 心跳）、`POST /agents/run|abort|answer|workspace|guard|materials|open-in-cli`（`lib/runtime/agents/http.cjs:12-16`、`:18`、`:22-31`、`:44-89`）。host 端在 `lib/index.js:1216-1219` 把 `/agents/*` 转发给它，惰性初始化（`lib/index.js:101-108`）。**注意这条路径不在 README 的功能表里**——是读源码才能发现的「隐藏注册面」。

### 11.2 `pi-guard.mjs` 的守卫逻辑

它是**每次启动 Pi 都要加载的 Pi 扩展**（`pi -e <this file>`，见 `pi.cjs:50-51` 的 `-e GUARD`），81 行，只用 `node:path/os/fs`（`lib/runtime/agents/pi-guard.mjs:14-16`）。一条规则：**工作目录就是边界。**

1. **系统自有路径放行**：`SYSTEM_PREFIXES = ['/dev/','/usr/','/bin/','/sbin/','/opt/','/etc/','/tmp/','/private/tmp/','/private/var/','/var/','/System/','/Library/','/Applications/','/proc/']`（`:18`）——跑 `/usr/bin/env` 不算越界。
2. **取路径**：`pathsOf(event, cwd)`——`bash` 走 `pathsInCommand(input.command)`（正则 `/(?:^|[\s=:'"(])((?:~|\/)[^\s'"\`;|&)<>]*)/g` 抓绝对/`~` 路径，另一条抓 `cd <target>`），`read/write/edit/ls/grep/find` 走 `input.path`，其它返回 `[]`（`:32-48`）。全部经 `expand()`（`:22-26`）处理 `~`。
3. **边界判定**：`inside(abs,root) = abs===root || abs.startsWith(root+sep)`（`:28`）；`outside = pathsOf(...).filter(p => !inside(p,root) && !systemOwned(p) && !cfg.allow.some(a => inside(p,a)))`（`:74`）。
4. **画布可调规则**：读 `<cwd>/.thoughtdag/guard.json`，**每次工具调用都重读**；`{ "mode": "ask" | "allow", "allow": ["/a/directory", …] }`；`mode` 非 `'allow'` 一律按 `'ask'`，`allow` 只保留以 `/` 开头的字符串并 resolve，读失败回 `{mode:'ask',allow:[]}`（`:50-55`）。
5. **问人**：无越界 → 直接放行返回；有越界 → 取前 3 个（多则 `+N`）；**没有人可以问时硬拦**：`if (!ctx.hasUI) return { block:true, reason: 'outside the working directory (where); nobody to ask' }`（`:77`）；否则把结构化尾部 `TAIL='␟'` + `JSON.stringify({paths:outside, suggest:suggestion(outside)})` 拼进问题正文，调 `ctx.ui.confirm(...)`（`:78-79`）；被拒 → `{ block:true, reason:'the person did not allow ...' }`。
6. **`suggestion(paths)`**（`:59-65`）：每个路径是目录就用它、否则用 `dirname`；多个则求公共父目录（落在根则取第一个）——即「拒绝之后给模型一个可行的替代目录」。
7. `mode === 'allow'` 时**什么都不问**，直接放行（`:72-73`）。

这段逻辑与本插件的 `approval/request` 抢占是**两条独立的审批通路**：一条给 Pi（扩展内的 `ctx.ui.confirm`），一条给 DSH 自己的 agent loop（waterfall）。二者共享「把问题送到画布、把决定带回来」的产品形态，但实现完全解耦。

### 11.3 `terminal.cjs`：在人的终端里恢复外部会话（与 DSH 无关）

`PROGRAMS = {'claude-code': id=>`claude --resume 'id'`, codex: id=>`codex resume 'id'`, pi: id=>`pi --session 'id'`}`（`lib/runtime/terminal.cjs:17-21`），`openInTerminal(runner, cwd, sessionId, {preferred, customTerminals})` 里 **`sessionId` 必须匹配 `/^[\w.-]{4,}$/`、`cwd` 必须是存在的绝对目录否则回 `~`**（`:90-103`）；`buildTerminalRegistry` 按平台列举终端（macOS: Terminal/iTerm/Ghostty/Warp/Alacritty/kitty/WezTerm；win32: wt.exe/powershell/cmd；linux: gnome-terminal/konsole/…），逐个 probe/launch 直到成功，返回 `{opened, via, command, terminal}`（`:50-86`）；macOS 上会写一个 `~/tmp` 下的 `.command` 脚本（含 `rm -- file` 自删）再 `open -a App file`（`:39-45`）。`run()` 用 `spawn(bin,args,{stdio:'ignore', detached: linux})`（`:23-28`）。

### 11.4 `sessions-fs.cjs`：另一份磁盘读取实现

`lib/runtime/sessions-fs.cjs`（100 行）与 `lib/index.js` 内联版**几乎同构**：同样的 `FILE_ROOTS` 三根（`:10-14`）、`FILE_READ_MAX=256MB`（`:15`）、同样的 `abs !== root && !abs.startsWith(root + sep)`→400（`:19-26`）、深度 ≤5 只收 `.jsonl`（`:28-46`）、head clamp `[1024,524288]`（`:48-52`）、range `want = Math.min(Math.max(65536, Number(length)||0), 32*1024*1024)` 且非 EOF 时在最后一个 `\n` 截断并回 `nextStart`（`:54-68`）、`handleSessions` 处理 `/roots` 与 `/roots/<key>/(list|head|read|range)`、`read` 超限 413、head 默认 16384 字节（`:71-98`）。**这是同一逻辑的重复实现**（一份给 DSH 内联桥，一份给本地桌面 server），属于可维护性瑕疵——两边的安全判断必须同时改才不会漂移。

---

## 12. 可借鉴的机制

1. **「同一份 tool schema，三处复用」**：`why.mjs:3443-3448` 的 `MCP_TOOLS` 既是 MCP server 的工具定义、又是 CLI 的入口说明、又被 `lib/index.js:1033-1042` 直接当作 DSH 原生工具的 `parameters`。插件层零重复定义，只做名字映射（`TOOL_NAMES`，`lib/index.js:997`）与 cwd 适配。对任何「已有 CLI/MCP 资产、想再暴露成宿主原生工具」的插件，这是最省成本的路径。
2. **prepend 抢占 + 三道降级护栏的审批接管**：`ctx.on('approval/request', fn, true)`（`lib/index.js:773`+`:801`）拿到优先权，但只在「本会话确实是画布自己在跑的那个 turn」时接管（`:774`、`:778`），流断 500ms 轮询后 `return next()` 原样还回宿主面板（`:788`、`:797`），取消则回 `'cancelled'`（`:798`）。**「能接管、但默认不接管」是插件与宿主 UI 共存的正确姿势**——比无条件拦截安全得多。
3. **两级检索的 token 经济学**：`why_check` 是显式设计的「一行、true/false、改文件之前先花一个廉价问题」（`why.mjs:3444`、`why.mjs:2937-2939`），配合 4 行系统提示段（`lib/index.js:1000-1003`）把「何时值得展开查」教给模型，而不是让模型每次都拉全量。任何往模型上下文塞检索结果的插件都该有这个前置阀门。
4. **「流是提示、文件是真相」**：外部 CLI 的实时事件流只用于画布显示，收尾时从 CLI 自己写的 session 文件回读采纳（`lib/runtime/agents/README.md:24-26`）；配套的 `where.cjs` 登录 shell PATH 解析（`where.cjs:23-38`、`:45-67`）解决了 GUI 进程 PATH 不完整导致找不到 CLI 的老问题。这是「接入第三方 CLI agent」时非常实用的一组工程细节。
5. **零外部依赖解 zstd 连接帧**：手写帧边界扫描 + `node:zlib` 逐帧解（`lib/index.js:238-289`），避免打包/依赖外部 zstd 二进制，且失败静默返回空串不炸宿主。对「宿主用连接帧压缩日志」的场景可复用。
6. **可观测性内置**：`whyStatus`（`lib/index.js:994`）把「哪些工具注册上了、命令、提示段、失败原因」经 `GET /why/status` 暴露（`lib/index.js:1130`），部署时不必翻日志。配合「两开关都关就完全懒加载 `why.mjs`」（`lib/index.js:1011`）形成很干净的开关-状态闭环。

---

## 13. 局限

1. **零 schema 校验的配置面**：没有 Schemastery/Config 声明，配置是 `config?.X` 原样读（`lib/index.js:1009-1010`、`:1067-1070`），宿主无法生成表单或提前校验；非法 `mountPrefix` 会**静默整体回退**默认值。
2. **why 工具没有输出预算**：`why_recall` 无任何上限（`why.mjs:2963-2993`），`why_file`/`why_find` 的 `limit` 只限条数不限单条长度，插件侧 `String(value)` 全量入库（`lib/index.js:1040`）。四个「查历史」工具可能把整轮问答 + 每个 1200 字符的 diff 灌进上下文。
3. **`ensureFresh()` 让「只读工具」带写副作用**：索引超 10 分钟（`why.mjs:2924`）就重建 `~/.thoughtdag` 索引（`why.mjs:2626-2656`），调用工具有隐藏的文件系统写与耗时。
4. **`/judge` 是无界 HTTP 转发器**：任意 URL/headers/body（`lib/index.js:1191-1199`），Host 头是唯一门禁；旁边 `/fetch-url` 反而走了有界抓取器（`:1206`），两者安全姿态不一致。
5. **无鉴权、无 CSRF token**：仅 Host 白名单（`lib/index.js:1076-1077`），且**静态侧不检查 Host**（`:1371-1384`）；默认白名单不含 `[::1]`。
6. **路径校验无 `realpath`**：`fileInRoot`（`lib/index.js:437-444`）与 `assetPath`（`:165-172`）都是纯字符串前缀判断，symlink 可绕（【高置信度推断】）。
7. **磁盘读取逻辑重复两份**：`lib/index.js:429-499` 与 `lib/runtime/sessions-fs.cjs:10-68` 同构，安全修复容易漂移。
8. **client 半零 DSH UI 原语**：纯 DOM + iframe + postMessage（`lib/client.js:58-60`、`:93`），因此无法跟随宿主主题/语言（README:109 自认 roadmap），也注定在宿主 DOM 结构变化时更脆（例如它必须读 `--dsh-frame-top-clearance` 这类私有 CSS 变量，`lib/client.js:56`、`:71`、`:76`）。
9. **`td:*` 消息协议没有版本号**：只有 `event.data?.source==='dsh-thoughtdag'` + origin 校验（`lib/client.js:117`），字段语义变化（如 `select`→`open`，`:144-149`）只能靠双名回退兼容。
10. **`limit` 的 `||10` 陷阱**：`Number(a.limit ?? 10) || 10`（`why.mjs:3463`、`:3468`）使 `limit: 0` 无法表达「只要条数统计」。
11. **审批抢占附带最坏 500ms 延迟**：断流检测是 500ms 轮询而非事件（`lib/index.js:788`）；`pendingApprovals` 若因异常路径未 resolve 会滞留（虽然有 `aborted` 兜底）。
12. **roadmap 四项未实现**（README:104-110），其中 `replace` 零代码痕迹（第 10 节）。

---

## 附录 A 未确认事项

以下条目**未能在本次分析中独立核实**，正文中已按需标注 **【高置信度推断】**：

1. **`ctx.sessionController` 的确切 API 形状**。工作区 `node_modules/@deepseek-ai/` 下有 `cordis`/`dsh-agent`/`dsh-session`/`dsh-llm`/`dsh-tools`/`dsh-subagent`/`dsh-experimental-agent-team` 等包，但**没有 `dsh-api-session-controller`**；DSH checkout 路径 `<DSH_INSTALL>\resources\app.asar\dsh\` 在本机**不存在**（asar 未解包，`Test-Path` 返回 False）。因此 `fork({sessionId, atSeq})`、`prompt({requestId, sessionId, mode, content}, signal)`、`create({cwd})`、`modelCatalog()`、`resolveAgent(id)`、`selectModel(...)` 的**对象参数名与返回形状均取自本插件的调用点**，未经宿主侧源码确认。已独立确认的只有底层 `SessionStore.fork(source, boundary?, childSessionId?)`（`node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts:453-469`），其 `boundary` 为 inclusive seq。
2. **`requestId` 如何进入 `user/message.source.rpcId`**。仅由监听端匹配逻辑反推（`lib/index.js:863`、`:890-932`），未读 controller 实现。
3. **harness 自家审批面板的注册顺序与形式**。本报告只确认了「本插件 prepend + 不调 next 即抢占」（`node_modules/@deepseek-ai/cordis/lib/types/events.d.ts:67-77`、`:85`、`:103`）；宿主面板以什么 id/优先级注册无从核实。
4. **`approval/request` 事件的完整 payload schema**。字段 `req.agent.id`、`req.callId`、`req.toolName`、`req.reason`、`req.signal` 是按本插件的消费点列举（`lib/index.js:773-793`），未见类型声明。
5. **DSH 是否对工具输出做外层裁剪**。`lib/index.js:1040` 的 `render` 全量返回；宿主侧是否有 token 预算策略（会削弱第 13 节第 2 条的实际后果）未验证。
6. **`ToolCallKind` 默认归类**。DSH 的 `ToolDefinition`（`node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts:115-128`）不含 read-only 字段，插件也未设置任何类别；「会落到 `other`」是基于 `presentation.d.ts:13` 的枚举与注册对象的字段集做出的推断。
7. **`why.mjs` 未通读**。本报告只精读了 `MCP_TOOLS`/`mcpCall`/`renderCheck`/`renderWhy`/`renderFind`/`renderRecall`/`ensureFresh`/`findJson`/`hitsFor` 等相关区段与 grep 命中的 subagent 区域；`why.mjs` 共 3520 行，其余（索引构建细节、dossier/topics/labels 子系统、缓存格式）未逐行核对。凡涉及「索引重建写哪些文件」的结论基于 `why.mjs:2626-2656` 的读，未展开验证文件格式。
8. **`dist-app/`（Vite 构建的 SPA）未分析**。本报告聚焦 `lib/`；画布侧 SPA 的行为（包括它如何消费 `/api/*`、`td:*` 消息）未读。
9. **`[::1]` 是否被特判放行**。未在代码中看到该字面量，但未做穷尽 grep。
10. **DSH 兼容性声明的实际含义**。`package.json:50-58` 声明 `0.1.2-rc.1 / 0.1.5-rc.1 / 0.1.5-rc.2 / 0.1.5-rc.3` 为 `compatible`，这是作者自述，未验证其在每个版本上的实测行为。
11. **`lib/index.js:926` 两个 `tool/*-dispatch-start` 事件名的语义**（`tool/code-dispatch-start`、`tool/ptc-dispatch-start`）：只确认插件在监听并把它们当作工具调用来展示，未核对其宿主侧定义。

## 附录 B 关键数字

| 项 | 值 | 来源 |
|---|---|---|
| 包版本 | `0.5.17` | `package.json:3` |
| 作者 / 许可 | Xia Chen / MIT | `package.json:5`、`:66` |
| Node engines | `^22.19.0 \|\| >=24.0.0` | `package.json:14-16` |
| host 主文件 | `lib/index.js`，1392 行 / 77,664 字节 | `lib/index.js` |
| client 文件 | `lib/client.js`，157 行 / 12,299 字节 | `lib/client.js` |
| 打包的 why 库 | `lib/why.mjs`，3520 行 / 139,386 字节；内含 `CLI_VERSION = "0.2.2"` | `why.mjs:3442` |
| HTTP 路由分支 | 约 24 条 path 分支 + 3 个 webServer 注册 | `lib/index.js:1074-1362`、`:1386-1388` |
| 原生工具 | 4 个（`why_check`/`why_file`/`why_find`/`why_recall`） | `lib/index.js:997`、`:1029-1048` |
| 斜杠命令 | 1 个（`/why`） | `lib/index.js:1049-1059` |
| 系统提示段 | 1 个（`thoughtdag-why`，`order: 900`，4 行文本） | `lib/index.js:1062`、`:1000-1003` |
| approval 钩子 | 1 个（`approval/request`，prepend=true） | `lib/index.js:773`、`:801` |
| 模块级 Map | `canvasTurns`、`pendingApprovals`、`listCache`、`headCache` | `lib/index.js:766`、`:768`、`:447`、`:331` |
| body 上限 | 32KB（默认）/ 4MB（写）/ 24MB（模型调用） | `lib/index.js:110-114` |
| 审批白名单 | `['allowed-once','rejected']`，其它→`rejected` | `lib/index.js:770`、`:1255` |
| 断流轮询 | 500ms | `lib/index.js:788` |
| followup 超时 | 30s（`AbortSignal.timeout(30000)`） | `lib/index.js:1359` |
| agent turn 超时 | 20 分钟（`setTimeout(resolve, 20 * 60 * 1000)`）；`sessionController.prompt` 30s | `lib/index.js:942`、`:1359` |
| 第三方 provider 调用超时 | 10 分钟 | `lib/index.js:644` |
| 版本查询节流 | 24 小时 | `lib/index.js:92` |
| zstd magic | `4247762216`（`0xFD2FB528`） | `lib/index.js:238` |
| 会话日志正则 | `/^session(?:\.v(\d+))?\.jsonl\.zstd?$/` | `lib/index.js:300` |
| 头部读上限 | 256KB（`HEAD_READ_BYTES`） | `lib/index.js:328` |
| 外部根 | 3 个（claude-projects / codex-sessions / pi-sessions） | `lib/index.js:429-433` |
| 单文件读上限 | 256MB（`FILE_READ_MAX`） | `lib/index.js:434` |
| head clamp | `[1024, 524288]` | `lib/index.js:474` |
| range clamp | `[65536, 32MB]`，按 `\n` 对齐 | `lib/index.js:480-499` |
| 目录递归深度 | ≤5；listCache 5s | `lib/index.js:456`、`:448` |
| why 索引新鲜度 | 10 分钟（`CHECK_FRESH_MS`） | `why.mjs:2924` |
| why_file / why_find 默认 limit | 10 | `why.mjs:3463`、`:3468` |
| why_recall 上限 | **无** | `why.mjs:2963-2993` |
| recall 单工具调用截断 | 1200 字符（error 首行 200 字符） | `why.mjs:2988-2989` |
| find snippet 宽度 | 70（≈140 字符） | `why.mjs:2842-2848` |
| why_file 候选清单上限 | 20 | `why.mjs:3461` |
| 外部运行时 | 3 个（pi / codex / claude-code）+ 1 个守卫扩展 `pi-guard.mjs` | `http.cjs:12-16`、`pi.cjs:23` |
| pi-guard 大小 / 逻辑 | 81 行 / 一条规则：工作目录即边界 | `pi-guard.mjs:1-81` |
| guard 可调文件 | `<cwd>/.thoughtdag/guard.json`（每次调用重读） | `pi-guard.mjs:50-55` |
| guard 系统前缀 | 14 条 | `pi-guard.mjs:18` |
| agents/总行数 | 约 1500 行（claude 302 + codex 379 + pi 345 + http 95 + where 99 + ops + fs-diff + pi-guard 81） | `lib/runtime/agents/` |
| 子代理/团队/拓扑概念 | **0 处**（grep 零命中） | 第 9 节 |
| `replace` 代码痕迹 | **0 处**（仅 README:108 一句） | 第 10 节 |
