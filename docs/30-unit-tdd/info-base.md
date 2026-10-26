# Info-Base Unit

## Boundary and Flow

The Info-Base unit spans the core models and mechanics, extension-provided semantics, and browser
rendering surfaces. It executes admitted reads/writes, hydration, interpretation, and rendering
locally; being a browser application does not make Client-Web a thin proxy to core-py.

```text
PostgreSQL/PostgREST --> Block + Relation --> hydrate --> exact Resolver
                                                |            |
                                                v            v
                                             bytes     solved value / safe handle --> component
```

Schema and migration authority, product meaning, and cross-unit knowledge contracts remain in
[`../_shared/`](../_shared/). This owner describes the TypeScript realization and its internal
authority boundaries.

## Persisted Graph

`Block` owns graph identity, persistence timestamps, an exact Resolver ID, optional Storage record,
and `content`. When Storage is absent, content is the inline value; when Storage is present, content
is an opaque pointer. A pointer is mechanics and must never be rendered as authored text.

`Relation` is directed authority: `from_` and `to_` identify endpoints and `content` follows its
owning contract. `includeIn` selects direct relations where the subject is `to_`; `includeOut`
selects those where it is `from_`. Neither implies recursive traversal. Direction alone does not
define a universal relation type or semantic owner.

## Hydration and Storage

`Block.getHydratedContent({ refresh })` returns the inline string or asks the configured Storage to
turn the opaque pointer into `Uint8Array`. Its private, non-enumerable cache is keyed by the
`(storage, content)` snapshot, so schema/transport projection cannot persist it and a changed
pointer misses naturally. `refresh` replaces only this instance's snapshot. There is no promised
cross-instance or cross-Peer invalidation, and storage bytes may change without a Block timestamp
change.

Storage is a byte mechanism. It does not decide MIME type, filename, information kind, Resolver ID,
or solved meaning.

- `HttpStorage` accepts HTTP(S), bounds timeout and redirects, enforces declared and received byte
  limits, and returns bytes without branching on `Content-Type`.
- `PostgreSQLBinaryStorage` provides browser-peer create/read/update/delete for raw bytes. Its
  storage-owned pointer is exactly `{ "blob_id": "..." }`; create/read use byte RPCs and
  update/delete address the exact UUID row. Storage operations never query or rewrite Blocks.
- `rawPostgrestFetch()` reuses browser origin and JWT authority while preserving a byte-capable
  response rather than forcing the JSON client abstraction.

## Exact Resolver Contracts

`Resolver.getClass(id)` requires an exact registered class. Registration is idempotent only for
the same class and rejects collisions; there is no default decoder. `Resolver.unregister(id, exactClass)` removes only that class’s registration and returns false when no matching owner remains. Stale module cleanup cannot remove another module’s class. Core bootstrap independently
registers the versioned text, HTML, image, audio, video, PDF, EPUB, ZIP, and file contracts.
Extensions register their own namespaced, versioned contracts rather than aliases for retired IDs.

Every concrete Resolver exposes `getText({ context })`, where `default` and `lexical` are named,
resolver-owned projections. Lexical projection is Block-local and non-recursive. Callers preserve
four distinct results:

- `UnknownResolverError`: no exact decoder is installed;
- `UnsupportedResolverCapability`: the decoder does not implement the requested projection;
- `null`: the capability exists but has no meaningful value;
- `''`: the actual solved value is empty.

The effect vocabulary is also exact: `refresh` replaces a local snapshot,
`materializeMissing` permits creation only when a required derivation is absent, `recompute` is an
explicit organization command for replacing an existing derivation, and `invalidate` discards a
cache without loading. `force` and `reload` are not synonyms.

Media matching normalizes one MIME candidate and returns an installed exact core Resolver ID or
`null`. Source/protocol adapters own evidence ordering and any explicit file fallback; the Resolver
manager does not impose a universal classification ladder.

## Browser Handles and Rendering

Byte-oriented Resolvers may expose Blob or Object URL handles for image, audio, video, PDF, EPUB,
ZIP, and file content. Handles are private runtime state, never persisted solved-graph authority.
They are revoked on Resolver refresh, disposal, cache replacement, and eviction.

HTML remains source/text preview unless a separate sanitizer contract exists; it is not passed
directly to `v-html`. A parser-derived field may remain `null` when no proportionate browser parser
exists while open/render/download remains supported.

