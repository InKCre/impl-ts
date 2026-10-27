# @inkcre/ext-github

## 0.1.3

### Patch Changes

- 85a3f16: 保留页面已有正文与 HTML 结构，增加 Markdown 通用解释与安全阅读，并衔接 Local Files v2 及旧网页材料。

  Web、WebExt 与 Local Files 使用正式 UI 2.7.0 阅读组件；移除已被上游修复取代的 WebExt 2.6.0 补丁，其余 2.5.0 消费者仍保留原补丁。

  MF 产物的 UI 要求取自各生产者自己的依赖声明，避免 Host 升级重写其它扩展的要求；保留单例、既有 fallback 和严格产物一致性检查。

- Updated dependencies [85a3f16]
  - @inkcre/core@0.4.3

## 0.1.2

### Patch Changes

- Updated dependencies [854291e]
- Updated dependencies [854291e]
- Updated dependencies [02ef335]
  - @inkcre/core@0.4.2

## 0.1.1

### Patch Changes

- e74195b: Web 宿主与第一方 Module Federation 扩展统一采用正式 @inkcre/ui-web 2.3.0，共享同一 UI 单例。图片查看支持连续缩放、拖动平移、双指捏合与键盘操作，100% 仅作为快捷比例；保留按需媒体读取、关闭与焦点恢复。

## 0.1.0

### Minor Changes

- 26b535d: 增加独立 GitHub MF 分发，为已采集的账号、仓库和列表提供预览、内容渲染及持久关系导航。
