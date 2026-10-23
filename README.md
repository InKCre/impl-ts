# InKCre TypeScript Implementation

The TypeScript peer of InKCre — the web application, the browser extension, and first-party TypeScript extensions, built around the shared `@inkcre/core` SDK.

`impl-ts` 是 InKCre 的 TypeScript 实现——一个承载 Web 应用、浏览器扩展和一方 TS 扩展的 peer monorepo。

## Repository shape

- `packages/core/` — `@inkcre/core` shared SDK (info-base model, storage, resolvers, retrieval, extension host)
- `apps/client-web/` — Vue 3 web application (static Vite artifact)
- `apps/client-webext/` — WXT browser extension
- `extensions/` — independently built native Module Federation producers (`ext-github`, `ext-mail`, `ext-twitter`, `ext-memos`)

## Quickstart

### Use the product

End users consume the published web build and browser extension through the deployed instance — see [inkcre.dev](https://inkcre.dev) for entry points. To self-host the underlying peer, see [`InKCre/impl-py`](https://github.com/InKCre/impl-py).

### Develop locally

```bash
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm run doctor
pnpm dev
```

`pnpm check` is the required format/lint/type/test/build gate used by CI. See the [organization contribution guide](https://github.com/InKCre/.github/blob/main/CONTRIBUTING.md) and [docs/40-deployment/development-runtime.md](docs/40-deployment/development-runtime.md) for the full local and SSH runtime contract.

## Documentation

- [Repository architecture](ARCHITECTURE.md)
- [Agent operating guide](AGENTS.md)
- [Deployment and runtime](docs/40-deployment/README.md)
- [Documentation index](docs/index.md)
- Shared product truth Hub: [`InKCre/docs`](https://github.com/InKCre/docs) (mounted read-only at `docs/_shared/`)
