---
'@inkcre/core': patch
'@inkcre/ext-twitter': minor
---

普通 Web Peer JWT 保持 24 小时签发默认值，并与数据库准入策略解耦。新增 Twitter 原生归档记录的解码与阅读；Web Host 提供所选 Peer 的浏览器表单凭据交接，用户可以通过 Twitter 扩展显式连接 x-monkey。Twitter MF 需 Host Core SDK >=0.4.1 才能使用该交接能力。
