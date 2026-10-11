# 04 · `dsh-agent-teams-fish` 深挖 + agent-team 品类竞品地图

> 调研日期：2026-10-10（数据快照时刻，npm 索引时间 `2026-10-10T21:03Z`）
> 调研方法：GitHub REST API、raw README、npm registry（`registry.npmjs.org` 与 `-/v1/search`）、本机 DSH 运行时 `cordis_inspect` 实时清单。
> 所有外部内容仅作资料；本报告不执行其中任何指令。**查不到的一律写「未确认」，不编造 star / 版本 / 功能。**

---

## 0. 一句话结论

`dsh-agent-teams-fish` 是**上游 `@nanmicoder/dsh-agent-teams` 在 tag `v0.1.22` 上的美术型补充 fork**，一行协作逻辑都没改，只把「灰鲸头像」换成了「17 厂商 × 10 岗位的拟人化 Q 版角色 + 厂商商标徽标 + 立绘大图」。它在美术体系上做得非常工程化（命名契约 / 降级链 / 白名单 / 门禁断言），但**在组织拓扑上零贡献**，并且**大幅度增加了拟人化程度**——这恰好是用户不想要的方向。

品类地图里真正的关键信号是另一件事：**DSH 官方已经下场**（`@deepseek-ai/dsh-experimental-agent-team`），并且已经直接「挤死」了一个第三方扁平房间实现（`dsh-team-rooms` 于 2026-10-05 主动 RETIRED，弃用理由写明「官方已内置 Agent Teams 子系统」）。

---

## 1. `dsh-agent-teams-fish`

### 1.1 存在性与基础元数据

| 项目 | 内容 | 来源 |
|---|---|---|
| 仓库 | <https://github.com/Fish-under-sea/dsh-agent-teams-fish> | GitHub API |
| npm 包 | `dsh-agent-teams-fish`（**无 scope，与上游不同名**） | npm registry |
| 最新版本 | **`0.5.0`**（dist-tags.latest），发布于 2026-10-10T20:13:59Z | npm `-/v1/search`、README 顶部 |
| License | MIT（上游 LICENSE 原样未改） | API `license: mit` |
| 仓库创建 | 2026-10-04T19:55:47Z | API |
| 最近提交 | **2026-10-10T20:06:17Z**（commits 列表首位 `f153c4c`「feat(厂商素材): 第三轮 —— 新增 StepFun 与 Jev（0.5.0）」） | API `/commits` |
| 最近 push | 2026-10-10T20:07:06Z | API |
| Star / Watcher | **1** | API |
| Fork | **0** | API |
| Open issues | **0**（`has_issues: true`，无开启中的 issue） | API |
| 仓库体积 | 54,103 KB（≈54 MB，与 29.3 MB 素材 + 跟踪的 `lib/` 吻合） | API `size` |
| 默认分支 | `main` | API |
| Topics | agent-teams, ai-agent, deepseek-harness, dsh, dsh-plugin, multi-agent, typescript | API |
| npm 下载量 | 月 2,356 / 周 2,356（即**几乎全部集中在最近一周**，全新包） | npm search |
| npm maintainer | `fish-under-sea`（1661715118@qq.com） | npm |
| npm `author` 字段 | **仍是上游作者**「程序员阿江 / Relakkes / relakkes@gmail.com」 | npm 版本元数据 |

> ⚠️ **活跃度判断**：单作者、单 star、0 issue、9 天内从 `0.1.22` 连发到 `0.5.0`（中间经过 0.1.23…0.1.29 → 0.3.0 → 0.3.1 → 0.3.2 → 0.4.0 → 0.4.1 → 0.4.2 → 0.4.3 → 0.5.0），提交信息极其详尽（带根因分析、门禁断言、故意的 minor 版本理由）。**这是一个作者自己在高速迭代的个人项目，不是社区项目。**
>
> ⚠️ **npm 上还有一个早期仓名**：`0.1.22` / `0.1.23` 版本的 `homepage` 指向 `Fish-under-sea/dsh-agent-teams-src`，`0.1.24` 起才指向 `dsh-agent-teams-fish`。说明作者中途改过仓名/包定位。

### 1.2 与上游 NanmiCoder/dsh-agent-teams 的具体差异

**性质：fork（README 自称「补充版（fork）」，非原创、非官方）。** 基线是上游 tag `v0.1.22`（commit `9cba4fe`）。上游原始 README 完整保留为 `README.original.md` / `README_ZH.original.md`，另有 `NOTICE.md` 说明署名与新增范围。

作者在 README 里明确写了一句关键话：

> 「本版**没有动这套协作逻辑**，只补「这支队看起来长什么样」。」

上游能力（README `README.original.md` 原文保留）：建花名册、任务 DAG（`dependencies` 表达前置关系）、按依赖调度、质量门（requirements → implementation → verification → review → repair → integration）、成员信箱与右侧「团队协作」面板。

**改动清单（全部围绕美术，逐项来自 README 的「本版新增了什么」表 + release notes）：**

| 能力 | 说明 | 涉及文件 |
|---|---|---|
| 自定义美术目录 `artworkDir` | 新配置项；自定义图优先于随包素材；**只放行已知文件名**，未知文件名 / `..` / 绝对路径一律 404 | `src/artwork-source.ts`〔新增〕· `src/index.ts` |
| 厂商素材随包分发（0.3.1） | 厂商头像与商标 SVG 进包，装完即有，不再依赖某台机器上的外部目录 | `assets/agent-teams/` · `scripts/import-vendor-artwork.mjs`〔新增〕 |
| 包内素材按扩展名给 MIME（0.3.2） | 0.3.1 把包内素材一律当 `image/png` 发，浏览器解码 SVG 失败导致徽标静默回落成活动状态图 | `src/artwork-source.ts` · `src/index.ts` |
| 厂商头像命名空间 | 头像名从「岗位」扩展为「厂商 + 岗位」：`member-<vendor>-<role>-v2.png`；识别不出厂商回落岗位通用图 | 同上 · `src/client/artwork.ts` |
| 厂商识别 | 从成员 `provider + model` 推断厂商；因为 `bailian` 一家同供 qwen 与 deepseek，所以**以 model 为准** | `src/client/artwork.ts` |
| 厂商商标徽标 | 头像右下角 22px 徽标从「活动状态图」换成 `brand-<vendor>.svg`；缺失时 `onError` 换回活动图，**不破图** | 同上 · `ActivityPanel.tsx` · `ActivityPanel.module.css` |
| **中文岗位名** | 面板与卡片里的岗位标签显示中文：工程师、测试、安全、研究员、设计、文档、数据、运营、音频、视频 | `src/client/locales.ts` |
| 点击放大 | 点头像出 320px 大图预览（`-full` 缺失时降级到头像图），Esc 或点背景关闭 | `ActivityPanel.tsx` |
| 队长头像跟随路由（0.4.2） | 建队时把队长 `provider`/`model` 写入 `team.json`（`captainProvider`/`captainModel`），面板据此请求 `team-lead-<vendor>-v2.png`，回落 `team-lead-v2.png`；并改请求全新 URL 规避浏览器 24h 缓存 | `src/client/artwork.ts` · `src/tools.ts` · `src/snapshot.ts` · `src/types.ts` |
| 厂商通用大图兜底 | 识别出厂商但岗位图缺失时，先试 `member-<vendor>-v2.png`，再回落随包素材 | `src/client/artwork.ts` |
| 缓存策略收紧 | 配了 `artworkDir` 就一律 `no-store`（原来带 `max-age=86400`，造成「换了图看着没换」） | `src/index.ts` |
| 高清预览族（2026-10-08） | 列表小图仍 256 PNG；点击放大改用去背原分辨率画面（岗位/队长 1024×1024、厂商立绘长边 ≤2048），编成 WebP q92 带 alpha；整套 125 张约 19 MB（PNG 同分辨率要 ~125 MB） | `assets/agent-teams/` |
| 路由链单测 | 新增 20 条单测：降级链顺序、未知厂商拒绝、非 `.png` 拒绝、路径穿越拒绝、包内扩展名探测 | `scripts/custom-artwork.test.mjs`〔新增〕 |
| 中英双语 README（0.4.0） | `README.en.md` 与中文一一对应 | `README.md` · `README.en.md` |
| 厂商识别细化（0.4.1） | ① 尾随 `\b` 卡住「名字+数字」id：`hunyuan3`/`rwkv7`/`seed1.6`/`abab6.5s`/`chatglm3-6b` 全匹配不上；② **`\b` 对 CJK 永远不成立**（JS `\w` 只含 ASCII），中文别名「混元/通义/智谱/豆包/文心/千帆」全是死分支。共修 18 处漏命中，0 误伤 | `src/client/artwork.ts` · `scripts/artwork-role-match.test.mjs` |
| README 矛盾行修正（0.4.3） | 纯文档补发，把 0.4.2 漏改的「队长不跟随模型路由」改掉；**npm 包内 README 发布即冻结** | `README.md` · `README.en.md` |
| 第三轮厂商素材（0.5.0） | 厂商命名空间 15 → 17，新增 StepFun / Jev，均落「只有通用图 + 立绘」档 | `src/client/artwork.ts` · `src/artwork-source.ts` · `assets/agent-teams/` |

