# Repository Architecture

This monorepo implements three logical client-side units across shared packages, applications, and
independently built Extension producers.

```text
Vue web application -----------+
WXT browser extension ---------+--> @inkcre/core --> Peer transports
Module Federation producers ---+         |               |
                                          +--> PostgREST/PostgreSQL
```

## Logical Units

- [Client Runtime and Delegation](docs/30-unit-tdd/client-runtime-and-delegation.md) owns the
  environment-neutral browser Peer, bootstrap/authentication authority, exact capability
  delegation, and navigation hosts.
- [Info-Base](docs/30-unit-tdd/info-base.md) owns graph models, hydration, byte storage, exact
  Resolver semantics, browser handles, and rendering boundaries.
- [Native Extension Runtime](docs/30-unit-tdd/native-extension-runtime.md) owns the Extension Host,
  durable enabled intent, producer/Host compatibility, native Module Federation loading, and
  compensated lifecycle.

Shared product behavior and cross-unit contracts belong to the read-only
[`docs/_shared/`](docs/_shared/) Hub reference. Package and application directories are realization
locations, not Unit boundaries.

## Cross-Unit Flows

1. Database fact: Vue surface → domain model → `DBAPIClient` → PostgREST → PostgreSQL.
2. Delegated command: domain manager → `PeerManager` → advertised protocol outbound → provider
   inbound → non-delegating local implementation.
3. Content: `Block.getHydratedContent()` → exact Resolver → solved value or safe browser handle →
   registered renderer.
4. Native Extension: exact Peer selection and enabled intent → exact Release and Host-range preflight →
   native manifest → initialize/activate; disable first records false intent, then releases native
   runtime resources.

## Realization Surfaces

- `packages/core/` - shared models, database access, Peer protocols, storage/Resolver mechanics,
  configuration/authentication, and Extension Host.
- `apps/client-web/` - Vue SPA, graph/list surfaces, settings, and static Vite artifact.
- `apps/client-webext/` - WXT browser surfaces and content scripts.
- `extensions/` - independently built native Module Federation producers.
- `packages/ext-dev-utils/` - producer development support consumed by applications.

The package graph is ESM-first. Workspace Vite and WXT applications consume `@inkcre/core` source
aliases, while external package consumers resolve its tsdown `dist` contract. Generated database
types and runtime metadata project the admitted impl-py contract through stable local adapters.

## Runtime and Delivery

- [Development Runtime](docs/40-deployment/development-runtime.md) owns SVC/Portless capabilities,
  database providers, worktree ownership, and sibling-source lanes.
- [Web Delivery](docs/40-deployment/web-delivery.md) owns checked static artifacts and Cloudflare
  Pages preview/production.
- [First-party Extension Delivery](docs/40-deployment/native-extension-delivery.md) owns Changesets,
  Registry publication, provenance, and release secret boundaries.

Pull-request preview authority is a trusted same-repository controller. It checks out the exact PR
head separately, installs frozen pnpm/PDM environments, builds the SPA and selected Module
Federation snapshots, uses `inkcre-ext preview build` to add a same-origin static Registry facade,
and directly deploys the combined output to the deterministic PR alias. Protected `main` is the
independent production authority and builds its own frozen exact-main artifact before direct Pages
delivery. Validation checks upload no deployable SPA, MF, or Registry handoff artifacts.

Executable configuration, scripts, tests, and workflows remain authoritative for exact commands
and wire values.
