# First-party Extension Delivery

本仓 `extensions/*/package.json` 中声明 `inkcre.module_federation` 的包是 MF producer。
包版本、逻辑名和 SDK 兼容范围来自同一个 manifest。
[扩展发行与安装](../_shared/20-product-tdd/extension-release-and-installation.md)定义宿主与发行端共同遵循的协议。
宿主加载实现见[原生扩展运行时](../30-unit-tdd/native-extension-runtime.md)。

## Release Intent and Versioning

Before SDK 1.0, each Core `0.y` line is a native compatibility boundary. Compatible additions can
ship in a patch release within that line; a new minor requires an explicit consumer migration.
Core 0.4.1 adds optional recall presentation APIs while retaining the 0.4 public surface and existing
native ranges. The deprecated `peerJwtContract.maximum_lifetime_seconds` field (also available at
`databaseRuntimeContract.jwt`) retains the historical signing default, not a database admission
limit. The generated database contract remains the authority for the actual protocol.

A targeted release uses Changesets to generate the selected units' versions and changelogs. A
compatible SDK bump need not release MF consumers whose only generated change is dependency
propagation: they do not bundle Core (`import: false`) and keep their declared Host SDK range.
Consumers that bundle changed code or require a newer minimum SDK must be released with it.

Contributors record intent with `pnpm changeset`, selecting the affected versioned workspace
projects: applications, SDK packages, or Extension packages. Private application and Extension
packages are versioned too; `private` does not mean their release intent should be omitted.
Changesets own versions and changelogs, while each delivery workflow owns its artifact. A package's
commit or PR scope is not a substitute for selecting it in the Changeset.

[First-party Extension release](../../.github/workflows/extension-release.yml)在受保护的
`main` 上执行以下步骤。

- Changesets 通过 Version PR 生成包版本和 changelog。一个 producer 仍有自己的待升版 Changeset
  时，正式流程等其版本提交后再发布。
- 候选只选择此次 push 新增或升版、且 GitHub 尚无公开 Release 的 MF producer。
  手动恢复的 source SHA 必须是当时的 `main`，候选选择与其父提交比较。
- 构建选中的包和 Core SDK，校验 MF manifest 与资源。工作流保存原始
  `module-federation.zip`、SHA-256 和发布计划，由 ZIP 生成同仓的产物提交。

The repository must enable **Allow GitHub Actions to create and approve pull requests** for
Changesets to create its Version PR. GitHub combines these capabilities in one setting; this
workflow only creates PRs and must never approve reviews. Default workflow-token permissions stay
read-only, with write permissions confined to reconciliation and publication. GitHub may require a maintainer to
select **Approve workflows to run** on a token-created Version PR before its checks execute; do not
replace this gate with an empty-check merge or a broader credential.

App checks, Pages production, and Pages preview are separate application lifecycles. They cannot
publish first-party Extensions. Local development and local verification must never publish either.

Python and Module Federation are independent native releases. Each producer owns its native version and publishes that distribution to its own repository.
The Web workflow does not read Core source or a Core version plan. Python publication neither
selects nor waits for MF, and MF publication neither selects nor waits for Python. Host SDK ranges
remain native loading requirements; they do not describe cross-distribution business compatibility.

Pages pull-request previews are the deliberate exception to building directly from pending package
versions: the trusted preview controller runs the existing Changesets version command in an isolated
copy so the preview can load a mutually compatible Host and MF when a change raises the MF's minimum
Host SDK. This produces temporary derived versions for preview only. It neither consumes the pending
changesets in the PR nor replaces the normal Version PR and protected-main release lifecycle.

Workspace contract 先校验源代码格式、静态规则和类型，再读取 Changesets 的版本计划。有待升版的包时，
在 CI 的临时 checkout 中运行 `pnpm release:version` 与 `pnpm install --lockfile-only --ignore-scripts`，然后构建并验证 Host 和 MF。
Pages preview 对受信控制器选定的 PR head 使用同样的版本计划和命令，保留完整历史供 Changesets 读取。
这些派生版本仅用于验证和预览，不回写源分支，也不替代 Version PR 或正式发布。

本地需要验证尚未发布的 SDK 时，在临时 clone 中运行上述命令及 `pnpm build`；日常工作树继续保留版本意图。

