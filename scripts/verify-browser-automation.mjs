import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { once } from 'node:events'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { build } = await import(pathToFileURL(require.resolve('vite')).href)
await mkdir(join(root, '.runtime'), { recursive: true })
const temporary = await mkdtemp(join(root, '.runtime/browser-automation-'))
const dist = join(temporary, 'web')
const extension = join(temporary, 'extension')
const nativeCommands = []
const nativeReplies = new Map()
const probeResults = new Map()
const probeWaiters = new Map()
let appOrigin
let otherOrigin
let webReport
let nativeReport
let done
const finished = new Promise((resolve) => {
  done = resolve
})

async function handle(request, response) {
  const url = new URL(request.url, appOrigin ?? 'http://127.0.0.1')
  if (url.pathname.startsWith('/unused-database/'))
    return response
      .writeHead(401, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ code: 'PGRST301', message: 'Local-only browser fixture' }))
  if (url.pathname === '/state') return response.end(JSON.stringify({ complete: !!webReport }))
  if (url.pathname === '/fixture-next')
    return response.end(JSON.stringify(nativeCommands.shift() ?? null))
  if (url.pathname === '/probe-result') {
    const token = url.searchParams.get('token')
    if (probeResults.has(token)) return response.end(JSON.stringify(probeResults.get(token)))
    probeWaiters.set(token, (result) => response.end(JSON.stringify(result)))
    return
  }
  if (url.pathname === '/probe-report') {
    let body = ''
    for await (const chunk of request) body += chunk
    const result = JSON.parse(body)
    probeResults.set(result.token, result)
    probeWaiters.get(result.token)?.(result)
    probeWaiters.delete(result.token)
    return response.end('ok')
  }
  if (url.pathname === '/fixture-command') {
    let body = ''
    for await (const chunk of request) body += chunk
    const id = randomUUID()
    nativeCommands.push({ id, message: JSON.parse(body) })
    nativeReplies.set(id, (reply) => response.end(JSON.stringify(reply)))
    return
  }
  if (url.pathname === '/fixture-reply') {
    let body = ''
    for await (const chunk of request) body += chunk
    const { id, reply } = JSON.parse(body)
    nativeReplies.get(id)?.(reply)
    nativeReplies.delete(id)
    return response.end('ok')
  }
  if (url.pathname === '/report' || url.pathname === '/native-report') {
    let body = ''
    for await (const chunk of request) body += chunk
    if (url.pathname === '/report') webReport = JSON.parse(body)
    else nativeReport = JSON.parse(body)
    response.end('ok')
    if (webReport && nativeReport) done()
    return
  }
  if (url.pathname === '/borrowed')
    return response.end('<title>borrowed</title><p>Borrowed tab</p>')
  if (url.pathname === '/target') {
    response.setHeader('Content-Type', 'text/html')
    return response.end(
      `<p id="account">${request.headers.cookie?.includes('fixture-login=1') ? 'fixture-account' : 'not-logged-in'}</p><ul><li>one</li><li>two</li></ul><button id="more">Load more</button><script>document.querySelector('#more').onclick=async()=>{const data=await fetch('/data?page=2').then(r=>r.json());for(const text of data.entries){const li=document.createElement('li');li.textContent=text;document.querySelector('ul').append(li)}};</script>`
    )
  }
  if (url.pathname === '/data') {
    response.setHeader('Content-Type', 'application/json')
    return response.end(JSON.stringify({ entries: ['three', 'four'] }))
  }
  const path = url.pathname.startsWith('/assets/')
    ? join(dist, url.pathname)
    : join(dist, 'index.html')
  try {
    response.setHeader(
      'Content-Type',
      extname(path) === '.js'
        ? 'application/javascript'
        : extname(path) === '.css'
          ? 'text/css'
          : 'text/html'
    )
    response.setHeader('Set-Cookie', 'fixture-login=1; SameSite=Lax; Path=/')
    response.end(await readFile(path))
  } catch {
    response.writeHead(404).end()
  }
}
const servers = [
  createServer((request, response) => void handle(request, response)),
  createServer((request, response) => void handle(request, response)),
]
for (const server of servers) server.listen(0, '127.0.0.1')
await Promise.all(servers.map((server) => once(server, 'listening')))
appOrigin = `http://127.0.0.1:${servers[0].address().port}`
otherOrigin = `http://127.0.0.1:${servers[1].address().port}`
let browserProcess
let stderr = ''
let timeout
try {
  await build({
    configFile: false,
    root: join(root, 'scripts/tests/browser-automation'),
    resolve: { alias: { '@inkcre/core': join(root, 'packages/core/src/index.ts') } },
    build: {
      outDir: dist,
      emptyOutDir: true,
    },
  })
  await cp(join(root, 'apps/webext/.output/chrome-mv3'), extension, { recursive: true })
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'))
  // This isolated fixture pregrants only its synthetic host. Native permission UX is separate evidence.
  manifest.host_permissions = ['http://127.0.0.1/*']
  manifest.background.service_worker = 'automation-fixture-background.js'
  manifest.background.type = 'module'
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest))
  await writeFile(
    join(extension, 'automation-fixture.html'),
    '<script src="automation-fixture.js"></script>'
  )
  const fixturePage = 'automation-fixture.html?' + new URLSearchParams({ appOrigin, otherOrigin })
  await writeFile(
    join(extension, 'automation-fixture-background.js'),
    `import './background.js'; chrome.runtime.onInstalled.addListener(() => { void chrome.tabs.create({url: chrome.runtime.getURL(${JSON.stringify(fixturePage)})}); });`
  )
  await cp(
    join(root, 'scripts/tests/browser-automation/extension-fixture.js'),
    join(extension, 'automation-fixture.js')
  )
  const executable = globalThis.process.env.INKCRE_CHROMIUM_BINARY || chromium.executablePath()
  browserProcess = spawn(
    executable,
    [
      '--headless=new',
      // Hosted Linux CI disallows Chromium's user-namespace sandbox. This browser
      // uses a disposable profile and serves only this fixture's synthetic pages.
      ...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []),
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      `--user-data-dir=${join(temporary, 'profile')}`,
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--enable-logging=stderr',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  )
  browserProcess.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-4000)
  })
  browserProcess.on('error', (error) => {
    webReport = { ok: false, error: String(error) }
    done()
  })
  browserProcess.on('exit', (code, signal) => {
    if (webReport && nativeReport) return
    webReport = {
      ok: false,
      error: `Browser fixture exited before reporting (code ${code}, signal ${signal})\n${stderr}`,
    }
    done()
  })
  await Promise.race([
    finished,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`Browser fixture timed out\n${stderr}`)), 120_000)
    }),
  ])
  assert.equal(webReport?.ok, true, webReport?.error ?? stderr)
  assert.deepEqual(
    nativeReport?.attached,
    [],
    'An owned debugger attachment survived callback cleanup'
  )
  console.log(JSON.stringify({ browser: executable, ...webReport, nativeReport }, null, 2))
} finally {
  clearTimeout(timeout)
  if (browserProcess && browserProcess.exitCode === null) {
    browserProcess.kill('SIGTERM')
    await Promise.race([
      once(browserProcess, 'exit'),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ])
    if (browserProcess.exitCode === null) browserProcess.kill('SIGKILL')
  }
  for (const server of servers) server.close()
  // Chromium helpers can still flush the disposable profile after the main process exits.
  await rm(temporary, { recursive: true, force: true, maxRetries: 5 })
}
