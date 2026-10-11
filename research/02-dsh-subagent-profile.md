# 02 · dsh-subagent-profile 深度逆向调研（一手精读）

> 调研对象：`dsh-subagent-profile@0.5.1`（bundle 插件 / 双面插件：宿主面 + 浏览器面）
> 安装位置：`C:\Users\KEI.NEO\.dsh\profiles\web\node_modules\dsh-subagent-profile`（源码级、未压缩）
> 仓库：https://github.com/muzyLink/dsh-subagent-profile · 许可证 MIT（`LICENSE`、`package.json:81`）
> 规模事实：**61 个文件** = `index.mjs`(24.7KB) + `lib/client.js`(325KB/5391 行) + `lib/core/` **46 个 .mjs** + `presets/orchestrator-v2/` 5 文件 + 3 张截图 + LICENSE/package.json/README×2
> 依赖事实：`dsh-subagent-profile@0.5.1` 已列入 `C:\Users\KEI.NEO\.dsh\profiles\web\package.json:19` 且在第 `dsh.profile.bundles` 列表内（`:40`）→ 本机实际加载中
> 方法：`grep`/`read` 工具逐文件精读（带行号），关键结论附 `文件:行号`；`lib/client.js` 先 grep 定位（20+ 处命中点）再局部精读；`docs/screenshots/*.png` 经本地 OCR 复核 UI 文案；`~/.dsh/subagent-evolution/*` 实盘数据核对格式。
> 未确认项一律显式标注 **未确认**，不做推测性断言。

---

## 1. 定位与需求

### 1.1 一句话定位

它是 DSH 的**子 Agent 派发治理层**：把「派生子 Agent 时选哪套预设 / 哪个模型 / 多深推理 / 给哪些工具 / 花多少钱」从「模型临场乱猜」变成**有名字的、可复用、有闸门、有台账、可复盘**的工程对象。

`package.json:4` 自述：

> 「DeepSeek Harness 子 Agent 派发插件：按任务为子代理选模型、推理强度与工具范围，常用组合存成命名方案随时复用；内置安全检查、成本估算与节省分析、完整决策台账。」

### 1.2 与 DSH 原生 subagent 的关系（不是替代，是补三层）

README 的对照表（`README.zh.md:20-30`）与代码事实一致，可归纳为三层补强：

| 维度 | 原生 `subagent` 工具 | 本插件 `dispatch` 工具 | 代码证据 |
|---|---|---|---|
| 命名方案复用 | ❌ 每次调用靠模型现填参数 | ✅ `profile` = 预设+模型+推理强度+工具范围+预算 一捆 | `profiles-store.mjs:42-45` |
| 派发前闸门 | 官方仅做自身模型白名单校验 | ✅ 白名单 / 成本 / 工具交集 / 预算 四闸，逐闸记 trace | `dispatch-gates.mjs`、`cost-guard.mjs` |
| 决策留痕与成本 | ❌ | ✅ `decisionTrace` + `dispatch.jsonl` + `summaries.json` + 成本反事实对照 | `decision-trace.mjs`、`evolution-ledger.mjs`、`cost-evidence.mjs` |

**技术关系要点**（不是两个平行工具那么简单）：

1. 插件向宿主注册了一个**名为 `profile` 的 subagent provider**（`profile-provider.mjs:244-250`）：`subagents.registerProvider({ name:'profile', capabilities:{outputSchema:false, depthLimit:true, toolFilter:true, persona:true}, inheritsParentContext:false, start, prepareContinuable })`。`dispatch` 工具内部就是走这个 provider（`dispatch-tool.mjs:185/224/127` 调 `subagents.start('profile', request)` / `startContinuable`），也就是说**官方 subagent API 通道同样可达这条 provider**（代码里称「provider 渠道」，见 `dispatch-gates.mjs:85-96`、`escape.mjs:119-129` 的注释）。
2. `dispatch` 工具本身**对所有预设可见**（`agent.cordis.yml:6` 注释：「`dispatch` 工具本身由 dsh-subagent-profile 宿主行注册，对所有预设可见」）；插件只对 `orchestrator-v2` 预设额外注入编排提示段（`index.mjs:131-148`、`ORCHESTRATOR_MODE_TEXT` 在 `index.mjs:153`）。
3. 原生通道与本插件通道**共用同一份官方模型选择策略**（若启用）：`model-policy.mjs:73-77` 与 `dispatch-gates.mjs:88-96` 分别覆盖派发渠道与 provider 渠道，保证「两通道一致」（`:26-27` 错误文案第 2 层明说）。

### 1.3 需求动机（从代码反推，而非从 README 抄）

- **成本不可见** → 每次派发估算成本 + 「若继承父模型」反事实对照（`cost-evidence.mjs:42-71`）。
- **委派放大权限** → 「工具只减不增、审批永不豁免」（`intersection.mjs:14-23`、`decision-trace.mjs:168-176`）。
- **事故无法复盘** → 决策轨迹三分支闭合 schema 强制携带（`dispatch-schema.mjs:82-186`）。
- **方案靠人记** → 命名方案 + 设置页 + 系统提示注入目录（`profile-directory.mjs:132-143`）。
- **无自学习** → 台账聚合 → 建议 → 候选 → 人工确认 → 观察期金丝雀（`evolution-engine.mjs`）。

---

## 2. 预设（profile）体系

### 2.0 先纠正一个概念混淆：这里有**两种「预设」**

这是本插件最容易误读的地方，必须先分开：

| 概念 | 英文/字段 | 归属 | 载体 | 作用 |
|---|---|---|---|---|
| **Agent 预设** | agent preset，`preset` 字段取值 | DSH 官方概念 | `presets/orchestrator-v2/`（插件自带 1 个）→ 同步到 `~/.dsh/.agent-presets/orchestrator-v2/` | 决定一个会话的插件组成、persona、工具集（Cordis 插件清单） |
| **派发方案** | dispatch profile，`profile` 字段取值 | 本插件私有概念 | `BUILTIN_SEEDS`（2 个内置）+ `~/.dsh/subagent-profiles.json` | 决定一次派发的 预设/模型/推理强度/工具/预算 捆绑 |

`presets/` 目录下**只有 1 个** Agent 预设：

```
presets/orchestrator-v2/
├── preset.yml          331B   { name, description } 两键
├── agent.cordis.yml   18KB    真正的 preset 主体（314 行 Cordis 插件清单）
├── tool-bootstrap.mjs 28KB    两阶段输入引导（梁神 V2 移植，非导出型工具实现）
├── custom-bash.mjs    9.8KB   win32 下补 `bash` 工具（Git Bash，保住 phase-1 锚点）
└── NOTICE              506B   许可与来源声明（改编自官方 Minimal/Standard + xiaobright/dsh-anchored-standard + dsh-liangshen）
```

`preset.yml` 全文只有两键（`presets/orchestrator-v2/preset.yml:1-2`）：`name: 编排者模式 V2` / `description: …两阶段引导…已适配当前 DSH 0.1.2+`。

`agent.cordis.yml` 的结构（字段语义，逐行精读归纳）：

| 元素 | 含义 | 示例/证据 |
|---|---|---|
| `- id:` | 条目 id（realm 内唯一） | `id: persona`（`:47`） |
| `name:` | 插件包名或**相对路径**文件 | `@deepseek-ai/dsh-persona`（`:48`）、`./tool-bootstrap.mjs`（`:70`）、`./custom-bash.mjs`（`:115`） |
| `config:` | 插件配置对象（各有各的 schema） | `tool-bootstrap` 的 11 个键（`:71-85`）：`shellTools/commonTools/messageSources/anchorGate/maxBootstrapSteps/promoteAfterFirstResponse/bootstrapMaxTokens/compactionTools/deferredSources/deferredGraceSteps/promotedPresentation/instructionHint` |
| `disabled:` | `!!js` 表达式，平台条件禁用 | `disabled: !!js process.platform === 'win32'`（`:102`，官方 `tool-bash`） |
| `cordis:group` + `group: true` + `isolate` | 服务行必须放进带 `isolate` 的 realm 组，避免发布成进程全局单例（注释 `:37-41`） | `name: cordis:group`（`:174/205/239`） |
| 工具行 `config` | 覆盖工具自身参数 | `str_replace_editor: maxOutputChars: 16000`（`:124-125`）、`tool-subagent: modelSelectionSettings: true`（`:255`） |

> 注：`layer` / `order` **不是** profile 字段（见 §2.2 表末说明）。

**Agent 预设的自安装**：`index.mjs:36-47` 的 `syncBundledPresetsToHome` 在每次启动把 `presets/` 树同步进 `~/.dsh/.agent-presets`；门控逻辑在 `presets-sync.mjs:198-231`（`synced` / `current` / `user-modified` 三态；用户改过的树**绝不覆盖**，两侧都变时先归档到 `.user-modified-<ts>/`）；`presets-sync.mjs:239-248` 还把旧名 `orchestrator` 目录改名归档（不删除）。幂等、每启动重跑、卸载时改名备份（`cleanup.mjs:11-17`）。

### 2.1 内置派发方案（只有 2 个）

`profiles-store.mjs:42-45`：

```js
export const BUILTIN_SEEDS = [
  { id:'swap-standard', name:'标准编码', description:'写代码与重构场景：切换到 standard 预设的完整编码工具集，适合多文件改动、修复与测试；当父会话不是 standard、但子任务需要完整编码能力时选用。', preset:'standard', tokenTier:'balanced', builtin:true },
  { id:'researcher', name:'调研检索', description:'调研与汇总场景：关闭深度推理省 token，继承父工具；适合查资料、检索、背景调研与只读分析，不适合改代码。', reasoningEffort:'off', persona:'You are a research subagent: search, read, and summarize only. Do not modify code or files.', tokenTier:'cheap', builtin:true }
];
```

- `swap-standard`：**换装**型（`preset: 'standard'`），均衡档。
- `researcher`：**降档**型（`reasoningEffort: 'off'` + 只读 persona），省 token 档。
- 二者都是 `builtin: true` → 可编辑、可删除（删除落墓碑）、可 `reset` / `reset-all` 回默认（`http-routes.mjs:302-320`）。

**本机实况**：`~/.dsh/subagent-profiles.json` **不存在** → 当前只有这 2 个内置方案在册（用户尚未持久化任何自建方案）。这也说明插件在「零配置」下即可用。

### 2.2 派发方案（profile）完整字段 schema

单一事实来源 = `pure.mjs:353-401` 的 `sanitizeProfile` + `pure.mjs:335-339` 的 `KNOWN_PROFILE_FIELDS` 白名单：

