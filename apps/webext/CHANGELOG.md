# @inkcre/client-webext

## 0.2.1

### Patch Changes

- 4aaeb6d: 将应用命名统一为 Web / WebExt，明确应用与运行 Peer 的角色；保留浏览器身份、存储、已发布扩展协议与部署兼容入口，构建和开发工具采用新的应用目录与 Runtime 导入名。

  对仍准入的 Runtime 0.4.2 单独更新 Zod 依赖至修复版，保留原发布包身份与完整性。

- ca4cfd7: 在既有 0.4 兼容线新增无 Vue/Pinia 依赖的 `@inkcre/core/sdk` 入口，提供显式连接的数据访问、字节存储、认证与协议合同；现有应用入口保留兼容，并复用相同传输和存储实现。Web/WebExt 随其内嵌 Core 更新，不要求 MF 分发迁移 Host ABI。
- 16b127d: 统一观测记录的采集与查询，默认使用内置信息库，选定 Loki 时通过具备能力的 Peer 读写；Web 提供全局筛选、关联时间线与明确的后端/历史状态，Job 生命周期记录不再依赖额外 OTEL 出口开关。
- Updated dependencies [4aaeb6d]
- Updated dependencies [ca4cfd7]
- Updated dependencies [a1f34f3]
- Updated dependencies [16b127d]
  - @inkcre/core@0.4.4
  - @inkcre/web-collection@0.1.2

## 0.2.0

### Minor Changes

- 115ca68: WebExt 重写为独立网页采集 Peer，支持本机待办、书签/历史导入、配置完整读改及原数据迁移，退役 Explain、Writing Assist 和旧图编辑入口。新增独立版本与下载包发布、稳定 Chromium 身份、本机数据转移，并适配深浅主题标志。首次从路径身份开发版切换时须先导出数据，不能卸载旧实例；Firefox 下载 ZIP 尚需 Mozilla 签名后才能正式安装。

  WebExt 单独升级到正式发布的 `@inkcre/ui-web` 2.6.0，通过公开资源入口取得标志并移除仓库中的重复素材，保留工具栏、管理图标及浅深主题的原有装配规则。2.6.0 延续已有的 InkInput 单行修复，其他消费者仍使用 2.5.0 及其原补丁。

### Patch Changes

- 1921699: Discourse 网页的现场采集与公开 URL 导入保留已取得帖子的作者、时间、顺序、短回复、链接地址与代码，排除主题外导航。只读取原页面已有信息，不生成摘要或推断回复关系。
- 85a3f16: 保留页面已有正文与 HTML 结构，增加 Markdown 通用解释与安全阅读，并衔接 Local Files v2 及旧网页材料。

  Web、WebExt 与 Local Files 使用正式 UI 2.7.0 阅读组件；移除已被上游修复取代的 WebExt 2.6.0 补丁，其余 2.5.0 消费者仍保留原补丁。

  MF 产物的 UI 要求取自各生产者自己的依赖声明，避免 Host 升级重写其它扩展的要求；保留单例、既有 fallback 和严格产物一致性检查。

- Updated dependencies [85a3f16]
  - @inkcre/core@0.4.3
  - @inkcre/web-collection@0.1.1

## 0.1.4

### Patch Changes

- 02ef335: 支持在 Web 与浏览器扩展保存、切换命名连接，并保留连接身份和上次选择；Web 备份包含完整连接列表。
- Updated dependencies [854291e]
- Updated dependencies [854291e]
- Updated dependencies [02ef335]
  - @inkcre/core@0.4.2

## 0.1.3

### Patch Changes

- Updated dependencies [7307dda]
- Updated dependencies
- Updated dependencies [7307dda]
  - @inkcre/core@0.4.0

## 0.1.2

### Patch Changes

- Updated dependencies [47fa3f6]
- Updated dependencies [ec5dd1e]
- Updated dependencies [ec5dd1e]
- Updated dependencies [ec5dd1e]
  - @inkcre/core@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [d72d88c]
  - @inkcre/core@0.2.0