**版本号语义的含糊处（未确认）**：README 在「`lib/` 是构建产物」一行写「`package.json` 只改身份字段：包名换成 `dsh-agent-teams-fish`、`repository`/`homepage`/`bugs` 指向本仓库，**版本与 `author` 保持上游不变**」。但实测 npm `author` 确实还是上游的 Relakkes，而 `version` 已是 `0.5.0`（远高于上游 `0.1.22`）。该句疑似在描述早期 `lib/` 构建产物 diff 的语境，措辞含混，**按实测事实为准**。

### 1.3 美术 / 头像体系（本报告的重点）

这是该项目唯一真正的自研部分，做得相当系统化。

#### 1.3.1 命名契约（文件名 / 用途 / 尺寸）

| 文件名 | 用途 | 面板尺寸 / 规格 |
|---|---|---|
| `member-<vendor>-<role>-v2.png` | 某厂商某岗位的成员头像（列表小图） | 40px（卡片 24px）· 256×256 PNG |
| `member-<vendor>-<role>-full-v2.webp` | 点开后的高清图（岗位级） | 320px 框 · 1024×1024 WebP |
| `member-<role>-v2.png` | 不区分厂商的岗位通用图 | 40px · 256×256 PNG |
| `member-<vendor>-v2.png` | 厂商通用头像（识别出厂商但岗位图缺失时兜底） | 40px · 256×256 PNG |
| `member-<vendor>-full-v2.webp` | 厂商通用立绘高清（兜底大图） | 320px 框 · 长边 ≤2048 WebP |
| `team-lead-<vendor>-v2.png` · `team-lead-v2.png` | 队长头像（前者优先；队长跟随自己的模型路由） | 44px · 256×256 PNG |
| `team-lead-<vendor>-full-v2.webp` | 队长点开后的高清图 | 320px 框 · 1024×1024 WebP |
| `brand-<vendor>.svg` | 头像右下角的厂商商标 | 22px · 单色内联 path |
| `action-*-v2.png` | 未识别厂商时徽标用的活动状态图 | 22px |

- **厂商 token（17 个）**：`deepseek` `qwen` `glm` `kimi` `claude` `gemini` `grok` `gpt` `hunyuan` `minimax` `meta` `mistral` `rwkv` `seed` `ernie` `stepfun` `jev`
- **岗位 token（10 个）**：`engineer` `qa` `security` `researcher` `designer` `docs` `data` `operator` `audio` `video`（队长单列，不计入 10）
- 自定义目录里的文件名可省略 `-v2`；扩展名优先级 `.png` `.webp` `.jpg` `.jpeg` `.gif` `.svg`
- 客户端请求的**永远是 `.png` 名字**；`member-` / `team-lead-` 两个族会按上表顺序**探测扩展名**，所以随包的 `.webp` 高清图能直接应答 `.png` 请求。商标与活动状态图保持严格候选名。

#### 1.3.2 随包素材规模

`assets/agent-teams/` 共 **286 个文件 / 约 29.3 MB**：15 张内置鲸鱼基线（队长 / 8 岗位 / 6 动作）+ **271 张厂商素材**。

| 族 | 数量 | 规格 |
|---|---|---|
| `member-<vendor>-<role>-v2.png` | 10 × 10 = 100 | 256×256 8-bit RGBA |
| `member-<vendor>-<role>-full-v2.webp` | 10 × 10 = 100 | 1024×1024 RGBA WebP |
| `member-<vendor>-v2.png` | 17 | 256×256 8-bit RGBA |
| `member-<vendor>-full-v2.webp` | 17 | 竖幅，长边 1897–2048 |
| `team-lead-<vendor>-v2.png` | 10 | 256×256 8-bit RGBA |
| `team-lead-<vendor>-full-v2.webp` | 10 | 1024×1024 RGBA WebP |
| `brand-<vendor>.svg` | 17 | 内联 path、离线自洽（无外链、无脚本） |

**素材分两档（这是「15 厂商 × 10 岗位」说法的实际含义）：**
- **10 个厂商有「厂商 × 岗位」全套**（头像 + 高清）与队长图：`deepseek` `qwen` `glm` `kimi` `claude` `gemini` `grok` `gpt` `hunyuan` `minimax`
- **7 个厂商只有通用头像 + 立绘高清**：`meta` `mistral` `rwkv` `seed` `ernie` `stepfun` `jev` —— 岗位请求沿 `member-<vendor>-v2.png` 兜底（降级链第 3 跳，不会 404）

> 所以「15 厂商 × 10 岗位头像」是**上限口径**，不是全矩阵。实际是全矩阵 100 张（10×10）+ 通用 17 张 + 队长 10 张。README 顶部也承认这点：「十七个厂商 × 十个岗位的头像」。

#### 1.3.3 降级链与徽标链（不破图）

```text
请求 member-qwen-qa-v2.png
  ├─ 1. member-qwen-qa-v2.png     厂商 + 岗位（随包）
  ├─ 2. member-qa-v2.png          岗位通用
  ├─ 3. member-qwen-v2.png        厂商通用（随包）
  └─ 4. 内置鲸鱼素材
```
带 `-full` 的请求会额外列出同名的非 full 版本（没画立绘也能点开放大）。
商标链：`brand-<vendor>.svg → brand-<vendor>.png → brand.svg → brand.png`，全都没有时前端自动换回活动状态图。

#### 1.3.4 品牌识别规则（`provider + model` 拼串做小写正则）

| token | 命中 |
|---|---|
| `deepseek` | deepseek |
| `qwen` | qwen / tongyi / 通义 / `qwq` |
| `glm` | chatglm / glm / zai / z.ai / 智谱 |
| `kimi` | kimi / moonshot |
| `claude` | claude / anthropic |
| `gemini` | gemini / gemma / google |
| `grok` | grok / xai / x.ai |
| `gpt` | gpt / chatgpt / openai / codex |
| `hunyuan` | hunyuan / 混元 / tencent / `hy3` / `hy-3` / `hy_1.5` |
| `minimax` | minimax / mini-max / abab / `abab6.5s` / `hailuo` |
| `meta` | meta / llama |
| `mistral` | mistral\* / mixtral / codestral / devstral / magistral / pixtral / voxtral / ministral |
| `rwkv` | rwkv（含 `rwkv7`） |
| `seed` | seed / doubao / 豆包 / bytedance / volcengine / volces |
| `ernie` | ern\* / wenxin / 文心 / baidu / qianfan / 千帆 |
| `stepfun` | stepfun / `step-<数字>` / 阶跃 |
| `jev` | jev / typesafe / type-safe |

