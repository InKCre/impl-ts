# InKCre TypeScript Implementation

The InKCre implemented in TypeScript. Ships the Vue web peer, the WXT browser-extension peer, and TypeScript-implemented first-party extensions, all consuming a shared `@inkcre/core` package.

## Mental Model

InKCre is a system of heterogeneous peers sharing one info-base. Peers differ in runtime capability, not in authority: no fixed frontend/backend hierarchy exists.

A single admitted database protocol carries both deployment state and persisted information. Every authenticated peer can operate the full protocol surface, submit jobs, and claim work it can execute. `impl-py` owns the authoritative database schema and migrations; that does not make it a controller of other peers.

Collection, organization, and application are three distinct activities around shared information. Information and business state do not belong to any executing node and do not disappear when a node stops.

Extensions add capabilities to the peer they run on. Different Distributions of the same extension participate in the shared system under one business and data contract; no Distribution is the "central" implementation.

Before choosing a design, identify shared state, business contracts, and each participant's capability. Then pick direct read/write, job execution, or peer delegation. The authoritative model is in [unit topology](docs/_shared/20-product-tdd/unit-topology.md), [system state and authority](docs/_shared/20-product-tdd/system-state-and-authority.md), and the [knowledge capability contract](docs/_shared/20-product-tdd/knowledge-capability-contract.md).

## Knowledge Owners

`impl-ts` is an SVC Spoke and an internal monorepo. Shared Hub truth is mounted read-only at `docs/_shared/` (git submodule → `InKCre/docs`).

- Product behavior and language: `docs/_shared/10-prd/`
- Cross-unit contracts and topology: `docs/_shared/20-product-tdd/`
- Repository topology and package boundaries: `ARCHITECTURE.md`
- Physical layout and entrypoints: `FILESYSTEM.md`
- Logical Unit internals: `docs/30-unit-tdd/`
- Runtime, development capabilities, and delivery: `docs/40-deployment/`
- Volatile task state: `tasks/`
- Mechanically enforceable facts: code, configuration, schemas, tests, and CI
- Subtree-specific hazards: the nearest local `AGENTS.md`

## Repository Map

- `apps/client-web/`: static Vue SPA (the web peer)
- `apps/client-webext/`: WXT browser extension (the browser-extension peer)
- `packages/core/`: shared models, protocols, storage/resolver mechanics, Extension Host
- `packages/ext-dev-utils/`: extension development utilities
- `extensions/`: independently versioned native Module Federation producers (mail, memos, twitter)
- `contracts/`: checked upstream release and compatibility inputs (generated, do not hand-edit)
- `runtime/`: portable local and SSH database topology
- `scripts/`: development orchestration, contract generation, verification, release tooling
- `docs/30-unit-tdd/`: logical Unit design
- `docs/40-deployment/`: runtime and delivery truth

For UI work, read the installed `@inkcre/ui-web` package's `DESIGN.md` and `skills/ui-web/SKILL.md` under the consuming app's `node_modules/`. The package owns design and API rules; this repository owns business flows and layout. Backend-only tasks do not need the UI docs.

## Development Constraints

- Runtime: Node.js 22.22.3; package manager: pnpm 11.11.0. Exact commands live in `package.json` and `docs/40-deployment/`.
- `.env` files are dotenv data, not shell scripts. Load them through the application because values may contain shell metacharacters.
- Generated contracts under `contracts/` are checked-in projections. Change their source and regenerate; do not edit them directly.
- The `apps/client-webext/` WXT extension and the `apps/client-web/` Vue SPA share `@inkcre/core` but run in different security contexts. Changes that cross the seam must be validated against both runtimes.
- Follow `.agents/prompts/code-for-human.md` for source changes.

## Governance And Workflow

- Git and GitHub workflow: [Git and GitHub Governance](https://github.com/InKCre/.github/blob/main/GOVERNANCE.md) and [Contributing](https://github.com/InKCre/.github/blob/main/CONTRIBUTING.md)
- Verification and test selection: [Verification and Test Policy](https://github.com/InKCre/.github/blob/main/TESTING.md)
- Hub-Spoke shared-doc workflow: `.agents/skills/edit-svc-shared-docs/`

<!-- svc:begin -->
## SVC

Use `svc --help` or `svc <command> --help`.

- `svc status`: inspect project state
- `svc dev`: manage declared development targets

If `AGENTS.local.md` exists, read it after this file. It is ignored local guidance; shared rules belong here.
<!-- svc:end -->
