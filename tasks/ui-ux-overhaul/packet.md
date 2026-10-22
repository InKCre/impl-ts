# InKCre Web UI/UX 全面改进

- **Objective**：让 InKCre web app（impl-ts/apps/client-web）的界面在信息架构、交互、视觉、可访问性、文案五个维度都符合 `InKCre/ui` 的 DESIGN.md 所宣称的"平静、有秩序、让内容建立秩序、让操作表达真实后果"。验收方式是 Human 在实际浏览器里走遍主要流程后认可"看起来像一个一致的系统"，而不是抽查单个组件。

- **Guardrails**：
  - 只改 `impl-ts/apps/client-web`（views/components/locales/styles）；**不改** `InKCre/ui` 仓库本身（tokens、组件 API 都保持向后兼容）。**2026-10-17 Human 更新：授权修改 ui package，修复应该是根本性的。**
  - 不改业务逻辑、Peer/Extension/Core 公共契约、数据库投影。
  - 修改源码前需要 Human 明确授权（impl-ts/AGENTS.md 强制要求）；本 packet 维护不需要授权。
  - 与上一个任务 `tasks/ui-v2-migration` 的关系：那次是依赖迁移，这次是设计兑现；不重复、不覆盖。
  - 每个 Slice 完成后 Human 走查确认再进入下一个 Slice；不在未授权情况下跨 Slice 推进。

- **Verification**：
  - 静态证据：`pnpm check` 通过；`grep -rn "alert(\|confirm(" apps/client-web/src` 无原生浏览器弹窗调用；每个主 view 至少一个 `<h1>`；全仓库 `:focus-visible` 覆盖所有可交互元素；`prefers-reduced-motion` 覆盖所有过渡动画。
  - 实际证据：dev server 下人眼走查 `/` `/sources` `/peers` `/extensions` `/settings` `/info-base/graph` 六个页面，确认页面标题、导航、空态、错误态、通知、保存反馈、键盘焦点、动效降级、文案都成立。
  - 完成标准：Human 看过走查结果并认可"这是一个一致的系统"。

