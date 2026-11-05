---
'@inkcre/core': patch
'@inkcre/web': patch
'@inkcre/webext': patch
---

在既有 0.4 兼容线新增无 Vue/Pinia 依赖的 `@inkcre/core/sdk` 入口，提供显式连接的数据访问、字节存储、认证与协议合同；现有应用入口保留兼容，并复用相同传输和存储实现。Web/WebExt 随其内嵌 Core 更新，不要求 MF 分发迁移 Host ABI。
