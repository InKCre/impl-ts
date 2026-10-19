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

Mail 的摘要用于识别邮件、附件或事实对象，完整 renderer 承担阅读和显式下载。邮件默认显示主题、发件人、日期与正文，完整信头、内嵌内容和相关邮件通过展开入口访问。附件条目与独立 MIME 视图共享文件身份和下载状态表现。邮件 HTML 先清理，再放入不允许脚本或同源访问的 iframe；只允许清理后插入的固定基础排印样式生效，远程图像不加载，已解析的 cid 图像仍由 Blob handle 提供。

## Producer Guardrails

Producers emit exact, versioned Resolver IDs; keep protocol/source identity and declared metadata
in canonical metadata/root Blocks; put actual media or document bytes in a semantic content Block;
and represent associations with Relations. They never encode attachment identity into root
content or choose a semantic Storage type. Storage remains bytes-only mechanics.

An archive that captures only source media metadata need not create a persistent semantic
content Block. `inkcre/twitter` retains native Media records without a Media-to-content Relation;
its resolver reads bytes from an allowed CDN only after the user explicitly expands that Media.
