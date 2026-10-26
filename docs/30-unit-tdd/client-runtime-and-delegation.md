# Client Runtime and Delegation

## Boundary

Client-Web is an environment-neutral static Vue application and an equal database-protocol Peer.
It reads and writes admitted PostgreSQL facts through PostgREST and delegates business capabilities
through exact Peer advertisements. These are separate paths: there is no generic Core API client,
generic capability endpoint, or delegation job table.

Shared capability envelopes, database admission, and JWT claims are cross-unit contracts owned by
[`../_shared/20-product-tdd/`](../_shared/20-product-tdd/). This document owns their browser-Peer
realization.

Info-Base interpretation belongs to [Info-Base](info-base.md); native Extension loading belongs to
[Native Extension Runtime](native-extension-runtime.md).

```text
Vue surface
  |-- database fact --> domain Active Record --> DBAPIClient --> PostgREST
  `-- command -------> domain manager --> PeerManager --> protocol outbound --> provider inbound
```

Domain managers own typed request and response models. `PeerManager` knows only capability IDs,
advertisements, candidate selection, and protocol outbound construction; it must not acquire
retrieval, organization, or extension semantics. Provider inbounds invoke non-delegating local
domain implementations so a received command cannot accidentally delegate in a loop.

## Exact Delegation and Outcome Safety

`PeerManager.delegate(capability, payload, routeToPeer)` discovers other Peers whose database lease
is live according to PostgreSQL time and whose advertisement contains the exact capability plus one
registered inbound protocol. `routeToPeer` is caller-local routing state and never enters the
business payload. Without an exact target, eligible candidates may be tried in shuffled order;
with one, no other Peer may be substituted.

The built-in `core.peer.protocol.http.v1` outbound takes its method and absolute HTTP(S) URL only
from validated inbound parameters. The command envelope may carry normalized query values, allowed
headers, and optional JSON body. The outbound rejects transport-owned headers and adds the current
Peer JWT itself.

Failover is safe only when the provider explicitly returns
`InkCre-Peer-Execution: not-executed`. A Fetch rejection can happen after dispatch, and an unreadable
response happens after dispatch, so both produce `PeerOutcomeUnknown`. That outcome is terminal:
the manager must not retry it, the UI must distinguish it from ordinary failure, and callers must
not report it as success. A malformed response after a readable dispatch is a protocol error, not
proof of non-execution.

## Public Readiness Observation

`probePeerReadiness(Peer)` observes only the explicitly configured `http_public_base_url` and its
`readyz` path. It sends no authentication. Browser-owned MetaConfig
`peer_readiness_timeout_seconds` sets the request deadline: five seconds by default, configurable
in Settings as an integer from one to 300 seconds and preserved by configuration import/export.
An older configuration without this field uses the default. The shared core schema
keeps ready/not_ready, runtime phase/reason, optional bootstrap step, and public database component
status/problems. Older Peers may omit step. Missing or invalid endpoints and failed/unsupported
responses are distinct unavailable observations; they do not imply an expired lease.

PeerList refresh sends the public probes to all configured Peers, including expired leases, then
reads live leases again so a Peer awakened by its hosting provider can appear online in that refresh.
The deadline bounds a single observation; it does not retry failed bootstrap or guarantee that a
sleeping host has completed startup. PeerList shows public diagnostics directly.
The probe never writes Peer state, changes advertisements, or grants routing/scheduling eligibility.
Read-only retrieval keeps the query and offers an explicit Retry after delegation unavailability;
that action repeats the existing live-lease selection. Outcome-unknown and exact-target safety remain
unchanged.

## Browser Configuration and JWT

Before business views mount, the browser initializes three bootstrap values owned by the current browser
origin:

- PostgREST base URL;
- current technical Peer UUID;
- user-owned JWT signing secret.

每个 Web origin 在本地保存命名连接列表和当前选择。一个条目包含 PostgREST 地址、JWT 签名密钥、稳定的 Peer UUID 和该连接的运行设置。添加连接生成新的身份；切回已保存连接复用原身份。设置中的“保存并使用连接”验证目标后才提交列表与当前选择；连接失败或存储失败不改变已保存的选择。切换前收束旧 Job worker、扩展 Host 和遥测，并清除 Resolver 缓存及连接相关的搜索、侧栏状态。

旧单连接会成为列表首项，保留凭据与身份。存储中的扁平 MetaConfig 字段是活动项的兼容投影；重新加载以列表的活动项为准。导出格式 v3 包含全部连接、当前选择和语言，包括连接凭据；导入接受旧 v2 单连接和 v3，并替换本地列表。各浏览器 origin 独立保存，不跨设备同步。

浏览器扩展的旧 API 入口独立保存命名 API 地址及当前选择，沿用现有请求协议；其他打开的扩展页面通过 extension storage 接收选择变化。原单一 `inkcreApi` 地址保留为首项。它不把 API 地址冒充 Web 的 PostgREST/JWT 连接，亦不迁移旧协议。

The application shell mounts immediately with its header and menu. A configured browser reads its
complete canonical Peer row once before business views mount; a new identity must first be
inserted. Business pages then remain available while runtime-owned version/schema registration and
the initial database-time lease complete in the background. The browser Job worker starts only after
that lease succeeds. The local Extension Host restores after the canonical Peer identity and MF Host are prepared,
independently of the initial lease. Local readiness does not advertise a live lease or start the Job
worker; the management view shares the same restore promise. A connecting or failed notice distinguishes page access from a running Peer;
failure preserves the database view and offers Retry and Settings. Optional telemetry runs after
lease adoption and does not delay either business views or the worker. Route views load on demand.

Each startup runtime binds its database URL and JWT signing closure to the captured connection.
Stopping or replacing the runtime invalidates pending work: a completed old request cannot perform
a subsequent registration write, renew another lease, install a timer, or start the worker. The
background registration updates only application version and config schema; its returned row never
overwrites the configuration or name read for the page. Already dispatched writes can still finish
against their original database. Shutdown drains queued telemetry initialization before closing its
SDK, preventing a late read from reopening it.

Failure before the initial Peer read or insertion replaces loading with an error. Retry reloads the
current URL, preserving deep-link parameters. Settings remains reachable through full-page navigation
and its independent recovery bootstrap. Saving or importing a connection verifies registration before
adoption; with positive background participation it also verifies the initial lease. Zero participation
does not renew a lease. Neither recovery action resets stored configuration unless explicitly
requested, and the root does not rerun initialization automatically. Existing SDK transport retry
behavior is unchanged.

The selected Peer's database row supplies deployment configuration such as Extension Registry URL
and Peer HTTP timeout. The static artifact contains no environment origin, Peer identity, secret,
Worker, or runtime-config endpoint fallback.

The signing secret is masked during ordinary display, excluded from logs, and retained only in
browser-owned runtime state. The explicit full-browser export includes the secret so importing it can
restore the same connection, identity, and local preferences in another browser. Signed JWTs are memory-only. The auth store derives algorithm,
issuer, audience, and role from the generated Peer runtime contract. Ordinary Web tokens use the
browser signer's 24-hour default lifetime, independently of database admission policy. The store
regenerates the token when the secret changes and clears it when the secret is removed. PostgREST JSON access,
raw byte access, and Peer HTTP delegation reuse this single authentication authority.

Web Peer registration publishes the client-web application version and a best-effort browser/version/system
default name only when creating a new identity. Later registration refreshes runtime-owned version and schema
without replacing the Human-owned name or Peer config.

The browser Job worker starts only when a Web Peer runtime with a successful initial lease is adopted.
Opening an unconfigured Settings page does not start database polling. Saving or importing a valid
connection uses that same adoption path; repeated saves reuse the worker's existing timer. Reset
waits for worker shutdown before clearing configuration, so in-flight work can finish cleanup
against the original database connection.

The browser signer backdates `iat` by five seconds and derives `exp` from that adjusted value. This
absorbs ordinary sub-second or small deployment clock skew at the authentication boundary without
moving retries into PostgREST/domain callers. The lifetime is the browser signer's policy;
database admission does not impose a shared maximum lifetime.

## Browser Background Participation

Browser-owned MetaConfig `peer_lease_renew_interval_seconds` is an integer from zero to 86400,
defaulting to 30 for older configuration files. Positive values control both lease renewal and
pending Job scans. Adoption immediately renews the lease and starts a scan; the lease TTL is three
times this interval, preserving the default 30-second renewal and 90-second expiry. Longer intervals
delay accepting pending Jobs and recognizing an offline browser.

Zero disables background participation. The browser still registers its canonical Peer identity and
can use database pages and outbound capability delegation, but does not renew its lease, start the
Job worker, or initialize optional telemetry. Its enabled local MF selections still restore for
reading and other explicit local features. Disabling background participation cancels local active
Jobs and waits for worker and telemetry cleanup; it does not close the same connection’s Extension
Host. Database URL, signing secret or Peer identity changes, and explicit shutdown, drain and dispose
the old Host.
It does not revoke an existing lease: PostgreSQL expiry still controls when others see the Peer as
offline. Explicit actions, open Job detail polling, and normal page queries remain possible requests.

Saving or importing configuration persists this value and exports include it. Changing only a
positive interval reorders the worker's scan timer without cancelling active Jobs or replacing their
abort watcher. Disabling participation or changing database authority drains work against the original
connection before saving the new configuration; if validation of the new connection fails, stored
configuration remains intact but the stopped background runtime requires Retry or a successful save.
Pending startup checks the captured connection and interval before adopting background services.
This preference belongs to each browser; another open tab or browser can still renew the same
technical Peer identity. No cross-tab lease coordination is implied.

## Application Hosts

### Job execution and shutdown

JobManager filters by registered handler and eligibility before its conditional database claim. The active execution owns
an AbortController and a completion promise. A two-second batch read observes `abort_requested` for
a snapshot of those executions; a late response cannot cancel a new execution that reuses an ID
after connection cutover. Source handlers do not poll the Job table. Abort and timeout signal the handler and preserve their distinct reasons. The record closes
only after the handler settles, not when a Promise.race stops observing it.

`stopWorker()` stops admission, requests cancellation and awaits every admitted Job pipeline, including
pending reads, eligibility checks, claims, handler cleanup and closure, before Extension shutdown or
connection cutover. A stopped pipeline cannot begin another claim; an already dispatched successful
claim closes as aborted against the original connection before the stop completes. Browser page
termination can still end JavaScript execution before asynchronous cleanup finishes; this protocol does not promise process
survival, rollback or automatic retry. A persisted stop request alone is not proof that running work has exited.

`InfoBaseRouter` is an application-bound singleton translating Block and Relation navigation into
the current Vue UI state. `GraphSurface` and `InfoBaseListView` are route destinations; nested Block
inspectors and solved-content popups remain hosted by the active surface instead of creating a
second browser-history authority.

Explicit rumination reloads the active surface and reselects the focal Block only after confirmed
success. `PeerOutcomeUnknown` remains visible and does not trigger reload or automatic retry.

## Invariants

- InKCre runtime nodes are **Peers** in technical contracts and product UI; “client” remains only for actual application or protocol client roles.
- Database facts and capability commands remain distinct paths.
- Exact-target routing never degrades to best-effort routing.
- Ambiguous dispatch is never retried automatically.
- Browser bootstrap state is runtime authority; portable build bytes stay environment-neutral.

## 可选遥测

浏览器连接配置的 `telemetry_enabled` 缺省为 false。关闭时不读取共享观测配置、不初始化
新增 SDK、不捕获 Job 提交 carrier，也不发出新增传播头。保存连接后重新初始化；配置文件
导入、导出保留此浏览器本地选择。现有 `job.<id>` PostgreSQL 日志查询始终保留。

开启后只读取 `configs` 中 `inkcre.observability` / `inkcre.observability.v1` 的公共投影。
`deployment_id` 由部署 owner 创建，浏览器不分配部署身份。三个 OTLP/HTTP 完整信号 URL
分别启用标准浏览器 SDK 的 OTLP/HTTP protobuf exporter。连接还可显式指定 `telemetry_peer_relay_url`，
从此 base 的 `/v1/traces`、`/v1/logs`、`/v1/metrics` 经现有短期 Peer JWT 认证导出；
JWT 签名闭包绑定初始化时的连接，旧批次不会借用新连接凭据。此地址不是启用开关，
也没有自动推导或失败回退。配置不可用或初始化失败不会阻止业务启动。配置读取、
exporter 超时和正常关闭排空均有界：配置读取最多等待 10 秒后放弃观测初始化；直发
exporter 为 10 秒，经 relay 为 35 秒，以覆盖服务端最多 32 秒的转发预算和网络余量。
处理器的等待比对应 exporter 多 5 秒。flush/shutdown 的调用方只等待 1.5 秒，这不会
取消已开始的 SDK 导出，也不证明排空成功；页面退出只能 best effort。Job 页面提供可选
`diagnostics_url` 链接，用户以 Job ID 在诊断端查询，不把 Grafana 查询语法写入业务层。

`JobManager.create` 在同一个 PostgREST INSERT 中写入 SDK 注入的提交 carrier。超出
512 UTF-8 bytes 的可选 tracestate 会被省略并计数。执行成功 claim 后创建独立 trace，
通过 SDK Span Link 关联提交；claim、取消和 close 不重写提交列。Job ID 是诊断关联字段，
不是 trace ID。时延指标 `inkcre.operation.duration` 使用与 Core 一致的 `operation` /
`outcome` 标签和 5ms 至 300s 的显式秒分桶，便于跨 Peer 聚合；日志保留 `inkcre.*` 属性。
`job.submitted`、`job.started`、`job.closed` 只从明确的业务边界发出结构化
事件；既有应用日志、异常 message、参数和内容不会桥接到新增 OTLP。

浏览器原生 `await` 不能依赖 StackContextManager 或 ZoneContextManager 自动保留当前
span。本实现显式传递标准 OTel Context：`PeerManager.delegate` 的 context 传给 outbound，
`PeerHTTPOutbound` 在真实请求边界注入；Job submit 的 context 在 await 后仍显式用于
carrier 捕获。执行 trace 自身携带 Job ID 与 Link。扩展 handler 内部、独立 PostgREST 请求
和任意 provider 的原生 async 调用尚不自动继承执行 context；不得将这些独立 span 宣称为
完整执行树。新的调用者可以使用 `JobManager.create` / `PeerManager.delegate` 的可选
Context 参数接续已有 SDK context。

Peer HTTP 是唯一新增 W3C 传播 owner，目标来自已验证的 Peer advertisement。普通
PostgREST 请求只生成本地 client span，不注入传播头，也不冒充远端 server/SQL span。
开启传播的 Peer 请求使用 `redirect: error`，包括同 origin 跳转也不跟随；重定向失败仍为
`PeerOutcomeUnknown` 且不重试，关闭态保留既有 fetch 行为。无全局 fetch patch；外部 provider、Source 和内容读取不会意外携带内部 trace 或 baggage。