`BlockContent.vue` makes exact Resolver setup errors visible, obtains solved content, passes it to
the registered component, and disposes its Resolver on unmount. Graph and editor surfaces use this
path and never fall back to the persisted pointer string.

`ResolverCache` first requires a currently registered class, then reuses instances by Block identity, `updated_at` snapshot, and that exact class identity. A disabled registration cannot return a cached instance; a replacement class disposes and replaces the old instance on the next read. Replacement,
targeted invalidation, and clearing dispose old instances. Resolver-local hydration, relation, and
solved-content caches still obey `refresh`; instance reuse does not change authority.

Every registered Resolver provides both `previewRenderer` and `solvedContentRenderer`. They consume
the same solved-content authority; there is no preview projection. Preview is bounded and
interaction-free for dense InfoBase presentation, while solved content may support focused reading
and domain actions. Graph/List orchestrators may request solved content with
`materializeMissing=false`; retrieval results never carry labels, renderers, solved values, dimensions,
or layout hints.

## Graph Navigation

`GraphNavigationRetrievalManager` is a peer-local TypeScript implementation over PostgREST. It returns
endpoint-closed `GraphModel` reads for bounded Block neighborhoods, exact Relation neighborhoods and
bounded shortest-by-hop paths. It does not call core-py, use Peer delegation, add a database RPC, or
depend on Vue Flow. Incoming/outgoing pages are queried separately and merged inside the manager;
frontier batching remains private query mechanics.

The application Graph View is a navigation host and presentation realizer. Role-named query fields
(`focal_block`, `focal_relation`, `path_from` + `path_to`, `q`) reconstruct the active scene; scale,
direction emphasis, positions, camera and preview cache remain runtime state. Activating a canvas
entity changes focal identity, while Inspect is an explicit secondary route. Block/Relation inspectors
and solved content are modeless route outlets whose close action delegates to browser/router `back()`.

Graph shells render before bounded Resolver previews. Intrinsic DOM dimensions inform deterministic
local layout. Resolved previews explicitly refresh VueFlow internals before measurement. New nodes,
including a new focal node, avoid occupied measured rectangles with a gap. Cached automatic positions
survive scene changes unless changed preview dimensions collide; user-dragged coordinates stay owned
by the user, including during preview settlement. Candidate rings expand within the current scene
bound rather than estimating one radius from the number of new neighbors. User drag is session-only. Direction is soft
presentation state: muted entities remain present and interactive and changing direction performs no
retrieval. Automatic camera movement follows explicit focal/path/refocus actions only; manual movement
cancels pending ownership, including node drag start. Refocus waits for the same ready-preview and
node-measurement boundary; later dimension changes can repair automatic positions and edge handles
but cannot reacquire the viewport.

Application Recall/Search is not part of an InfoBase View, but an active View may realize its selected
destination. Recall defaults to List outside a View; Find path supplies two Block references to Graph.
The retired `sink/graph` community/MDS layer is not a compatibility surface.

Graph 的工具区显示当前地址和实体数量；仅在 Block 邻域中提供可展开的范围与方向选项。节点以 Resolver 预览为主，编号与 Details 为辅助信息。预览区域支持 Enter／Space 聚焦，Details 打开 modeless inspector；拖拽使用节点的非操作区域，关系线选择朝向另一节点的连接点并在拖动后更新。方向弱化保留可读文字与全部交互，通过节点边界和关系线型区分，不触发重新检索。关系线仅显示可聚焦标签，选中关系后由工具区提供 Relation details。窄画布默认聚焦当前对象并保持可读比例，其余关系通过平移和缩放探索；Focus current 恢复当前视角。加载、空、缺失、无路径、超出边界与读取失败分别呈现；失败允许在原地址重试。

Mail 的摘要用于识别邮件、附件或事实对象，完整 renderer 承担阅读和显式下载。邮件默认显示主题、发件人、日期与正文，完整信头、内嵌内容和相关邮件通过展开入口访问。附件条目与独立 MIME 视图共享文件身份和下载状态表现。邮件 HTML 先清理，再放入禁止脚本的 iframe；只允许清理后插入的固定基础排印样式生效，远程图像不加载，已解析的 cid 图像仍由 Blob handle 提供。普通邮件和原文视图不允许同源访问；newsletter 阅读视图允许父页面访问清理后的 DOM，以测量全文高度并定位标题，仍不允许脚本。

