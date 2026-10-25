# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与
[语义化版本](https://semver.org/lang/zh-CN/)。版本变更须在此登记。

## [Unreleased] — 2026-10-25 · 文档与工作流重构（无代码行为变更）

### Added

- `docs/REQUIREMENTS.html`（需求文档 v2.0）：**唯一需求依据**。合并两册调研，统一需求编号
  （FR-A 拓扑 / FR-B 定档 / FR-C 通信 / FR-D 探针，共 45 条 + NFR 14 条），纳入 P2 路线 A
  决议对架构的修正，并给出每条需求的实现状态（已实现 / 部分 / 未实现）。

### Changed

- `COLLABORATION.md` 升级到姊妹项目同代规范：角色改称**出品人 / AI 第一作者**、
  版本号**全量带 `rc`**、**测试先行**、**四级验证阶梯**（标准测试 → Web 安装 →
  Web 实机验证 → Desktop + 出品人验收，含 Web 实机闸门与 45 分钟预算）、
  交付清单改为「验收通过才 push」、已知残留必须公示、文档隐私边界。
- `DEVELOPMENT_PLAN.md` 重写为 v2.0：P0–P4 与 `0.1.0` / `0.2.0` 归档为已完成；新增
  **P5 旁路探针 MVP / P6 探针生命周期 / P7 校准闭环与运行期能力 / P8 会话加入 T2a /
  P9 发布准备**；技术债 T-1…T-10、风险 P-R1…P-R7、已知残留 13 条全部公示。
- `README.md` / `README.zh.md` 双语重写：现状表（诚实标注未完成项）、快速上手、
  四层结构、闸门口径、已知边界、按版本区间的作者声明。
- 两份调研报告移入 `docs/`（`dsh-agent-teams-concourse-report.html`、
  `dsh-side-inquiry-probe-report.html`），继续作为调研底稿。

### Fixed

- `scripts/corpus-regression.mjs`：报告改为写**仓库相对路径**（此前把绝对路径写进入库文档）。
- 入库文档与脚本的机器路径清理：`research/01–13`、`cordis.patch.yml`、
  `scripts/_mount-concourse.cjs` 内共 46 处 `C:\Users\<user>\…` 替换为
  `$DSH_HOME` / `<DSH_INSTALL>` / `<TEMP>` / `<NPM_GLOBAL>` 等占位符；
  挂载脚本改为从 `$DSH_HOME` 与命令行参数解析，不再硬编码任何机器路径。

## [0.2.0] — 2026-10-18

运行时基线升级到 DSH 0.2.1-rc.2（不兼容 0.2.0 系列），并修复真机测试
（session-69172a02）报告的 6 个问题。

### Changed

- **运行时适配**：`startContinuable` → `startActivation`（持有 Activation 句柄，
  interrupt = 中断信号 + `dispose()` 释放）；`interrupt` 授权改为
  `{ kind: 'ancestor', agent }`；provider capabilities 对齐 0.2.1 契约
  （`agentOptions/agentPreset/outputSchema/depthLimit`）。
- **peerDependencies / devDependencies / engines.dsh** 全部升到 `0.2.1-rc.2`；
  `inject` 增补 `agents`（逐顶点工具面收口所需）。
- **逐顶点 toolFilter** 改道：0.2.1 起 start 期不再接受 toolFilter，改为
  `startActivation` 成功后经 `ctx.agents.get(childId).ctx.tools.restrict()` 应用；
  失败即 dispose + fail-loud（`START_FAILED`）。

### Fixed

- **F5（高）自动 id 重启后必撞号**：进程内计数器不随回放恢复。现在构造时以
  snapshot 中 `concourse-<n>` 的最大序号播种，且 `ensureId` 撞号自动跳过。
- **F4（中）team_plan 结构错误直出 ZodError 多行 JSON、issues 为空**：现返回
  规范化 `SCHEMA` issues（含 path），message 为单行中文摘要；render 打印 path。
- **F1（中）原生 effort 档名按 default 位次零距离胜出**：新增别名表
  （`max→high`、`medium→default`、`minimal→off` 等），rationale 文案补齐
  `off<low<default<high` 并注明原生档位归一化。
- **F2（低）未知字段守卫真机不可达**：改为在 spec 内部逐层扫描未知键，产出
  `UNKNOWN_FIELD` issue（附 did-you-mean），parse 失败时与结构错误一并返回。
- **F3（低）parse 阶段 render 双空格**：无 path 时不再产生空占位。

### Documented (accepted, no code change)

- **F6（低）create 事件内嵌整份 spec**：台账随任务文本线性膨胀。回放需要完整
  concourse 才能重建，去掉内嵌等价于引入外部引用与一致性风险，MVP 接受并记入
  已知限制。

### Infrastructure

- `pnpm-workspace.yaml` 增加 `allowBuilds.koffi: true`（pnpm 11 的新白单位置；
  0.2.1 运行时依赖 koffi 的 install 脚本）。

## [0.1.0] — 2026-10-17

首个 MVP 出口版本：P0–P4 全阶段交付（内核四簇 / 运行时探针 / host+service+tools /
最小 UI），V-1..V-5 证据归集完成。