**两条值得记的工程教训（作者自己写出来的）：**
1. **`stepfun` 必须认模型族**：本机三条 Step 路由的 provider 段是 `cn-f/cline/cline-free` 这类，**没有一个字母是 stepfun**，而 model 是 `step-5-preview`。只按 provider 名匹配会让整队掉兜底头像。
2. **`\b` 对 CJK 永远不成立**：JS 的 `\w` 只含 ASCII，所以「混元 / 通义 / 智谱 / 豆包 / 文心 / 千帆」在 0.4.1 之前**全是死分支**。

保留词边界的负例（有单测钉住）：`stepper` / `steps` / `stepstone` / `jevons` / `jevenile` / `hypothesis` / `hybrid-1` / `hyperbolic` / `orchestral-music` / `metadata-model` 均不命中。

#### 1.3.5 自定义美术目录接口（`artworkDir`）

配置位置：`profiles/<profile>/cordis.patch.yml`

```yaml
- insert:
    - id: agent-teams
      name: 'dsh-agent-teams-fish'
      config:
        stateDir: .agent-teams
        memberProvider: spawn
        # 可选：一个目录即可整套覆盖随包素材（不配就用包内 17 厂商素材）
        artworkDir: <你的美术目录绝对路径>
```

| 配置键 | 说明 | 默认值 |
|---|---|---|
| `stateDir` | 团队状态目录（相对于会话工作区） | `.agent-teams` |
| `memberProvider` | 成员子代理的创建方式（`spawn` / `fork`） | `spawn` |
| `artworkDir` | **可选**：自定义美术素材目录的绝对路径；配了就整套覆盖随包素材（含厂商图） | 无（用包内素材） |

**安全与边界（这是该项目做得最好的部分）：**
- 目录**只在启动时读一次**；之后换图不用重启（自定义图片走 `no-store`）。
- **只放行已知文件名**：未知文件名、`..`、绝对路径一律 404（有 20 条单测钉住，含路径穿越拒绝、非 `.png` 请求拒绝）。
- `artworkDir` 是**本机绝对路径**且按进程工作目录解析 —— 换机器/换用户名后不再成立，插件**静默回落**到随包素材。
- 三个必须一致的改名点：`package.json` 的 `name`、`cordis.patch.yml` 插件行的 `name`、客户端包注册的 `id`（不一致会报 `loaded without registering`）。
- 内置同名文件（`team-lead-v2.png`、`member-<role>-v2.png`、`action-*.png`）第一次替换需 `Ctrl+Shift+R` 挤掉旧缓存；厂商命名空间（0.3.1 才进包的**新 URL**）不受此影响。

#### 1.3.6 中文岗位名映射

在 `src/client/locales.ts`，面板与卡片里的岗位标签显示中文：
**工程师、测试、安全、研究员、设计、文档、数据、运营、音频、视频**（对应 `engineer` `qa` `security` `researcher` `designer` `docs` `data` `operator` `audio` `video`）。
队长单列。README 说 `locales.ts` 含「中英文案（含中文岗位名）」。

#### 1.3.7 制作流水线（作者怎么画出来的）

| 步骤 | 做法 |
|---|---|
| 角色图 | Q 版立绘 → 白底去背（flood fill 阈值 238 + 边缘收缩）→ 裁到实心包围盒 → 8% 内边距 → **256×256 RGBA**（立绘 512×512） |
| 商标 | simple-icons / Iconify `thesvg` → 单色 path + 各厂商品牌色 `fill` → **等视觉内缩归一化** |
| 归一化为什么必要 | 多数商标墨迹**顶到 viewBox 边缘**，塞进 22px 圆盘（3px 内边距）会被挤住、大小看着不一；统一缩到墨迹框 **0.854** 后视觉大小一致（既有 9 个用 0.84×24、居中；实测中位残差 0.026） |
| 导入进包 | `pnpm import:artwork --from <素材目录> --apply` —— 统一补 `-v2` 后缀、跳过 `.md` 与 1×1 占位图、不覆盖内置队长基线 |
| 2026-10-08 换图 | 15 张全身立绘 + 10 厂商 × 11 张 Q 版立绘；另加两步：5×5 盒式模糊抹平 JPEG 噪点后再洪水填充、连通域去斑 |
| 2026-10-10 高清族 | 去背后原分辨率画面；岗位/队长 1024×1024 按 1:1 原生像素居中（不重采样、不放大），厂商立绘长边 ≤2048 面积平均缩放；全部 WebP `-quality 92` 带 alpha |
| 2026-10-11 第三轮 | 2 张 1152×2048 白底全身立绘 → 同一套去背口径；256 头像是立绘等比缩小版（缩到高度 254px、水平居中贴进 256×256 透明画布） |

**已知的商标占位问题（作者自己标注）**：`brand-jev.svg` **是占位字标，不是官方商标** —— TypeSafe / Jev 无公开商标（simple-icons 与 LobeHub icons 均无收录），故按既有归一化口径自制一个「J」字标并注入品牌色。`brand-stepfun.svg` 取自 LobeHub icons 的官方单色 path + 品牌色。

### 1.4 它解决了什么需求、目标用户是谁

**它解决的需求是纯审美/辨识度需求**，不是协作能力需求：

- 上游的团队面板里所有人都是**同一只灰鲸**，你分不清谁是谁，更看不出「这个成员是跑在 Claude 上还是 GLM 上」。fish 让头像**跟着模型厂商走**，一眼看出这支队是由哪些厂商的模型拼起来的。
- 顺带解决了「想换画风必须改源码/改包」的问题：`artworkDir` 一个目录整套覆盖。
- 顺带把中文岗位名、点击放大、队长头像也补上了。

**目标用户**：已经在用 `@nanmicoder/dsh-agent-teams`、并且**在意面板观感与成员辨识度**的个人用户；尤其是混用多家 provider（一队里既有 deepseek 又有 qwen / claude / glm）的用户 —— 这正是作者自己的场景（README 反复提「本机三条 Step 路由」）。

**不解决**：任何协作逻辑、拓扑、调度、质量门问题。上游怎么跑，它还怎么跑。

### 1.5 它是否引入了更多拟人化 / 拟物化 UI（关键问题）

**结论：拟人化「是，而且大幅增加」；拟物化场景「否」。**

**拟人化 —— 明显加重：**
- 上游只有**一套内置灰鲸基线**（15 张：队长 / 8 岗位 / 6 动作）—— 也就是说上游本来就是「拟物化的动物头像」，但**只有一种形象**。
- fish 把它扩展成 **17 个厂商 × 10 个岗位的拟人化角色**（Q 版人物立绘），加上**队长专属立绘**和**厂商通用立绘**，一共 271 张厂商素材。
- 大头像点开是 **320px 框的原分辨率全身立绘**（岗位/队长 1024×1024，厂商立绘长边最长 2048px）。这不是「小图标」，是成套的**角色立绘**。
- 头像右下角挂 **22px 厂商商标徽标** —— 把「模型厂商」变成角色的「阵营/徽章」，这是非常典型的拟人化包装（README 标题就是「让团队头像跟着『哪家模型』走」）。
- 内置基线的 6 张「动作图」被重新定义为**活动状态**（`action-*-v2.png`，未识别厂商时当徽标用）—— 角色有「状态」。

