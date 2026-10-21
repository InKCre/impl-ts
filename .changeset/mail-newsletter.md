---
'@inkcre/core': minor
'@inkcre/client-web': patch
---

支持 newsletter 阅读与原文切换、刊物归档和重复投递折叠；保留多篇文章、有效链接与独立 MIME 正文。阅读模式适配窄屏布局表格、清理明确的订阅和分享操作，并保留图片独占的链接入口，延续禁止被动加载远程资源的阅读边界。

搜索按邮件呈现 newsletter 命中，保留每条原始证据和检查入口。桌面阅读提供常驻目录、标题导航、单层滚动和浏览器本地阅读位置。

刊物归档使用整行阅读入口，对齐标题、日期与阅读操作；投递副本和刊物标识按需展开，窄窗口保留标题与日期的阅读顺序。

Newsletter HTML 的 lexical 投影仅索引可见文字，排除布局 Markdown 和属性派生的跳转 URL；default 投影及阅读中的链接不变。

Mail 的 Module Federation 分发兼容现有 Core SDK 0.4 与新增阅读目标接口的 0.5，Resolver 通过可逆的 initialize/dispose 生命周期注册。