| 字段 | 类型 / 取值 | 默认 | 约束与失败行为 | 证据 |
|---|---|---|---|---|
| `id` | string（必填、非空、唯一） | — | 非空字符串；注册时重复即 throw | `pure.mjs:335-339`；`index.mjs:90-96` |
| `name` | string | 无 | 换行压平成空格（防提示注入，H1 修复） | `pure.mjs:124-132`、`:368-374` |
| `description` | string | 无 | **落库契约**：trim 后 ≥10 字符且**必须含场景词**（`DESCRIPTION_SCENARIO_WORDS` 19 个：查/调研/检索/汇总/代码/重构/修复/审查/只读/审计/生成/测试/翻译/编写/改/脚本/分析），否则 fail-loud（中文文案） | `profiles-store.mjs:48-59`、`pure.mjs:50-55` |
| `persona` | string | 无 | 长度上限 `PERSONA_MAX_CHARS = 2048`（**含**引导前缀 `'[guidance, not authority] '` 26 字符）；strict 超长拒绝写入，非 strict 保留原值+告警（绝不静默截断） | `pure.mjs:59-63`、`:135-158` |
| `preset` | string（Agent 预设 id） | 无 → `'inherit'` | 必须落在**运行时推导**的 system-trust 白名单；等于父 composed 预设时**改写为 `'inherit'`**（不无谓换装） | `dispatch-gates.mjs:19-25`、`whitelist.mjs:23-28` |
| `provider` | string | 无 → 继承父 | 必须在 `llm.listProviders()` 目录中已注册，否则 fail-loud | `cost-guard.mjs:44-50` |
| `model` | string | 无 → 继承父 | 必须在该 provider 的 `llm.listModels()` 目录中已发布，否则 fail-loud（空目录/无发现能力 adapter → 走 `allowFailOpen` 兼容门） | `cost-guard.mjs:59-82`、`:34-41` |
| `reasoningEffort` | string（档位 id） | 无 → `'(default)'` | 经 `llm.resolveCallConfig()` 实校验；不支持即 fail-loud（三层中文文案） | `cost-guard.mjs:85-92` |
| `enabled` | boolean | 隐式 true | `false` 时 `resolveProfile` 直接 throw（禁止派发） | `profiles-store.mjs:63-68` |
| `maxTokens` | number | 无 | 硬上限 `MAX_TOKENS = 65536`；超限写路径拒绝、运行时 `assertHardLimits` throw（**恒开，与 llm 无关**） | `pure.mjs:67`、`:75-82`、`:160-172` |
| `maxDepth` | number | 无 | 硬上限 `MAX_DEPTH = 3`；同上 | `pure.mjs:68` |
| `toolFilter` | `{ allow?: string[], deny?: string[] }` | 无 | 未知子键忽略；allow/deny 去重去空串；空对象则整字段不写入；**只减不增**（与父工具集求交，`run_code` 恒删） | `pure.mjs:174-196`、`intersection.mjs:14-23` |
| `tokenTier` | `'cheap'｜'balanced'｜'premium'` | **`'balanced'`（未提供时回填）** | 非法值剔除+告警；合法值影响目录排序（cheap-first）与预算闸判定 | `pure.mjs:198-209`、`:397-399`、`:407-411` |
| `builtin` | boolean | 无 | 内置种子标记：区分「可 reset 的内置」与用户方案；删除内置落墓碑 | `profiles-store.mjs:93-106`、`:166-168` |
| `deleted` | boolean | 无 | 仅出现在持久化墓碑条目 `{id, builtin:true, deleted:true}` | `profiles-store.mjs:93-99` |

**明确不存在的字段**（避免误读需求清单）：

- ❌ `layer`：只在**工具目录**里出现（`catalog-cache.mjs:137-141` 的 `layerOf()`：`global→plugin`、官方预设→`core`、其它→`custom`），profile 没有 `layer`。
- ❌ `order`：出现在 systemPrompt section（`index.mjs:188/194/203/210` 的 116.5/117/116.8/116.7）与客户端 slot（`client.js:5364-5386` 的 order 100/20/800/20），profile 没有 `order`。
- ❌ `profileKey` / `avgCost` / `successRate`：是**派生只读字段**（`profile-directory.mjs:55-72`、`profiles-query.mjs`），不是可写配置。

**安全设计（值得单独记一笔）**：`sanitizeProfile` 产出 `Object.create(null)` 且只复制白名单键 → 敌意的 `__proto__` / `constructor` / `prototype`（`JSON.parse` 可产出为 own 属性）被丢弃，不污染原型链（`pure.mjs:332-352`、`:355`）。

### 2.3 存储位置与格式（「常用组合存成命名方案」落在哪）

**主文件**：`~/.dsh/subagent-profiles.json`（`DSH_HOME` 环境变量优先，支持 `~` 展开；`profiles-store.mjs:23-32`、`:269`）

**v2 信封格式**（`profiles-store.mjs:155-181` 写出，`:70-79` 读取）：

```json
{
  "version": 2,
  "profiles": [
    { "id":"my-code", "name":"…", "description":"…", "preset":"standard",
      "provider":"…", "model":"…", "reasoningEffort":"…", "persona":"…",
      "toolFilter": {"allow":["read","edit"]}, "maxTokens":65536, "maxDepth":2,
      "tokenTier":"balanced", "enabled":true },
    { "id":"researcher", "builtin":true, "deleted":true }
  ],
  "allowFailOpen": false
}
```

- **v1 兼容**：裸数组（`classifyProfileFile` 判 v1）→ 内存迁移并把 `allowFailOpen` 置 true，warn「v1 数据：fail-open 兼容模式」（`profiles-store.mjs:73-79`、`:123-131`）。
- **原子写**：先写 `<file>.tmp` 再 `renameSync`（崩溃只留旧文件，绝不留截断文件）（`:170-180`）。
- **写失败**：不抛、不回滚内存 Map，返回 `{persisted:false,error}`；同时触发治理审计钩子（`:175-180`、`:280-285`）。
- **写入路径**：只有设置页 HTTP 路由 `POST /add`、`/remove`、`/reset`、`/set-profile-enabled` 会改写（`http-routes.mjs:241-333`）；`/add` 用 `strict: true`（超限/非法 → 400 拒绝整次写入，`:248-252`），与读取路径的宽松迁移口径分离（`pure.mjs:342-347`）。
- **启用态/开关**：`~/.dsh/subagent-profiles.state.json`（`profiles-store.mjs:270`），默认值与 fail-closed 语义见 §4.9。

---

## 3. dispatch 工具

### 3.1 完整入参 schema

单一事实来源 `dispatch-schema.mjs:13-57`（`DISPATCH_PARAMETERS`）。**恰好 15 个键**（`dispatch-schema.mjs:63` 的 `DISPATCH_PARAMETER_KEYS`，并被 percall-spec 测试锁定）：

| # | 字段 | 类型 | 必填 | 轴 | 含义 / 约束（原文精炼） |
|---|---|---|---|---|---|
| 1 | `profile` | string | ✗ | 容器选择 | profile 注册表 id（内建 `swap-standard`/`researcher` 或设置页自建）；**省略 → 该 subagent 原样继承父预设与工具集，不加配置覆盖**（`:28`） |
| 2 | `preset` | string | ✗ | 能力轴 | 目标预设**强制覆盖**；必须 system-trust 白名单内否则 fail-loud；与父 composed 相同时改写为 `inherit`（`:29`） |
| 3 | `model` | string | ✗ | 能力轴 | per-call **优先于 profile**；必须在该 provider 目录已发布否则 fail-loud（无发现能力空目录 adapter 按兼容开关决定）；遵循官方模型选择白名单（`:30`） |
| 4 | `provider` | string | ✗ | 能力轴 | 同上，必须已注册（`:31`） |
| 5 | `reasoningEffort` | string | ✗ | 预算轴 | **弃用别名**（请用官方名 `reasoning_effort`）；经 `resolveCallConfig` 校验；continuable 模式忽略（`:32`） |
| 6 | `reasoning_effort` | string | ✗ | 预算轴 | 官方字段名，与 #5 同义；**与 #5 同送即歧义 → fail-loud 拒绝，请二选一**（`:33`） |
| 7 | `tokenTier` | string enum `cheap｜balanced｜premium` | ✗ | 预算轴 | **估算口径、非计费**；覆盖 profile 的 tokenTier，缺省 balanced（`:34`） |
| 8 | `persona` | string | ✗ | 能力轴 | 覆盖子 Agent 部署 persona 段——**只 shadow order 0 的 persona 影子段，不进 descriptor**；per-call 优先于 profile（`:35`） |
| 9 | `toolFilter` | object `{allow?:string[], deny?:string[]}`，`additionalProperties:false` | ✗ | 能力轴 | 与父工具集求交，**只减不增**（`:36-47`） |
| 10 | `maxTokens` | number | ✗ | 预算轴 | per-call 优先于 profile；超 `MAX_TOKENS` fail-loud（`:48`） |
| 11 | `maxDepth` | number | ✗ | 防护 | 超 `MAX_DEPTH` fail-loud（`:49`） |
| 12 | `run_in_background` | boolean | ✗ | 模式 | 异步 one-shot，走 `jobs.start` 包 `start()`，返回 `jobId`；仍单轮即弃（`:50`） |
| 13 | `continuable` | boolean | ✗ | 模式 | 持久可续会话，立即返回 `subagentId`，后续经官方 `send_message` 延续；**与 `run_in_background` 同真时本字段优先**；**忽略 preset 换用与 reasoningEffort**（`:51`） |
| 14 | `envelope` | boolean | ✗ | 模式 | opt-in：true 时把信封骨架追加进子 persona（模型可见），子按结构化信封汇报；默认 false 走剪枝回收（`:52-55`） |
| 15 | `prompt` | string | **✓ required:true** | 任务文本 | 自包含任务（子看不到当前对话）（`:56`） |

**键集闭合的工程细节（很有借鉴价值）**：宿主 `dsh-tools` 的 DSL 对参数**默认拒绝未知键**，且参数级 `additionalProperties` 只接受 value-schema 对象、**不接受 boolean**，因此无法显式声明 `additionalProperties:false` → 改为用测试锁定「键集恰为 15 键」，并在决策轨迹侧用同一份 `DISPATCH_PARAMETER_KEYS` 把未知键记成 `unknown_keys`（fail-visible 而非静默吞）（`dispatch-schema.mjs:23-27`、`:59-63`、`decision-trace.mjs:97-101`）。

### 3.2 互斥 / 覆盖 / 优先级规则

**逐字段优先级（per-call > profile > parent > default）**，由三处协同实现：

1. **合并**：`mergeProfileArgs`（`dispatch-tool.mjs:29-37`）
   ```js
   const base = args.profile !== undefined ? store.resolveProfile(args.profile) : {};
   const merged = { ...base };
   for (const key of ['preset','model','provider','reasoningEffort','persona','toolFilter','maxTokens','maxDepth','tokenTier'])
     if (args[key] !== undefined) merged[key] = args[key];
   ```
   → **只有这 9 个键**可 per-call 覆盖（`envelope`/模式字段不进配置覆盖，见下）。
2. **生效值呈现**：`buildMeta`（`dispatch-tool.mjs:40-49`）——缺失时依次回落到 `parent.options.provider/model`，最后 `'(parent)'`；`preset` 缺失记 `'inherit'`；`reasoningEffort` 缺失记 `'(default)'`；`tokenTier` 缺失记 `'balanced'`。
3. **来源归因**：`effectiveModelSourceOf`（`decision-trace.mjs:134-139`）判定 `call`（per-call 显式）/`profile`（方案绑定）/`parent`（继承父）/`default`，写入 `trace.requested.source` 与派发台账 `effectiveModelSource`。

**互斥/否决规则表**：