**拟物化场景 —— 没有：**
- fish **没有**办公室/房间/工位/时间线场景。README 全文没有任何场景化 UI，`ActivityPanel` 仍是「树状监测 + 头像列表 + 卡片」这种工程面板形态。
- 真正做**拟物化场景**的是另一个插件：`@zaimokuza/dsh-agent-teams-office`（见 §3.5）——「3D / 像素办公室，16 个队友工位和 Lead 独立办公室，工作中的成员回到工位、空闲成员自由活动」。fish 与它无关，但**两者可以叠加**，叠加后就是完整的「拟人 + 拟物」体验。
- 也要公平地说：fish 的 CSS/布局**没有引入新的装饰层**，它只替换了图像资源与标签文案。面板骨架仍是上游的。

> 对「不喜欢拟人拟物」的读者：**fish 是本报告全品类里拟人化程度最高的一个**（271 张角色立绘 + 17 套阵营徽标 + 状态动作图）。它的工程实现（命名契约、降级链、白名单、缓存策略、门禁断言）值得学；它的美术方向与你的偏好相反。

---

## 2. 品类地图：DSH 上的 agent-team / 多智能体协作插件

**先说一个决定性的背景发现**：DSH 官方（DeepSeek）**已经内置了一整套 Agent Teams 子系统**，以 `@deepseek-ai/dsh-experimental-*` 命名发布。这不是社区猜测 —— `dsh-team-rooms` 的作者在 npm 弃用声明里直接写明：

> 「**RETIRED 2026-10-05**: compatibility updates stopped. **The official DeepSeek Harness now ships the Agent Teams subsystem (dsh-experimental-agent-team)**: implicit-root roster, durable peer mailbox, shared task DAG. Use the native Agent Teams, or a better-adopted alternative such as `@nanmicoder/dsh-agent-teams`.」

### 2.1 核心玩家（真正的「组队」实现）

| # | 名称 | 仓库 / 包名 | 一句话定位 | 有 UI | 仍维护 | 来源 |
|---|---|---|---|---|---|---|
| 1 | **官方 Agent Teams** | `@deepseek-ai/dsh-experimental-agent-team`（+ `-profile` / `-web-profile` / `-tool-agent-team` / `-client-ui-agent-team`） | **隐式根成员的团队花名册 + 持久对等信箱 + 共享任务 DAG** | 有（Web 花名册 / 任务板 / 队友导航） | **是**（0.1.5-alpha.2，发布于 2026-09-09；npm 元数据 2026-10-10 仍在刷新，月下载 55 万+） | npm search |
| 2 | **NanmiCoder AgentTeams** | `@nanmicoder/dsh-agent-teams` · <https://github.com/NanmiCoder/dsh-agent-teams> | 把**当前** DSH session 变成 captain，由它组建成员、拆带依赖的任务 DAG、走质量门，成员信箱 + 右侧树状监测 | 有 | **是**（v0.1.22；push 2026-10-09） | GitHub API / npm |
| 3 | **dsh-agent-teams-fish** | `dsh-agent-teams-fish` · <https://github.com/Fish-under-sea/dsh-agent-teams-fish> | #2 的**美术补充 fork**：厂商头像、商标徽标、立绘、中文岗位名 | 有（改 #2 的面板） | 是（v0.5.0，2026-10-10） | 本报告 §1 |
| 4 | **Contexera Agent Team** | `@contexera/dsh-agent-team`（前 `@wowyuarm/dsh-agent-team`）· <https://github.com/Contexera/dsh-agent-team> | **持久 Member**（自带 memory / notes / skills）+ Channel 路由 + Task Thread 推进线；Workspace 组织多支 Team | 有（Channel / 收件箱 / Task Thread 页面） | **是**（v0.2.2；push 2026-10-10） | GitHub API / npm |
| 5 | **limuyang2 Agent Team** | `@limuyang2/dsh-agent-team` · <https://github.com/limuyang2/agent-team> | 每个成员都是**独立 root agent**（不降级成 subagent），混用模型/provider，**指定恰好一个 Leader**，共享 Workspace | 有（全屏 Team workbench + 浮动启动器 + 助手库） | 存疑（v0.1.4，**最后 push 2026-08-26**，约 6.5 周未动；8 个 open issue） | GitHub API / npm / raw README |
| 6 | **toolclub Agent Team GUI** | `toolclub/dsh-agent-team-gui` · <https://github.com/toolclub/dsh-agent-team-gui> | **持久多模型 workflow 团队**：动态 lead 规划、有界 DAG、每 agent 独立模型/工具、Run Center + Token 用量洞察 | 有（Run Center） | **是**（push 2026-10-08；**283★**，品类里社区最高） | GitHub API |
| 7 | **StarPivot Agent Teams** | `@starpivot/dsh-agent-teams` · <https://github.com/StarPivotNet/dsh-plugins-public> | 「durable teammates, task DAG, **read-only role isolation**」 | 未确认 | 存疑（v0.2.1，2026-08-22 后无新发布；月下载 199） | npm search |
| 8 | **dsh-agent-teams-meta** | `dsh-agent-teams-meta`（**无仓库链接**） | 「独立团队协调、动态路由、用量账本、Web 面板」 | 有（Web panel） | 存疑（v0.1.1，2026-08-16；月下载 437） | npm search |
| 9 | **@paircode/agent-teams** | `@paircode/agent-teams`（**无仓库链接**） | **`dsh-agent-teams` 的移植，但用「单 Agent 多步执行」**达成：任务 DAG 就绪推进、质量门禁修复循环、两阶段批准、Web 活动面板（**不含成员子会话**） | 有 | 存疑（v1.1.1，2026-09-24；月下载 337） | npm search |
| 10 | **dsh-team-rooms** | `dsh-team-rooms` · <https://github.com/PerryLink/dsh-team-rooms> | **扁平跨会话团队房间**：消息总线 + 共享任务板 + 审批门交接 + 共享时间线，DSH 重启后存活 | 有（Web 设置页：成员状态/任务板/时间线） | **已 RETIRED（2026-10-05）** —— 官方内置后被作者主动弃用 | npm registry |

**关于 #4 与 `@wowyuarm/dsh-agent-team` 的核实结论（重要）**：
`@wowyuarm/dsh-agent-team` **确实存在**，v0.1.0 → 0.2.1 全部版本都被标记 `deprecated: "moved to @contexera/dsh-agent-team / 已迁移到新包名"`。两者是**同一个项目、同一位维护者**（npm 用户 `wowyuarm` / wuyuang1007@gmail.com），`@contexera/` 是新名。Contexera README 明确写：「旧的 `@wowyuarm/dsh-agent-team` 停在 0.2.1，已标记废弃并指向新名；profile 换插件名即可，**数据无需迁移**。」
→ 所以**它们不是两个竞品，是一个竞品的两个包名**。品类实际玩家数要按这个修正。

### 2.2 卫星 / 相邻插件（不自己实现组队，但属于同一品类生态）

