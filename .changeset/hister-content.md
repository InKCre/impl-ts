---
'@inkcre/core': patch
'@inkcre/client-web': patch
'@inkcre/client-webext': patch
'@inkcre/ext-local-files': minor
---

保留页面已有正文与 HTML 结构，增加 Markdown 通用解释与安全阅读，并衔接 Local Files v2 及旧网页材料。

Web、WebExt 与 Local Files 使用正式 UI 2.7.0 阅读组件；移除已被上游修复取代的 WebExt 2.6.0 补丁，其余 2.5.0 消费者仍保留原补丁。
