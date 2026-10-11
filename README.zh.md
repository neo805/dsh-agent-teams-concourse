# dsh-agent-teams-concourse

> **WIP — 开发中（P0 脚手架阶段）。** 功能与 API 均不稳定。

本插件是 DeepSeek Harness 的组织层：拓扑即数据（虚拟拓扑，官方完全图上裁剪开放边集）、逐顶点模型定档、通信硬约束、反拟人化高密度 UI。一次计划审批，运行期零审批。

设计与阶段路线见 [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)；需求依据见同目录调研报告。

## 开发命令

| 命令 | 作用 |
| --- | --- |
| `pnpm test` / `test:coverage` | 单测 / 带覆盖率门禁 |
| `pnpm typecheck` · `lint` | 类型与静态检查 |
| `pnpm check:boundaries` | 模块依赖方向门禁（kernel 零宿主依赖） |
| `pnpm verify:assets` | 零美术资产 / 零 emoji 门禁 |
| `pnpm verify` | 全部门禁（阶段出口标准） |

## License

MIT © neo805
