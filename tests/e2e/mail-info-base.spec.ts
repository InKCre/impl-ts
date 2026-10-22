import { expect, test } from '@playwright/test'
import { SignJWT } from 'jose'

const postgrestUrl = process.env.INKCRE_E2E_POSTGREST_URL!
const jwtSecret = process.env.INKCRE_E2E_JWT_SECRET!
const coreUrl = process.env.INKCRE_E2E_CORE_URL!

type BlockRow = {
  id: number
  resolver: string
  content: string
}

type RelationRow = {
  from_: number
  to_: number
  content: string
}

type AcceptanceGraph = {
  email: number
  mimePart: number
  parent: number
}

async function token(): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setIssuer('inkcre-peer')
    .setAudience('inkcre-api')
    .sign(new TextEncoder().encode(jwtSecret))
}

async function rows<Row>(path: string): Promise<Row[]> {
  const response = await fetch(new URL(path, postgrestUrl), {
    headers: { Authorization: `Bearer ${await token()}` },
  })
  const body = await response.text()
  expect(response.ok, body).toBe(true)
  return JSON.parse(body) as Row[]
}

async function locateAcceptanceGraph(): Promise<AcceptanceGraph> {
  const emails = await rows<BlockRow>(
    'blocks?select=id,resolver,content&resolver=eq.extensions.mail.email.v1&order=id.desc'
  )
  for (const email of emails) {
    const root = JSON.parse(email.content) as { message_id?: string }
    if (root.message_id !== 'deep-module-reply@inkcre.acceptance') continue

    const relations = await rows<RelationRow>(
      `relations?select=from_,to_,content&or=(from_.eq.${email.id},to_.eq.${email.id})`
    )
    const component = relations.find((relation) => {
      if (relation.from_ !== email.id) return false
      try {
        const content = JSON.parse(relation.content) as { role?: string }
        return content.role === 'inline'
      } catch {
        return false
      }
    })
    const parent = relations.find(
      (relation) => relation.from_ === email.id && relation.content.startsWith('parent:')
    )
    if (!component || !parent) continue

    const materialized = await rows<RelationRow>(
      `relations?select=from_,to_,content&from_=eq.${component.to_}&content=eq.content`
    )
    if (materialized.length === 0) {
      return { email: email.id, mimePart: component.to_, parent: parent.to_ }
    }
  }
  throw new Error('The Mail acceptance graph has no unmaterialized inline MIME part')
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ postgrestUrl, jwtSecret }) => {
      try {
        localStorage.setItem(
          'inkcre_app_config',
          JSON.stringify({
            INKCRE_PGREST_URL: postgrestUrl,
            INKCRE_JWT_SECRET: jwtSecret,
            INKCRE_PEER_ID: '00000000-0000-4000-8000-000000000001',
          })
        )
      } catch {
        // Sandboxed email frames intentionally have no localStorage access.
      }
    },
    { postgrestUrl, jwtSecret }
  )
})

