# Contributing

The organization-wide Git and pull-request policy lives in
[InKCre Git and GitHub Governance](https://github.com/InKCre/.github/blob/main/GOVERNANCE.md).
This guide owns the `impl-ts` setup, monorepo boundaries, verification, and release-intent details
required by that policy.

## Package access before setup

This public repository consumes the private `@inkcre/ui-web` GitHub Package. Local clone and fork
development therefore requires both a classic GitHub personal access token with `read:packages` and
read access to that package. Follow the
[`ui` authentication instructions](https://github.com/InKCre/ui/blob/main/CONTRIBUTING.md#github-packages-authentication)
before running `pnpm install`. A token scope does not grant package access by itself.

Treat `401` or `403` during install as an access/setup failure. Do not edit the lockfile, commit a
token, or add credentials to this repository's `.npmrc`. If you cannot obtain package access, confirm
another suitable contribution with a maintainer; the normal local check cannot run without the
locked package.

The approved public-download path uses the original UI tarball on its versioned GitHub Release.
Publication and consumer cutover have not happened yet; the active lockfile intentionally retains
the existing source. Maintainers follow the
[UI delivery contract](https://github.com/InKCre/ui/blob/main/CONTRIBUTING.md#public-package-delivery)
to publish and anonymously verify the asset first, then add a version-qualified root override and
regenerate this lockfile. Keep `@inkcre/ui-web` dependency values as semver: Module Federation reads
them as `requiredVersion`. The cutover must pass a clean no-token install, Web build, and Extension
build before the package-access prerequisite above can be removed.

## Setup

Use Node.js 22.22.3 and pnpm 11.11.0, then run from the repository root:

```bash
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm doctor
pnpm check
```

`pnpm doctor` diagnoses the pinned toolchain. Use `pnpm dev` for the Web peer and read
[`docs/40-deployment/development-runtime.md`](docs/40-deployment/development-runtime.md) before
starting a database runtime, browser-extension lane, local Extension remotes, or joint UI source
lane. Integration and E2E commands create or mutate development data; never point them at a shared
development or production info-base.

## Monorepo boundaries and change names

- `apps/client-web/` and `apps/client-webext/` are independently delivered applications.
- `packages/core/` and `packages/ext-dev-utils/` are shared packages.
- Each `extensions/<id>/` is an independently versioned Module Federation distribution.

Use the primary area as the `type(scope): summary` scope: `client-web`, `client-webext`, `core`,
`ext-dev-utils`, or an Extension ID such as `twitter`. Use `extensions` for one coherent change
spanning several Extensions and `release` for release tooling. The title does not select versions;
list every affected release project in the pull-request body. Examples: `fix(client-web): retain peer
selection`, `feat(twitter): show archived media`, and `ref(extensions): share host bootstrap`.

For user-visible behavior or another delivered contract, run `pnpm changeset` and select the exact
affected workspace projects. Do not edit generated versions or changelogs in a feature pull request.
Pure contributor documentation or release-tooling changes do not invent package news. The
[delivery contract](docs/40-deployment/native-extension-delivery.md) owns preparation, publication,
and the distinction between applications, SDK packages, and native Extension releases.

## Verification and pull requests

Run `pnpm check` before opening or updating a pull request. Also run the behavior-level command that
matches the change, normally `pnpm test:e2e:web`, `pnpm test:e2e:webext`, or a narrower documented
acceptance command. Record what actually ran and any unmet environment condition in the pull-request
body; a package build is not evidence of browser behavior.

External fork workflows require maintainer approval and receive no preview or production credentials.
A maintainer may need to confirm package access for CI and perform a trusted Pages preview after the
ordinary checks pass. Never add a credential to the branch to make a fork workflow run.