| 名称 | 包名 / 仓库 | 一句话定位 | 有 UI | 维护 |
|---|---|---|---|---|
| **Agent Teams Office** | `@zaimokuza/dsh-agent-teams-office` · <https://github.com/zaimokuza-yoshiteru/dsh-agent-teams-office> | **给 Agent Teams 加一个 3D / 像素「办公室」视图**：16 个队友工位 + Lead 独立办公室，点人物看状态/聚焦，真实消息与任务事件触发拜访/交接/讨论/完成动画 | 有（右侧边栏「办公室」标签，可悬浮） | 是（Beta，0.1.0-beta.1，2026-09-16；月下载 1,319） |
| **team-auto-router** | `dsh-team-auto-router` · <https://github.com/snow930/dsh-team-auto-router> | 复杂度触发的 AgentTeams **自动激活**：在 agent/pre-step 边界给每条真实用户消息打分，超阈值就注入「请求确认」或确定性的激活指令 | 无 | 存疑（v0.1.2，2026-08-27；月下载 53） |
| **agent-teams-approval** | `dsh-agent-teams-approval` · mimajiushi/dsh-plugins | Settings → General 一个开关，让 AgentTeams **跳过 Web plan 审批点击** | 有（设置项） | 存疑（v0.1.0，2026-09-27；月下载 159） |
| **agent-teams-limits** | `dsh-agent-teams-limits` · mimajiushi/dsh-plugins | Settings → Plugins 卡片，设置 AgentTeams **成员上限与每队并发上限** | 有（设置卡片） | 存疑（v0.1.0，2026-09-27；月下载 165） |
| **agent-team-model-pin** | `@lolkda/dsh-agent-team-model-pin` · <https://github.com/lolkda/dsh-agent-team-model-pin> | 用原生命令菜单**选择 Team 的模型、reasoning effort 与建队时的 Agent preset** | 有（命令菜单） | 存疑（v1.5.1，2026-10-04） |
| **@dsh-cc/coordinator** | `@dsh-cc/coordinator` · dsh-cc/dsh-cc | 「Coordinator 模式编排，基于 continuable subagents」 | 未确认 | 存疑（v0.8.3，2026-10-04；月下载 3,393） |
| **dsh-multi-model-orchestrator** | `dsh-multi-model-orchestrator` · Bazley13/dsh-multi-model-orchestrator | **「主脑」拆解任务，按各模型所长分派给 GLM / Kimi / Qwen 等子 agent**，带每模型 token 用量 | 未确认 | 存疑（v0.2.2，2026-09-07；月下载 910） |
| **dsh-subagent-mcp** | `dsh-subagent-mcp` · dqtz5vpvj9-create/dsh-subagent-mcp | **「让 Codex 领队、DeepSeek 干活」**：并行持久 DSH agent，原生完成回调、不轮询模型 | 未确认 | 存疑（v0.7.0，2026-09-29；月下载 2,845） |
| **dsh-subagent-registry** | `@aiwayds/dsh-subagent-registry` · fan56/dsh-subagent-registry | 把 `~/.dsh/agents/*.md` 注册成可调用 subagent（`use_agent` 工具）+ 可续期后台派发 | 无 | 存疑（v0.13.0，2026-09-29） |
| **agent-dashboard** | `YYTbit/dsh-plugin-agent-dashboard` | 多 agent **看板技能**（展示导向、只读为主） | 有 | 未确认 |
| **dsh-automation** | `titanwings/dsh-automation` | 在**全新 agent session** 里跑定时编码任务（拥有「何时跑」） | 未确认 | 未确认 |
| **lunheng-article-pipeline** | `lunheng-article-pipeline` · zuoyunlai/lunheng-article-pipeline-dsh | **固定 9 角色（T1–T9）多 Agent 长文流水线**：定题→并行检索→分析→大纲人在环→写作→批判→审计→审稿→修订→配图→终检；T0 主控调度 | 未确认 | 是（v18.94.1，2026-10-10；月下载 30,812） |

### 2.3 底层基座（官方，非竞品但决定品类边界）

| 包 | 作用 |
|---|---|
| `@deepseek-ai/dsh-subagent` + `-spawn-in-process` / `-fork-in-process` / `-in-process-driver` | **subagent seam**（`ctx.subagents`）：命名 provider 注册表，把工作委派给子 agent |
| `@deepseek-ai/dsh-tool-subagent` / `-subagent-control` / `-subagent-report` | 面向模型的委派工具；`send_message` / `interrupt_agent` / `list_agents` 全局命名控制；子作用域汇报 |
| `@deepseek-ai/dsh-workflow` + `dsh-tool-workflow` + `dsh-workflow-ptc` / `-worker-thread` | **workflow 编排 seam**（`ctx.workflows`）：跑 JavaScript 编排脚本，`agent()` 调用桥回 `ctx.subagents` |
| `@deepseek-ai/dsh-tool-ralph` | fresh-agent Ralph 循环（基于 workflow + subagent） |
| `@deepseek-ai/dsh-experimental-agent-team-profile` / `-web-profile` | 启用 Agent Teams 的 profile bundle 层 |

**本机实测（决定性证据）** —— 用 `cordis_inspect` 查本机 DSH 运行时 Config 清单，**已经装的**相关条目：

```
include:agent-teams        → @nanmicoder/dsh-agent-teams        (status: schema)
include:team-auto-router   → dsh-team-auto-router               (status: schema)
include:team-rooms         → dsh-team-rooms                     (status: schema)
include:subagent-profile   → dsh-subagent-profile               (status: absent)
include:effort-router      → dsh-effort-router                  (status: schema)
```

→ **本机 profile 里层级式 AgentTeams（#2）与扁平式房间总线（#10，已上游弃用）是同时挂载的。** 这直接关系到 §3 的「混合拓扑」问题。

### 2.4 生态横向信号（说明品类有多热）

| 指标 | 数值 | 来源 |
|---|---|---|
| DSH 主仓 star | 246,974 | GitHub API `deepseek-ai/deepseek-harness` |
| 上游 AgentTeams star / fork / open issues | **2,008 / 180 / 75** | GitHub API `NanmiCoder/dsh-agent-teams` |
| 上游 npm 月下载 | 56,429 | npm search |
| 官方 agent-team 包月下载 | 551,672（`-profile` 包）；554,427（核心包）；500,872（tool）；549,217（client-ui） | npm search |
| awesome-dsh-plugin（社区精选列表） | 18,310★ / 3,949 fork / 956 open issues | GitHub API |
| npm 上 `dsh-plugin` 关键词相关包总数 | 搜索 `dsh-plugin` 返回总数 287,221（含噪声）；搜索 `dsh multi-agent orchestration subagent` 总数 206,120 | npm search `total` |
| 单个作者产出 | PerryLink 一家维护 **45 个** DSH 插件 | dsh-team-rooms README |

---

## 3. 生态位归纳：按「组织架构」维度分类

### 3.1 四个分类，以及每个竞品落在哪里

#### A. 领队中心式（captain + members，单层）
> 特征：一个明确的 leader/root session 拥有团队，向下派发任务；成员是下属，不是对等节点。

| 竞品 | 领队形态 | 落点说明 |
|---|---|---|
| **NanmiCoder AgentTeams（#2）** | 当前 session = captain | 教科书式：captain 拥有 roster / DAG / 质量门 / 信箱；成员只能向 captain 汇报 |
| **dsh-agent-teams-fish（#3）** | 同 #2（未改逻辑） | 只加了队长头像跟随路由，拓扑不变 |
| **limuyang2 Agent Team（#5）** | **恰好一个 Leader**，成员是**独立 root agent** | 领队中心 + 成员自治（成员有自己的 session/模型/权限），但层级只有 1 层 |
| **toolclub Agent Team GUI（#6）** | **动态 lead**（每次 run 可换） | 「dynamic lead planning, bounded DAGs」——领队可换，仍是单层 |
| **dsh-multi-model-orchestrator** | 「主脑」 | 主脑拆解 → 按模型所长分派 → 子 agent 执行 |
| **@dsh-cc/coordinator** | Coordinator | 「Coordinator-mode orchestration over continuable subagents」 |
| **dsh-subagent-mcp** | Codex（外部）领队 | 「Let Codex lead and DeepSeek do the work」 |
| **@paircode/agent-teams（#9）** | 单 Agent 扮演多个角色 | **冒名的领队中心**：没有真实成员子会话，用一个 agent 多步执行模拟团队 |
| **@lolkda/dsh-agent-team-model-pin** | （卫星） | 不组队，只给团队定模型/effort/preset |

