import { expect, test } from '@playwright/test'
import { connectNativeHost, databaseToken } from './native-extension-fixture'

type BlockRow = { id: number; content: string }
type RelationRow = { to_: number; content: string }

// Run on an operator-prepared, disposable deployment containing the Python Mail corpus.
// Download consumes an unmaterialized part. A run needs a fresh copy of that part.
test('the deployed Python Mail Peer materializes the attachment requested by the Web Host', async ({
  page,
  request,
}) => {
  const postgrestUrl = process.env.INKCRE_E2E_POSTGREST_URL
  const jwtSecret = process.env.INKCRE_E2E_JWT_SECRET
  const coreUrl = process.env.INKCRE_E2E_CORE_URL
  if (!postgrestUrl || !jwtSecret || !coreUrl || !process.env.INKCRE_E2E_WEB_URL) {
    throw new Error(
      'Mail provider acceptance requires Web, PostgREST and Core URLs and the disposable database JWT secret'
    )
  }
  const databaseBase = postgrestUrl.replace(/\/?$/, '/')
  const token = await databaseToken(jwtSecret)
  async function rows<Row>(path: string): Promise<Row[]> {
    const response = await request.get(new URL(path, databaseBase).href, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(response.ok(), `PostgREST returned ${response.status()} for ${path}`).toBe(true)
    return response.json()
  }

  async function unmaterializedInlinePart() {
    const messageId = 'deep-module-reply@inkcre.acceptance'
    const emails = await rows<BlockRow>(
      `blocks?select=id,content&resolver=eq.extensions.mail.email.v1&content=like.*${messageId}*&order=id.desc`
    )
    for (const email of emails) {
      if (JSON.parse(email.content).message_id !== messageId) continue
      const components = await rows<RelationRow>(
        `relations?select=to_,content&from_=eq.${email.id}&content=like.*inline*`
      )
      for (const component of components) {
        if (JSON.parse(component.content).role !== 'inline') continue
        const parts = await rows<BlockRow>(
          `blocks?select=id,content&id=eq.${component.to_}&resolver=eq.extensions.mail.mime_part.v1`
        )
        const mime = parts[0] && JSON.parse(parts[0].content)
        if (mime?.filename !== 'architecture-map.png' || mime.media_type !== 'image/png') continue
        const saved = await rows(`relations?select=id&from_=eq.${component.to_}&content=eq.content`)
        if (!saved.length) return { email: email.id, part: component.to_ }
      }
    }
    throw new Error('The Python Mail acceptance corpus needs an unmaterialized inline attachment')
  }

  const graph = await unmaterializedInlinePart()
  await connectNativeHost(page, {
    postgrestUrl,
    jwtSecret,
    browserPeer: process.env.INKCRE_E2E_MAIL_PEER_ID ?? '00000000-0000-4000-8000-000000000001',
  })
  await page.goto(`/info-base/graph/blocks/${graph.email}/content`)
  const popup = page.getByRole('dialog', { name: 'Content' })
  await popup.locator('summary', { hasText: 'Inline content' }).click()
  const attachment = popup.locator('.content-email__part', { hasText: 'architecture-map.png' })
  const endpoint = new URL('mail/mime-parts/materialize', coreUrl.replace(/\/?$/, '/')).href
  const [response] = await Promise.all([
    page.waitForResponse((res) => res.url() === endpoint && res.request().method() === 'POST'),
    attachment.getByRole('button', { name: 'Download', exact: true }).click(),
  ])
  expect(response.request().postDataJSON()).toEqual({ block: graph.part })
  expect(response.status()).toBe(200)
  const child = await response.json()
  expect(child.resolver).toBe('core.image.v1')
  expect(await rows(`relations?select=to_&from_=eq.${graph.part}&content=eq.content`)).toEqual([
    { to_: child.id },
  ])
  await expect(attachment.getByRole('link', { name: 'Open', exact: true })).toBeVisible()
  const body = popup.frameLocator('iframe[title="Email HTML body"]')
  await expect(body.getByAltText('Architecture map')).toHaveJSProperty('naturalWidth', 1)
})
