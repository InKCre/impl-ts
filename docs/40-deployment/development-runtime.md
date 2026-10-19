# Development Runtime

## Capability Contract

The committed [`svc.json`](../../svc.json) declares four worktree-scoped capabilities: `database`,
`web`, `web-ui`, and `webext`. SVC resolves the worktree instance and coordinates provisioning and
readiness; [`scripts/dev.mjs`](../../scripts/dev.mjs) and the database runtime scripts own the
executable behavior. Observe without provisioning with `pnpm dev:status`, and run
`pnpm run doctor` before diagnosing host setup.

Portless gives the web and WXT targets instance-specific HTTPS `.localhost` routes. Their probes
accept only the expected target and worktree identity. Provisioning returns after readiness; it does
not transfer long-lived process ownership to SVC. The optional `web-ui` target is a non-release
source lane whose resolved checkout stays machine-local. Normal build, check, and CI continue to
use the locked Registry package.

`pnpm dev:webext` builds and watches the browser extension without requiring a browser. When
`INKCRE_CHROMIUM_BINARY` is supplied, the development browser uses the instance-owned profile under
`.runtime/dev/<instance>` rather than a shared user profile. Hosts that cannot perform Portless's
first-time privileged setup may place a consistent unprivileged `PORTLESS_PORT` and matching access
URLs in ignored `svc.local.json`; these are host facts, not repository defaults.

## Joint Development Lanes

`pnpm dev:all` runs the web Host with local Extension remotes. A missing remote output is built in a
separate process before mounting because Module Federation virtual modules are package-local; the
Host Vite process must not absorb a producer build. Producer playgrounds remain isolated lifecycle
and UI surfaces, not Host bootstrap authority.

The sibling `@inkcre/ui-web` source lane is an explicit non-release opt-in:

```bash
pnpm --dir ../ui install --frozen-lockfile
pnpm --dir ../ui generate
pnpm dev:ui --ui-source ../ui/packages/web
pnpm type-check:ui --ui-source ../ui/packages/web
```

Use `pnpm dev:all:ui --ui-source ../ui/packages/web` when a local Extension remote changes in the
same loop. The source root is validated for the exact package and public entries, remains
machine-local, and is never written to manifests or the lockfile. Do not use `pnpm link`, `file:`, a
temporary workspace member, or manifest/lockfile edits as a substitute. Normal development,
build, check, and CI stay Registry-backed.

Source mode aliases the package's public source entries and consumer-owned peer dependencies,
retains separate Sass ownership, and refuses `vite build`. Before handoff, stop the worktree,
remove `INKCRE_UI_SOURCE_ROOT` if set, and run the normal `pnpm check`; a green source loop is not
release evidence.

UI 2.0 的共享运行时是 Vue（最低 3.5.25）；使用 UnoCSS 的应用自行声明 UnoCSS。Web 的 Uno 配置在通用 preset 后注册
`@inkcre/ui-web/uno` 的 `presetInk()`，使语义颜色与字体工具类实际生成。
CodeMirror、JSON 语言服务等编辑器实现依赖由 UI 包拥有，源码联调也从 UI 自身解析它们。
Web、mail、twitter 和 ext-dev-utils 锁定同一正式 UI 版本；生产构建不使用源码映射。

维护 UI 消费代码前，从对应 workspace 的 `node_modules/@inkcre/ui-web/DESIGN.md`
读取同版本的设计决策，再按随包 `skills/ui-web/SKILL.md` 选择组件与组合指南。
各消费者的 `intent.skills` 已显式声明该包，可在相应 workspace 运行
`pnpm exec intent load @inkcre/ui-web#ui-web`（例如先 `cd apps/client-web`）。
仓库根目录只安装 Intent CLI，不另建一份 UI 依赖或复制 DESIGN.md；更新依赖时同步核对指南。

## Browser Runtime Configuration

