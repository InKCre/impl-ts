import { test, expect } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
import { SignJWT } from 'jose'

const postgrestUrl = process.env.INKCRE_E2E_POSTGREST_URL!
const jwtSecret = process.env.INKCRE_E2E_JWT_SECRET!
const sourceType = `e2e.accessibility.${crypto.randomUUID()}`
const extensions = [
  { name: `e2e/accessibility-${crypto.randomUUID()}`, nickname: 'Accessible extension' },
  { name: `e2e/accessibility-${crypto.randomUUID()}`, nickname: 'Second accessible extension' },
]
let headers: Record<string, string>
let sourceId: number | undefined

test.beforeAll(async () => {
  const token = await new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setIssuer('inkcre-peer')
    .setAudience('inkcre-api')
    .sign(new TextEncoder().encode(jwtSecret))
  headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const type = await fetch(`${postgrestUrl}sources_types`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: sourceType,
      description: 'Accessibility source',
      config_schema: { type: 'object', properties: {} },
      collect_config_schema: { type: 'object', properties: {} },
    }),
  })
  expect(type.status).toBe(201)
  const source = await fetch(`${postgrestUrl}sources`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({ type: sourceType, nickname: 'Accessible source', config: {} }),
  })
  expect(source.status).toBe(201)
  sourceId = (await source.json())[0].id
  const extension = await fetch(`${postgrestUrl}extensions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(extensions.map((extension) => ({ ...extension, config: {}, state: {} }))),
  })
  expect(extension.status).toBe(201)
})

test.afterAll(async () => {
  if (!headers) return
  if (sourceId !== undefined)
    expect(
      (await fetch(`${postgrestUrl}sources?id=eq.${sourceId}`, { method: 'DELETE', headers }))
        .status
    ).toBe(204)
  for (const path of [
    `sources_types?id=eq.${sourceType}`,
    ...extensions.map((extension) => `extensions?name=eq.${encodeURIComponent(extension.name)}`),
  ])
    expect((await fetch(`${postgrestUrl}${path}`, { method: 'DELETE', headers })).status).toBe(204)
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ postgrestUrl, jwtSecret }) => {
      localStorage.setItem(
        'inkcre_app_config',
        JSON.stringify({
          INKCRE_PGREST_URL: postgrestUrl,
          INKCRE_JWT_SECRET: jwtSecret,
          INKCRE_PEER_ID: '00000000-0000-4000-8000-000000000001',
        })
      )
    },
    { postgrestUrl, jwtSecret }
  )
})

for (const route of ['sources', 'extensions', 'settings', 'peers'] as const) {
  test(`${route} is accessible with its connected content loaded`, async ({ page }) => {
    await page.goto(`/${route}`)
    await expect(page.getByRole('main')).toBeVisible()
    if (route === 'sources') {
      await expect(page.getByRole('link', { name: 'Accessible source', exact: true })).toBeVisible()
    } else if (route === 'extensions') {
      // Two cards expose repeated Peer groups without depending on another project's fixtures.
      for (const extension of extensions) {
        const card = page.getByRole('article', { name: extension.nickname, exact: true })
        await expect(card).toBeVisible()
        await expect(
          card.getByRole('group').filter({ hasText: 'This browser' }).getByText('Not installed', {
            exact: true,
          })
        ).toBeVisible()
        await expect(card.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled()
      }
    } else if (route === 'settings') {
      await expect(page.getByLabel('PostgREST URL')).toHaveValue(postgrestUrl)
      await expect(
        page.getByRole('button', { name: 'Save and use connection', exact: true })
      ).toBeEnabled()
    } else {
      await expect(page.locator('.peer-card', { hasText: 'This browser' })).toBeVisible()
    }
    await expect(page.getByRole('status', { name: 'Starting InKCre…' })).toHaveCount(0)
    const scan = await new AxeBuilder({ page }).analyze()
    expect(scan.violations).toEqual([])
  })
}
