# @inkcre/ext-local-files

## 0.2.0

### Minor Changes

- 85a3f16: 保留页面已有正文与 HTML 结构，增加 Markdown 通用解释与安全阅读，并衔接 Local Files v2 及旧网页材料。

  Web、WebExt 与 Local Files 使用正式 UI 2.7.0 阅读组件；移除已被上游修复取代的 WebExt 2.6.0 补丁，其余 2.5.0 消费者仍保留原补丁。

  MF 产物的 UI 要求取自各生产者自己的依赖声明，避免 Host 升级重写其它扩展的要求；保留单例、既有 fallback 和严格产物一致性检查。

### Patch Changes

- Updated dependencies [85a3f16]
  - @inkcre/core@0.4.3

## 0.1.1

### Patch Changes

- 854291e: 读取本地文件资料及已提取正文，展示原件失效与提取范围。
- Updated dependencies [854291e]
- Updated dependencies [854291e]
- Updated dependencies [02ef335]
  - @inkcre/core@0.4.2
