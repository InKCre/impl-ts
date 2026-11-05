# LogsViewer

Job 内嵌观测视图，复用 ObservationExplorer 和 Core 的统一查询接口，不直接访问 PostgreSQL 或选择外部供应商。

`jobId` 同时关联新结构化事件和历史 job.N 日志；`since` 使用 Job 创建时间，旧任务不因默认最近窗口而被遗漏。也保留独立 `traceId` 查询。

查询有界，记录过多时提示缩窄范围；不承诺全量历史。`enablePolling` 与 `pollingInterval` 控制刷新。连接或业务范围变化使在途响应失效；刷新失败保留同范围已有记录并提示重试。
