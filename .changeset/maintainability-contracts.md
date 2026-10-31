---
'@inkcre/core': patch
'@inkcre/client-web': patch
'@inkcre/client-webext': patch
'@inkcre/ext-dev-utils': patch
'@inkcre/ext-twitter': patch
'@inkcre/ext-mail': patch
'@inkcre/ext-capture': patch
'@inkcre/ext-caldav': patch
'@inkcre/ext-memos': patch
'@inkcre/ext-github': patch
---

由 Core 拥有精确 Peer 管理命令与媒体资源操作。Resolver 子类通过 createByteContent 按需加载，Core 管理并发、替换和释放；缓存借用接口不暴露 dispose，关系片段不再隐式充当完整快照。消费新能力的分发需要 Host SDK 0.4.4；这是待发行兼容下限，正式版本由 Version PR 派生。

Web 统一保存、导入与重置的运行时切换顺序；三个扩展设置入口复用目标 Peer 的首次发行选择，保留密码、令牌和授权等领域步骤。WebExt 从一份命令合同推导调用参数、返回值和后台处理器类型。
