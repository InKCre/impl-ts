import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { firefox } from '@playwright/test'

const require = createRequire(new URL('../apps/webext/package.json', import.meta.url))
const puppeteer = require('puppeteer-core')
const extension = fileURLToPath(new URL('../apps/webext/.output/firefox-mv3', import.meta.url))
const extensionId = 'webext@inkcre.org'
const extensionOrigin = randomUUID()
const profile = await mkdtemp(join(tmpdir(), 'inkcre-firefox-collection-'))
const server = createServer((request, response) => {
  if (request.url?.startsWith('/database/')) {
    // Keep accepted material in the real outbox. No database write acknowledgement is fabricated.
    response
      .writeHead(403, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ message: 'fixture storage offline' }))
  } else
    response
      .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end(
        '<title>Firefox collection</title><article><h1>First page</h1><p>The first document belongs to the original tab URL.</p></article>'
      )
})
let browser
try {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  await writeFile(
    join(profile, 'extension-preferences.json'),
    JSON.stringify({
      [extensionId]: { permissions: [], origins: ['http://127.0.0.1/*'], data_collection: [] },
    })
  )
  browser = await puppeteer.launch({
    browser: 'firefox',
    executablePath: firefox.executablePath(),
    userDataDir: profile,
    headless: true,
    defaultViewport: null,
    args: ['--remote-allow-system-access'],
    extraPrefsFirefox: {
      'extensions.webextensions.uuids': JSON.stringify({ [extensionId]: extensionOrigin }),
    },
  })
  assert.equal(await browser.installExtension(extension), extensionId)
  const options = (await browser.pages())[0]
  // Gecko does not emit web-page load events for extension UI. Wait for the actual control.
  await options.goto(`moz-extension://${extensionOrigin}/options.html`, { waitUntil: [] })
  await options.waitForSelector('input[type="password"]')
  assert.match(await options.evaluate(() => document.body.innerText), /此浏览器尚不支持自动化操作/)
  const message = (request) =>
    options.evaluate(async (request) => {
      const result = await globalThis.browser.runtime.sendMessage(request)
      if (!result.ok) throw new Error(result.error)
      return result.value
    }, request)
  await message({
    type: 'collection-connect',
    connection: {
      name: 'Gecko offline collection',
      url: origin + '/database',
      secret: 'synthetic-firefox-collection-credential',
      storageId: -4,
    },
  })
  await message({ type: 'collection-enable-origin', origin })
  const tabId = await options.evaluate(async (url) => {
    const tab = await globalThis.browser.tabs.create({ url, active: true })
    return tab.id
  }, origin + '/first')
  async function expectSaved(url) {
    const result = await options.waitForFunction(
      async (url) => {
        const result = await globalThis.browser.runtime.sendMessage({ type: 'collection-status' })
        return result.value.items.find(
          (item) => item.automatic && item.url === url && item.state === 'blocked'
        )
      },
      { polling: 100, timeout: 15_000 },
      url
    )
    const accepted = await result.jsonValue()
    assert.match(accepted.error, /fixture storage offline/)
    return accepted.id
  }
  const first = await expectSaved(origin + '/first')
  // Firefox keeps a content script's initial sender URL after same-document navigation.
  await options.evaluate(
    (tabId) =>
      globalThis.browser.scripting.executeScript({
        target: { tabId },
        func: () => {
          history.pushState({}, '', '/next')
          document.querySelector('article p').textContent =
            'The second page belongs to the same live document.'
        },
      }),
    tabId
  )
  const next = await expectSaved(origin + '/next')
  assert.notEqual(next, first)
  console.log(
    `${await browser.version()}: built extension installed; automatic collection queued both sides of a same-document navigation`
  )
} finally {
  try {
    await browser?.close()
  } finally {
    server.closeAllConnections()
    if (server.listening) await new Promise((resolve) => server.close(resolve))
    await rm(profile, { recursive: true, force: true })
  }
}
