---
'@inkcre/core': patch
---

默认数据库认证按连接快照签发和续签 JWT，在实际请求边界拒绝已切换连接的旧查询，避免过期凭据和跨连接认证竞态。保留显式 SDK token provider 的调用方式。
