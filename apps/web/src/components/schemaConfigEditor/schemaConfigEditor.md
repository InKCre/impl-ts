# SchemaConfigEditor

Source 与 Peer 配置共用的编辑组合。`modelValue` 始终是一份原始 JSON 文本；可视化表单改动会生成同一份文本，JSON 模式直接编辑它。受支持的 schema 默认使用可视化字段，不支持的结构保留 JSON 编辑能力。无效 JSON 不会被视图切换清空；切到尚不能解析的可视化视图时维持 JSON 模式。

通过 `validation` 返回当前模式的状态与文本，消费者只在两者都与当前草稿一致且状态为 valid 时保存。这里不负责业务提交或持久化。密码输入的遮蔽由 schema 的 `format: password` 指示，只影响可视化显示；JSON 模式和导出保持原值。
