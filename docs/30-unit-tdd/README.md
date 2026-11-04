# Web App Unit TDD

This directory owns stable internal design for the logical units implemented by this repository.
The units cross package and application directory boundaries; paths are implementation locations,
not architectural boundaries.

## Owners

- [App Runtime and Delegation](app-runtime-and-delegation.md) owns the static browser Peer,
  bootstrap configuration, authentication, exact capability delegation, and application navigation
  hosts.
- [Info-Base](info-base.md) owns peer-local graph models, hydration, byte storage, exact Resolvers,
  browser runtime handles, and rendering boundaries.
- [Native Extension Runtime](native-extension-runtime.md) owns the Extension Host, producer/Host
  boundary, native Module Federation loading, durable enabled intent, and compensated lifecycle.

Repository/package topology remains in [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md). Observable
product behavior and cross-unit contracts remain in the read-only
[`../_shared/`](../_shared/) Hub reference. Deployment, Registry delivery, and publication
automation are outside Unit TDD.