| 规则 | 行为 | 证据 |
|---|---|---|
| `reasoningEffort` + `reasoning_effort` 同送 | **throw**（两义即歧义，绝不静默二选一） | `dispatch-schema.mjs:69-80` |
| `continuable` + `run_in_background` 同真 | **continuable 优先**，warn 提示 | `dispatch-tool.mjs:110-118` |
| `continuable` + `preset` 换用 / `reasoningEffort` | **忽略**（宿主请求面无对应字段），结果以 `ignored:['preset','reasoningEffort']` 回报，trace 的 `effective` 也按实际生效值记 | `dispatch-tool.mjs:119-125`、`:150`、`:152-155` |
| `preset` == 父 composed 预设 | 改写为 `'inherit'`（不换装） | `dispatch-gates.mjs:24` |
| 模式字段（`run_in_background`/`continuable`/`envelope`） | **不入配置覆盖**（是派发方式选择） | `dispatch-schema.mjs:20-21` |
| 前置校验顺序 | 禁用门 → 白名单 → 官方模型 → 成本 → 交集 → 审批 → 预算（**闸序固定，逐闸记 trace**） | `dispatch-tool.mjs:320-337` |

### 3.3 返回值结构

**闭合 `oneOf` 三分支**（`dispatch-schema.mjs:82-186`），判别键分别是 `kind:'background'`+`jobId` / `kind:'continuable'`+`subagentId` / `output`（前台）；三分支共享同一套元数据键集：`profile/preset/provider/model/reasoningEffort/tokenTier/imageText/childTotalTokens/childUsage/elapsedMs/stopReason/ignored/decisionTrace`。

- **一致性锁**：`assertResultSchemaConsistency`（`pure.mjs:290-330`）在 apply 阶段比对三分支「剔除判别键后的键集」，任一分支漏补/多余即 throw——防止未来加字段时某个分支被模型侧 schema 静默拒绝（`dispatch-tool.mjs:376` 调用点）。
- `childUsage` 五段分解：`inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens/reasoningTokens`（可选，无则省略）。
- `ignored`：continuable 恒为 `['preset','reasoningEffort']`，其余为空数组（`dispatch-tool.mjs:150`、`decision-trace.mjs:143-153`）。
- **render 行**（模型可见面，`dispatch-schema.mjs:206-234`）：`[dispatch] background job <id> · profile=… · preset=… · provider=… · model=… · reasoningEffort=…(ignored: …) · tokenTier=… · childTotalTokens=… · childUsage={…} · elapsedMs=… · stopReason=…` + 前台附 `\n\n<子输出>`。
- **`presentationMeta`**（客户端面，`dispatch-tool.mjs:364-368`）：把整个 `decisionTrace` + `imageText` 投影进会话块 meta，**不进模型可见面**。
- `imageText` 一句话画像：`方案 X；provider/model 或 继承父；档位 Y`（`dispatch-schema.mjs:191-200`）。
- **`stopReason` 枚举**：`completed｜max-tokens｜aborted｜refusal｜error`；映射自宿主 `toStopReason`（`pure.mjs:10-18`），非 completed 时 `stopReasonError()` 生成中文错误并附「Partial output」（`pure.mjs:21-38`）。
- `isConcurrencySafe: () => true`（`dispatch-tool.mjs:370`）。

### 3.4 `reasoningEffort` 与 `reasoning_effort` 双字段的歧义处理（完整链路）

1. **归一先于合并**：`mergeProfileArgs` 第一步就调 `normalizeReasoningEffort(args)`（`dispatch-tool.mjs:30`）。
2. **歧义即拒绝**：`snake !== undefined && camel !== undefined` → `throw 'dispatch: reasoning_effort 与 reasoningEffort 不得同送（两义即歧义，请二选一）'`（`dispatch-schema.mjs:73-75`）。
3. **归一方向**：只传官方名时 `{...args, reasoningEffort: snake}` 并 `delete reasoning_effort`——**下游只读 camel**（`:77-79`）。
4. **弃用声明**：camel 名的 description 标注「（弃用别名，请用 reasoning_effort）」，并注明「后续 major 移除」（`dispatch-schema.mjs:32`、`:68`）。
5. **台账双留**：`requestedOf` 同时记录内部键 `reasoningEffort`（归一口径）与官方键 `reasoning_effort`（调用方实际使用的名）——「同送两义时两值并留、交由 fail-loud 拒绝」（`decision-trace.mjs:102-114`）。
6. **continuable 的特殊处理**：即便归一成功，continuable 分支仍**忽略** effort 并把该项列入 `ignored`（`dispatch-tool.mjs:123-125`、`dispatch-schema.mjs:202-205`）。

---

## 4. 代码实现逻辑

### 4.1 注册面总览

**插件形态**：Cordis bundle 插件。`cordis.patch.yml:8-10` 往 profile roster 插入一行 `{id: subagent-profile, name: dsh-subagent-profile}`；`package.json:31-39` 声明 `dsh.bundle.patch` 与 `dsh.client = { inject: [], platform: 'web' }`（浏览器面由 `/plugins/<id>/client.js` 提供，见 `cordis.patch.yml:2-7` 注释）。

**宿主依赖注入**：`index.mjs:32` `export const inject = ['subagents','tools','agents']`；另在 `index.mjs:226` 用 `ctx.inject(['webServer'], scope => …)` 延迟注册 HTTP（webServer 的 activate 是异步的，可能晚于本插件依赖解析）。

**服务**：只 provide 一个窄接口（`index.mjs:88-113`）：

```js
ctx.provide('subagent-profiles', {
  register(profile)   // id 非空、唯一（重复即 throw）；返回退订函数
  get(id) / list() / resolve(id)
})
```
`list()` 返回 `store.profiles` 值数组；`resolve()` 走 `resolveProfile`（未知 id / 已禁用均 throw）。

**工具**（2 个，均带 `syncTool` 随 `enabled` 开关即时注册/注销）：

| 工具 | 作用 | 证据 |
|---|---|---|
| `dispatch` | 派发子任务 + 逐字段覆盖 + 四闸 + 台账 | `dispatch-tool.mjs:355-372`、`syncTool` 在 `:379-391` |
| `profiles_query` | 只读下钻档案明细（`id` / `tier` / `provider+model` 成对 / 无参全量） | `profiles-query.mjs:17-31`、`:144-177` |

**subagent provider**：`profile`（`profile-provider.mjs:244-250`）。

**系统提示 section（4 段）**：

| section | order | 门控 | 内容 | 证据 |
|---|---|---|---|---|
| `dispatch:profiles` | 116.5 | **能力判据**：`ctx.tools.schemas(agent)` 含 `dispatch` 才注入；schemas 不可用则按「注入机会」处理 | profile 目录（cheap-first，行格式 `- id: "描述" (tier: X)`）+ 一行 note（路由建议）+ 官方模型选择可见性行 | `index.mjs:186-190`、`profile-directory.mjs:132-143`、`model-policy.mjs:99-103` |
| `orchestrator:mode` | 117 | **模式判据**：`agentPresets.composedPreset(agentCtx) === 'orchestrator-v2'` | 编排者定位 + 官方报错的中文行动引导 | `index.mjs:131-148`、`:192-196`、`:153` |
| `dispatch:budget` | 116.7 | 同模式判据 + 必须有父 sessionId | 预算余量三态文案 | `index.mjs:208-217`、`dispatch-gates.mjs:176-182` |
| `evolution:advice` | 116.8 | **恒空（模型侧下架）** | `text: () => ''`；注册结构保留供客户端依赖其存在性 | `index.mjs:197-205` |

**HTTP 路由表**（`http-routes.mjs:362-397`，全部挂在 `webServer.register({kind:'prefix', path:'/subagent-profiles'})`，`:430`）：

| 方法 | 路径（前缀省略） | 作用 |
|---|---|---|
| GET | `/` `/list` | 方案列表 + 成本统计 + 建议 + 进化候选 + 冷启动状态（`:43-68`） |
| GET | `/options/summary` | enabled/建议开关/模型目录/预设名册/审计分级/逃生舱态/候选策略（`:71-85`） |
| GET | `/options/versions` | 三包版本探测 + 中文 warnings + 插件版本（`:102-105`） |
| GET | `/options/efforts?model=` | 该模型官方 reasoning efforts（`:88-93`） |
| GET | `/options/tools` | 完整工具目录（分组/中文名/来源/layer）（`:96-99`） |
| POST | `/options/refresh` | 清 catalog 缓存 + 重算聚合（`:107-111`） |
| GET | `/ledger/failures?session=` | 失败台账（每会话）（`:135-138`） |
| GET | `/ledger/jobs?session=` | 后台结算内存台账（`:140-144`） |
| GET | `/reminders` / POST `/reminders/ack` / POST `/reminders/action` | 提醒中心（列表/已读数/动作）（`:114-133`） |
| GET | `/drafts` / POST `/draft` `/draft/apply` `/draft/remove` `/draft/preview` | auto-profile 草稿域（`:146-186`） |
| GET | `/evolution/assets` / POST `/evolution/apply` `/evolution/rollback` `/evolution/regenerate` | 进化资产与候选写路径（`:378-381`） |
| POST | `/advice/save-profile` / `/settings/candidate` | 建议存方案 / 候选策略设置（`:382-383`） |
| GET | `/snapshots` `/snapshot` `/reminders/archived`；POST `/snapshots/set-enabled` `/maintenance/clean` | 数据维护域（`data-maintenance.mjs:132-137`） |
| POST | `/set-enabled` `/set-evolution-advice` `/set-escape` `/escape-add` `/escape-remove` | 开关与逃生舱（`:188-239`） |
| POST | `/add` `/remove` `/reset` `/reset-all` `/set-profile-enabled` | 方案 CRUD（`:241-333`） |
| — | 其它 | 404 `{ok:false,error:'未知路由 …'}`（`:396`） |

**暴露面守卫（两层）**：
- **loopback**：`LOOPBACKS = {127.0.0.1, ::1, ::ffff:127.0.0.1}`，非本机 → 403「仅限本机访问」（`http-routes.mjs:16`、`:404-405`）。
- **CSRF 三件套**（仅 POST，GET 只读不设防）：① `Origin` 主机名必须在本机白名单（含 `[::1]` 字面量）；② 强制 `Content-Type: application/json`；③ 必须带自定义头 `X-DSH-Plugin: dsh-subagent-profile`（逼 preflight，跨域表单无法携带非简单头）（`:18-23`、`:337-358`、`:409-419`）。
- 500 错误**不回显内部信息**（防泄漏），详情只进宿主日志（`:423-427`）。

**其他接入点**：`agent/disposed` 事件释放父会话记账 + 把未决采纳判「明确未采纳」（`index.mjs:78-83`）；`session/event` 驱动采纳判定（`index.mjs:61`）；卸载清理器改名备份 3 个数据文件 + `orchestrator-v2` 预设目录（`index.mjs:73-77`、`cleanup.mjs:11-17`）。

### 4.2 与 `@deepseek-ai/dsh-subagent` / `dsh-llm` 的对接点与 fail-loud 边界

**唯一 import 面**：`lib/core/shims.mjs`（注释 `:1-18` 明确「唯一 import index.mjs 依赖的 @deepseek-ai 符号的模块」）。两类失败策略截然分开：

