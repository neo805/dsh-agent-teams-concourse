# dsh-agent-teams-concourse

> **WIP — 开发中（P0 脚手架阶段）。** 功能与 API 均不稳定。

DeepSeek Harness 的**组织层**插件：把「谁和谁能通信、每个执行单元用什么模型与思考强度、任务在层与层之间如何流动」变成可编辑的一等数据。复用官方 agent-team 底座（持久邮箱 / CAS 任务 DAG / invariant），在其上裁剪**虚拟拓扑**——执行底座恒为一层，树形外观由开放边集声明决定。

- 拓扑谱系 T0 / T1a / T1b / T1.5 / T2a（T2b 不提供）
- 逐顶点 model / reasoningEffort / toolFilter / 预算，fail-loud 校验
- 通信硬约束：deny-by-default 开放边集、wake 默认 never、跳数 TTL、幂等去重、速率与预算熔断
- 零美术资产：形状 + 颜色双通道 UI，形状单独即可完整表意

## 开发

```bash
pnpm install
pnpm test            # 单元测试（TDD：先写 failing tests 再实现）
pnpm verify          # 全部门禁：build + typecheck + lint + boundaries + assets + coverage + pack-smoke
```

详见 [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)（阶段路线 P0–P6 与测试策略）与需求调研报告（`dsh-agent-teams-concourse-report.html`）。

## License

MIT © neo805