- **Current Truth**：
  - 实际跑过 dev server 并连接 Human 的自部署；问题清单已五维度定位到具体文件与行号，见各 Track 文件。
  - Human 已确认：(a) 通知条常驻且不自动消失；(b) 元叙述泄漏是普遍问题；(c) A11y 与加载态是突出问题；(d) 会分批实施，且后续会纵向展开更多内容。
  - 形状决策：因为会纵向展开，采用 **Tracks**（每条是一个持续的关注点轴）；当前不建 Phase（没有跨 Track 的真实屏障，授权闸由 Human 控制）；每条 Track 有自己的 plan，可独立推进、独立扩展。
  - **track-foundation 已完成**（2026-10-16）：5 个 Slice 全部交付。type-check 通过；8 个主 view 全有 `<h1>`；无原生 alert/confirm；通知条中性色+可关闭（sessionStorage）；settings 的 telemetry 换 InkSwitch；extensionCard 的 setup 按钮移除 primary。
  - **track-ia 已完成**（2026-10-16）：4 个 Slice 全部交付。(1) AppSidePanel 重做：用 InkPopup 自带 scrim 替代手写 InkScrim（修复 `<dialog>` top layer 层级问题）；RouterLink + 当前路由高亮 + mdi 图标 + 分组标题 + 路由变化自动关闭；样式用 token：`apply-elevation(low)` 替代硬编码阴影、直角（符合 DESIGN"默认直角"）、`border-inline-start` 细实线。(2) ~~全局 `.page-header` 模式~~ 已回退（Human 反馈：header 已有 page-title，页面内重复 title/lead 是冗余）。改为：每个 main 保留 `<h1 class="sr-only">` 给屏幕阅读器，视觉由 InkHeader 的 page-title 承担；操作按钮单独成行（`.sources-view__actions` 等）。(3) RecallSearch 入口提到 InkHeader `right-icon` slot；同时手动渲染 menu 按钮（InkHeader 的 `right-icon` slot 会覆盖默认 menu fallback）。(4) info-base list/graph 加 InkTabs 切换，新共享组件 `InfoBaseViewTabs.vue`；路由查询参数在切换时保留。
  - **track-content 已完成**（2026-10-16）：4 个 Slice 全部交付。(1) 共享 `.entity-card` 全局样式（`src/styles/entity-card.scss`，main.ts 引入），Source/Peer/Extension 三卡片统一：直角 + `border.subtle` + `surface.base` + 无阴影；`header(title+status+actions)`/`meta`/`actions` 三段式。(2) 空态/错误态统一 InkPlaceholder：sources/list/graph 补齐（peers/extensions 原本已用），所有错误态带"重试"操作，sources 空态给"创建数据源"行动。(3) 加载态双保险：peerList/sources/extensions/jobs/info-base-list 的刷新/搜索按钮全部 `:is-loading` + `:disabled` 同步。(4) 轻量 toast：新建 `src/components/toast/`（toast.ts + ToastHost.vue + ToastHost.scss），`toast.success/info/error`，`role=status/alert`，3 秒（error 6 秒）自动消失，Escape 关闭，apply-elevation(low)+直角+3px 左边线；已接入 settings 保存、source 创建/删除、peer 保存/删除、extension 安装/卸载。
  - **track-copy 已完成**（2026-10-16）：4 个 Slice 全部交付。(1) startup/peer 通知改用户任务语言（"正在连接到你的 InKCre" / "后台同步已暂停"）。(2) info-base 概念清洗：区块→条目、关系→关联、解析器→类型、反刍→重新理解、社区→分组；evidence "标签完全匹配"→"匹配了标签" 等。(3) 数据源/扩展清洗：sourceCard 的 type 显示改为最后一段（`extensions.github.stars.Source` → `Source`）；"Peer"→"设备"（含 peer.title/sidePanel.peers 等所有 UI 文案）；"部署"→"你的 InKCre"；"Registry"→"扩展库"（中文）；"Runtime 就绪状态"→"就绪状态"。(4) 新建 `copy-glossary.md` 术语表，含内部术语 ↔ UI 文案对照表 + 新文案 checklist。graph.vue 的所有英文硬编码（loading/empty/error/sceneDescription/scaleOptions/directionOptions）全部接入 i18n。
  - **track-a11y 已完成**（2026-10-16）：5 个 Slice 全部交付。(1) 全局 `:focus-visible` 样式（`:where()` 零优先级，组件样式仍能覆盖）。(2) `prefers-reduced-motion` 全局降级（所有动画/过渡瞬时完成）。(3) 标题层级修正：job 详情 logs 从 h3 改 h2；卡片 h3 模式验证合规（h1 → 列表项 h3 不违反 WCAG 1.3.1）。(4) 移动端（≤768px）所有可交互元素强制 min 44×44px（WCAG 2.5.5）。(5) 表单 label 审查：3 个 `<input>` 全部有 label / aria-label / 隐藏。
  - 待 Human 授权：下一条 Track（track-foundation/ia/content/copy/a11y 全部完成，可回到 audit 看下一批问题）。
  - **audit 复查发现的问题**（2026-10-16）：
    1. **首页 h1 "找回你记得的信息。"** 是产品 slogan，与 InkHeader "信息库" 不一致；应改为具体描述（如"搜索你的信息"或"最近条目"）。
    2. **source 详情页显示内部扩展 ID** `extensions.github.stars.Source`（meta 行 `<code>` + SourceForm 类型 combobox 的 label）；需改为最后一段（`Source`）。
    3. **路由缺失**：`/info-base/list` 无路由，直接访问 404（空白页）；需加 alias 或 redirect 到 `/`。
    4. **graph 节点 aria-label 硬编码英文**（"Explore Block #196"、"Inspect Block #196"、"Preview unavailable"、"Details"）；需 i18n。
    5. **"检索" 是 Recall 直译**，非用户语言；`infoBase.list.searchLabel` / `search` 应改为"搜索"。
    6. **graph 页 "搜索" 按钮**与 InkHeader "查找信息" 不一致；应统一为"搜索信息"或"查找信息"。
    7. **"扩展库" 外部链接**（registry.inkcre.dev）已有 ↗ 图标，但可再确认是否需 `target="_blank"` + `rel="noopener"`。
    8. **sources 页按钮高度不一致**："创建数据源" 36px (md)，"刷新" 30px (sm)，"立即采集" 30px (sm)。
    9. **侧边栏 icon 过度使用**：6 个菜单项每个都有 icon，违反"纯粹填空的图标应直接移除"原则。
    10. **jobs 详情页显示内部扩展 ID** `extensions.github.stars.Source`。
  - **2026-10-17 Human 指示**：修复应该是"根本性的"；授权修改 ui package；不要列工作量。
  - **audit 修复完成**（2026-10-17）：10 个问题全部修复。
    1. **sources 页按钮高度统一**：创建/刷新/立即采集全部改为 md（36px）。
    2. **首页 h1 去 slogan**：`找回你记得的信息。` → `搜索你的信息`；英文同步。
    3. **内部 ID 泄漏根治**：新建 `src/utils/format.ts` 的 `formatTypeId()`，`extensions.github.stars.Source` → `Source`；sourceCard、source 详情页 meta、SourceForm combobox、jobs 详情页统一使用。
    4. **`/info-base/list` 路由**：加 `redirect: '/'`。
    5. **graph 节点 i18n**：BlockNode/RelationEdge 的 aria-label、preview error、details 按钮全部接入 `useI18n`；新增 `exploreBlock`/`inspectBlock`/`exploreRelation`/`previewUnavailable`/`details` 等 key。
    6. **"检索"→"搜索"**：`searchLabel`/`search`/`idle`/`error`/`unavailable`/`recall` 全部改为"搜索"；英文同步。
    7. **graph 页"搜索"按钮**：`infoBase.graph.search` 从"搜索"改为"搜索信息"，与全局统一。
    8. **jobs 页内部 ID**：`source.type` 改为 `formatTypeId(source.type)`。
    9. **侧边栏 icon 移除**：AppSidePanel 的 NavItem 接口去掉 `icon` 字段，模板去掉 `<span class="app-side-panel__item-icon">`，SCSS 去掉 `&__item-icon`；uno.config.ts safelist 清理不再使用的 icon。
  - **侧边栏重构**（2026-10-17）：去除"信息库"tab，改为"首页"；去除分组（管理/系统），扁平化列表；激活样式从左边线+背景色改为仅 `font-weight: 500` + `color: text.strong`（符合 DESIGN 极简原则）。
  - **搜索框按钮高度统一**（2026-10-17）：RecallSearch 弹窗（InkInput 44px + InkButton 44px）和首页搜索（原生 input 48px + InkButton 48px）的 query box 与提交按钮高度对齐。
  - **搜索框高度根治**（2026-10-17）：RecallSearch 的 InkInput wrapper（原 54px）和 InkButton（原 44px）统一为 48px，与首页搜索框一致；`:deep()` 穿透 scoped 样式覆盖 ui package 组件。
  - **首页去除视图切换 tabs**（2026-10-17）：`/` 路由不再显示"列表 - 信息图"tabs；仅 `/info-base/list/blocks/:block` 等详情页保留。
  - **Tabs 组件 underline 呼吸空间**（2026-10-17）：InkTabs 的 underline 与 tab 边界齐平，视觉拥挤；在 ui package 的 `inkTabs.scss` 加 `padding-inline: sys-var(space, sm)`，让 underline 比 tab 内容宽 8px。**根本性修复，已改 ui package 源码**。
  - **InkSwitch 默认尺寸**（2026-10-17）：InkSwitch 默认 size 从 md（100x36px）改为 sm（80x24px），避免设置页开关过大。**根本性修复，已改 ui package 源码**。
  - **InkInput 高度**（2026-10-17）：InkInput wrapper 从 `min-height: 36px`（被浏览器默认 input 44px 撑开到 54px）改为 `block-size: 36px`，内部 input `block-size: auto` + `min-block-size: 0`；现在 InkInput 和 InkButton md 都是 36px，RecallSearch 弹窗输入框与按钮自然等高，无需 app 层覆盖。**根本性修复，已改 ui package 源码**。