| 类别 | 符号 | 加载方式 | 失败行为 |
|---|---|---|---|
| **守卫型（fail-loud，无回退）** | `assertSubagentMaxDepth`、`resolveChildDepth`（来自 `dsh-subagent`） | **静态 import**（`:24`） | 宿主 rc 改名/移除 → ESM 链接错误，**模块加载即失败**（绝不替换成弱化实现，子 Agent 永远不可能派发超过 MAX_DEPTH） |
| **函数映射型（fail-soft + warn）** | `foldConsumedWork`(dsh-agent)、`finalAssistantOutput`、`appendDelegatedPolicyOverrides`、`captureDelegatedPolicyOverrides`、`resolveChildAgentOptions`(dsh-subagent)、`createUserMessage`(dsh-llm)、`defineTool`(dsh-tools) | 顶层 `await Promise.all([loadSoft(...)])`（`:152-160`），`loadSoft` 校验「导出存在且是函数」（`:42-53`） | 降级到本地功能等价/安全降级实现 + `console.warn`（模块顶层无 ctx 故无 logger）；`__fallbacks` 导出供测试走降级路径（`:268-276`） |

`defineTool` 的回退是**在调用点 fail-loud**（`shims.mjs:145-147`：`throw new Error('dsh-tools 缺失：dispatch 工具不可用')`）——「加载不崩溃，调用点才报错」。

**目录解析（llm 侧）**：

- 一次快照收集：`llm.listProviders()` → 逐 provider `llm.listModels(id)` → 逐 model `llm.resolveModelInfo(provider, model)` 取 `reasoning.efforts`（`catalog-cache.mjs:70-112`）。
- 进程级 TTL 缓存：默认 **60s**（`catalog-cache.mjs:20`），按 llm 实例分键、同 key 在途 Promise 去重、hit/miss 计数走 logger（`:189-273`）；**目录错误态不缓存**（`providersError` 时删除条目，让瞬时故障更快自愈，`:235-239`）。
- 同一快照同时喂 `/options` 三路由与 dispatch 的 cost guard（`index.mjs:259-269` 注释；cost guard 传父实例作 key，同一 host llm 命中同条目）。

**fail-loud 清单（会直接 throw 的边界）**：

| 场景 | 文案要点 | 证据 |
|---|---|---|
| 未知/已禁用 profile | 「未知 profile "x"（可在设置页…确认可用的 id）」 | `profiles-store.mjs:63-68` |
| 预设不在 system-trust 白名单 | 「预设 "x" 不在 system-trust 白名单」 | `dispatch-gates.mjs:21-22` |
| provider 未注册 | 「provider "x" 未注册（不在当前 provider 目录中…）」 | `cost-guard.mjs:47-49` |
| 模型不在目录 | 「模型 "x" 不在 provider "y" 的目录中…」 | `cost-guard.mjs:79-81` |
| 目录查询抛错 | 「无法校验模型 "x"：provider 目录查询失败（…）」 | `cost-guard.mjs:74-76` |
| reasoningEffort 不支持 | 「不受 provider "p" 的模型 "m" 支持（…）」 | `cost-guard.mjs:89-91` |
| llm 缺失/目录空且 fail-loud | 「模型能力不可验证：fail-loud 拒绝（可在配置中显式开启兼容模式）」 | `cost-guard.mjs:35-41` |
| maxTokens/maxDepth 超限 | 「maxTokens N 超过委派上限 65536」/「maxDepth N 超过委派上限 3」 | `pure.mjs:75-82` |
| 工具交集为空 | 「子工具交集为空（…可放宽过滤器后重试）」 | `profile-provider.mjs:186-188` |
| continuable 工具集为空 | 「continuable 工具集为空，拒绝派发」 | `pure.mjs:104-107` |
| 并发/token 到顶 | 「并发派发数已达上限 8…」/「本会话累计派发 token 已达上限 200000…」 | `dispatch-gates.mjs:224-236` |
| 预算低位封顶 | 「预算不足：当前可用最高档=cheap…」 | `dispatch-gates.mjs:200` |
| 官方模型白名单越界 | 三层中文文案（事实+同策略+行动路径） | `model-policy.mjs:21-29` |
| 后台缺 jobs | 「后台派发不可用：缺少 jobs 服务（请安装 @deepseek-ai/dsh-jobs 与 dsh-tool-jobs…）」 | `dispatch-tool.mjs:166-169` |
| continuable 禁用态 | 「插件已禁用（设置 → 子 Agent 方案 重新启用）」 | `dispatch-tool.mjs:113-115`、`dispatch-gates.mjs:131-135` |
| 无预设名册却要求换装 | 「无法在无预设名册的部署中切换预设…」 | `profile-provider.mjs:134-136` |

**反向的 fail-soft 纪律**（同样重要）：目录为空且 `allowFailOpen=true` 时 warn 跳过（v1 迁移兼容）；剪枝器缺失时回退为不剪（`pure.mjs:232-242`）；台账/快照/提醒写失败只 warn + 计数，绝不阻断派发（`evolution-ledger.mjs:333-356`）。

**版本探测**：读三包 `package.json` version，与 `>=0.1.0-rc.6 <0.2.0` 比对，产出中文 warnings（`shims.mjs:180-264`），设置页顶部渲染 amber 提示条，**不阻断派发**。

### 4.3 与 LLM 的「模型目录」交互：官方面与本地面的分工

- **本地面（本插件权威闸）**：`provider` 必须在目录；`model` 必须在目录（空目录无法核验 → 兼容门）；`reasoningEffort` 走 `resolveCallConfig` 实校验（`cost-guard.mjs:111-149`）。
- **官方面（`subagentModelSelectionPolicy` 投影）**：`readModelSelectionPolicy` 从 `sessionProjections.stateOf(session, 'subagentModelSelectionPolicy')` 读取（key 字符串与官方同源，`model-policy.mjs:16-17`）；投影未配置/未固化 → `{configured:false}` 静默跳过（行为与 0.4.0 一致）；投影存在但形状畸形 → **fail-loud**（照官方 `assertAllowedModelRoutes` 语义校验，`:33-52`）；生效路由（解析链完成后的最终 provider/model，**含继承带出**）与 `allowedModels` 精确成对匹配（`:73-77`）。驳回时写治理审计 `official-model-reject` + 闸快照（`dispatch-gates.mjs:42-70`）。
- **可见性提示**：`dispatch:profiles` 段尾追加一行——已启用则列出允许清单，未启用则提示「无官方发现工具；授权路由请用 profiles_query 查看在册状态」（`model-policy.mjs:83-97`）。

### 4.4 演进引擎（evolution）——这是什么机制

**定位**：把「派发台账」变成「可执行的改进建议」，并给每次改进配**人工确认 + 观察期金丝雀 + 可回滚**的闭环。核心纪律：**绝不自动改配置**（`evolution-engine.mjs:116` 注释：「应用写路径（受控路由专用；绝不自动落写）」）。

**六层流水线**：

| 层 | 机制 | 数据/位置 | 证据 |
|---|---|---|---|
| ① 观测（采集） | 每次派发追加 1 行 JSONL；**只 append，绝不改写**；含双栏 `requested`/`effective` 配置（捕捉「请求了但被宿主丢弃」的失真）、`task.len` + 结构指纹（长度+换行数+sha1前8）、`outcome`（status/stop_reason/elapsed_ms/output_len/tool_count/tokens/usage 五段） | `~/.dsh/subagent-evolution/dispatch.jsonl` | `evolution-ledger.mjs:1-21`、`:64-112`、`:151-174`、`:333-356` |
| ② 聚合（确定性双层） | L1 = 生效配置重建的**身份键**（`preset:`/`provider:`/`model:`/`persona:1`/`toolFilter:1`，**预算轴不入 L1**，纯 effort/无配置落 `(inline)`）；L2 = 各轴交叉（`:model:`/`:preset:`/`:reasoningEffort:`/`:maxTokens:` 后缀键）。指标：`deployments_total`、`outcome{completed,failed,killed}`、`score.weighted_success`、`perf`、`cost`、`confidence` | `~/.dsh/subagent-evolution/summaries.json`（带版本号，损坏自动重建） | `evolution-summary.mjs:41-60`、`:189`、`:216`；`evolution-advice.mjs:11-13` |
| ③ 表现分公式 | `weighted_success = max(0, completed − 0.3·confirmedFalse) / (completed+failed+killed)`，3 位小数；`unknown`（未决）**不惩罚** | 同上 | `evolution-summary.mjs:9-19` |
| ④ 建议生成（确定性纯函数） | **四条件齐备**才产出：`N ≥ minN`、`weighted_success` 低于阈值（表现不佳才建议）、置信度达标（low/medium/high，阈值 3/10）、cooldown 未过期。方向硬规则：**能力轴只建议「降」，预算轴可建议「升」**，无法定位安全轴则「平」 | 只读台账 → 面板数据 | `evolution-advice.mjs:16-21`、`:65-69`、`evolution-summary.mjs:35-39` |
| ⑤ 候选（≤3 条互斥） | 一条建议 → 最多 3 条互斥候选；逐候选**过三道闸**（whitelist → cost → intersection，approval 恒 `never`）才落资产；总护栏 20 条；更新策略 `auto`（到期且数据显著变化才换代，留审计）或 `manual`（不自动换代/过期，只经人工「重新生成候选」）；候选有效期 `candidateTtlH`（0=不过期，1~8760 小时） | `~/.dsh/subagent-evolution/assets/` | `evolution-engine.mjs:79-93`、`evolution-generate.mjs:11`、`:97-151`、`evolution-renewal.mjs:11-13` |
| ⑥ 采纳追踪（parent_adopted 三态） | 用 `session/event` + `decisionTrace.execution` 锚点判定父 Agent 是否采纳子结果：窗口 **N=3 轮 或 T=10 分钟**；`adoptedAt` 有值→`true`（引用 childId/jobId **或复用子输出内容**，≥40 字符，`outputSnippet` 仅内存）；窗口外未引用→`false`；窗口内无信号→`unknown`。已确认 false 计 −0.3 惩罚，经 `confirmedFalseCounts()` 惰性 join 进聚合（**不写回 append-only 台账**）。「明确未采纳」还会 mint 一条 P2 提醒 | `~/.dsh/subagent-evolution/adopted-state.json` | `adoption-tracker.mjs:1-31`、`:55-95`、`index.mjs:54-64` |
| ⑦ 金丝雀（防退化） | apply 时**冻结基线**（聚合均值 + 最近 ≤100 条逐条分）与**完整配置快照**（回滚依据）；观察期 **K=5** 次相关派发后判定；判据 = 跌破「均值 − 1 标准差」；最少样本 `CANARY_MIN_N=3`；24h 无新派发→`stalled`（延期不误判）；观察期内同键**禁止再次应用**（观察期隔离）；用户手改方案→`aborted-human-edit`。判定**只读台账、不产生派发**；跌破基线只产出**只读回滚建议挂面板**，回滚必须 `human_confirmed`，并写 `suggestion-rollback` 审计 | 资产文件内 `canary` 段 | `evolution-canary.mjs:1-25`、`:47-66`、`evolution-engine.mjs:263-273` |
| ⑧ 提醒与审计 | 一条提醒 = 一条治理审计记录；P0 三要件（红、常驻至已读、带 session 标识）；写失败计 `lostTelemetry`/`lostGovernance`，health 置 `degraded` 并持久化（重启仍 degraded，直到一次成功文件写才恢复 ok） | `reminders.json`（上限 200）+ `governance-audit.jsonl` + `ledger.meta.json` | `reminder-store.mjs:1-16`、`evolution-ledger.mjs:176-284`、`:358-407` |

