import { chromium, test as base, type BrowserContext } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const extensionPath = fileURLToPath(
  new URL('../../apps/client-webext/.output/chrome-mv3', import.meta.url)
)

export const test = base.extend<{
  extensionRuntime: { context: BrowserContext; restart: () => Promise<BrowserContext> }
  context: BrowserContext
  extensionId: string
  restartContext: () => Promise<BrowserContext>
}>({
  extensionRuntime: async ({ browserName: _browserName, headless }, use) => {
    const executablePath = process.env.INKCRE_CHROMIUM_BINARY
    const profile = await mkdtemp(join(tmpdir(), 'inkcre-webext-test-'))
    let loadedExtension = extensionPath
    if (process.env.INKCRE_E2E_WEBEXT_PGREST) {
      loadedExtension = join(profile, 'fixture-extension')
      await cp(extensionPath, loadedExtension, { recursive: true })
      const manifest = JSON.parse(await readFile(join(loadedExtension, 'manifest.json'), 'utf8'))
      // Native permission UX is checked separately. This profile contains only
      // synthetic localhost pages, bookmarks and history; browser APIs stay real.
      manifest.host_permissions = ['http://127.0.0.1/*']
      manifest.permissions = [...new Set([...manifest.permissions, 'bookmarks', 'history'])]
      await writeFile(join(loadedExtension, 'manifest.json'), JSON.stringify(manifest))
    }
    const launch = () =>
      chromium.launchPersistentContext(profile, {
        headless,
        ...(executablePath ? { executablePath } : { channel: 'chromium' }),
        args: [
          `--disable-extensions-except=${loadedExtension}`,
          `--load-extension=${loadedExtension}`,
        ],
      })

    let context = await launch()
    try {
      await use({
        get context() {
          return context
        },
        restart: async () => {
          await context.close()
          context = await launch()
          return context
        },
      })
    } finally {
      await context.close()
      await rm(profile, { recursive: true, force: true })
    }
  },
  context: async ({ extensionRuntime }, use) => {
    await use(extensionRuntime.context)
  },
  restartContext: async ({ extensionRuntime }, use) => {
    await use(extensionRuntime.restart)
  },
  extensionId: async ({ context }, use) => {
    let [serviceWorker] = context.serviceWorkers()
    serviceWorker ??= await context.waitForEvent('serviceworker')

    const extensionId = new URL(serviceWorker.url()).hostname
    await use(extensionId)
  },
})

export const expect = test.expect