- **ui package 本地联合调试**（2026-10-17）：通过 `INKCRE_UI_SOURCE_ROOT=/path/to/ui/packages/web node scripts/dev.mjs web-ui` 启动，client-web 直接用 ui package 源码而非 npm dist；改 ui package 后无需重新构建，HMR 生效。注意：此模式仅用于开发，不提交到 git。

- **graph-view 优化**（2026-10-18）：
  1. **forced DAG 布局**：`layoutMeasuredNodes` 从环形布局改为 dagre（`rankdir: 'TB'`, nodesep 80, ranksep 120, marginx/y 40），节点按层次排列，edge 不再交叉。
  2. **节点拖拽修复**：`.block-node__content` 的 `nodrag` class 已移除（保留 `nopan`），现在整个节点区域都可拖拽；`draggedNodes` 在 `onNodeDragStop` 中正确清理，避免永久跳过布局。
  3. **左键平移画布**：`pan-on-drag` 从 `[1, 2]` 改为 `[0, 1, 2]`，左键拖拽空白区域平移画布，左键拖拽节点仍触发节点拖拽。
  4. **代码清理**：移除 2 处 `console.log` 调试残留。

- **Next Step**：Human 走查 audit 修复结果，决定是否继续深挖或关闭任务包。

## Task-map Projection