**注意一个重要的「下架」事实**：`evolution:advice` 系统提示段**恒空**（`index.mjs:197-205` 注释说明：建议文本曾注入模型可见面却自称「仅供人类参考」——噪声 + 诱导降档，故撤下；注册结构保留，人类面板数据源不变）。因此**模型侧看不到优化建议**，建议只服务人类 UI 与候选生成。

**实盘证据（本机）**：`~/.dsh/subagent-evolution/` 现存 `dispatch.jsonl`（3 条，`provenance: dispatch:v0.3.4`）、`summaries.json`(13KB)、`adopted-state.json`(3KB)、`reminders.json`(3.4KB)、`governance-audit.jsonl`（6 条，其中 3 条 `adoption-false` + 3 条 `reminder-created` P2）。说明该闭环在本机真实跑通过（旧版本 0.3.4 时期）。

### 4.5 决策台账（decision trace）——记录什么、存哪、如何回放

**结构**（`createDecisionTrace`，`decision-trace.mjs:48-59`）：

```
{ version:1, startedAt,
  parentContext: { parentPreset, parentProvider, parentModel, parentToolCount, allowFailOpen },
  requested:     { profile, preset, provider, model, reasoningEffort, reasoning_effort?,
                   tokenTier, persona_present, toolFilter_present, maxTokens, maxDepth,
                   envelope, advice_present, prompt_excerpt(≤200字), prompt_truncated?,
                   profiles_snapshot?(≤6 条×≤80 字), unknown_keys? , source },
  gates:         [ {name, input, output, verdict, reason?} … ],
  effective:     { profile, preset, provider, model, reasoningEffort, tokenTier, ignored[] },
  execution:     { kind, parentSessionId, childSessionId|jobId, mode },
  settled:       { stopReason, elapsedMs, childTotalTokens?, childUsage?, calls? } }
```

**六道闸**（顺序固定，pass/fail 均记）：`whitelist` → `official-model`（投影已配置时才出现）→ `cost`（含 `modelEfforts` 快照：该模型当时可选哪些档位）→ `intersection`（前/后台记 `deferred`，continuable 记闭集 allow + 移除清单）→ `approval`（声明性不变量，恒 `never`）→ `budget`（并发/token/低位封顶）。

**隐私红线**：`prompt` 原文**绝不进 trace**，只存 ≤200 字符摘要 + 截断标记；persona 只存 present 布尔，toolFilter 只存 present（`decision-trace.mjs:88-92`、`:116-117`）；派发 label 用 prompt 的 sha1 前 8 位代替原文前缀（`pure.mjs:271-288`）。

**体积护栏**：单条 trace JSON ≤ `MAX_TRACE_BYTES = 4096`；六级逐步收敛：① 截 `detail/reason` 至 200 字符 → ② 截 cost `checks` 至 6 条 → ③ 截 `settled.calls` 至 4 条 → ④ 整体丢 `detail` 字段 → ⑤ 截全树任意超长字符串 → ⑥ 丢 `settled`、再逐道丢最旧闸（恒收敛，**绝不 return 超限 trace**）；名单类数组在 `recordGate` 阶段就截前 8 项并打 `truncated:true`（`decision-trace.mjs:24-28`、`:33-44`、`:284-317`）。

**存放与回放（两条通道）**：

1. **会话块通道（主通道）**：trace 经 `output.presentationMeta` 投影进 dispatch 工具调用块的 meta（`dispatch-tool.mjs:364-368`）→ 客户端「派发决策台账」标签页读取当前会话的工具调用块，渲染「请求 vs 生效」对照、五道安全检查徽标、工具集交集、成本分解、因果链时间线（`client.js:499-606` 的 ZH 文案表即该页面的字段清单）。后台派发的 `settled` 无法回写已返回的块 → 用**内存台账**按 `sessionId → jobId → settled` 兜底，客户端按 jobId join（`background-ledger.mjs:1-5`、`:34-69`；路由 `GET /ledger/jobs`）。
2. **失败台账通道**：`recordFailure` 把失败 trace 写进 `createFailureLedger`（每会话上限 50、总量 500，超限丢最旧 + warn），可持久化到 `~/.dsh/subagent-profiles.failed-traces.json`（原子写，形状 `{version:1,sessions:{…}}`，加载时元素级守卫丢弃畸形条目）（`decision-trace.mjs:319-432`、`index.mjs:362`）；经 `GET /ledger/failures?session=` 读取。

「回放」= 客户端标签页按会话读取会话块 meta + `loadOlder()` 翻页（`client.js:5376-5386` 的 `conversation.view` slot，`inject: (sessionId) => ({ loadOlder })`），无独立的「重放引擎」——**未确认**存在服务端 trace 回放器。

### 4.6 安全检查的实现方式（四闸 + 一道模式门）

| 闸 | 判定 | 实现 | 证据 |
|---|---|---|---|
| 白名单闸 | 显式 preset ∈（运行时 system-trust 名单 ∪ 逃生舱放行集）；等于父 composed → 改写 `inherit` | `resolveWhitelist`（`agentPresets.list()` 过滤 `trust==='system'`，无名册回退 `['standard','code','minimal']`）+ 逃生舱只叠加 | `whitelist.mjs:10-28`、`dispatch-gates.mjs:19-38` |
| 官方模型闸 | 投影已配置时，**生效路由**（含继承）与 allowedModels 成对匹配 | 见 §4.3 | `dispatch-gates.mjs:56-83` |
| 成本闸 | ① 硬上限（`maxTokens≤65536`、`maxDepth≤3`，**与 llm 无关恒开**）；② provider 注册；③ model 在目录；④ effort 受支持 | `assertCostGuard` + `hardLimitChecks` 预判条目 | `cost-guard.mjs:111-149`、`pure.mjs:70-82`、`dispatch-gates.mjs:103-125` |
| 工具交集闸 | 前台/后台：**由宿主在子会话启动时算** `parent ∩ child − run_code − deny (− allow 收窄)`，插件记 `deferred`；continuable：插件预加工**闭集 allow**（同一结果既进 request 又进 trace），空集 fail-loud | `computeEffectiveAllow`（真实交集）/ `computeContinuableAllow`（闭集近似，两者不得合并，注释 `intersection.mjs:6-11`） | `intersection.mjs:14-23`、`pure.mjs:91-109`、`dispatch-gates.mjs:141-160`、`profile-provider.mjs:180-196` |
| 预算闸 | 两级：① **低位封顶**（余量 <15% 且请求档位超出 cheap → fail-loud，**在 acquire 之前**，不占并发槽）；② acquire（并发上限 **8**、每父累计 token 上限 **200000**，拒绝时给出可行动中文文案）；通过也记 pass（无父 sessionId 时记 `skipped`） | `dispatch-guard.mjs` | `dispatch-gates.mjs:162-257`、`dispatch-guard.mjs:14`、`:31-55` |
| 模式门 | continuable 专属「禁用不得静默派生子树」显式检查（provider `start` 的 `!enabled` 只拦 `start` 不拦 `startContinuable`） | `assertContinuableEnabled` | `dispatch-gates.mjs:127-135` |

**额外安全设计**：

- **审批不豁免**：委派时捕获父的沙箱覆盖 + **审批策略钉 `'never'`**（有 approval 服务时），写入子会话日志供重建（`shims.mjs:117-124`、`:107-115`）；同时 `DELEGATION_CONTEXT` 文本注入子会话，明确告知「权限范围在启动时固定、无法从会话内部放宽、需要审批的操作自动拒绝」（`delegation.mjs:187`）。
- **信任标注**：completed 子结果回灌父上下文前加结构化前缀 `[dispatch:trusted-output] profile=… preset=…`（让父不把子输出当高信任指令），审计同字段 JSON 只进 logger、不含子输出原文（`pure.mjs:244-269`、`dispatch-tool.mjs:264-267`）。
- **逃生舱**（默认关）：放行非 system-trust 预设需显式 opt-in + 逐成员入集；成员只在「其余各闸全过」时放行；每次放行写高可见治理审计 + mint P0 紧急提醒；开关关时 `getEscapeSet()` 恒返回空数组（零叠加、零放行审计）（`escape.mjs:103-129`、`index.mjs:282-298`）。
- **结果剪枝**：默认复用宿主 `toolResultPruner.pruneContent` 预剪（纯函数、零 LLM），pruner 缺失时回退为不剪（增强而非硬依赖）（`pure.mjs:211-242`、`dispatch-tool.mjs:332-333`）。

### 4.7 成本估算与节省分析

**两级计价（`prices.mjs`，纯数据，来源标注为 2026-08-24 实测）**：

- **A 级：单次均价**（元/次）：`deepseek-v4-flash 0.0039`、`deepseek-v4-pro 0.0104`（`prices.mjs:7-10`）。
- **B 级：五段单价**（元/千 token）：结构已留（input/output/cacheRead/cacheWrite/reasoning），但当前**五段全为 null**（只有 `avgCost` 占位），注释说明「保留键结构供未来实测回填」（`prices.mjs:12-31`）。
- **模型名归一**：`priceKeyFor` 支持别名/前缀（含 `flash` → flash、含 `pro` → pro），未知返回 `undefined`（**fail-soft 不猜价**）（`prices.mjs:33-41`）。

**计算**：`dispatchCost` 优先 B 级逐段计价，否则回退 A 级均价，都缺则 `undefined`（`cost-evidence.mjs:12-38`）。

**反事实对照（核心洞见）**：判定必须读 `trace.requested.model` 而**不能读 `effective.model`**（因为 `buildMeta` 会把继承的父模型名写进 effective，无法区分「继承父」与「显式选 pro」，`cost-evidence.mjs:1-4`）：

- 未指定 model（继承父）→ `saving = 0` 且打 `inherit: true` 标，让「根因①：根本没指定模型」在面板上可见（`:47-57`）。
- 显式指定 → `saving = counterfactual(父模型) − actual(指定模型)`，`ratio = 父/指定`（`:58-71`）。
- 聚合 `summarizeCosts` 输出 `estimated_cost / estimated_inherit_cost / estimated_saving / priced / inherit_count / inherit_ratio`（`:74-99`），再由 `costSummaryFromSummaries` 从 `summaries.json` 汇总全局 + 按模型拆分（`:104-145`）。

**UI 呈现**：设置页「全局成本」卡片显示「全部会话估算≈X 元 · 继承父会话成本≈Y 元 · 节省≈Z 元 · 可计价 N 次 · 继承占比 P%」（文案与实测截图 OCR 一致）；台账页有「若继承父会话」对照与「省」徽标（`client.js:558-561`）。README 明确标注**成本是估算、按每次派发均价计算（每模型实测一次），按 token 精细计价在路线图**（`README.zh.md:113`）。

### 4.8 客户端 API 面（供参考）

`client.js:906-917`：所有数据操作走 `fetch('/subagent-profiles' + path, init)`，即宿主侧 loopback HTTP——**浏览器面本身不持久化、不判定**，纯展示 + 表单上行。

### 4.9 状态与开关（fail-closed 语义）

