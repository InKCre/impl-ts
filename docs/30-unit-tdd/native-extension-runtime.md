# Native Extension Runtime Unit

## Boundary

The native Extension Runtime spans the browser Web Extension Host, its SDK-owned durable models, and
independently built Module Federation producers. It owns compatibility preflight, executable
loading, runtime lifecycle, and reconciliation with durable enabled intent. Release publication,
Registry delivery, and deployment workflow remain outside this Unit TDD; cross-unit Extension and
Registry contracts remain in [`../_shared/`](../_shared/).

Resolver/content producer semantics belong to [Info-Base](info-base.md). Registry publication and
artifact delivery belong to
[First-party Extension Delivery](../40-deployment/native-extension-delivery.md).

The browser supports the Module Federation native distribution. Registry v2 resolves an exact
`(name, module_federation, version)` release; other Peers independently select their native distributions. `@inkcre/extension-runtime-client-web`, maintained in
ext-reg, owns the Web Host and Registry consumers. `@inkcre/core` owns the shared models, Peer
transport, and browser configuration. There is no generic target matcher or cross-format artifact
manifest.

## Producer and Host Contract

Each producer is an independent build package; its package version owns its MF release. Its default export preserves the optional
native lifecycle methods `initialize`, `activate`, `deactivate`, and `dispose`; host-consumed
capabilities come from its package entry rather than playground bootstrap code. Extension code
imports `@inkcre/core` directly.

Each producer's `inkcre.module_federation.host_sdk_version` also supplies its native MF
`@inkcre/core` shared requirement. The build SDK version is not the consumer compatibility range:
an Extension may support more than one SDK minor. The artifact verifier requires both ranges to be
semantically equal and to accept the build SDK. SDK sharing remains a Host-only singleton, without
a bundled fallback. UI compatibility is declared independently and is not implied by the SDK range.

Host 与 Web 扩展通过现有 Module Federation 配置共享 `@inkcre/ui-web` 单例，
并声明当前锁定 UI 版本的要求。UI 的 i18n、路由和表单上下文使用模块内的 Vue 注入 key；
如果扩展另用一份 UI 运行时，即使外观相同，也无法继承 Host 的这些上下文。
独立 playground 仍可使用包自身的 fallback 模块，样式由各自应用入口加载。

The producer emits the native `mf-manifest.json`, Remote entry, and referenced shared/exposed asset
closure with relative asset semantics. The Registry Release records an immutable manifest
association and typed Host SDK association. These are runtime inputs to the Host, not a second
manifest invented by the client.

Before fetching executable bytes, the Host reads the exact Release, requires an associated Module
Federation distribution, requires `host_sdk === '@inkcre/core'`, and verifies that its strict local
SDK version satisfies the Release range. Installation requires a published Release; an already
installed exact yanked Release may start with a warning, while other non-executable states fail.
The Registry reader resolves the association to a trusted Registry-hosted URL, which the Host
passes directly to the current native Module Federation implementation.

## Durable State and Peer Intent

The shared `ExtensionModel` owns one deployment identity, display name and configuration. Business
state remains deployment-scoped and is never cleared by native version changes. The
`ExtensionParticipationModel` owns each `(name, peer_id)` selection: exact distribution/version,
enabled intent and configuration schema from that exact selection. No global package version or
shared enabled array remains writable.

The Extension card displays a single plugin with a row for each Peer. Installation and version
changes explicitly target that row. The current browser uses its local Host; an online remote Peer
uses `core.extension.management.v2`; offline operations update an existing exact participation.
A new remote installation requires a real supported-distribution observation. Peer names and
application versions do not imply format support. Missing MF releases remain unavailable choices;
a Python-only plugin does not get a failing browser enable action.

Management responses contain supported distributions and actual loaded versions, running state,
restart requirements and errors. Database enabled intent is not proof that a sleeping Peer is running.
The consumer sends each mutation once to its exact target and preserves unknown outcomes. It does
not retry mutations on another Peer. Configuration forms identify the selected Peer/distribution/
version that provided their schema; shared configuration has no global last-started schema.

Registry installation links carry `name`, `distribution` and exact `version`. Opening a link only
reads the release and presents the target Peer choice; confirmation persists that exact target's
selection without enabling it. Startup reads only current-Peer enabled selections and never follows
latest. Legacy records with unresolved distribution retain their exact version until the upgraded
Host resolves its own native format. A missing release requires an explicit replacement selection.

Removing a participation requires it to be disabled and does not remove the plugin's shared identity,
configuration, authorization state, Sources or info-base content. Another Peer's selection is unchanged.

## Documentation and Connection Setup

`inkcre/caldav` 的 Web setup contribution 按选定 Python Peer 的实际运行状态准备连接。
没有选择时才从该 Peer 自己的 Registry 选择发行版；安装返回重启状态后停止后续写入，
要求刷新观察原目标。已有密码保持不变，缺失时才使用浏览器密码学随机数生成专用密码。
完成条件包括 `running`、与 selection 一致的 `loaded_version`，以及
`caldav.connection.v1` 返回合法服务地址。启用意图不能替代运行事实。未知写入结果锁定
原目标直到刷新成功，不重放请求；关闭后的回调不能更新向导状态。

CalDAV 的三个 resolver 注册 `extensions.caldav.collection.v1`、
`extensions.caldav.calendar.v1` 和 `extensions.caldav.contact.v1`。ical.js 解析原生
iCalendar/vCard 为只读内存投影；calendar 同时承载 VEVENT 与 VTODO。内容视图不展开
重复规则、不隐式转换源时区，也不把展示字段写回另一份模型。集合成员只从 outgoing
`member` Relations 读取。嵌入式照片仅渲染常见栅格类型，远程照片保留显式链接。
解析失败保留原文；dispose 只注销当前模块自己注册的 resolver 类。

