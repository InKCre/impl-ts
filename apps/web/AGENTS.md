# Web App

Static Vue application and equal InKCre database Peer.

## Owners

- Runtime, Peer delegation, configuration, and authentication: `../../docs/30-unit-tdd/app-runtime-and-delegation.md`.
- Info-Base and Resolver contracts: `../../docs/30-unit-tdd/info-base.md`.
- Native Extension Host: `../../docs/30-unit-tdd/native-extension-runtime.md`.
- Local and sibling-UI development lanes: `../../docs/40-deployment/development-runtime.md`.
- Component subtree hazards: `src/components/AGENTS.md`.

## Local Hazards

- Keep deployable artifacts environment-neutral: no service origin, Peer identity, JWT secret, Worker runtime, or `/api/config` fallback.
- Browser-owned settings are runtime authority. Keep the JWT signing secret masked during ordinary display and absent from logs. The explicit full-browser export includes it so another browser can restore the same experience.
- Use **Peer** for InKCre runtime nodes in both technical contracts and product UI. Keep “client” only for actual protocol client roles.
- Preserve exact capability delegation and typed unknown outcomes; do not replace them with a generic Core API path or automatic retry after ambiguous dispatch.
- Start development through root commands so SVC and Portless preserve worktree identity. The sibling UI source lane is explicitly non-release evidence.

## Checks

- `pnpm --filter @inkcre/web type-check`
- `pnpm --filter @inkcre/web build`
- `pnpm check`