`~/.dsh/subagent-profiles.state.json` 单一文件承载 7 个开关（`profiles-store.mjs:183-222`）：

| 键 | 默认 | 作用 |
|---|---|---|
| `enabled` | **true** | 派发工具 + `profiles_query` 注册开关（关 → 注销工具 + 级联取消在途 + 清记账） |
| `evolutionAdvice` | false | 建议链开关（**与建议面板/候选生成同生共死**；模型侧注入已下架） |
| `escapeEnabled` | false | 逃生舱（信任底板，需显式 opt-in） |
| `applyEnabled` | false | 进化候选**应用写路径**（只由人显式开启；不门生成） |
| `candidateMode` | `'auto'` | 候选更新策略（auto/manual） |
| `candidateTtlH` | `24` | 候选有效期（0 或 1~8760 小时，坏值归一 24） |
| `snapshotEnabled` | false | 派发配置快照（本机私有域，含 persona 原文） |

**损坏文件 fail-closed**：`state.json` 解析失败 → 全部开关置关（绝不静默回退 `enabled:true`，否则「安全禁用」会被撤销）+ warn（`:214-221`）。

---

## 5. UI 呈现

**两个面**（`cordis.patch.yml:2-7` 注释即官方口径：宿主面 `exports "."` + 浏览器面 `exports "./client"`，服务在 `/plugins/<id>/client.js`）。

浏览器面是**手写 `__ModuleLoader__` 工厂、无构建步骤**（`client.js:5-19`），并非「编译产物」——5391 行可读源码，React 来自共享模块宿主，slot 经共享 `slots` 服务注册。

### 5.1 五个 slot（注册面完整清单，`client.js:5363-5386`）

| slot | key/id | order | 组件 | 形态 |
|---|---|---|---|---|
| `tool.call.toolview` | key `dispatch` | — | `DispatchToolview` | dispatch 工具调用卡片（只读） |
| `settings.section` | id `subagent-profiles` | 100 | `ProfilesSection` | **设置页「子 Agent 方案」**（含提醒中心、数据维护、全局成本） |
| `conversation.session.header.utilities` | id `…-subagent` | 20 | `SubagentHeaderUtility` | 子会话页头紧凑标签（悬停看全部字段） |
| `shell.overlay` | id `…-reminders` | 800 | `ReminderOverlayBadge` | 右上角 P0 常驻红角标 |
| `conversation.view` | id `dispatch-ledger` | 20 | `DispatchLedgerView` | **每会话「派发决策台账」标签页** |

模块还 `inject = ['slots','sessions']`（`client.js:5349`），`sessions.openSubagent(address)` 提供子会话跳转（`:5358`）。

### 5.2 设置页面结构（截图 + 代码交叉验证）

来自 `docs/screenshots/settings-page1.png` / `settings-page2.png` 的 OCR，与 `client.js` 的 `ZH` 文案表（`:407-606`）及 `EMPTY_FORM`（`:815`）一致：

- **状态条**：已启用 / 健康 ✅ 审计丢失 0 条。
- **方案管理**（每行一张带边框卡片）：名称 + `内置`/`已启用` 徽标 + 成本与成功率 + 「编辑」「删除」；展开显示 `预设 / 模型 / 推理强度 / 档位`。
- **新增/编辑表单**（`EMPTY_FORM` 明确字段集）：
  `id, description, preset, provider（由模型联动，只读）, model, reasoningEffort, tokenTier, toolMode(不限制/白名单/黑名单), toolList`
  → 工具限制面板按来源分组（核心预设 33 / 文件 6 / 终端 1 / 网络 1 / 任务 4…），带 `全选/清空/反选`（OCR + `client.js:2910-2957`）。
- **明确不在表单里的字段**：`persona`、`maxTokens`、`maxDepth`（表单 schema 无这些键）→ 只能经 `POST /add` 直接写 JSON，或手改 `subagent-profiles.json`。**这是一个可用性缺口**（见 §8）。
- **全局成本卡片**：估算/继承父成本/节省/可计价次数/继承占比（OCR 实测：`≈0.0832 元 · 节省≈0 元 · 可计价 13 次 · 继承占比 100%`）。
- 其它区：版本告警条、逃生舱开关、候选策略、数据维护（快照/候选/提醒/统计清理，`data-maintenance.mjs`）。

### 5.3 dispatch 工具卡片与台账

**卡片**（`docs/screenshots/dispatch-card.png` OCR，与 `makeDispatchToolview` 一致）：

- 派发链状态机徽标：`发起 → 检查通过 → 创建 → 执行中 → 完成`（`ZH.phaseInitiate/phaseGuards/phaseCreate/phaseRun/phaseDone`，`client.js:434-441`）。
- 字段芯片（chip 族）：`方案 / 预设 / 提供方·模型 / 推理强度 / 档位（估算口径）`。
- 安全检查行：`安全检查 ✅` 或 `安全检查 ❌ 未通过（<闸名>）`；工具集行：`工具由系统最终授予` 或 `白名单 X ∩ 父会话 Y → 实得 Z · 移除 N 个`（含「安全策略：子代理不执行代码」逐项原因）。
- 成本行：`派发子Agent · 后台任务 #subagent-1 · 估算成本≈0.0104元 · 继承父会话模型`；操作按钮「存为方案」（把该次派发配置存成 draft → 过闸落库）。

**台账标签页**（三层信息架构：折叠态 / 结论层 / 证据层，文案表 `client.js:499-606`）：

- 结论层：`✅ 成功 / ❌ 拒绝 / 🔄 执行中 / ⚠ 异常`、安全检查徽标（`安全检查 ✅ 5/5 通过` 或定位失败闸名 + 修复方向）、`⚠ 干预 {n} 次`。
- 「请求 vs 生效」对照表（差异项琥珀底行；`请求全部生效 ✓`；`请求了 X，未生效（被忽略）`）。
- 工具集公式与移除原因表、逐次调用明细（`合计` / `仅显示前 N 条，共 M 次调用`）。
- 决策时间线：`① 发起 → ② 决策·生效值 → ③ 执行 → ④ 结算`；执行期事件含 `停滞 {s}s 无活动（超过 {t}s 上限）` 与 `主 agent 干预`（`ledgerEventStall/Intervene`）。
- 成本分解 + `若继承父会话` 对照 + `省` 徽标；已有可见的「本会话口径」说明。
- 原始 JSON / 字段视图切换；子会话/后台任务 id 可点击跳转。

### 5.4 拟人化 / 徽章元素（用户问到的点）

**没有拟人化形象**（无头像、无人格化吉祥物）：`grep` 全文件未见 avatar/人物形象组件；风格是**官方「模型」设置节的设计 token 对齐**（`client.js:10-11`：`var(--dsw-alias-*)` 一套 token）。

**徽章/角标密集**（这部分确实是「徽章元素」）：

| 元素 | 形态 | 证据 |
|---|---|---|
| header 标签 | 虚线边框 chip：`继承父会话 · 前台` / `持久` / `来源：由父会话派发`，`max-width:260px` 截断 + `cursor:help` 悬停显示全字段 | `client.js:30-31`、`ZH.bannerInheritValue/bannerModePersistent/bannerOriginTitle`（`:431-433`） |
| 链路 phase 徽标 | 5 段着色（done 绿 / fail 红 / running 琥珀） | `client.js:32-36`、`:434-441` |
| 安全检查徽标 | `sap-ledgerBadgeOk/Fail/Warn` 三态边框+文字色 | `client.js:271-274`、`:4616-4627` |
| P0 常驻红角标 | 固定右上角（`z-index:9000`）红底白字按钮 `⚠ 紧急 {n}` + 展开面板 | `client.js:53-56`、`:1793-1819` |
| 提醒分级 | `sap-reminderP0/P1/Unread` 三档配色（P0 错误色、P1 琥珀、未读加边框） | `client.js:37-39` |
| 状态/档位文案 | `✅ 成功 / ❌ 拒绝 / 🔄 执行中 / ⚠ 异常`、`省 token（cheap） / 均衡（balanced） / 高成本（premium）` | `client.js:545-548`、`:486` |

---

## 6. 审批与权限

### 6.1 需要用户批准的动作（明面清单）

| 动作 | 批准方式 | 证据 |
|---|---|---|
| **进化候选 apply（会写新方案）** | 必须 `human_confirmed === true`，否则拒绝并写审计；另有 apply 开关（默认关）门 | `evolution-engine.mjs:145-162`、`:246-252` |
| **回滚（撤销已确认的应用）** | 同样必须 `human_confirmed`；**绝不自动回滚** | `evolution-canary.mjs:1-9`、`evolution-engine.mjs:254-261` |
| **逃生舱放行非 system-trust 预设** | 需开关 opt-in + 逐成员加入；每次放行留审计 + P0 提醒 | `index.mjs:282-298`、`escape.mjs:103-117` |
| **开启派发配置快照**（会落 persona 原文到本机私有域） | 显式 opt-in，默认关；文案明确「数据仅存您本机」 | `profiles-store.mjs:191`、`client.js:469` |
| **设置页写操作** | loopback + CSRF 三件套（Origin/Content-Type/自定义头） | `http-routes.mjs:337-358` |
| **删除/重置方案、清理数据** | UI 确认弹窗（`maintenanceConfirm: '确认要执行「{zone}」吗？清理操作会留下记录。'`）+ 每次清理留审计 | `client.js:482`、`data-maintenance.mjs` |

### 6.2 「审批永不豁免」与 fail-loud 的边界（核心不变量）

- **委派不豁免宿主审批要求**：有 approval 服务时**强制钉 `approvalPolicy: 'never'`** 写进子会话日志（`shims.mjs:117-124`）；`recordApprovalGate` 把这条**声明性不变量**记进 trace（`decision-trace.mjs:166-176`），闸名 `approval` 恒 `pass`（因为不是运行时判定，而是启动时固定的权限范围）。README 口径：「需要审批的操作自动拒绝」（`README.zh.md:79-80`），与 `DELEGATION_CONTEXT` 注入文本一致（`delegation.mjs:187`）。
- **工具只减不增**：子工具集 = 父 ∩ 子 − `run_code` − deny（− allow 收窄）；空集 fail-loud（`intersection.mjs:14-23`、`profile-provider.mjs:186-194`）。
- **fail-loud 边界**：凡「无法核验 / 越界 / 歧义 / 空集」一律 throw 中文可行动错误，**绝不静默降级或二选一**；唯二例外是显式声明的兼容门（`allowFailOpen`，v1 数据迁移）与「增强型」能力（剪枝器、目录快照、统计），后者缺失只 warn。
- **continuable 的保守假设**：continuable 继承父预设 ⇒ 假设子工具集 ≈ 父工具集，故把 allow 预加工为闭集；**一旦假设失效**（宿主行为变化导致父集含子集不存在的工具），`tools.restrict` 会抛「未知工具」→ 自动降级为 fail-loud，绝不静默放行（`dispatch-tool.mjs:81-88`、`README.zh.md:110-112`）。

---

## 7. 兼容性与工程化

### 7.1 peerDependencies 与运行时要求

