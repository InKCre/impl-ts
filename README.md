# InKCre Web Clients

Monorepo for the InKCre web application, browser extension, shared client core, and native Module
Federation Extensions.

## Setup

Required tools:

- Node.js 22.22.3 through the root pnpm-managed runtime;
- pnpm 11.11.0 from `packageManager`;
- Python 3.11+, PDM, and `sustainable-vibe-coding==14.0.0`;
- Docker Compose v2, locally or through an SSH alias;
- a GitHub token with `read:packages` for `@inkcre/ui-web` and the admitted core image.

```bash
pdm add -g --save-exact sustainable-vibe-coding==14.0.0
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm run doctor
```

Store the package token as a user-level placeholder rather than repository configuration:

```bash
pnpm config set --global //npm.pkg.github.com/:_authToken '${NODE_AUTH_TOKEN}'
```

Authenticate the selected Docker engine separately when the database runtime needs GHCR access.
See [Development Runtime](docs/40-deployment/development-runtime.md) for local, SSH, external
impl-py, Portless, browser, and sibling UI setup.

## Commands

```bash
pnpm dev             # Ensure database and web capabilities
pnpm dev:webext      # Ensure the WXT capability
pnpm dev:all         # Develop the web Host with local remotes
pnpm dev:status      # Observe capability health
pnpm dev:stop        # Stop only current-worktree resources
pnpm run doctor      # Diagnose versions and runtime contracts
pnpm check           # Required format, lint, type, test, and build gate
pnpm test:e2e        # Browser tests with owned runtime resources
```

Specialized database, sibling UI, contract-generation, and release commands are documented under
[Deployment and Runtime](docs/40-deployment/README.md); `package.json` remains their executable
owner.

## Documentation

- [Repository topology](ARCHITECTURE.md)
- [Logical Unit design](docs/30-unit-tdd/README.md)
- [Deployment and runtime](docs/40-deployment/README.md)
- [Documentation index](docs/index.md)

Shared product requirements and cross-unit Product TDD are mounted read-only at `docs/_shared/`.
Update the Hub source first and publish it before changing this repository's reference.
