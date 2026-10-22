# ExtensionCard

Displays one deployment Extension and its independent native participation on each Peer.

The `extension` prop supplies shared identity and configuration; `participations` supplies exact
Peer/distribution/version selections and enabled intent. `peers`, `livePeerIds` and `currentPeerId`
identify operation targets and determine local runtime, remote management or offline intent routing.
`peerSelectionDisabled` prevents mutation while target discovery is unavailable.

Each Peer row keeps version selection, enablement, actual running version and errors together.
The component obtains actual runtime status from the host rather than inferring it from enabled
intent. A selection change affects only that row. Removing a disabled participation retains shared
configuration and business data. An unobserved remote Host is not assigned a format from its name.

`updated` emits the shared configuration row after a successful save. `participationChanged` asks the
parent to reload native choices after a successful targeted mutation. The running browser module
can contribute its own setup dialog; disabling that browser closes its contribution first.

Configuration editing offers schemas with their exact Peer/distribution/version source, plus JSON
editing without a schema. Documentation opens for an explicitly selected participation and follows
Registry-returned links. Missing documentation does not block runtime operations.
