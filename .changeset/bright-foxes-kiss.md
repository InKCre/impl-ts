---
'@inkcre/core': patch
---

普通 Web Peer JWT 保持 24 小时签发默认值，并与数据库准入策略解耦。Twitter 新增 x-monkey 原生归档记录的读取与浏览器连接入口；账户页在本地签发短时 Peer JWT，不增加 Host SDK API，因此仍兼容 Core SDK >=0.4.0。
