---
description: Use the Memos Web Extension to prepare connection details for a compatible app.
---

# Prepare your client connection

The Memos Web Extension provides a connection-preparation interface. It does not create a Source,
schedule collection, or write a test note. Core and the browser use compatible Distributions of `inkcre/memos`. Their versions are selected
independently. During first setup, a repository-backed Web install looks up the official
Python Release for a Core without an existing selection.

1. In **Extensions**, enable Memos in this browser, then open **Setup**.
2. Choose the online Core providing the service. A single eligible Core is selected automatically.
3. Select **Prepare connection**. The browser generates a PAT if none is saved, otherwise reuses
   the saved PAT. It saves through Core and enables Memos only when necessary.
4. Copy **Server URL** and **Personal Access Token** into your compatible client's sign-in screen.
   Use the complete URL as returned by Memos; do not append `/api/v1` or use the PostgREST address.

An already configured connection opens directly on these connection details. Opening or refreshing
the page never generates or rotates a PAT. The result says that the information is ready; verify
the actual sign-in in the external app. The established compatibility baseline is MoeMemos Android
2.0.4, not every Memos version.

Saving, enabling, and reading the address are separate operations. A failed address read does not
undo a saved PAT or disable Memos. If Core has no public address, set its Public HTTP Base URL in
**Peers → Edit Config**, then select **Refresh status**. The address must be reachable from your
client device and may include a deployment path prefix.

If enablement fails after saving, retry with the saved PAT. An uncertain save or enable response
requires **Refresh status** before continuing; the page never automatically repeats that request
or switches to another Core. An online, enabled Core is assumed to provide the service until a
concrete failure is observed. If copying is unavailable, reveal the token and manually select it.
Hide it again before sharing a screenshot.

PAT replacement and revocation remain explicit Extension Config operations. Replacing a token
requires updating every app that used the old token. This setup interface never does it silently.

The **Memos connection help** link opens this guide for the installed version. Extension cards also
link any global, Core, or Web documentation provided by that exact release, including when the
extension is disabled. Missing or temporarily unavailable documentation does not prevent setup.