#### B. 扁平分布式（会话间房间 / 消息总线）
> 特征：没有 leader；若干个对等 session 通过共享房间、总线、任务板协作；路由靠人（@提及）或靠抢单。

| 竞品 | 落点说明 |
|---|---|
| **官方 Agent Teams（#1）** | **偏扁平，但有一个隐式根成员**。官方描述是「**Implicit-root** Agent Teams roster, **durable peer mailbox**, and shared task DAG」—— 一个隐式根 + **对等信箱** + 共享 DAG。对等（peer）是它自己的用词 |
| **dsh-team-rooms（#10）** | **最纯的扁平**：8 个 `room_*` 工具、消息总线（定向/广播）、共享任务板、审批门交接、共享时间线；成员就是普通 session，**房间不带模型路由**；`room_transfer_task` 需审批 |
| **Contexera Agent Team（#4）** | 扁平 + 人做路由：「Human 管 Channel 与职责。你决定谁在哪个频道、负责什么；**@提及把工作路由到对的 Agent**」；**没有领队角色**，反而有「Human 收件箱」把需要你的事项置顶 |
| **YYTbit agent-dashboard** | 多 agent 看板，展示导向只读 |

#### C. 单会话子代理路由（不组队，只选模型）
> 特征：不产生团队对象，只有「我该派谁去、用哪个模型」。

| 竞品 | 落点说明 |
|---|---|
| **`@deepseek-ai/dsh-subagent` 全家桶** | `ctx.subagents` 命名 provider 注册表 + spawn/fork 后端；`subagent` 工具只做「委派给一个子 agent」 |
| **`@deepseek-ai/dsh-subagent-registry`** | 把 `~/.dsh/agents/*.md` 变成可调用 subagent |
| **`dsh-effort-router` / `dsh-subagent-profile`**（本机已装/存在） | 路由与档位选择，不组队 |
| **`@deepseek-ai/dsh-workflow` + `dsh-tool-workflow` + `dsh-tool-ralph`** | 用 JS 脚本编排 `agent()` 调用 —— 编排存在，但是**一次性的脚本级编排，不是常驻团队** |
| **dsh-plugin 生态里的 model-proxy / auto-tier / router 类**（如 `dsh-plugin-model-proxy`、`dsh-autotier`、`dsh-routing-suite`） | 纯模型路由，与组队无关 |

#### D. 混合型（同时具备以上多种）
> **这是本次调研最重要的判断，见 §3.2。**

| 对象 | 为什么算混合 | 性质 |
|---|---|---|
| **本机实际运行的组合** | `@nanmicoder/dsh-agent-teams`（层级：captain + members + DAG + 质量门）**同时挂载** `dsh-team-rooms`（扁平：房间 + 总线 + 共享任务板） | **组合式混合，不是设计式混合** |
| **官方 Agent Teams（#1）** | 隐式根（层级锚点）+ 对等信箱（扁平） | **设计式混合的第一层**，但只有 1 层领队 |

### 3.2 关键问题：品类里是否有人已经做了「混合拓扑（多层领队 + 局部扁平）」？

**答案：没有。没有任何一个产品把「多层领队 + 层内局部扁平」做成一等公民。**

逐条证据（这是本节的核心，请重点看）：

1. **层级式竞品全部只有 1 层领队。**
   - NanmiCoder（#2）：一个 captain + 平铺的 members。我方可读的协议规范里，成员是「member」而不是「sub-captain」；成员不能同时拥有第二个未完成任务（`A member cannot own a second unfinished task`）—— 这是**平铺资源模型**，不是树。
   - 成员虽然可以再用 `subagent` 工具生出子代理（`interrupt_agent` 说明里写「Subagents it started will keep running」），但那是**临时的 subagent 嵌套**，**不是子团队对象**：没有嵌套的 roster、没有嵌套的任务板、没有嵌套的 DAG、没有子队长身份。所以它是「树状的进程」，不是「树状的团队」。
   - limuyang2（#5）**显式限定**「assign **exactly one** Leader」—— 作者把单领队当作设计约束写进 README。
   - toolclub（#6）是「dynamic lead」：领队可以**换人**，但层级数不变，仍是 1 层。
   - Contexera 作者自己在对比表里也把 #2 概括为「把**当前** session 变成 captain…工作单位 = **一个 session**」——即单层。

2. **扁平式竞品完全没有层级。**
   - `dsh-team-rooms`（#10）：对等房间，成员是**普通 session**，README 明确「**房间不带模型路由**（rooms carry no model route — members are ordinary sessions）」。没有 leader 概念。
   - Contexera（#4）：**人**做路由（@提及），没有算法意义上的领队，更不用说多层。
   - 官方（#1）：**implicit-root**，即根是隐含的单一个；其余是 **peer** mailbox。它是「一锚点 + 一层对等网」，不是「多层锚点」。

3. **官方对「根」的定义恰好堵死了多层。**
   官方包的描述用词是 **Implicit-root**（隐式根）—— 团队由创建它的那个 session 隐含地当根，没有「再往上一层」的概念，也没有「根下的某个成员自成一队」的概念。

4. **本机的「混合」是巧合，不是设计。**
   实测本机同时挂了 `@nanmicoder/dsh-agent-teams`（层级）与 `dsh-team-rooms`（扁平）。但两者是**两个互不认识的命名空间**：
   - 层级的工具是 `agent_teams_*`（roster / task / message / claim / view / amend / reassign…），任务对象叫 **task**，带 `dependencies` DAG、`kind`/`acceptance`/`verify` 质量契约。
   - 扁平的工具是 `room_*`（`room_list_rooms` / `room_post` / `room_read` / `room_list_tasks` / `room_create_task` / `room_claim_task` / `room_transfer_task` / `room_complete_task`），任务对象叫 **board row**，只有 status（todo / in-progress / done）。
   - **两套任务板不互通**：AgentTeams 的 task 不会出现在 room 的 board 上，反之亦然。没有跨层的任务桥、没有统一的「谁属于谁」的拓扑契约、没有 cross-layer 的路由规则。用户看到的是**两个并排的面板**。
   - 更糟的是：`dsh-team-rooms` 已经被作者因「官方已内置」而 **RETIRED（2026-10-05）**，这条混合路径正在自然消亡。

5. **官方自己的 roadmap 也没有多层。**
   官方 agent-team 子系统的 5 个包，职责划分是：core（roster + mailbox + DAG）/ profile / web-profile / tool / client-ui。**没有任何一个包负责嵌套、子团队、层级裁决或跨层路由。**

**结论一句话**：
> **「多层领队 + 层内扁平」在 DSH agent-team 品类里是真空地带。** 现有玩家分成两派：一派做单层领队（NanmiCoder / limuyang2 / toolclub / orchestrator 类），一派做无领队的扁平房间（team-rooms / Contexera / 官方对等信箱）。**没有任何人把「树」和「网」在同一个产品里合成「层内网、层间树」**，也没有人提供层边界、子队长身份、跨层任务传播、或跨层质量门这些必备原语。本机那种「层级插件 + 扁平插件并挂」只是两个孤岛，任务模型都不共享。

### 3.3 顺带归纳：拟人化 / 拟物化光谱（用户关心的另一维度）

