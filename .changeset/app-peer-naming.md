---
'@inkcre/core': patch
'@inkcre/web': patch
'@inkcre/webext': patch
'@inkcre/ext-caldav': patch
'@inkcre/ext-capture': patch
'@inkcre/ext-github': patch
'@inkcre/ext-local-files': patch
'@inkcre/ext-mail': patch
'@inkcre/ext-memos': patch
'@inkcre/ext-twitter': patch
---

将应用命名统一为 Web / WebExt，明确应用与运行 Peer 的角色；保留浏览器身份、存储、已发布扩展协议与部署兼容入口，构建和开发工具采用新的应用目录与 Runtime 导入名。

对仍准入的 Runtime 0.4.2 单独更新 Zod 依赖至修复版，保留原发布包身份与完整性。
