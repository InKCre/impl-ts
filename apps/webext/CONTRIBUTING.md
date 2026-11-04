Config `web-ext.config.ts` like this to persist Chrome/Chromium profile under .wxt/chrome-data.

```typescript
import { resolve } from 'node:path'
import { defineWebExtConfig } from 'wxt'

export default defineWebExtConfig({
  binaries: {
    chrome: 'path/to/chrome',
  },
  // For MacOS/Linux
  chromiumArgs: ['--user-data-dir=./.wxt/chrome-data'],
  // For Windows
  chromiumProfile: `${resolve('.wxt/chrome-data')}`,
  keepProfileChanges: true,
  // About persist user data under Windows, refer to https://github.com/wxt-dev/wxt/issues/1023 for more
})
```
