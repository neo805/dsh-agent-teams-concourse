# 人机协作规范 / Human–AI Collaboration Norms

> 本文件记录本项目的**维护者**（人类决策者）与 **AI 协作者**（在 DSH 中工作的编码
> agent）在 Vibe Coding 模式下共同约定的协作规范。它是**双向约定**：双方都按它执行。
> 参照 `2026.10_dsh-effort-router/COLLABORATION.md` 适配本项目制定。
>
> 要改规范，先改这份文件。

**English abstract.** This repository is developed in a human–AI pair-programming
("vibe coding") mode. This document states the norms **both** sides follow:
phase-plan-driven development with TDD, evidence-over-assertion reporting,
root-cause-first debugging, skill-guided plugin install/development,
explicit permission before `git push` / repo creation, a fixed delivery
checklist, and public disclosure of accepted residue.

---

## 1. 计划与版本治理

- **施工依据 `DEVELOPMENT_PLAN.md`**：P0→P4 阶段制，每阶段出口标准以计划文件为准；
  MVP（v0.1.0）必须证明的五件事（V-1..V-5）是验收基线。
- **版本号要谦虚**：bug 修复、参数调整不动基数位，只递增 `-rc.N`；变更
  `major.minor.patch` 基数位**必须先报维护者审批**。
- 每次版本变更同步写 `CHANGELOG.md`（Keep a Changelog：
  `Added / Changed / Fixed / Removed`）。
- **决策留痕**：路线选择、口径偏差、修复决策写入 `docs/decisions/D-*.md`，
  编号递增；探针/实验写入 `docs/spikes/`。偏差必须写明理由与影响面。

## 2. 权限边界

- **`git push` 与建仓必须先问。** 本地 `commit` 可自行完成（提交身份
  `neo805@163.com`）；推送、创建远程仓库等对外动作需维护者明确批准。
- **破坏性操作先确认**：删除/覆盖数据、删除或保护工作表、批量替换、清空
  `node_modules` 等，先说明影响范围并取得确认。
- **改动已安装环境前先留退路**：覆盖 profile 的 `package.json` /
  `cordis.patch.yml` 前先备份并记录时间戳（`yyyyMMdd-HHmmss`）。
- AI 协作者**不得**：未经批准 push、自行升大版本号、静默丢弃已知问题、
  把未验证的事说成已完成。

## 3. 实证优先（Evidence over assertion）

- 任何状态结论都要有**可复核的证据**：
  - 仓库状态 → 实际跑 `git log` / `git status`；
  - 功能可用 → `pnpm vitest run` 实际通过数（当前基线 **333/333**，44 文件）；
  - 安装成功 → 体检脚本四件套 + 裸 import 预检，而不是"拷过去了"；
  - 接线生效 → `dsh --profile <name> --dump-config` 实际输出。
- **不确定就说不确定**；失败如实完整报告（含原始错误文本），不绕过、
  不改断言迎合结果。
- 报告结论带**数值与路径**（版本号、提交号、通过数、文件、日志路径），
  让维护者能独立复核。

## 4. 追根因，不打补丁

- 症状出现时**逐层定位到机制层根因再修**；定位到哪一层就在哪一层修。
- 归罪前先验证：宿主报「failed to import」不给出真实异常时，用裸 import
  预检（`node -e "import('<入口>')"`）区分「插件坏了」与「环境遮蔽」——
  2026-10-12 启动崩溃曾险些误判为本插件 bug，实际根因是失败族 G
  （dsh-plugin-check@0.1.0 把 dsh-tools 写进 dependencies 遮蔽宿主 SDK）。
- 排查过程产出**结论**（试过什么、为什么不行），死路也要留一句话，避免重走。

## 5. 工程纪律（每次改动都遵守）

- **严格 TDD**：先红后绿；测试与实现同提交。
- **单向依赖**：kernel 纯函数零依赖 ← host/service/tools ← client（仅
  kernel + react）；`scripts/check-boundaries.mjs` 是硬门禁。
- **每次交付前 `pnpm verify` 全门禁过**：tsc + oxlint + 边界检查 + 零美术
  资产检查 + vitest + 覆盖率（≥80%）+ pack-smoke。任一不过不交付。
- **cordis 插件形态红线**：
  - 必须 `export const inject`（缺则静默不激活）；
  - `ctx.tools.register` 只收 `defineTool` 产物，output schema 闭合对象
    `additionalProperties: false`（注册抛错会回滚整个插件 effect，下游报
    NO_PROVIDER，极具迷惑性）；
  - `apply` 内每步独立 try/catch，绝不 throw（NFR-2 防 effect 回滚）；
  - NFR-1 惰性安装：`enabled !== true` 时零行为变更。
- **给 profile 装包走技能 `Skill_DSH-Plugin-Safe-Install`**：
  `Invoke-DshPluginSafe.ps1` 执行 + `Test-DshProfileHealth.ps1` 验收；
  **勿裸 `pnpm add`**（用户 pnpm 与 ASAR pnpm store 不匹配会打坏同 profile
  其他插件）；desktop profile CLI 拒绝直装，只能应用内或手工等价操作。

## 6. 人机分工与验收闭环

| 角色 | 职责 |
|---|---|
| **AI 协作者** | 实现、测试、构建、安装、自查、提交、写变更说明、给出验证步骤 |
| **维护者** | 重启后实机验收、拍板版本号、批准 push/建仓、裁决取舍 |

- **实机验收权归维护者。** 自动化测试全绿 ≠ 功能可用；UI 与真机行为必须
  由维护者在真实客户端确认。
- **每次交付给出可执行验证步骤**：打开哪个页面、看哪个位置、预期看到什么、
  出问题怎么回滚。只说"已完成"不算交付。
- 宿主插件只在**进程启动**时加载：验证 patch/profile 改动必须完全重启应用，
  刷新页面不算。

## 7. 已知残留必须公示

- 无法立即解决或经权衡**有意接受**的问题，写入 `docs/mvp-exit-*.md` 的
  「已知限制」或计划文件的未决清单，标明现象、影响范围与缓解手段，
  **不得静默丢弃**。
- 上游问题与本项目问题分开定性；确认属上游的，记录结论与证据后结案。

## 8. 文档与隐私

- **面向维护者的报告用中文**。
- **入库文档不得包含个人隐私或机器专属信息**：绝对路径中的用户名、真实
  邮箱、token/密钥、机器专属运维日志。写路径用 `$DSH_HOME/profiles/<profile>/…`
  这类占位表达。git 提交身份（`neo805@163.com`）是唯一允许的邮箱。
- 提交前自检：这份文档如果被陌生人看到，会不会暴露维护者的个人信息或
  本机结构？

## 9. 沟通约定

- **结论先行**：先说结论与影响，再说依据与细节。
- **数值说话**：版本、提交号、通过数、覆盖率、耗时，能量化就量化。
- **不夸大**：不用"完美/彻底解决"描述未经验证的结果。
- 维护者指出规范层面的问题时，AI 应当**把结论固化进本文件**，
  而不是只记住这一次。

---

_本规范随项目演进；每次修订请在本文件中直接改动，并在提交信息中说明原因。_
