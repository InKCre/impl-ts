import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { get } from 'node:https'
import { fileURLToPath } from 'node:url'

const target = process.argv[2]
const instance = process.argv[3]
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const portlessBin = `${repoRoot}/node_modules/.bin/portless`
const names = {
  // Keep the browser origin stable so existing local settings remain readable.
  web: 'client-web',
  'web-ui': 'client-web-ui',
  webext: 'webext',
}
if (!names[target] || !instance || !/^[a-f0-9]{16}$/.test(instance)) {
  process.exit(2)
}

let expectedUiSource = null
try {
  if (target === 'web-ui' && process.env.INKCRE_UI_SOURCE_ROOT) {
    expectedUiSource = createHash('sha256')
      .update(realpathSync(process.env.INKCRE_UI_SOURCE_ROOT))
      .digest('hex')
      .slice(0, 16)
  }
} catch {
  process.exit(1)
}

const routeName = `${names[target]}-${instance}`
let origin
try {
  const routes = execFileSync(portlessBin, ['list'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 3_000,
  })
  const route = routes
    .split('\n')
    .map((line) => line.match(/(https:\/\/([a-z0-9-]+)\.localhost(?::[0-9]+)?)/))
    .find((match) => match?.[2] === routeName)
  origin = route?.[1]
} catch {
  // Portless is not running yet.
}

if (!origin) process.exit(1)

const url = `${origin}/__inkcre/dev/${instance}`
const endpoint = new URL(url)

const observation = await new Promise((resolve) => {
  const request = get(
    {
      hostname: '127.0.0.1',
      port: endpoint.port || 443,
      path: endpoint.pathname,
      servername: endpoint.hostname,
      headers: {
        host: endpoint.host,
      },
      rejectUnauthorized: false,
      timeout: 3_000,
    },
    (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        if (body.length <= 4_096) body += chunk
      })
      response.on('end', () => {
        if (response.statusCode !== 200 || body.length > 4_096) {
          resolve(false)
          return
        }

        try {
          const identity = JSON.parse(body)
          const matchesTarget = identity.instance === instance && identity.target === target
          const matchesUiSource = !expectedUiSource || identity.uiSource === expectedUiSource
          resolve(matchesTarget && matchesUiSource)
        } catch {
          resolve(false)
        }
      })
    }
  )

  request.once('error', () => resolve(false))
  request.once('timeout', () => {
    request.destroy()
    resolve(false)
  })
})

process.exitCode = observation ? 0 : 1
