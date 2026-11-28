# InKCre/impl-ts #211 UI 验收

[PR #211](https://github.com/InKCre/impl-ts/pull/211) · [验收提交 d99880a](https://github.com/InKCre/impl-ts/commit/d99880a6f5983e3c7950489ea65a1d65f20e6a25)

使用 Chromium、隔离 PostgreSQL、真实 PostgREST 和 Core worker。桌面视口为 1360 × 900，移动视口为 375 × 812。提交增量维护后，Job #1 从待执行变为 finished，索引写入 1 条、失败 0 条，随后检索找到验收样本。移动端打开维护入口及 Job 详情，页面宽度检查通过。

- [桌面维护入口](01-desktop-maintenance.png)
- [桌面重建确认](02-desktop-rebuild-confirmation.png)
- [桌面提交后待执行](03-desktop-pending.png)
- [桌面 Job 终态与报告](04-desktop-finished.png)
- [桌面关键词检索结果](05-desktop-search-result.png)
- [移动端维护面板与维护结果](06-mobile-maintenance.png)
- [移动端 Job 详情](07-mobile-finished.png)
- [桌面操作录屏（MP4，26 秒）](keyword-index-maintenance.mp4)
