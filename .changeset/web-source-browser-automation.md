---
'@inkcre/core': patch
'@inkcre/web': patch
'@inkcre/webext': patch
---

为 Web Source 提供基于 Puppeteer 的本机浏览器能力，支持明确的 Web origin 授权、精确浏览器绑定、登录态页面交互与网络响应读取。

Chromium 扩展新增 debugger 权限，最低 Chrome 125。新建页与借用页分别清理，取消和断连不会自动重放操作。普通 Source Job 通过业务资格钩子选择执行 Peer。
