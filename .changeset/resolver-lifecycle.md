---
'@inkcre/core': patch
'@inkcre/ext-mail': patch
'@inkcre/ext-twitter': patch
---

统一 Resolver 的并发读取与释放语义：相同选项共享待决读取，不同选项按顺序执行，保留显式刷新和派生权限。释放后的实例不再接受 solved content 读取，也不会发布晚到结果；字节内容不再在释放后创建 Object URL。覆盖 `dispose()` 的扩展需要调用 `super.dispose()`。

Mail 只在 Extension initialize/dispose 中注册与注销 Resolver，避免模块导入失败留下能力。Twitter 媒体加载在异步读取后再次检查释放状态，防止已释放实例产生新句柄；旧版 Tweet 的附件读取跳过 Tweet 目标，避免错误附件关系造成递归等待，并保留自定义媒体 Resolver。
