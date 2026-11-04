---
'@inkcre/core': patch
'@inkcre/web': patch
'@inkcre/webext': patch
---

统一观测记录的采集与查询，默认使用内置信息库，选定 Loki 时通过具备能力的 Peer 读写；Web 提供全局筛选、关联时间线与明确的后端/历史状态，Job 生命周期记录不再依赖额外 OTEL 出口开关。
