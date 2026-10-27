# @inkcre/ext-caldav

## 0.1.2

### Patch Changes

- 85a3f16: 保留页面已有正文与 HTML 结构，增加 Markdown 通用解释与安全阅读，并衔接 Local Files v2 及旧网页材料。

  Web、WebExt 与 Local Files 使用正式 UI 2.7.0 阅读组件；移除已被上游修复取代的 WebExt 2.6.0 补丁，其余 2.5.0 消费者仍保留原补丁。

  MF 产物的 UI 要求取自各生产者自己的依赖声明，避免 Host 升级重写其它扩展的要求；保留单例、既有 fallback 和严格产物一致性检查。

- b93548b: Peer 管理改用正式 Runtime 0.4.2，保留宿主声明的原生分发标识；设置页不再因 Python／Module Federation 白名单拒绝原生状态。相关 MF 分发的最低 Core SDK 同步为 0.4.2。
- Updated dependencies [85a3f16]
  - @inkcre/core@0.4.3

## 0.1.1

### Patch Changes

- Updated dependencies [854291e]
- Updated dependencies [854291e]
- Updated dependencies [02ef335]
  - @inkcre/core@0.4.2

## 0.1.0

### Minor Changes

- 682f390: 新增 CalDAV Web 分发，提供目标 Peer 连接向导，以及日历、任务、联系人和集合的内容预览与阅读；从共享语义图组合 DAV 内容，并可打开独立电话、媒体及关联任务。