Extension cards discover documentation independently of executable preflight or enablement.
They resolve the existing Registry origin and read documentation for the exact installed name and
version through the Runtime's `getExtensionDocumentation`. Only returned global, python, and
module-federation links appear. Missing documents and temporarily unavailable discovery are
different states; neither prevents Extension operations. Links open without credentials or an
opener, and the application does not fetch or embed document bodies.

The Memos setup contribution owns connection preparation. An explicit action reuses a saved PAT or
generates one with browser cryptographic randomness, saves it through `patch_config`, and enables
the selected Core only if it is not already enabled. Online plus enabled is the normal best-effort
runtime assumption. The contribution obtains the complete server URL from `memos.connection.v1`;
it does not read Peer configuration or construct a Memos route. Address-read failures preserve the
saved token and enabled state. Opening, selecting, and refreshing only read state. Unknown mutation
outcomes require refreshing before another attempt. The PAT is masked by default; a normal help
link opens the current browser participation's exact MF release connection guide.

The Twitter setup contribution selects an authorization Peer for OAuth requests and callbacks. It
can open from the browser's running MF distribution before the selected Peer has installed Twitter;
an explicit enable action selects an available Python release when no pin exists, then enables that
Peer. Existing exact selections are not replaced by that action. Source, Cron and collection Jobs
remain shared deployment records; choosing the authorization entry does not bind their future
execution to that Peer. The interface does not call this a collection-Peer binding or attribute its
schedule timezone to the selected OAuth entry.

## Lifecycle and Compensation

The normal lifecycle is:

```text
load --> initialize --> activate --> deactivate --> dispose
```

Mail and Twitter define their resolver classes at module import, register them during `initialize`, and unregister only their exact classes during `dispose`. A partially failed initialization is cleaned up by the Host’s existing compensation path without removing another module’s registrations. Module import therefore does not leave capabilities from a failed or stopped runtime behind. Memos has no resolver registrations.

The Host records a runtime as running only after initialization and activation finish. If either
start phase fails, it compensates through the available reverse lifecycle and preserves both the
original and cleanup failures when cleanup also fails. Stop deactivates only an active module and
then disposes it; disposal releases the loaded runtime.

An explicit enable or disable command saves its exact participation intent before scheduling native
lifecycle work. Initial restore consumes enabled intent without rewriting it. The Host serializes
local lifecycle work per Extension and rechecks the selected coordinate and enabled intent before
and after executable loading, initialization and activation. A superseded candidate is disposed
without entering the running projection. Local serialization does not make direct writes by other
admitted clients atomic; fresh persistent observations remain necessary.

An operation can persist intent and still fail during activation or shutdown. The Extension card
therefore reads both participation and actual runtime after success or failure and retains the
operation error. If selection returns an unknown outcome, only an independent read of the original
connection’s same name, Peer, distribution and version can complete the picker. This read never
replays a mutation or enables the Peer. Configuration changes, unmount and a newer picker invalidate
old callbacks; observing a pin does not establish loaded version or running state.

Version catalogs are read only after an explicit version choice. A native format with no published
release is distinguished from an unknown or failed read. The card shows an unavailable target only
when all formats supported by that Peer are known to lack published releases. A Python-only
catalog can explain why the browser has no compatible choice without guessing from application
names. An explicit card refresh discards those catalog observations and allows another read.

The Client Web shell opens database views before native Extension restore finishes. A cold deep link can therefore encounter an unregistered Extension resolver. The content popup and graph preview retry only that early lookup failure once after the Host completes restore, while preserving other read failures. Graph pending additions and restore completion both check the retry condition; scene generation, connection and Host ownership reject stale callbacks. A missing resolver after that attempt stays visibly unavailable. Extension cards wait for the same restore before observing current-Peer runtime status; a persisted enabled intent alone does not establish that the module is running.

A restore attempt isolates module failures. Completing the attempt, including an aggregate failure, allows registered resolvers to serve content and exposes each module’s actual status; an unknown resolver after that attempt remains a visible error.

## Invariants

- Shared identity/configuration and per-Peer native selection have separate SDK models.
- Compatibility is proven before native executable fetch.
- The exact Release and native manifest association remain stable through one start attempt.
- Durable enabled intent and volatile runtime are reconciled with explicit compensation.
- Producer identity and lifecycle are native Module Federation contracts, not deployment scripts.

Settings 在切换数据库地址、数据库签名密钥或 Peer ID 之前排空旧 Host，连接成功后创建绑定新 Peer 的 Host。同一连接只调整租约选项时保留 Host；旧连接的恢复和管理回调不能改变新 Host 的状态。

## GitHub content producer

The independently versioned [GitHub MF producer](../../extensions/github/README.md) reads stored v1 Account, Repository and List records and their owns/stars/contains relations. It owns browser projection and rendering, without calling GitHub or controlling collection. Its native SDK range is a Host compatibility boundary, not a version pairing with the Python distribution.

Local MF restore depends on a prepared canonical Peer identity and initialized Host, independently
of periodic background lease, Job scans and telemetry. Turning background participation off or
changing only its interval preserves this Host; changing connection authority or Peer identity
and explicit shutdown dispose it. Initial restore still consumes exact enabled intent without
rewriting it.