| 程度 | 竞品 | 具体表现 |
|---|---|---|
| **重拟人化** | **dsh-agent-teams-fish（#3）** | 271 张厂商角色立绘（17 厂商 × 10 岗位）+ 队长立绘 + 厂商商标徽标 + 活动状态动作图；点开是 320px 全身立绘 |
| **重拟物化（场景）** | **@zaimokuza/dsh-agent-teams-office** | 3D / 像素**办公室**：16 个队友工位 + Lead 独立办公室；工作中的成员回工位、空闲成员自由活动；真实消息与任务事件触发拜访/交接/讨论/完成动画；可悬浮出侧边栏 |
| 轻拟物化 | 上游 NanmiCoder（#2） | 只有一套灰鲸头像（15 张：队长 / 8 岗位 / 6 动作） |
| 工程面板型（无拟物） | toolclub（#6）Run Center、Contexera（#4）Channel/Task Thread、dsh-team-rooms（#10）设置页、YYTbit dashboard | 列表 / 看板 / 时间线 / 表格 |

**重要的边界事实**（对「不要拟人拟物」的需求很关键）：
- `@zaimokuza/dsh-agent-teams-office` README 明确写：「**动画不调用模型，也不会创建消息或任务。**」—— 它是**纯展示层**，对协作零贡献。
- 同理 YYTbit dashboard 被 `dsh-team-rooms` 作者评为「**Display-oriented and read-mostly**」。
- **整个品类里没有任何一个产品提供「工程化、零拟人、零拟物」的团队 UI 作为卖点或可选项。** 想关掉拟物只能不装那个插件；想关掉 fish 的拟人只能不装 fish 或用 `artworkDir` 换成抽象图形（这是 fish 唯一提供的「去拟人」后门）。

### 3.4 品类生命周期观察（可信度较高的推断）

- **2026-08-10 ~ 08-13**：DSH 官方 subagent / workflow seam 上线。
- **2026-08-12 ~ 08-17**：NanmiCoder（2008★）、limuyang2、toolclub 等社区团队插件集中涌现。
- **2026-09-09**：**官方 Agent Teams 子系统发布**（`@deepseek-ai/dsh-experimental-agent-team` 家族，0.1.5-alpha.2）。
- **2026-10-05**：`dsh-team-rooms` 作者因「官方已内置」**主动 RETIRED** 自己的扁平房间实现。
- **2026-10-04 ~ 10-10**：fish fork 出现并高速迭代（0.1.22 → 0.5.0）。
- **2026-10-10**：生态仍在活跃（多个包当日发布/刷新）。

**含义**：品类正处在**「官方收编」阶段**。第三方扁平实现已被证明会被官方内置挤掉（team-rooms 是活样本）；第三方层级实现（NanmiCoder，2008★ / 75 issues）体量大、迭代快，暂时站得住，但**与官方 Agent Teams 功能重叠明显**（都是 roster + mailbox + task DAG）。在这种格局下，**差异化只能来自官方没做的东西** —— 而「多层领队 + 层内扁平」的混合拓扑，以及「反拟人/反拟物的工程化团队 UI」，恰好都是官方与现有第三方**都没有做**的。

---

## 4. 三个最关键的空白点（按重要性排序）

### 空白点 1 —— 混合拓扑（多层领队 + 层内扁平）完全无人实现
- 层级派全是**单层领队**（NanmiCoder 1 个 captain；limuyang2 显式「exactly one Leader」；toolclub 领队可换但仍 1 层；官方是 **Implicit-root** 单锚点）。
- 扁平派**完全没有层级**（team-rooms 对等房间、无模型路由；Contexera 靠人 @提及路由，无领队）。
- 本机那种「层级插件 + 扁平插件并挂」是**两个孤岛**：`agent_teams_*` 的 task（带 DAG + 质量契约）与 `room_*` 的 board row（只有 todo/in-progress/done）**互不互通**，混合路径还因 `dsh-team-rooms` 被 RETIRED 而正在消亡。
- **缺失的原语**：子队长身份、层边界、跨层任务传播/汇总、跨层质量门组合、层内局部扁平（peer 协商）与层间树状（权威裁决）的同一套契约。

### 空白点 2 —— 「反拟人 / 反拟物」的工程化团队 UI 完全空白，且品类正朝反方向跑
- 品类当前的美术投入方向是**加装饰**：fish 加 271 张角色立绘 + 17 套厂商徽标；`@zaimokuza` 加 3D/像素办公室 + 工位 + 拜访动画。
- 拟物层被明确证明是**纯展示**（office README：「动画不调用模型，也不会创建消息或任务」；dashboard 被同行评为「read-mostly」）。也就是说，**这些美术投入不产生任何协作能力**。
- 品类里**没有一个产品**把「高信息密度、零拟人、零拟物的工程面板」当卖点或提供为开关。唯一接近「去拟人」的手段是 fish 的 `artworkDir` 白名单替换（但那是给美术换图，不是给工程化让路，且要自己画 17×10 张图）。
- **缺失的原语**：以拓扑/依赖/状态/成本为一等公民的视图（谁在等谁、关键路径、阻塞点、token 花在哪个成员），以及「无头像 / 无角色立绘 / 无场景」的默认形态。

### 空白点 3 —— 层级与扁平之间没有共享的任务模型，也没有跨层质量门
- 两套任务语义并存却不兼容：AgentTeams 的 **task**（`dependencies` DAG、`kind`/`objective`/`acceptance`/`verify`/`inScope` 质量契约、`attempt_id` 能力、review/repair/verification/integration 门）vs rooms 的 **board row**（只有 status）。
- 因此**无法**把「一层里的质量门」组合成「多层质量门」：没有「子团队自己的 review 通过后，才向上层交付」这种原语，也没有把上层的 acceptance 下传成子团队 objective 的机制。
- 官方与第三方都**没有**做这个桥（官方 5 个包职责划分里没有「层级裁决」或「跨层路由」）。
- **含义**：即使有人明天做出多层领队，也会立刻撞上这个问题 —— 所以「统一任务模型 + 跨层质量门契约」其实应该和空白点 1 一起设计，它是混合拓扑的**前置依赖**，不是后续优化。

> 补充（可视为第 4 个次要空白）：**拓扑可观测性与运行期可干预**无人做。所有 UI 都是「看」——树的展示、看板的展示、办公室的展示。**没有任何产品暴露「谁领谁、层边界在哪」这种可读可改的拓扑状态**，也没有「飞行中改拓扑（拆层、合层、换层边界）」的能力。

---

## 5. 来源链接清单

### 5.1 `dsh-agent-teams-fish`
- <https://github.com/Fish-under-sea/dsh-agent-teams-fish>（GitHub 仓库页）
- <https://api.github.com/repos/Fish-under-sea/dsh-agent-teams-fish>（仓库元数据：创建/推送时间、star、fork、issues、size、topics、license）
- <https://api.github.com/repos/Fish-under-sea/dsh-agent-teams-fish/readme>（README，base64 编码，`size: 29529`）
- <https://raw.githubusercontent.com/Fish-under-sea/dsh-agent-teams-fish/main/README.md>（README 纯文本，本报告 §1.3 的全部依据）
- <https://api.github.com/repos/Fish-under-sea/dsh-agent-teams-fish/commits?per_page=5>（提交历史与时间戳）
- <https://registry.npmjs.org/dsh-agent-teams-fish>（npm 全量文档：版本列表、author、maintainer、依赖、scripts、homepage 变更）
- <https://registry.npmjs.org/-/v1/search?text=dsh-agent-teams&size=20>（最新版 `0.5.0` 与下载量）