A plugin owns compatibility of its shared configuration, state, Source/Job parameters and stored
information. Changesets record MF changes even when no Python change is necessary. Published native
coordinates and saved candidate bytes are immutable; repairs require a new native version.

## Native SDK 0.4 cutover

The Peer-participation protocol removes the SDK's global Extension version and enabled array.
New first-party MF releases therefore require `@inkcre/core >=0.4.0 <0.5.0`; historical MF releases
keep their existing declared range and are not silently repinned or declared compatible. Shared
configuration and business data remain preserved when the user chooses a supported native release.

This breaking cutover prepares the SDK and its in-repository consumers in the same reviewed change.
The existing `pnpm release:version` command consumes the already-admitted UI intents and the native
participation intent once, generating SDK 0.4 and independent MF patch releases. The resulting
Version outputs are committed; no duplicate pending intent remains for the next reconciliation.
This is the one-time delivery boundary for this cutover. Ordinary feature work continues to submit
Changesets and use the automated Version PR described above.

The original Peer-participation cutover consumed the official Runtime SDK 0.4.1 tarball and Toolkit 0.5 wheel through exact GitHub
Release asset URLs and lock-file integrity. Consumers install prebuilt packages without checking
out Registry SDK source or running its SDK preparation. Runtime SDK 0.4.1 also qualifies its own
build with the official Core SDK 0.4 prebuilt asset, removing the earlier Git-package bootstrap.
The Core SDK publishes independently through its protected-main GitHub Release lane; its source
remains a workspace dependency inside this repository, while external producers consume the
prebuilt package. Runtime 0.4.1 preserves the 0.4 API and Host SDK range. Dependency publication,
candidate qualification and production Extension publication remain separate delivery boundaries.

The first production candidate for this cutover uses that final Runtime 0.4.1 qualification input.
Its API and Host SDK range are unchanged, and the prepared App and MF versions still carry the
already-consumed cutover intent. This dependency substitution occurs before those MF coordinates
are published or have a saved production candidate; it does not create a second version intent.
If either a published coordinate or a saved candidate exists, preserve its original bytes instead
of rebuilding the same version. Subsequent producer changes continue to use ordinary Changesets.

当前 Runtime 依赖由 [App 命名与兼容身份](web-delivery.md#app-命名与兼容身份)引用的 workspace catalog 管理。

Required database checks normally resolve the protected Core `stable` artifact. During this cutover,
`contracts/core-release.json` can admit a `canonical_candidate` with an existing canonical Core
image digest, its protected-main source SHA and exact database contract revision. The consumer
checks the image-owned manifest against both expected values and rejects tags, other registries,
source mismatches and contract mismatches. This reference is populated only after the existing Core
canonical artifact lane publishes it; a local or preview image is qualification evidence and cannot
be entered as that canonical candidate. Omitting the entry continues to use stable. This admission
does not move stable, deploy Core or migrate a production database.

## 静态分发与公开 Release

发布工作流在受保护的 `production` 环境执行。它只发布本次候选，从保存的 ZIP 生成
独立的产物提交，并用同仓的 `inkcre-mf/<namespace>/<name>/v<version>` 标签保留该提交。
GitHub Release 原有的版本标签仍指向源码提交，可由此查看 producer 的 `docs/user`。

InKCre 官方发行的 `manifest_url` 使用 jsDelivr 按完整 Git commit SHA 提供的静态地址。
Manifest 的 `publicPath` 使用 `auto`，入口和异步资源从该发行的目录加载。
流程验证公开 manifest 和入口的跨源响应及字节，再公开同一份 ZIP 和 Release 正文。
每次只追加本次产物，过去的发行保留自己的精确 URL。其他发布者由自己的仓库发行，
并自行选择满足[共享契约](../_shared/20-product-tdd/extension-release-and-installation.md)的静态托管。

首次启用仓库发现时给两个发布者仓库添加 `inkcre-extension` Topic。

失败时在原 run 上使用 **Re-run failed jobs**，从同一个 GitHub Actions 附件恢复候选。
候选保留 90 天。公开后的修订需要 producer 升版。

本地构建和验证不进行发布。

```bash
pnpm --filter @inkcre/core build
pnpm --filter @inkcre/ext-mail build
fixture="$(mktemp -d)"
node scripts/prepare-repository-extension.mjs mail "$fixture" InKCre/impl-ts
node --test scripts/test-extension-publication.mjs scripts/tests/independent-extension-release.test.mjs
```