五条 Track 各自可独立推进、独立纵向展开。当前没有跨 Track 的真实集成屏障——Human 授权就是节奏控制。

| Track                                   | 关注点                                                                       | 当前紧迫度 | 预计首个 Slice 工作量 |
| --------------------------------------- | ---------------------------------------------------------------------------- | ---------- | --------------------- |
| [track-foundation](track-foundation.md) | 拆除最严重问题（通知条、原生 alert/confirm、缺 h1、黑底按钮、原生 checkbox） | 最高       | ~30 分钟              |
| [track-ia](track-ia.md)                 | 信息架构（导航、标题、面包屑、视图切换、全局搜索入口）                       | 高         | ~1-2 小时             |
| [track-content](track-content.md)       | 内容呈现（卡片统一、空态、错误态、反馈 toast、加载态）                       | 中         | ~1-2 小时             |
| [track-copy](track-copy.md)             | 文案与元叙述清洗（i18n、用户任务语言、概念翻译）                             | 中         | ~1 小时               |
| [track-a11y](track-a11y.md)             | 可访问性与动效（焦点、reduced-motion、标题层级、触控目标）                   | 中         | ~1 小时               |

**推荐推进次序**：track-foundation → track-ia → track-content → track-copy → track-a11y。但每条 Track 都是开放的，未来发现新问题时回到对应 Track 加 Slice。

## Supporting Material

- 各 Track 详情：[track-foundation](track-foundation.md) / [track-ia](track-ia.md) / [track-content](track-content.md) / [track-copy](track-copy.md) / [track-a11y](track-a11y.md)
- 设计依据：`InKCre/ui/DESIGN.md` 及 `docs/design/{principles,visual-language,composition,reference}.md`；`apps/client-web/node_modules/@inkcre/ui-web/skills/ui-web/SKILL.md`
- 工作约束：`impl-ts/AGENTS.md`（源码修改需 Human 授权）、`impl-ts/ARCHITECTURE.md`
- 既有相关 packet：`impl-ts/tasks/ui-v2-migration/packet.md`（已收尾的依赖迁移，非本任务一部分）