### 5.2 上游与同品类核心竞品
- 上游仓库：<https://github.com/NanmiCoder/dsh-agent-teams>
- 上游 API：<https://api.github.com/repos/NanmiCoder/dsh-agent-teams>（2008★ / 180 fork / 75 open issues）
- 上游 npm：<https://www.npmjs.com/package/@nanmicoder/dsh-agent-teams>

- Contexera 仓库：<https://github.com/Contexera/dsh-agent-team>
- Contexera API：<https://api.github.com/repos/Contexera/dsh-agent-team>（57★ / 15 fork / 2 issues）
- Contexera npm（含 README，含「与同名插件的区别」对比表）：<https://registry.npmjs.org/@contexera/dsh-agent-team>
- **旧包名 `@wowyuarm/dsh-agent-team`（已废弃、指向新名）**：<https://registry.npmjs.org/@wowyuarm/dsh-agent-team>

- limuyang2 仓库：<https://github.com/limuyang2/agent-team>
- limuyang2 API：<https://api.github.com/repos/limuyang2/agent-team>（42★ / 5 fork / 8 issues / 最后 push 2026-08-26）
- limuyang2 README：<https://raw.githubusercontent.com/limuyang2/agent-team/main/README.md>（「exactly one Leader」「does **not** turn members into subagents」）
- limuyang2 npm：<https://www.npmjs.com/package/@limuyang2/dsh-agent-team>

- toolclub 仓库：<https://github.com/toolclub/dsh-agent-team-gui>
- toolclub API：<https://api.github.com/repos/toolclub/dsh-agent-team-gui>（283★ / 5 fork / 12 issues / push 2026-10-08）

### 5.3 官方 Agent Teams 子系统
- 官方仓：<https://github.com/deepseek-ai/deepseek-harness>
- API：<https://api.github.com/repos/deepseek-ai/deepseek-harness>（246,974★）
- 核心包：<https://www.npmjs.com/package/@deepseek-ai/dsh-experimental-agent-team>（"Implicit-root Agent Teams roster, durable peer mailbox, and shared task DAG"）
- profile 包：<https://www.npmjs.com/package/@deepseek-ai/dsh-experimental-agent-team-profile>
- web profile 包：<https://www.npmjs.com/package/@deepseek-ai/dsh-experimental-agent-team-web-profile>
- tool 包：<https://www.npmjs.com/package/@deepseek-ai/dsh-experimental-tool-agent-team>
- client UI 包：<https://www.npmjs.com/package/@deepseek-ai/dsh-experimental-client-ui-agent-team>
- npm 检索（含上述全部）：<https://registry.npmjs.org/-/v1/search?text=dsh%20agent%20team&size=60>

### 5.4 扁平式 / 房间式
- `dsh-team-rooms` 仓库：<https://github.com/PerryLink/dsh-team-rooms>
- `dsh-team-rooms` npm（含 **RETIRED 弃用声明**、8 个 `room_*` 工具清单、Config 表、"Not this plugin" 对比）：<https://registry.npmjs.org/dsh-team-rooms>
- 前身：<https://github.com/PerryLink/dsh-background-agents>
- 本机运行时清单（`cordis_inspect` → host/Config/listConfigs）：实时证明本机同时挂载 `@nanmicoder/dsh-agent-teams` + `dsh-team-rooms` + `dsh-team-auto-router`

### 5.5 卫星 / 相邻
- Agent Teams Office（3D/像素办公室）：<https://github.com/zaimokuza-yoshiteru/dsh-agent-teams-office> · README <https://raw.githubusercontent.com/zaimokuza-yoshiteru/dsh-agent-teams-office/main/README.md> · npm <https://www.npmjs.com/package/@zaimokuza/dsh-agent-teams-office>
- team-auto-router：<https://github.com/snow930/dsh-team-auto-router>
- agent-team-model-pin：<https://github.com/lolkda/dsh-agent-team-model-pin>
- dsh-cc（coordinator / plugin-loader）：<https://github.com/dsh-cc/dsh-cc>
- dsh-multi-model-orchestrator：<https://github.com/Bazley13/dsh-multi-model-orchestrator>
- dsh-subagent-mcp：<https://github.com/dqtz5vpvj9-create/dsh-subagent-mcp>
- dsh-subagent-registry：<https://github.com/fan56/dsh-subagent-registry>
- lunheng-article-pipeline：<https://github.com/zuoyunlai/lunheng-article-pipeline-dsh>
- dsh-automation：<https://github.com/titanwings/dsh-automation>
- YYTbit agent-dashboard：<https://github.com/YYTbit/dsh-plugin-agent-dashboard>

### 5.6 生态目录与检索入口
- awesome-dsh-plugin（社区精选，18,310★）：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin> · <https://awesome-dsh-plugin.com>
- 其他市场/目录：<https://dsh.market/>、<https://dsh-plugin.org>、<https://dshfind.com>
- npm 精确检索（本报告主要用到的几个）：
  - `dsh-plugin`：<https://registry.npmjs.org/-/v1/search?text=dsh-plugin&size=100>
  - `dsh agent team`：<https://registry.npmjs.org/-/v1/search?text=dsh%20agent%20team&size=60>
  - `dsh-agent-teams`：<https://registry.npmjs.org/-/v1/search?text=dsh-agent-teams&size=20>
  - `dsh multi-agent orchestration subagent`：<https://registry.npmjs.org/-/v1/search?text=dsh%20multi-agent%20orchestration%20subagent&size=50>
- GitHub topic 检索：<https://github.com/topics/dsh-plugin>、<https://github.com/topics/dsh-plugins>

---

## 6. 未确认事项（明确标注，未做任何推断填补）

1. **`dsh-agent-teams-meta` 与 `@paircode/agent-teams` 的源码仓库** —— npm 元数据无 `repository`/`homepage` 字段，无法核实实现细节与活跃度，只有包描述。
2. **`@starpivot/dsh-agent-teams` 的实际能力与 UI** —— 仅从 npm 描述「durable teammates, task DAG, read-only role isolation」与仓库路径 `StarPivotNet/dsh-plugins-public/tree/main/packages/agent-teams` 得知，未读 README。
3. **`dsh-subagent-profile`、`dsh-effort-router` 的作者与仓库** —— 仅从本机运行时清单得知它们存在于本 profile，未查到 npm 公开条目。
4. **fish 的 star / issue 数会随作者自测而变化** —— 本报告为 `2026-10-10T21:0xZ` 快照（1★ / 0 fork / 0 open issue）。
5. **fish 的 `README.md` 与 npm 包内 README 是否一致** —— 作者自己说明 npm 包内 README 在发布时冻结（0.4.3 就是为此外发）；本报告读的是**仓库 README**（对应 0.5.0 内容），未逐一比对 npm 冻结副本。
6. **`@zaimokuza/dsh-agent-teams-office` 在其他操作系统上的可用性** —— README 自称「已在 macOS 桌面端验证」，Windows / Linux 未验证。其 npm 版本号 `0.1.0-beta.1` 为 beta，README 亦标注「当前为 Beta」。
7. **`lunheng-article-pipeline` 是否属于「团队协作」还是「固定流水线」** —— 从其描述看是**固定 9 角色流水线**（T1–T9「互不可替代」、T0 主控调度），没有动态组队语义；本报告将其归入「相邻」而非「核心竞品」。此归类为本人判断，非官方口径。
8. **`@deepseek-ai/dsh-experimental-agent-team` 是否支持嵌套子团队** —— 本报告结论「不支持」的依据是**其 5 个官方包的职责描述中没有任何嵌套/层/Routing 包**，以及「Implicit-root」这一用词。**未阅读其源码验证**，属高置信度推断而非确证。