test('Mail is used through the generic InfoBase navigation host', async ({ page }) => {
  const graph = await locateAcceptanceGraph()
  const remoteEntry = page.waitForResponse(
    (response) => response.url().includes('/mail/client-web/remoteEntry.js') && response.ok()
  )
  const trackerRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('tracker.invalid')) trackerRequests.push(request.url())
  })

  await page.goto('/info-base/graph')
  await remoteEntry

  const community = page.locator('.community-navigator__dropdown')
  await community.locator('.ink-dropdown').click()
  await community.locator('.ink-dropdown__option', { hasText: 'All Communities' }).click()
  const graphNode = page.locator(`.vue-flow__node[data-id="${graph.email}"] .block-node`)
  await expect(graphNode).toBeVisible()
  await graphNode.click()
  await expect(page).toHaveURL(new RegExp(`/info-base/graph/blocks/${graph.email}$`))
  const inspector = page.locator('.block-inspector-popup')
  await expect(inspector).toContainText(`#${graph.email}`)

  await inspector.getByRole('button', { name: 'View content' }).click()
  await expect(page).toHaveURL(new RegExp(`/info-base/graph/blocks/${graph.email}/content$`))
  await expect(
    page.getByRole('heading', {
      name: 'Re: A deep module is measured by the promise it hides',
    })
  ).toBeVisible()

  // Keep native restore behind the initial content lookup to exercise a cold deep link.
  let releaseNativeModule!: () => void
  const nativeModuleReady = new Promise<void>((resolve) => {
    releaseNativeModule = resolve
  })
  const nativeEntryPattern = '**/remoteEntry.js'
  await page.route(nativeEntryPattern, async (route) => {
    await nativeModuleReady
    await route.continue()
  })
  try {
    await page.goto(`/info-base/graph/blocks/${graph.email}/content`)
    await expect(page.locator('.solved-content-popup')).toContainText(
      'Unknown resolver ID: extensions.mail.email.v1'
    )
    releaseNativeModule()
    await expect(
      page.getByRole('heading', {
        name: 'Re: A deep module is measured by the promise it hides',
      })
    ).toBeVisible()
  } finally {
    releaseNativeModule()
    await page.unroute(nativeEntryPattern)
  }

  const html = page.frameLocator('iframe[title="Email HTML body"]')
  await expect(
    html.getByRole('heading', { name: 'Deep modules preserve a small promise' })
  ).toBeVisible()
  await expect(html.locator('script')).toHaveCount(0)
  await expect(html.getByAltText('remote tracker')).not.toHaveAttribute('src')
  await expect(html.getByAltText('Architecture map')).not.toHaveAttribute('src')
  await expect(html.getByRole('link', { name: 'Read about information hiding' })).toHaveAttribute(
    'target',
    '_blank'
  )
  expect(await page.evaluate(() => '__mailAcceptanceScriptExecuted' in window)).toBe(false)
  expect(trackerRequests).toEqual([])

  const inlinePart = page.locator('.content-email__part', { hasText: 'architecture-map.png' })
  const delegated = page.waitForRequest(
    (request) =>
      request.url() === `${coreUrl}mail/mime-parts/materialize` && request.method() === 'POST'
  )
  await inlinePart.getByRole('button', { name: 'Download' }).click()
  const materializeRequest = await delegated
  expect(materializeRequest.postDataJSON()).toEqual({ block: graph.mimePart })
  await expect(inlinePart.getByRole('link', { name: 'Open' })).toBeVisible()
  await expect(html.getByAltText('Architecture map')).toHaveAttribute('src', /^blob:/)
  expect(trackerRequests).toEqual([])

  await page.locator('.solved-content-popup__header button:has(.i-mdi-close)').click()
  await expect(page).toHaveURL(new RegExp(`/info-base/graph/blocks/${graph.email}$`))
  await expect(page.locator('.block-inspector-popup')).toContainText(`#${graph.email}`)
  await page.locator('.block-inspector-popup').getByRole('button', { name: 'View content' }).click()
  await expect(page).toHaveURL(new RegExp(`/info-base/graph/blocks/${graph.email}/content$`))
  await expect(
    page.getByRole('heading', {
      name: 'Re: A deep module is measured by the promise it hides',
    })
  ).toBeVisible()

  await page.getByRole('button', { name: /View reply target:/ }).click()
  await expect(page).toHaveURL(new RegExp(`/info-base/graph/blocks/${graph.parent}$`))
  await expect(page.locator('.block-inspector-popup')).toContainText(`#${graph.parent}`)

  await page.locator('.block-inspector-popup__header button:has(.i-mdi-close)').click()
  await expect(page).toHaveURL(new RegExp(`/info-base/graph/blocks/${graph.email}/content$`))

  await page.goto('/info-base/graph/blocks/2147483647')
  await expect(page.getByText('Block #2147483647 no longer exists.')).toBeVisible()
})