## Recall Reading Destinations

`LexicalRetrievalManager.retrieve()` 保留 Peer 返回的逐 Block 命中。列表和图通过
`presentLexicalMatches()` 呈现同一结果窗口：Resolver 可用 `getRecallTarget(match)` 提供确定的阅读目标，
默认返回 `null`。按目标 Block ID 聚合并保持第一次命中的顺序，每组保留原始命中对象、rank 和 evidence。
未安装的 Resolver 保留原节点，读取失败仍是可重试错误。列表主入口打开阅读目标，详情可检查各个原始 Block；
图使用同一组目标。最多 20 个原始命中可能形成少于 20 个阅读结果，不构成去重后的全库分页。
直接打开页面时，扩展注册可能晚于首轮检索。Web 在既有 Extension Host restore 的 restored/failed
终态后刷新当前 recall，并通过 generation 丢弃过期查询结果；读取视图不主动启动宿主或等待本地租约。

Mail 仅将有刊物归属的 Email，以及具有唯一直接 Email `role=body` 归属的 newsletter 正文映射到该 Email。
正文归属缺失或有多个 Email 时保持原命中；普通 HTML/Text 不套用邮件关系规则。不同 Email Block 不在搜索中
按 Message-ID 或标题合并。刊物、日期及隐藏 URL 参数的摘要属于呈现，原始检索证据保持完整。

Newsletter 桌面 reader 在容器宽度达到 720px 时显示常驻目录，正文随内容展开，由宿主滚动容器统一滚动。
目录来自已清理的 H1–H6，提供定位及前后导航；窄容器默认折叠。阅读位置仅存当前浏览器，
按 PostgREST 地址、正文 Block ID 和更新时间隔离，重新打开时由用户选择继续阅读，不写共享数据库。

## Producer Guardrails

Producers emit exact, versioned Resolver IDs; keep protocol/source identity and declared metadata
in canonical metadata/root Blocks; put actual media or document bytes in a semantic content Block;
and represent associations with Relations. They never encode attachment identity into root
content or choose a semantic Storage type. Storage remains bytes-only mechanics.

只捕获媒体元数据的归档不需要预建持久语义内容 Block。`inkcre/twitter` 保存共同模型的 Media 记录，不建立 Media-to-content Relation；列表、文本投影和索引只读取已有元数据。用户明确展开后，Twitter Resolver 选择图片 URL 或最高码率的可用 MP4，再交给现有 `HttpStorage` 按通用 HTTP(S)、超时、字节上限和重定向规则读取。它不另设 CDN、端口或重定向政策，读取也不持久化媒体字节。

Twitter 的详情 renderer 以作者、正文、媒体与引用、发布时间、只读统计组织阅读，顶部提供在新标签打开原帖的文字链接。Graph preview 与详情共享身份与文字表达，预览仅限制可见行数，详情保留完整正文和长文。头像使用本地占位，不自动获取远端图片；引用只呈现已经捕获的事实，通过已保存帖子入口继续阅读，不凭作者 ID 补造 handle。新归档的媒体按需读取；已加载图片可点击图片或常驻放大按钮进入大图，关闭后回到原入口。视频提供原生控制，在浏览器允许全屏时显示全屏按钮，保留播放进度与状态；全屏请求失败时显示提示并继续使用原播放器。加载与解码失败允许重试，放大不会额外读取或持久化媒体。

每个媒体视图拥有独立的运行态 Resolver 和 Object URL，随视图切换、卸载或加载结果被替换而撤销；视图关闭后的异步结果也会被释放，不与同时打开的视图共享待撤销的句柄。旧格式 renderer 使用相同阅读布局，但其 Resolver 原有的附件关系解析仍可能读取字节；本轮没有改写旧格式解析合同。UI 候选验收入口及边界见 [`scripts/tests/twitter-rendering`](../../scripts/tests/twitter-rendering/README.md)。

媒体显示使用运行态 Object URL，随 Resolver 刷新、释放和缓存替换撤销。协议 DTO、provider 响应及共同信息模型的转换属于 Twitter 适配器，不能让客户端协议字段集变成 info-base 或 Resolver 的持久数据权威。

Organization 提取结果沿用 `core.text.v1`，正文与必要引文已是可读文本；客户端通过现有 TextResolver 和文本组件读取，通过普通 `extraction` Relation 导航来源。生成行为不新增客户端结果类型或专用展示协议。