| 项 | 值 | 证据 |
|---|---|---|
| peerDeps | `@deepseek-ai/dsh-agent / dsh-llm / dsh-subagent / dsh-tools`，范围 **`>=0.1.0-rc.6 <0.2.0`**，且**全部 optional: true** | `package.json:40-59` |
| devDeps 实测版本 | 上述四包 `0.1.0-rc.8`；eslint `^10.9.0`、`@eslint/js ^10.0.1` | `package.json:60-67` |
| engines | `node ^22.19.0 || >=24` | `package.json:68-70` |
| ESM | `"type": "module"`，`exports: { ".": "./index.mjs", "./client": "./lib/client.js", "./package.json": … }` | `package.json:9-21` |
| 版本探测 | 运行时读三包 version 与 peer 范围比对（自实现 semver 比较，含预发布段 `rc.10 > rc.6`），越界/缺失产出中文 warning，**不阻断派发** | `shims.mjs:173-264` |
| 平台差异 | `presets-sync.mjs` 刻意**不用 `fs.cpSync({recursive})`**（Node 22 Windows + CJK 主目录会崩进程，nodejs/node#54476），改为逐文件复制并保留 mtime | `presets-sync.mjs:11-13` |

### 7.2 测试脚本与测试文件清单（61 个文件里测试占多少）

**答案：0 / 61。** 安装包里**没有 `test/` 也没有 `scripts/`**（`package.json:22-30` 的 `files` 白名单只含 `index.mjs / lib / cordis.patch.yml / presets / docs/screenshots / README×2`；实测目录树 61 个文件全部为运行时代码 + 文档 + 截图）。

但仓库确实有测试与脚本（只能从 `package.json` scripts 与 README 结构树得知，**具体文件数量与内容未随包发布 → 未确认**）：

| script | 命令 | 可推断信息 |
|---|---|---|
| `test` | `node --test "test/**/*.test.mjs"` | 测试放 `test/`，用 Node 内置 test runner |
| `test:bare` | `node --test test/pure.test.mjs test/input-schema.test.mjs test/catalog-integrity.test.mjs` | **至少 3 个测试文件**：纯函数层 / 输入 schema 层 / 目录完整性层；代码里多处注释提到「bare-CI 测试」可无 junction 包直接 import（`pure.mjs:1-5`、`decision-trace.mjs:11`、`intersection.mjs:1-5`），说明测试分**纯函数层**与**接缝层**两档 |
| `preflight` | `node scripts/preflight.mjs` | 发布前预检（**具体检查项未确认**；从工程习惯与仓库上下文推测为依赖/许可/清单预检） |
| `leak-scan` | `node scripts/leak-scan.mjs` | 泄漏扫描（**具体规则未确认**；结合本插件大量「隐私红线」注释——绝不落 prompt/persona/子输出原文——推测为发布前扫描本机路径/密钥/隐私串） |

测试覆盖面的**间接证据**（代码里被测试锁定的契约，反向可推断测试存在）：

- 键集闭合：「键集恰为 15 键（含双名键）」由 percall-spec 测试锁定（`dispatch-schema.mjs:23-27`）。
- `profiles_query` 键集闭合断言在 `test/profiles-query.test.mjs`（`profiles-query.mjs:2-3`）。
- 结果 schema 三分支一致性由 apply 时锁 + 单测双重保证（`dispatch-schema.mjs:5-10`、`dispatch-tool.mjs:373-376`）。
- 失败路径可注入：`loadSoft` 的 `importer` 与 `detectVersions` 的 `reader` 都是测试接缝（`shims.mjs:36-53`、`:248-250`）。

### 7.3 代码组织与「行门」工程纪律

- **`lib/core/` 46 个模块按域拆分**，且大量注释写明「从 X 逐字拆出以守文件行门」——即作者设了**单文件行数上限**，超限就把逻辑抽成模块（`index.mjs:49`、`dispatch-schema.mjs:1-3`、`decision-trace.mjs`、`evolution-generate.mjs:1-5` 等）。装配文件 `index.mjs` 只做装配（`index.mjs:1-2` 注释）。
- **单一事实来源纪律**：`MAX_TOKENS/MAX_DEPTH`（`pure.mjs:65-68`）、`DISPATCH_PARAMETER_KEYS`（`dispatch-schema.mjs:63`）、`BUILTIN_SEEDS`（`profiles-store.mjs:42`）、`profileDirectoryRows`（`profile-directory.mjs:55`）都显式声明为唯一来源，并禁止在它处复制。
- **fail-soft / fail-loud 分级一致**：写失败（台账、meta、快照、提醒、draft、state、escape 集）一律 warn + 计数，不阻断；安全判定一律 throw。
- **原子写统一口径**：所有持久化都是 `写 <file>.tmp → renameSync 覆盖`（profiles/state/escape/assets/snapshots/reminders/drafts/ledger.meta），崩溃只留旧的完好文件。
- **卸载/热重载安全**：卸载改名备份（不删除）+ 启动清理上个生命周期的 `.removed-*` 残留（`cleanup.mjs:11-32`）。
- **注释即规格**：几乎每个阈值都标注「(初值，待实测后校准)」——作者刻意把不成熟参数标出来（影响面：预算阈值、采纳窗口、金丝雀 K、trace 预算 4096 等）。

---

## 8. 明确的局限（重点）——对「过于死板，不能每次任务调整」的逐条验证

> 用户判断：「这个插件把子代理的模型路由写成了预设文件，过于死板，不能每次任务调整。」

### 8.1 结论：**命题的前半段（写进预设文件）成立，后半段（不能每次任务调整）不成立**

**可逐次覆盖，且覆盖粒度很细**——这是代码里最硬的事实：

`dispatch-tool.mjs:29-37`（`mergeProfileArgs`）逐字：

```js
const base = args.profile !== undefined ? store.resolveProfile(args.profile) : {};
const merged = { ...base };
for (const key of ['preset','model','provider','reasoningEffort','persona','toolFilter','maxTokens','maxDepth','tokenTier'])
  if (args[key] !== undefined) merged[key] = args[key];
```

即 **9 个配置键全部可 per-call 覆盖**，且 per-call 与 profile 的语义在 description 里明确写死为「per-call 优先于 profile」（`dispatch-schema.mjs:30/31/32/33/34/35/48/49`）。**profile 是可选的前缀，不是必须的门票**：

- `profile` 参数可选（`dispatch-schema.mjs:28`）；省略时 `base = {}`，直接由 per-call 参数 + 父继承构成一次派发。
- provider 侧的唯一硬要求是 `request.profile` 必须存在对象——而 dispatch 恒传 `profile: merged`（`dispatch-tool.mjs:58`，`{}` 也算存在），因此**「无方案的内联派发」是合法路径**（`profile-provider.mjs:46-48` 只判 `undefined`）。

**覆盖粒度（逐项回答「能否指定 reasoning effort 的具体档位」）**：

| 粒度 | 能否 per-call 指定 | 证据 |
|---|---|---|
| Agent 预设（换装） | ✅ `preset: 'standard'` 等，须 system-trust 白名单 | `dispatch-schema.mjs:29` |
| provider | ✅ `provider: 'xxx'`（须已注册） | `:31` |
| 模型 | ✅ `model: 'deepseek-v4-flash'`（须在目录；覆盖 profile 与父） | `:30` |
| **推理强度具体档位** | ✅ **可以**：`reasoning_effort: 'off'｜'high'｜'max'…`（值本身不限，由 `llm.resolveCallConfig` 对该 provider/model 实校验，不支持的档位 fail-loud 并提示「可改用一个该模型支持的 effort 值」） | `:32-33`、`cost-guard.mjs:85-92` |
| persona | ✅ 整段替换（只 shadow order 0 影子段） | `:35` |
| 工具白名单/黑名单 | ✅ `toolFilter.allow/deny`（只减不增） | `:36-47` |
| token 预算 / 递归深度 | ✅ `maxTokens`（≤65536）/ `maxDepth`（≤3） | `:48-49` |
| 成本档位标签 | ✅ `tokenTier`（估算口径；<15% 预算余量时会用它做封顶判定） | `:34`、`dispatch-gates.mjs:188-195` |
| 派发方式 | ✅ 前台 / `run_in_background` / `continuable`（模式字段不入配置覆盖） | `:50-51` |

**「根据任务自动建议模型」的能力**——有「辅助」，无「自动路由」：

1. `dispatch` 工具 description 内置路由启发：轻任务优先 cheap 方案或显式 `model=flash`；细粒度授权发现改走官方 `subagent` + `list_subagent_models`（`dispatch-tool.mjs:357`）。
2. 系统提示 `dispatch:profiles` 段尾 note：「查资料/汇总→cheap 或 flash；写/改代码→swap-standard；深度推理→premium；1-2 步可自查的小事直接做别派」（`profile-directory.mjs:141`）。
3. `profiles_query` 提供**决策素材**：绑定路由、tier、平均成本、成功率(N)、官方在册状态、是否未授权、该模型可选 efforts（`profiles-query.mjs:73-88`、`:148`）。
4. 进化引擎能产出「该方案近期成功率偏低，可考虑换方案」类建议并生成候选——但**模型侧注入已下架**（`index.mjs:197-205`），只服务人类面板，因此**不会自动改路由、也不会自动提示模型换模型**。
5. **没有**「按任务特征自动选模型」的评分器/路由器（`grep` 未发现任务分类 → 模型映射的代码路径）。同工作目录里另装的 `dsh-effort-router@0.2.0-r4`（`profiles/web/package.json:10`）是同生态的**独立插件**，不属本插件。（该插件机制本报告不展开。）

**预设是否必须事先创建**：**不必须**——内联派发合法（见上）；预设只是「命名复用 + 一次配好多次用」的便利层。设置页也提供「存为方案」把某次派发的实际配置固化成 draft（`client.js:2264-2274` 从派发快照生成 draft 建议；`/advice/save-profile` 路由）。

### 8.2 但「死板」这个批评仍有**四处真实成立**的地方（不要为插件辩护过头）

| 真实局限 | 证据 | 影响 |
|---|---|---|
| **设置页表单不能配 persona / maxTokens / maxDepth** | 表单 schema `EMPTY_FORM = {id, description, preset, provider, model, reasoningEffort, tokenTier, toolMode, toolList}`（`client.js:815`） | 想把这些固化进「命名方案」，只能调 HTTP `/add` 或手改 JSON——UI 与存储 schema 存在缺口 |
| **每 session 只能靠模型自觉逐次填参；没有 per-task 路由策略层** | 无任务→模型映射代码；advice 模型侧下架 | 使用体验上确实像「要么用预设、要么模型每次手写参数」，缺少「策略（policy）」这一中间层 |
| **continuable 模式丢弃 preset 换用与 reasoningEffort** | `dispatch-tool.mjs:119-125`、`:150`；`README.zh.md:107` | 持久子会话无法换装/调档（宿主请求面无对应字段），想要细粒度覆盖就只能用 one-shot |
| **外部约束会否决 per-call 路由**：官方模型选择白名单（web 线，需手动开启）；目录校验 fail-loud（模型不在 provider 目录直接拒派）；预算 <15% 时只允许 cheap | `model-policy.mjs:73-77`、`cost-guard.mjs:79-81`、`dispatch-gates.mjs:197-210` | 「我明明指定了模型却被拒」的挫败来源；但这是**有意的安全边界**，不是死板 |
| （附带）`maxDepth ≤ 3`、`maxTokens ≤ 65536` 为硬编码常量 | `pure.mjs:67-68` | 深度编排场景会被硬顶（注释承认是「待实测校准」的建议值） |

