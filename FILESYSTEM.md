# Filesystem

## Repository Roots

- `.agents/` - Consumer-owned Agent prompts and shared-doc workflow bridge.
- `.github/` - CI, release, deployment, contextual coding instructions, and explicit preview
  inventories under `.github/preview/`.
- `apps/client-web/` - Static Vue application.
- `apps/client-webext/` - WXT browser extension.
- `contracts/` - Checked upstream release and compatibility inputs.
- `docs/` - Local durable technical owners; `_shared/` is the read-only Hub reference.
- `extensions/` - Independently versioned native Module Federation producers.
- `packages/core/` - Shared models, protocols, storage/resolver mechanics, and Extension Host.
- `packages/ext-dev-utils/` - Extension development utilities.
- `runtime/` - Portable local and SSH database topology.
- `scripts/` - Development orchestration, contract generation, verification, and release tooling.
- `tasks/` - Active, disposable Task Packets.

## Primary Entrypoints

- `apps/client-web/src/main.ts` - Web bootstrap.
- `apps/client-web/src/core.ts` - Core registration and initialization.
- `apps/client-web/src/router.ts` - Web route authority.
- `apps/client-webext/entrypoints/` - WXT-discovered extension surfaces.
- `packages/core/src/sdk.ts` - Independent SDK exports with explicit connections.
- `packages/core/src/index.ts` - Published Vue/MF compatibility exports.
- `extensions/*/src/index.ts` - Host-consumed Extension exports.
- `extensions/*/src/main.ts` - Local producer playgrounds.
- `pyproject.toml` / `pdm.lock` - Frozen repository-level Python preview tooling.
- `svc.json` - SVC Corpus baseline and portable development targets.

## Ignored Runtime State

- `.runtime/database/<instance>/` - Database identity, Compose environment, and credentials.
- `.runtime/dev/<instance>/` - Optional isolated Chromium profile.
- `.runtime/ssh/<instance>/` - Instance-owned OpenSSH control socket.
- `.runtime/ui-source/` - Ephemeral sibling UI type-check configuration.
- `svc.local.json` - Machine-specific SVC development overlay.
- `AGENTS.local.md` - Machine-local Agent guidance.

The bounded stop path removes only resources owned by the current worktree. See `ARCHITECTURE.md` for responsibility boundaries and the nearest local `AGENTS.md` for subtree hazards.
