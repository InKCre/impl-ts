# I4 验收

[源码与验收身份](delivery.json)，[本地完整新增旅程](local-browser.txt)。在历史提交 `ec5dd1e387` 中使用 [browser-host.mjs](https://github.com/InKCre/impl-ts/blob/ec5dd1e3877db30bf51b5780b1a6bc7d31e3ba01/tasks/ui-v2-migration/evidence/browser-host.mjs) 重放；加 `--i4-only` 只运行本轮，加 `--deployed-extensions` 使用远端 Registry 与 MF 资源。

- Twitter：[应用保存失败](i4-twitter-application-failed.png)、[等待授权](i4-twitter-authorization.png)、[采集设置](i4-twitter-collection-375.png)、[完成摘要](i4-twitter-ready-375.png)。
- Mail：[宽屏阅读](i4-mail-1280.png)、[窄屏阅读与附件](i4-mail-375.png)、[邮箱事实](i4-mail-record-202.png)、[MIME 下载就绪](i4-mail-record-204.png)。
- Graph：[宽屏探索](i4-graph-1280.png)、[窄屏当前对象](i4-graph-375.png)、[关系详情](i4-graph-relation-375.png)、[无路径](i4-graph-no-path-375.png)。

截图使用浅深主题、375px／1280px，并关闭过渡动画；Graph 等待相机定位后截图。所有数据及凭据均为隔离夹具，日志中的 403 是主动拒绝注入。邮件白色区域是隔离后的消息文档，不继承宿主主题；完整地址与技术信息通过详情保持可达。

远端完整复验通过，源码 `9cd531e` 对应部署 `69ebcde3`；[远端日志](remote-browser.txt) 包括原有菜单、来源旅程及本轮 I4，pageerror 为零。此目录代表截图已替换为该部署的截图。[完整 CI](https://github.com/InKCre/client-web/actions/runs/34803560421) 全部成功，包括 Web 真实数据库 E2E、浏览器扩展 E2E 与工作区契约检查。
