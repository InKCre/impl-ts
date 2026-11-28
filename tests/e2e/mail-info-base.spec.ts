import { expect, test } from '@playwright/test'
import { jwtVerify } from 'jose'
import { connectNativeHost, databaseToken, serveBuiltExtension } from './native-extension-fixture'

type BlockRow = { id: number; resolver: string; content: string; storage: number | null }
type RelationRow = { id: number; from_: number; to_: number; content: string }

// The real Host and built Mail MF use a disposable database. Registry delivery and the
// external materialization Peer are fixtures; no mailbox or Python Mail producer is exercised.
test('Mail navigation, cold restore and explicit MIME materialization survive reopening', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const postgrestUrl = process.env.INKCRE_E2E_POSTGREST_URL!
  const jwtSecret = process.env.INKCRE_E2E_JWT_SECRET!
  const browserPeer = crypto.randomUUID()
  const materializationPeer = crypto.randomUUID()
  const materializeUrl = 'https://mail-peer.example.invalid/materialize'
  const extension = await serveBuiltExtension(page, 'mail')
  const authorization = await databaseToken(jwtSecret)
  const headers = { Authorization: `Bearer ${authorization}`, 'Content-Type': 'application/json' }
  async function database(path: string, options: RequestInit = {}): Promise<Response> {
    const requestHeaders = new Headers(headers)
    new Headers(options.headers).forEach((value, name) => requestHeaders.set(name, value))
    const response = await fetch(new URL(path, postgrestUrl), {
      ...options,
      headers: requestHeaders,
      signal: AbortSignal.timeout(15_000),
    })
    expect(response.ok, await response.clone().text()).toBe(true)
    return response
  }
  async function insert<Row>(table: string, value: unknown): Promise<Row> {
    const response = await database(table, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(value),
    })
    expect(response.status).toBe(201)
    const [row] = await response.json()
    return row as Row
  }
  const blocks: number[] = []
  const relations: number[] = []
  const blobs: string[] = []
  let storage: number | undefined
  async function block(resolver: string, content: string, storage: number | null = null) {
    const row = await insert<BlockRow>('blocks', { resolver, content, storage })
    blocks.push(row.id)
    return row
  }
  async function relate(from_: number, to_: number, content: string) {
    const row = await insert<RelationRow>('relations', { from_, to_, content })
    relations.push(row.id)
  }
  const cors = { 'Access-Control-Allow-Origin': '*' }
  const trackerRequests: string[] = []
  await page.route('https://tracker.invalid/**', async (route) => {
    trackerRequests.push(route.request().url())
    await route.abort()
  })
  await connectNativeHost(page, { postgrestUrl, jwtSecret, browserPeer })
  let materializations = 0
  let releaseFirstAttempt!: () => void
  const firstAttempt = new Promise<void>((resolve) => {
    releaseFirstAttempt = resolve
  })

  let materialized: BlockRow | undefined
  const imageBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
  try {
    const parent = await block(
      'extensions.mail.email.v1',
      JSON.stringify({ message_id: 'parent@example.invalid', subject: 'The original design note' })
    )
    const email = await block(
      'extensions.mail.email.v1',
      JSON.stringify({
        message_id: 'reply@example.invalid',
        subject: 'Re: A deep module is measured by the promise it hides',
        authored_at: '2026-10-20T00:00:00Z',
      })
    )
    const body = await block(
      'core.html.v1',
      `<h1>Deep modules preserve a small promise</h1>
       <script>parent.__mailAcceptanceScriptExecuted = true</script>
       <img src="https://tracker.invalid/open" alt="remote tracker" onerror="parent.__mailAcceptanceScriptExecuted = true">
       <img src="data:image/png;base64,${imageBase64}" alt="untrusted inline image">
       <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" aria-label="Untrusted SVG references">
         <image href="data:image/png;base64,${imageBase64}"></image>
         <image xlink:href="data:image/png;base64,${imageBase64}"></image>
         <filter id="untrusted-filter">
           <feImage href="data:image/png;base64,${imageBase64}"></feImage>
           <feImage xlink:href="data:image/png;base64,${imageBase64}"></feImage>
         </filter>
         <use href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E"></use>
         <rect width="1" height="1"></rect>
       </svg>
       <img src="cid:architecture" alt="Architecture map">
       <a href="https://example.invalid/information-hiding">Read about information hiding</a>`
    )
    const mimePart = await block(
      'extensions.mail.mime_part.v1',
      JSON.stringify({
        media_type: 'image/png',
        filename: 'architecture-map.png',
        content_id: 'architecture',
      })
    )
    await relate(email.id, parent.id, 'parent:0')
    await relate(email.id, body.id, JSON.stringify({ role: 'body', part_id: '1' }))
    await relate(email.id, mimePart.id, JSON.stringify({ role: 'inline', part_id: '2' }))
    await relate(
      body.id,
      mimePart.id,
      JSON.stringify({ type: 'embeds', reference: 'cid:architecture' })
    )
    storage = (await insert<{ id: number }>('storages', { type: 'postgresql_binary', config: {} }))
      .id
    await insert('peers', {
      id: materializationPeer,
      name: 'Mail materialization fixture',
      labels: ['e2e'],
      config: {},
      config_schema: {},
      lease_expires_at: new Date(Date.now() + 180_000).toISOString(),
      capabilities: [
        {
          id: 'extensions.mail.mime_part.materialize.v1',
          inbound: {
            protocol: 'core.peer.protocol.http.v1',
            parameters: { method: 'POST', url: materializeUrl },
          },
        },
      ],
    })
    await page.route(materializeUrl, async (route) => {
      materializations++
      const request = route.request()
      expect(request.method()).toBe('POST')
      expect(request.postDataJSON()).toEqual({ block: mimePart.id })
      const credential = (await request.allHeaders()).authorization?.replace(/^Bearer /, '')
      const signed = await jwtVerify(credential!, new TextEncoder().encode(jwtSecret), {
        issuer: 'inkcre-peer',
        audience: 'inkcre-api',
        algorithms: ['HS256'],
      })
      expect(signed.payload.role).toBe('authenticated')
      if (materializations === 1) {
        await firstAttempt
        await route.fulfill({ status: 503, headers: cors, json: { detail: 'Offline mailbox' } })
        return
      }
      expect(materializations, 'Only the explicit retry may materialize the MIME content').toBe(2)
      const bytes = Buffer.from(imageBase64, 'base64')
      const response = await database('rpc/create_storage_blob', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: bytes,
      })
      const blobId: string = await response.json()
      blobs.push(blobId)
      materialized = await block('core.image.v1', JSON.stringify({ blob_id: blobId }), storage)
      await relate(mimePart.id, materialized.id, 'content')
      await route.fulfill({ headers: cors, json: materialized })
    })

    await extension.install()
    await page.goto(`/info-base/graph?focal_block=${email.id}`)
    await page.getByRole('button', { name: `Inspect entry #${email.id}`, exact: true }).click()
    await expect(page).toHaveURL((url) => url.pathname === `/info-base/graph/blocks/${email.id}`)
    const inspector = page.locator('.block-inspector-popup')
    await expect(inspector).toContainText(`#${email.id}`)
    await inspector.getByRole('button', { name: 'View content', exact: true }).click()
    const content = page.locator('.solved-content-popup')
    const subject = 'Re: A deep module is measured by the promise it hides'
    await expect(content.getByRole('heading', { name: subject, exact: true })).toBeVisible()
    await content.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page).toHaveURL((url) => url.pathname === `/info-base/graph/blocks/${email.id}`)
    await expect(inspector).toContainText(`#${email.id}`)
    await inspector.getByRole('button', { name: 'View content', exact: true }).click()
    await expect(page).toHaveURL(
      (url) => url.pathname === `/info-base/graph/blocks/${email.id}/content`
    )
    await expect(content.getByRole('heading', { name: subject, exact: true })).toBeVisible()

    extension.hold()
    await page.goto(`/info-base/graph/blocks/${email.id}/content`, {
      waitUntil: 'domcontentloaded',
    })
    await expect.poll(extension.waiting).toBe(true)
    await expect(content).toContainText('Unknown resolver ID: extensions.mail.email.v1')
    extension.release()
    await expect(content.getByRole('heading', { name: subject, exact: true })).toBeVisible()
    const html = page.frameLocator('iframe[title="Email HTML body"]')
    await expect(
      html.getByRole('heading', { name: 'Deep modules preserve a small promise' })
    ).toBeVisible()
    await expect(html.locator('script, [onerror]')).toHaveCount(0)
    await expect(html.getByAltText('remote tracker')).not.toHaveAttribute('src')
    await expect(html.getByAltText('Architecture map')).not.toHaveAttribute('src')
    await expect(html.getByRole('link', { name: 'Read about information hiding' })).toHaveAttribute(
      'target',
      '_blank'
    )
    expect(await page.evaluate(() => '__mailAcceptanceScriptExecuted' in window)).toBe(false)
    expect(trackerRequests).toEqual([])
    expect(materializations).toBe(0)
    expect(
      await (await database(`relations?from_=eq.${mimePart.id}&content=eq.content`)).json()
    ).toEqual([])

    await content.locator('summary', { hasText: 'Inline content' }).click()
    const inlinePart = content.locator('.content-email__part', { hasText: 'architecture-map.png' })
    const download = inlinePart.getByRole('button', { name: 'Download', exact: true })
    await download.click()
    await expect(download).toBeDisabled()
    releaseFirstAttempt()
    await expect(inlinePart).toContainText('Mail materialization Peer returned HTTP 503')
    await expect(download).toBeEnabled()
    await download.click()
    await expect(inlinePart.getByRole('link', { name: 'Open', exact: true })).toBeVisible()
    await expect(inlinePart.getByRole('link', { name: 'Open', exact: true })).toHaveAttribute(
      'href',
      /^blob:/
    )
    await expect(html.getByAltText('Architecture map')).toHaveJSProperty('naturalWidth', 1)
    await expect(html.getByAltText('untrusted inline image')).not.toHaveAttribute('src')
    const svg = html.locator('svg[aria-label="Untrusted SVG references"]')
    await expect(svg.locator('image, feImage, use')).toHaveCount(0)
    await expect(svg.locator('rect')).toHaveCount(1)
    await expect(page.locator('iframe[title="Email HTML body"]')).toHaveAttribute(
      'sandbox',
      'allow-popups allow-popups-to-escape-sandbox'
    )
    expect(
      await html.locator('body').evaluate(() => {
        try {
          void window.parent.document
          return null
        } catch (error) {
          return error instanceof DOMException ? error.name : String(error)
        }
      })
    ).toBe('SecurityError')
    expect(materializations).toBe(2)
    const saved = await (
      await database(`relations?from_=eq.${mimePart.id}&content=eq.content`)
    ).json()
    expect(saved).toEqual([
      expect.objectContaining({ from_: mimePart.id, to_: materialized!.id, content: 'content' }),
    ])

    // The saved MIME child lies beyond the email's graph neighborhood. A new document must
    // reload its complete relations and bytes, rather than reuse only the visible graph edges.
    await page.reload()
    await expect(content.getByRole('heading', { name: subject, exact: true })).toBeVisible()
    await expect(html.getByAltText('Architecture map')).toHaveJSProperty('naturalWidth', 1)
    expect(materializations).toBe(2)
    expect(trackerRequests).toEqual([])
    await content.locator('summary', { hasText: 'Related messages' }).click()
    await content.getByRole('button', { name: 'The original design note', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/info-base/graph/blocks/${parent.id}$`))
    await expect(inspector).toContainText(`#${parent.id}`)
    await inspector.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/info-base/graph/blocks/${email.id}/content$`))
    await expect(content.getByRole('heading', { name: subject, exact: true })).toBeVisible()
    await page.goto('/info-base/graph/blocks/2147483647')
    await expect(page.getByText('Entry #2147483647 no longer exists.')).toBeVisible()
  } finally {
    releaseFirstAttempt()
    extension.release()
    if (!page.isClosed()) await page.goto('about:blank').catch(() => {})
    for (const id of relations) await database(`relations?id=eq.${id}`, { method: 'DELETE' })
    for (const id of blocks) await database(`blocks?id=eq.${id}`, { method: 'DELETE' })
    for (const id of blobs) await database(`storage_blobs?id=eq.${id}`, { method: 'DELETE' })
    if (storage !== undefined) await database(`storages?id=eq.${storage}`, { method: 'DELETE' })
    await database(`extension_peer_participations?name=eq.inkcre/mail&peer_id=eq.${browserPeer}`, {
      method: 'DELETE',
    })
    await database(`peers?id=in.(${browserPeer},${materializationPeer})`, { method: 'DELETE' })
  }
})
