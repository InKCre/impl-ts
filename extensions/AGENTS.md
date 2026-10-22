# Native Extensions

Scope: `extensions/**`. Stable Release, Registry, and Module Federation delivery truth belongs to
[`docs/40-deployment/native-extension-delivery.md`](../docs/40-deployment/native-extension-delivery.md).

Host/producer runtime contracts belong to
[`docs/30-unit-tdd/native-extension-runtime.md`](../docs/30-unit-tdd/native-extension-runtime.md).

## Local Tripwires

- Keep each directory an independent build package. Its directory name is the local ID;
  `package.json#inkcre.name`, version, nickname, and `module_federation` association are Registry
  identity and compatibility inputs, not playground metadata.
- Keep production remotes relocatable: `vite.config.ts` must retain `base: './'`, emit the native
  `mf-manifest.json`, and write `dist/client-web`.
- Export host-consumed capabilities from `src/index.ts`; keep `src/main.ts` limited to the local
  playground. Do not make the Host depend on playground bootstrap behavior.
- Changes to a native producer must preserve asset-closure validation. Record its native release intent
  in a Changeset for that package; its committed package version owns the MF release coordinate.
- Build and publish only this repository’s MF distributions. Python producers use their own repositories
  and versions; do not read their source or version to choose an MF release.

## Required Check

```bash
pnpm build
```
