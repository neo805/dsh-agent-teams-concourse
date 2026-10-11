# 语料回归报告（P1）

- 语料：`C:\Users\KEI.NEO\Documents\Projects\2026.10_dsh-agent-teams-concourse\test\fixtures\corpus\public.jsonl`（54 条）
- 时间：2026-10-11T13:06:50.093Z
- 判定下限：effort exact ≥ 50% · effort ±1 ≥ 85% · tier exact ≥ 70%

## 命中率

| 指标 | 命中率 | 命中/总数 |
| --- | --- | --- |
| effort exact | 96.3% | 52/54 |
| effort ±1 档 | 100% | 54/54 |
| tier exact | 98.1% | 53/54 |

**判定：通过（退出码 0）**

## 被系统性高估/低估的维度

| 维度 | 高估（预测 > 标注） | 低估（预测 < 标注） |
| --- | --- | --- |
| effort | 0 | 2 |
| tier | 0 | 1 |

> effort 存在系统性低估倾向，考虑上调 cognitive 权重。

## 未命中明细

| 语料（截断） | 期望 | 实际 | 画像（cognitive/breadth/risk） |
| --- | --- | --- | --- |
| 1做登录 2做注册 3做找回密码，先出接口 | default+balanced | low+balanced | 2/3/reversible |
| 帮我分析一下这个持续三天的线上抖动：高峰期 CPU 偶发抖到 95%，GC 次数… | default+balanced | low+cheap | 2/1/readonly |
