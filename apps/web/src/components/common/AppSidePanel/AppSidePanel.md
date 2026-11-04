# AppSidePanel

应用导航由 Header 的 Menu 按钮控制，`expanded` 默认为 `false`。侧栏提供 Sources、Extensions、Settings 和 Info-Base 导航，切换路由时通过 `update:expanded(false)` 通知父组件关闭。

桌面端与页面并排显示，宽度包含内边距和边框。移动断点内覆盖 `.app-content`，避免压缩主内容；Header 保持可见，用户可再次激活 Menu 关闭侧栏。

```vue
<AppSidePanel v-model:expanded="sidebarExpanded" />
```