The web settings UI owns the PostgREST URL, technical Peer ID, user-supplied JWT signing
credential, language, and full-browser import/export. The selected Peer's database row owns its Extension Registry URL and
other Peer configuration. A fresh browser origin has no environment selection. The explicit export includes the credential
so another browser can restore the same experience. No InKCre service origin, Peer identity, or JWT
credential may enter source, source maps, Vite variables, Cloudflare bindings, or the built web and
extension artifacts. The executable checks are
[`scripts/check-local-runtime-contract.mjs`](../../scripts/check-local-runtime-contract.mjs) and
[`scripts/check-package-contract.mjs`](../../scripts/check-package-contract.mjs).

## Database Providers and Ownership

The committed database provider is portable local Docker. Machine-specific selection belongs only
in ignored `svc.local.json`; [`scripts/database-provider.mjs`](../../scripts/database-provider.mjs)
owns provider parsing and transport safety.

- `local` uses the host Docker CLI and publishes collision-safe loopback ports.
- `ssh` uses one alias from the user's SSH configuration. The repository owns no hostname, user,
  key path, or remote Docker path. The remote engine allocates ports, and an instance-owned OpenSSH
  control tunnel exposes them locally; the optional forwarding host defaults to remote loopback.
- `external` attaches to one absolute, machine-local impl-py `runtime.json` descriptor. Attachment
  succeeds only for a development runtime owned by `InKCre/impl-py` when its runtime instance,
  Compose project, Docker daemon, contract revision, migration head, source fingerprint, descriptor,
  and live readiness agree.

For a client-owned `local` or `ssh` runtime, the database provisioner resolves impl-py's admitted
`stable` channel once to an immutable digest. The selected image supplies the raw schema and role
artifact; fresh pgvector PostgreSQL is restored before that exact core service reconciles runtime
credentials and development data, with PostgREST serving the resulting database. The PostgreSQL
health check uses TCP so the temporary socket-only initialization server cannot release the restore
step before the final server is listening. Client-web owns no
migration SQL, role definitions, seed ordering, or startup sleeps. Those semantics remain an impl-py
capability boundary. [`runtime/database.compose.yml`](../../runtime/database.compose.yml),
[`contracts/core-release.json`](../../contracts/core-release.json), and
[`scripts/database-runtime-lib.mjs`](../../scripts/database-runtime-lib.mjs) are the executable
owners.

`pnpm db:ready` emits machine-readable readiness. `pnpm db:reset` requires explicit confirmation,
accepts only a ready development runtime, and resets only this worktree's client-owned database.
`pnpm dev:stop` removes only this worktree's Portless routes and client-owned database/tunnel
resources. Client-web refuses to reset or stop an external core-py runtime; recovery and cleanup
must go through core-py. Browser E2E always creates and removes its own isolated database runtime.

The checked database projection records the contract revision intentionally adopted by this
consumer. Update it with `pnpm contract:sync` when client work adopts a newer compatible revision;
an unrelated pull request does not chase a moving `stable` channel. CI still resolves `stable` once
to an immutable image and runs that real core service through the isolated browser/database chain,
which proves the checked client remains compatible with current delivery. A breaking contract
revision requires the coordinated producer-first migration defined by the shared contract.
Pull-request evidence does not establish source-branch or migration equality between repositories.

尚未发布的候选 Core 可用 `pnpm contract:sync --image sha256:<完整的本地镜像 ID>` 生成投影，再用相同参数追加
`--check` 核对。镜像必须已存在于所选 local/ssh Docker daemon，工具核对 ID 并使用同一不可变镜像创建、清理
独占的 typegen 数据库，不接受可移动 tag，也不会拉取本地 ID。此入口不支持 external provider；需选择构建候选的
同一 provider。`contracts/core-release.json` 仍只接纳已发布的 GHCR digest，本地生成不能代替发布产物验收。

## Operator Commands

Run these from the repository root; [`package.json`](../../package.json) owns their exact carriers.

```bash
pnpm dev
pnpm dev:ui --ui-source ../ui/packages/web
pnpm dev:webext
pnpm dev:all
pnpm dev:status
pnpm dev:stop
pnpm db:ready
pnpm db:reset
pnpm contract:sync
pnpm test:e2e
```