### 8.3 一句话修正

> 准确表述应是：**「路由默认值被固化在命名方案里，但 dispatch 支持 per-call 逐字段覆盖（含具体推理档位）；缺的不是覆盖能力，而是把『按任务自动路由』做成策略层——这一层作者选择交给模型自己判断 + 人类面板建议，并未实现。真正的缺口在 UI（persona/预算字段不可视化配置）与 continuable 模式（覆盖被丢弃）。」**

---

## 9. 给新插件的启示（可直接借鉴的机制）

### 9.1 决策台账（decision trace）——最高价值

**为什么值得抄**：它把「一次自动决策」做成**可审计的四段式对象**：`parentContext`（我看到了什么）→ `requested`（我请求了什么）→ `gates[]`（每道闸的输入/输出/判定/原因）→ `effective/execution/settled`（实际生效/执行/结算）。这不是日志，而是**面向"为什么这么决策"的数据结构**。

可复用的具体设计：

1. **闸门数组统一形状** `{name, input, output, verdict, reason?}`，pass/fail 都记（`dispatch-gates.mjs` 各闸）；CLI/UI 可零成本渲染时间线。
2. **「请求 vs 生效」双栏 + `ignored[]` 显式回报**：把「请求了但被忽略」做成**结果里的字段**（`dispatch-schema.mjs:202-205`），模型能「看见」自己被丢弃的意图 → 避免静默失真。
3. **体积护栏的分级收敛**（`assertTraceSize`，`decision-trace.mjs:284-317`）：6 级降级 + **硬保证「绝不 return 超限 trace」**，永不 throw。任何要往工具结果里塞结构化元数据的插件都该抄这一条。
4. **schema 一致性锁**（`assertResultSchemaConsistency`，`pure.mjs:290-330`）：闭合 `oneOf` 的多分支共享键集用「apply 时 throw」锁死——比测试更早暴露漏字段。
5. **快照与判定同源**：`profiles_snapshot` 由 `profileDirectoryRows` 生成，与系统提示里模型看到的目录**同源同序**（`profile-directory.mjs:1-4`、`dispatch-tool.mjs:281-285`）→ 「模型当时看到哪些候选」可被事后复现。这是**决策可解释性的关键一环**。
6. **fail-visible 的未知键**：未知参数记 `unknown_keys`，不静默吞（`decision-trace.mjs:97-101`）。

### 9.2 成本估算与「反事实对照」

- **两级计价 + fail-soft 不猜价**：有精价用精价、无精价用实测均价、都没有就 `undefined` 不显示（`cost-evidence.mjs`、`prices.mjs`）。绝不编数字。
- **反事实基线选对字段**：必须读 `requested.model` 而非 `effective.model`，否则「继承父」与「显式选」不可区分，节省分析会失真（`cost-evidence.mjs:1-4`）。这个坑极其值得抄。
- **把「根因」做成可见指标**：`inherit_ratio = 100%` 直接指向「你根本没指定模型」——比任何建议都有效。
- **成本数字带 provenance**：单价表注明来源与实测日期，模型名归一失败返回 undefined。

### 9.3 fail-loud 校验 + 分层降级边界

- **守卫型 vs 映射型两类依赖分开处理**（`shims.mjs:1-18`）：安全关键符号用**静态 import**（宿主改名 → 加载即失败，绝不弱化）；业务助手用**动态 import + 功能等价回退 + warn**。这是一条极清晰、可直接照抄的依赖哲学。
- **fail-loud 文案三段式**：事实 + 为什么这样 + 怎么办（`model-policy.mjs:21-29`）；全部中文、可行动，且区分「越界值大声失败而非静默降级」。
- **白名单从运行时推导、不硬编码**（`whitelist.mjs:23-28`，「从运行时名册推导，不硬编码」），没有名册才回退常量名单。
- **逃生舱 + 逐次审计**：非白名单放行需显式 opt-in、只叠加不替代、每次都留高可见审计（`escape.mjs:103-117`）——治理类插件的标准范式。
- **state 文件损坏 fail-closed**：绝不静默回退 `enabled:true`（`profiles-store.mjs:214-221`）。
- **原子写统一口径**（tmp + rename）与**卸载改名备份而非硬删**（`cleanup.mjs`）。
- **隐私红线写成不变量**：台账绝不落 prompt/persona/子输出原文，只落长度 + 确定性结构指纹（`evolution-ledger.mjs:17-21`、`pure.mjs:271-288` 的 sha1 前缀 label）。

### 9.4 自进化的正确姿势（如果要做「插件自我改进」）

`观测(append-only) → 确定性聚合 → 四条件建议 → ≤3 互斥候选 → 三道闸 → 人工确认 → 冻结基线 → K 次金丝雀 → 跌破下沿只给只读回滚建议` —— 全程**不自动改配置**、**不自动回滚**、**每个动作留审计**，并且**同一身份键单写锁 + 观察期隔离**（`evolution-engine.mjs:237-252`、`:163-165`）。**值得深挖与抽象成通用「建议-候选-金丝雀」框架**：这是本插件最有原创性的部分，也是它能被称为「自学习」而不是「自动乱改」的原因。

---

## 附录 A · 数据文件清单（全部相对 `DSH_HOME`，默认 `~/.dsh`）

| 文件 | 内容 | 上限/纪律 | 证据 |
|---|---|---|---|
| `subagent-profiles.json` | 方案注册表（v2 信封） | 原子写；失败不阻断 | `profiles-store.mjs:269` |
| `subagent-profiles.state.json` | 7 个开关 | 损坏 fail-closed | `:270`、`:191-222` |
| `subagent-profiles.failed-traces.json` | 失败 trace 台账 | 每会话 50 / 总 500 | `index.mjs:362`、`decision-trace.mjs:422` |
| `subagent-evolution/dispatch.jsonl` | 派发台账（append-only） | 轮转封存 + 保留上限 | `evolution-ledger.mjs:362-364` |
| `subagent-evolution/summaries.json` | L1/L2 聚合 + streak/cooldown 回写 | 版本号，损坏重建 | `evolution-advice.mjs`、`evolution-lag.mjs` |
| `subagent-evolution/adopted-state.json` | 采纳判定状态 | 原子写 | `index.mjs:56` |
| `subagent-evolution/reminders.json` | 提醒（= 审计记录） | 上限 200 | `reminder-store.mjs:16`、`:194` |
| `subagent-evolution/governance-audit.jsonl` | 治理审计（append-only） | 写失败 → degraded | `evolution-ledger.mjs:364` |
| `subagent-evolution/ledger.meta.json` | `{v:1,lostTelemetry,lostGovernance,health,last_write_ts,lost_count,rotation_seq}` | 原子写；health 持久 | `:365`、`:181-189` |
| `subagent-evolution/assets/` | 进化候选资产 | 总量 20 条护栏 | `evolution-assets.mjs:154`、`evolution-generate.mjs:11` |
| `subagent-evolution/drafts.json` | auto-profile 草稿（未过闸不入注册表） | 原子写 | `drafts-store.mjs:20-21` |
| `subagent-evolution/evolution-escape.json` | 逃生舱放行集 `{version:1,presets:[]}` | 形状不符判空集 | `escape.mjs:14-22`、`:65` |
| `subagent-evolution/snapshots/`（+ `snapshots.index.json`） | 派发配置快照（含 persona 原文，本机私有） | 上限 200，到顶停写不自动删 | `snapshots.mjs:15`、`:134` |
| `.agent-presets/orchestrator-v2/` | 自装 Agent 预设（含 `.dsh-sync.json` sidecar） | 用户改过绝不覆盖 | `presets-sync.mjs`、`index.mjs:36-47` |

## 附录 B · 本报告的未确认项（不臆测）

1. `scripts/preflight.mjs` 与 `scripts/leak-scan.mjs` 的**具体检查规则**——脚本未随 npm 包发布，本机磁盘未见副本（已 glob 全 `~/.dsh` 与 `Documents`）。
2. 仓库 `test/` 的**文件总数**（`package.json` 的 `test:bare` 只暴露 3 个文件名；`test` 脚本用 `test/**/*.test.mjs` 通配）。
3. 是否存在**服务端 trace 回放器**（客户端只见「读取会话块 meta + loadOlder 翻页」；服务端只有失败台账与后台内存台账的查询路由）。
4. `docs/` 下除 3 张截图**无任何 markdown**；`prices.mjs:2` 与 `cost-evidence.mjs:7` 引用的 `docs/measured-params.md` / `docs/cost-closed-loop-design.md` **未随包发布**，故 A/B 级单价的实测方法与 `MODEL_USAGE_PRICES` 五段单价空置的原因**无法核实**（代码内部自洽：五段均为 `null`，走 A 级均价回退）。
5. 金丝雀「跌破基线」阈值的**实测校准结果**：代码注释多处标注「初值，待实测后校准」，未见校准后的常量（`CANARY_K=5`、`BUDGET_TIGHT_RATIO=0.15`、采纳窗口 N=3/T=10min、并发 8、每父 token 200000 均属此类）。
6. `dsh.client.inject: []` 为空数组（`package.json:36`），但客户端 `apply()` 内部自行 `inject = ['slots','sessions']`（`client.js:5349`）——**该空数组与官方约定是否等价未确认**（运行正常，说明空数组合法）。

## 附录 C · 关键数字速查

| 常量 | 值 | 位置 |
|---|---|---|
| `MAX_TOKENS` / `MAX_DEPTH` | 65536 / 3 | `pure.mjs:67-68` |
| `PERSONA_MAX_CHARS` | 2048（含 26 字符引导前缀） | `pure.mjs:59-63` |
| 并发上限 / 每父 token 上限 | 8 / 200000 | `dispatch-guard.mjs:14` |
| 预算三态阈值 | ≥50% 充足 / ≥15% 紧张 / 其余告警 | `dispatch-gates.mjs:164-165` |
| 单条 trace 体积上限 | 4096 B（6 级收敛） | `decision-trace.mjs:25` |
| 失败台账上限 | 每会话 50 / 总 500 | `decision-trace.mjs:422` |
| 采纳判定窗口 | N=3 轮 或 T=10 分钟；确认 false 惩罚 −0.3 | `adoption-tracker.mjs:27-29`、`evolution-summary.mjs:13-19` |
| 金丝雀 | K=5 次；最少样本 3；24h 无派发→stalled | `evolution-canary.mjs:17-21` |
| 候选护栏 | 总量 20；单条建议 → ≤3 互斥候选；TTL 默认 24h | `evolution-generate.mjs:11`、`evolution-renewal.mjs:11-13` |
| catalog 缓存 TTL | 60s（错误态不缓存） | `catalog-cache.mjs:20`、`:235-239` |
| 提醒上限 / 快照上限 | 200 / 200 | `reminder-store.mjs:16`、`snapshots.mjs:15` |
| 模型可见 profile 快照 | ≤6 条 × 描述 ≤80 字 | `profile-directory.mjs:12-13` |
| dispatch 入参键数 | 15（含双名键） | `dispatch-schema.mjs:63` |
| per-call 可覆盖键数 | 9 | `dispatch-tool.mjs:33` |
