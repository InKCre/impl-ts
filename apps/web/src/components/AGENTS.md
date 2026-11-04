# Component Subtree Instructions

Scope: `apps/web/src/components/**`.

## Hazards and Owners

- Domain contracts belong to `@inkcre/core` or the owning application domain. Do not create a
  component-local copy of a model merely to shape props or emits.
- Solved-content renderer selection belongs to the core `Resolver` registration. Keep
  `SolvedContentRenderer` as a dynamic handoff; do not add a second resolver-to-component map here.
- Keep InKCre runtime-node names under `peer/` and use “Peer” in user-facing copy. Use “client” only for actual protocol client roles.

General component file guidance lives in
[component.instructions.md](../../../../.github/instructions/component.instructions.md). Stable
runtime and Info-Base semantics belong to `../../../../docs/30-unit-tdd/`.

## Checks

- Run `pnpm --filter @inkcre/web type-check` after changing component contracts or Vue code.
- Run `pnpm --filter @inkcre/web test` when changing behavior covered by component specs.
