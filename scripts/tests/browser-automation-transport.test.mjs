import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const require = createRequire(new URL('../../packages/core/package.json', import.meta.url))
const { ExtensionTransport } = await import(
  pathToFileURL(require.resolve('puppeteer-core/internal/cdp/ExtensionTransport.js')).href
)

void test('ExtensionTransport close awaits native detach and removes its event listener', async () => {
  const original = globalThis.chrome
  const listeners = new Set()
  let completeDetach
  const detached = new Promise((resolve) => {
    completeDetach = resolve
  })
  globalThis.chrome = {
    debugger: {
      attach: async () => {},
      detach: () => detached,
      onEvent: {
        addListener: (listener) => listeners.add(listener),
        removeListener: (listener) => listeners.delete(listener),
      },
    },
  }
  try {
    const transport = await ExtensionTransport.connectTab(42)
    assert.equal(listeners.size, 1)
    let finished = false
    const closing = transport.close()
    void closing.then(() => {
      finished = true
    })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(finished, false)
    assert.equal(listeners.size, 0)
    completeDetach()
    await closing
  } finally {
    globalThis.chrome = original
  }
})

void test('ExtensionTransport close exposes detach failure to the session owner', async () => {
  const original = globalThis.chrome
  globalThis.chrome = {
    debugger: {
      attach: async () => undefined,
      detach: async () => {
        throw new Error('native detach failed')
      },
      onEvent: { addListener() {}, removeListener() {} },
    },
  }
  try {
    const transport = await ExtensionTransport.connectTab(1)
    await assert.rejects(transport.close(), /native detach failed/)
  } finally {
    globalThis.chrome = original
  }
})
