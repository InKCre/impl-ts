import { readFile } from 'node:fs/promises'
import { expect, type Page } from '@playwright/test'
import { SignJWT } from 'jose'

export function databaseToken(secret: string): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setIssuer('inkcre-peer')
    .setAudience('inkcre-api')
    .sign(new TextEncoder().encode(secret))
}

export async function connectNativeHost(
  page: Page,
  connection: { postgrestUrl: string; jwtSecret: string; browserPeer: string }
): Promise<void> {
  await page.addInitScript(
    ({ origin, postgrestUrl, jwtSecret, browserPeer }) => {
      if (window !== window.top || location.origin !== origin) return
      const previous = JSON.parse(localStorage.getItem('inkcre_app_config') ?? '{}')
      if (previous.INKCRE_PEER_ID === browserPeer) return
      localStorage.setItem(
        'inkcre_app_config',
        JSON.stringify({
          INKCRE_PGREST_URL: postgrestUrl,
          INKCRE_JWT_SECRET: jwtSecret,
          INKCRE_PEER_ID: browserPeer,
        })
      )
    },
    { ...connection, origin: new URL(process.env.INKCRE_E2E_WEB_URL!).origin }
  )
}

export async function setupNativeDatabase(page: Page) {
  const postgrestUrl = process.env.INKCRE_E2E_POSTGREST_URL!
  const jwtSecret = process.env.INKCRE_E2E_JWT_SECRET!
  const browserPeer = crypto.randomUUID()
  await connectNativeHost(page, { postgrestUrl, jwtSecret, browserPeer })
  const headers = {
    Authorization: `Bearer ${await databaseToken(jwtSecret)}`,
    Prefer: 'return=representation',
  }
  async function database<Row = unknown>(path: string, method = 'GET', data?: object) {
    const response = await page.request.fetch(new URL(path, postgrestUrl).href, {
      method,
      data,
      headers,
    })
    expect(response.ok(), await response.text()).toBe(true)
    return (await response.json()) as Row[]
  }
  return { browserPeer, database }
}

/** Mirrors registry delivery while exercising the real built manifest, assets and Host. */
export async function serveBuiltExtension(page: Page, directory: string) {
  const root = new URL(`../../extensions/${directory}/`, import.meta.url)
  const producer = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const { name, nickname } = producer.inkcre
  const version: string = producer.version
  const assetBase = `https://registry.inkcre.dev/extensions/${name}/${version}/module-federation/`
  const release = {
    name,
    nickname,
    version,
    distribution: 'module_federation',
    state: 'published',
    python: null,
    module_federation: {
      ...producer.inkcre.module_federation,
      manifest_url: `${assetBase}mf-manifest.json`,
    },
  }
  const headers = { 'Access-Control-Allow-Origin': '*' }
  await page.route(`**/v2/extensions/${name}/distributions/module_federation**`, (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/documentation'))
      return route.fulfill({ headers, status: 404 })
    return route.fulfill({
      headers,
      json: route.request().url().includes('/releases/')
        ? release
        : { name, nickname, releases: [release] },
    })
  })
  let gate: Promise<void> | undefined
  let releaseEntry = () => {}
  let waiting = false
  await page.route(`${assetBase}**`, async (route) => {
    const filename = new URL(route.request().url()).pathname.split('/module-federation/')[1]!
    if (gate && filename === 'remoteEntry.js') {
      waiting = true
      await gate
    }
    let body = await readFile(new URL(`dist/web/${filename}`, root))
    if (filename === 'mf-manifest.json') {
      const manifest = JSON.parse(body.toString())
      manifest.metaData.publicPath = 'auto'
      body = Buffer.from(JSON.stringify(manifest))
    }
    const contentType = filename.endsWith('.js')
      ? 'application/javascript'
      : filename.endsWith('.css')
        ? 'text/css'
        : 'application/json'
    await route.fulfill({ headers, contentType, body })
  })
  return {
    async install() {
      await page.goto(
        `/extensions?install=${encodeURIComponent(name)}&distribution=module_federation&version=${version}`
      )
      await expect(page.getByRole('heading', { name: nickname, exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Install', exact: true }).click()
      await expect(page).toHaveURL(/\/extensions$/)
      const row = page
        .getByRole('article', { name: nickname, exact: true })
        .locator('.extension-card__peer-row')
        .filter({ hasText: 'This browser' })
      await row.getByRole('button', { name: 'Enable', exact: true }).click()
      await expect(row.getByText(`Running ${version}`, { exact: true })).toBeVisible()
      return { row, version }
    },
    hold() {
      gate = new Promise<void>((resolve) => {
        releaseEntry = resolve
      })
    },
    waiting: () => waiting,
    release() {
      releaseEntry()
      gate = undefined
    },
  }
}
