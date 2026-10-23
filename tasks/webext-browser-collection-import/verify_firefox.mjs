// Run on sfp7 with its installed Firefox. No browser or driver is downloaded.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createServer } from 'node:http'

const extensionPath = resolve(process.argv[2])
let config
if (process.argv.includes('--database')) {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  config = JSON.parse(input)
}
const profile = await mkdtemp(join(tmpdir(), 'inkcre-webext-firefox-'))
if (config) {
  const manifest = JSON.parse(await readFile(join(extensionPath, 'manifest.json'), 'utf8'))
  assert.deepEqual(manifest.host_permissions ?? [], [])
  assert.ok(!manifest.permissions.includes('history'))
  // Synthetic data-path fixture, not evidence for the browser's permission UI.
  await writeFile(
    join(profile, 'extension-preferences.json'),
    JSON.stringify({
      'webext@inkcre.org': {
        permissions: ['bookmarks', 'history'],
        origins: ['http://127.0.0.1/*', 'https://developer.mozilla.org/*'],
        data_collection: [],
      },
    })
  )
}
const extensionURL = `moz-extension://${randomUUID()}/`
await writeFile(
  join(profile, 'user.js'),
  `user_pref("extensions.webextensions.uuids", ${JSON.stringify(JSON.stringify({ 'webext@inkcre.org': new URL(extensionURL).hostname }))});\n`
)
const firefox = spawn(
  '/usr/bin/firefox',
  [
    '--headless',
    '--no-remote',
    '--profile',
    profile,
    '--remote-debugging-port',
    '0',
    '--remote-allow-system-access',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] }
)
let socket
let sourceServer
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Firefox startup timed out')), 20_000)
    firefox.once('exit', (code) => reject(new Error(`Firefox exited: ${code}`)))
    firefox.stderr.on('data', (data) => {
      const match = String(data).match(/WebDriver BiDi listening on (ws:\/\/[^\s]+)/)
      if (match) {
        clearTimeout(timeout)
        resolve(match[1] + '/session')
      }
    })
  })
  socket = new WebSocket(endpoint)
  await once(socket, 'open')
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timeout)
    if (message.type === 'error') request.reject(new Error(`${message.error}: ${message.message}`))
    else request.resolve(message.result)
  })
  function command(method, params = {}) {
    return new Promise((resolve, reject) => {
      const requestId = ++id
      const timeout = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error(`${method} timed out`))
      }, 30_000)
      pending.set(requestId, { resolve, reject, timeout })
      socket.send(JSON.stringify({ id: requestId, method, params }))
    })
  }
  async function evaluate(context, expression) {
    const result = await command('script.evaluate', {
      target: { context },
      awaitPromise: true,
      expression: `(async () => JSON.stringify(await (${expression})))()`,
    })
    if (result.type === 'exception') throw new Error(result.exceptionDetails.text)
    return JSON.parse(result.result.value)
  }
  const session = await command('session.new', { capabilities: {} })
  console.log('Firefox', session.capabilities.browserVersion)
  const addon = await command('webExtension.install', {
    extensionData: { type: 'path', path: extensionPath },
  })
  assert.equal(addon.extension, 'webext@inkcre.org')
  const { context } = await command('browsingContext.create', { type: 'tab' })
  await command('browsingContext.navigate', {
    context,
    url: extensionURL + 'options.html',
    wait: 'complete',
  })
  const text = await evaluate(context, 'document.body.innerText')
  assert.ok(text.includes('信息库') && text.includes('PostgREST 地址'), text)
  const status = await evaluate(context, 'browser.runtime.sendMessage({type: "collection-status"})')
  assert.equal(status.ok, true, JSON.stringify(status))
  console.log('PASS independent settings and background messages')
  const passwordToggle = await evaluate(
    context,
    `(async () => {
      const name = [...document.querySelectorAll('label')].find(node => node.textContent.includes('信息库名称'))
      const uniqueName = document.querySelectorAll('[id="' + name.htmlFor + '"]').length === 1
      const input = document.querySelector('input[type="password"]')
      input.value = 'synthetic-password-visibility-check-only'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      document.querySelector('button[aria-label="显示密码"]').click()
      await new Promise(resolve => setTimeout(resolve, 0))
      const shown = input.type === 'text' && input.value === 'synthetic-password-visibility-check-only'
      document.querySelector('button[aria-label="隐藏密码"]').click()
      await new Promise(resolve => setTimeout(resolve, 0))
      return uniqueName && shown && input.type === 'password' && input.value === 'synthetic-password-visibility-check-only'
        && !document.querySelector('[role="alert"], [role="status"]')
    })()`
  )
  assert.equal(passwordToggle, true)
  console.log('PASS password visibility without duplicate fields or form submission')
  if (config) {
    async function message(value) {
      const result = await evaluate(
        context,
        `browser.runtime.sendMessage(${JSON.stringify(value)})`
      )
      assert.equal(result.ok, true, result.error)
      return result.value
    }
    async function until(check, label) {
      const deadline = Date.now() + 25_000
      while (Date.now() < deadline) {
        const result = await check()
        if (result) return result
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
      throw new Error(`${label} timed out`)
    }
    const switches = await until(
      () =>
        evaluate(
          context,
          `(() => {
        const switches = [...document.querySelectorAll('[role="switch"]')]
        return switches.length === 2 && switches.map(node => ({
          width: node.getBoundingClientRect().width,
          height: node.getBoundingClientRect().height,
          label: node.getAttribute('aria-label'),
          text: node.querySelector('[aria-hidden="false"]')?.textContent.trim(),
        }))
      })()`
        ),
      'settings switches'
    )
    assert.ok(switches.every((item) => item.width <= 64 && item.height <= 24 && item.label))
    assert.deepEqual(
      switches.map((item) => item.text),
      ['OFF', 'ON']
    )
    assert.equal(
      await evaluate(
        context,
        'browser.runtime.sendMessage({type: "collection-legacy-tools"}).then(value => value ?? null, () => null)'
      ),
      null
    )
    console.log('PASS compact named switches and retired legacy entry')
    let article = 'Firefox 首次加载的正文。'
    let authorization = 0
    const pdf = '%PDF-1.4\nFirefox original bytes\n%%EOF'
    sourceServer = createServer((request, response) => {
      if (request.headers.authorization) authorization++
      if (request.url === '/document.pdf') {
        response.writeHead(200, { 'Content-Type': 'application/pdf' }).end(pdf)
        return
      }
      if (request.url === '/redirect') {
        response.writeHead(302, { Location: '/article' }).end()
        return
      }
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(
        request.url === '/login'
          ? '<title>登录</title><input type="password"><p>请登录</p>'
          : `<title>Firefox 资料</title><form hidden><input type="password"></form><article><h1>原文</h1><p>${article}</p><p>${'可重新解释的来源正文。'.repeat(80)}</p></article>`
      )
    })
    sourceServer.listen(0, '127.0.0.1')
    await once(sourceServer, 'listening')
    const origin = `http://127.0.0.1:${sourceServer.address().port}`
    const target = await message({
      type: 'collection-connect',
      connection: {
        name: 'Firefox 隔离验收',
        url: config.endpoint,
        secret: config.secret,
        storageId: -4,
      },
    })
    const originalConnection = (await message({ type: 'collection-status' })).connections[0]
    await until(
      () =>
        evaluate(
          context,
          `(() => {
      const button = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === '修改连接')
      if (!button) return false
      button.click(); return true
    })()`
        ),
      'connection editor'
    )
    await until(
      () =>
        evaluate(
          context,
          `(() => {
      const input = document.querySelector('input[type="password"]')
      return input?.value === ${JSON.stringify(config.secret)}
    })()`
        ),
      'existing password filled and masked'
    )
    await evaluate(
      context,
      `(() => {
      const label = [...document.querySelectorAll('label')].find(node => node.textContent.includes('信息库名称'))
      const input = document.getElementById(label.htmlFor)
      input.value = 'Firefox 修改名称'; input.dispatchEvent(new Event('input', { bubbles: true }))
      document.querySelector('input[type="password"]').form.requestSubmit()
      return true
    })()`
    )
    const edited = await until(async () => {
      const target = (await message({ type: 'collection-status' })).connections[0]
      return target.name === 'Firefox 修改名称' && target
    }, 'rename without reentering password')
    assert.equal(edited.id, originalConnection.id)
    assert.equal(edited.peerId, originalConnection.peerId)
    const settings = (await message({ type: 'collection-status' })).config
    await message({
      type: 'collection-settings',
      settings: { ...settings, excluded: ['https://private.example'] },
    })
    await command('browsingContext.reload', { context, wait: 'complete' })
    await until(
      () =>
        evaluate(
          context,
          `(() => {
      const summary = [...document.querySelectorAll('summary')].find(node => node.textContent === '排除页面或站点')
      if (!summary) return false
      summary.click(); return true
    })()`
        ),
      'exclusion editor'
    )
    await until(
      () =>
        evaluate(
          context,
          `document.querySelector('textarea')?.value === 'https://private.example'`
        ),
      'existing exclusions'
    )
    console.log('PASS existing configuration edit, masked password, stable Peer and exclusions')
    await message({ type: 'collection-enable-origin', origin })
    const source = (await command('browsingContext.create', { type: 'tab' })).context
    await command('browsingContext.navigate', {
      context: source,
      url: origin + '/article',
      wait: 'complete',
    })
    const current = await until(
      async () =>
        (await message({ type: 'collection-status' })).items.find(
          (item) => item.automatic && item.state === 'confirmed'
        ),
      'automatic collection'
    )
    const tabId = await evaluate(
      context,
      `(async () => (await browser.tabs.query({})).find(tab => tab.url === ${JSON.stringify(origin + '/article')}).id)()`
    )
    const fixedId = await message({
      type: 'collection-save',
      kind: 'page',
      tabId,
      expectedURL: origin + '/article',
      note: 'Firefox 手动附注',
    })
    const fixed = await until(
      async () =>
        (await message({ type: 'collection-status' })).items.find(
          (item) => item.id === fixedId && item.state === 'confirmed'
        ),
      'manual save'
    )
    article = 'Firefox 重访后的正文。'
    await command('browsingContext.reload', { context: source, wait: 'complete' })
    const textOf = (read) =>
      Buffer.from(read.parts.find((part) => part.role === 'text').base64, 'base64').toString()
    await until(
      async () =>
        textOf(
          await message({
            type: 'collection-read',
            connectionId: target,
            blockId: current.receipt.root_id,
          })
        ).includes(article),
      'current update after navigation'
    )
    const original = await message({
      type: 'collection-read',
      connectionId: target,
      blockId: fixed.receipt.root_id,
    })
    assert.ok(textOf(original).includes('Firefox 首次加载的正文。'))
    assert.equal(original.notes[0].text, 'Firefox 手动附注')
    await evaluate(
      source,
      '(() => { history.pushState({}, "", "/next"); document.querySelector("article p").textContent = "Firefox SPA 正文。"; return true })()'
    )
    const probe = await evaluate(
      context,
      `browser.scripting.executeScript({target:{tabId:${tabId}}, func: async () => ({url: location.href, response: await browser.runtime.sendMessage({type:"collection-auto-allowed"})})})`
    )
    assert.equal(probe[0].result.response.ok, true, JSON.stringify(probe))
    await until(
      async () =>
        (await message({ type: 'collection-status' })).items.find(
          (item) => item.automatic && item.url === origin + '/next' && item.state === 'confirmed'
        ),
      'SPA route'
    )
    console.log('PASS automatic current, reload, SPA and stable manual save')

    const folder = await evaluate(
      context,
      `(async () => { const folder = await browser.bookmarks.create({ title: 'InKCre synthetic import' }); for (const path of ['/redirect', '/document.pdf', '/login']) await browser.bookmarks.create({parentId: folder.id, title: path, url: ${JSON.stringify(origin)} + path}); return folder.id })()`
    )
    async function runImport(kind) {
      const preview = await message({
        type: 'collection-preview-import',
        options: {
          kind,
          folder: kind === 'bookmarks' ? folder : '',
          since: Date.now() - 60_000,
          until: Date.now() + 1_000,
          site: '127.0.0.1',
          minVisits: 0,
          fetchContent: true,
        },
      })
      await message({ type: 'collection-control-import', id: preview.id, action: 'start' })
      return until(async () => {
        const run = (await message({ type: 'collection-status' })).imports.find(
          (item) => item.id === preview.id
        )
        return run?.state === 'completed' && run
      }, kind + ' import')
    }
    const bookmarks = await runImport('bookmarks')
    assert.equal(bookmarks.counts.records, 3)
    assert.equal(bookmarks.counts.content, 2)
    assert.equal(bookmarks.failuresCount, 1)
    const pdfItem = (await message({ type: 'collection-status' })).items.find(
      (item) =>
        item.importId === bookmarks.id &&
        item.url === origin + '/document.pdf' &&
        item.receipt?.mode === 'fixed'
    )
    const savedPDF = await message({
      type: 'collection-read',
      connectionId: target,
      blockId: pdfItem.receipt.root_id,
    })
    assert.equal(Buffer.from(savedPDF.parts[0].base64, 'base64').toString(), pdf)
    await evaluate(
      context,
      `(async () => { await browser.history.deleteAll(); await browser.history.addUrl({url: ${JSON.stringify(origin + '/history')}}); return true })()`
    )
    assert.equal((await runImport('history')).counts.content, 1)
    assert.equal(authorization, 0)
    console.log('PASS native bookmarks/history, HTML parser, partial failure and PDF bytes')
    const publicURL =
      'https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Match_patterns'
    await message({ type: 'collection-enable-origin', origin: new URL(publicURL).origin })
    await command('browsingContext.navigate', { context: source, url: publicURL, wait: 'complete' })
    const actualURL = await evaluate(source, 'location.href')
    const publicTab = await evaluate(
      context,
      `(async () => (await browser.tabs.query({})).find(tab => tab.url === ${JSON.stringify(actualURL)}).id)()`
    )
    const publicSave = await message({
      type: 'collection-save',
      kind: 'page',
      tabId: publicTab,
      expectedURL: actualURL,
      note: '',
    })
    const publicItem = await until(
      async () =>
        (await message({ type: 'collection-status' })).items.find(
          (item) => item.id === publicSave && item.state === 'confirmed'
        ),
      'public MDN save'
    )
    const publicRead = await message({
      type: 'collection-read',
      connectionId: target,
      blockId: publicItem.receipt.root_id,
    })
    assert.ok(textOf(publicRead).includes('Match patterns'))
    assert.ok(textOf(publicRead).includes('Firefox'))
    console.log('PASS representative public MDN page capture and readback')
  }
  await command('webExtension.uninstall', { extension: addon.extension })
  await command('browser.close')
} finally {
  sourceServer?.closeAllConnections()
  sourceServer?.close()
  socket?.close()
  if (firefox.exitCode === null && firefox.signalCode === null) {
    const exited = once(firefox, 'exit')
    firefox.kill('SIGTERM')
    await exited
  }
  await rm(profile, { recursive: true, force: true })
  console.log('Removed isolated Firefox profile')
}
