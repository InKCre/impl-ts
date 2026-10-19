import { expect, test } from '@playwright/test'
import { SignJWT } from 'jose'

const postgrestUrl = process.env.INKCRE_E2E_POSTGREST_URL!
const jwtSecret = process.env.INKCRE_E2E_JWT_SECRET!
const coreUrl = process.env.INKCRE_E2E_CORE_URL!
function getArchiveBase(): URL {
  return new URL('twitter/x-monkey/', coreUrl.endsWith('/') ? coreUrl : `${coreUrl}/`)
}

type BlockRow = { id: number; resolver: string; content: string }
type RelationRow = { from_: number; to_: number; content: string }
type LexicalJob = { id: number; status: string; state: Record<string, unknown> }

const CORE_LEXICAL_MAINTAIN_JOB = 'core.feature_retrieval.lexical.maintain.v1'

function coreBase(): URL {
  return new URL(coreUrl.endsWith('/') ? coreUrl : `${coreUrl}/`)
}

async function databaseToken(): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setIssuer('inkcre-peer')
    .setAudience('inkcre-api')
    .sign(new TextEncoder().encode(jwtSecret))
}

async function databaseRows<Row>(path: string): Promise<Row[]> {
  const response = await fetch(new URL(path, postgrestUrl), {
    headers: { Authorization: `Bearer ${await databaseToken()}` },
  })
  const body = await response.text()
  expect(response.ok, body).toBe(true)
  return JSON.parse(body) as Row[]
}

async function maintainLexicalIndex(page: import('@playwright/test').Page): Promise<LexicalJob> {
  const authorization = { Authorization: `Bearer ${await databaseToken()}` }
  const created = await page.request.post(new URL('jobs', coreBase()).toString(), {
    headers: authorization,
    data: {
      type: CORE_LEXICAL_MAINTAIN_JOB,
      parameters: { options: { max_records: 1000 } },
    },
  })
  const createdBody = await created.text()
  expect(created.status(), createdBody).toBe(201)
  const initial = JSON.parse(createdBody) as LexicalJob

  const read = async (): Promise<LexicalJob> => {
    const response = await page.request.get(new URL(`jobs/${initial.id}`, coreBase()).toString(), {
      headers: authorization,
    })
    const body = await response.text()
    expect(response.ok(), body).toBe(true)
    return JSON.parse(body) as LexicalJob
  }
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const job = await read()
    if (job.status === 'finished') return job
    if (['failed', 'timed_out', 'aborted'].includes(job.status)) {
      throw new Error(
        `Lexical maintenance Job #${job.id} ${job.status}: ${JSON.stringify(job.state)}`
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`Lexical maintenance Job #${initial.id} did not finish within 120 seconds.`)
}

async function expectPostSearchResult(
  page: import('@playwright/test').Page,
  query: string,
  blockId: number
): Promise<import('@playwright/test').Locator> {
  await page.goto(`/info-base/list?q=${encodeURIComponent(query)}`)
  const result = page
    .locator('.info-base-list-view__matches li')
    .filter({ hasText: `#${blockId} · extensions.twitter.tweet.v2` })
  await expect(result).toBeVisible()
  return result
}

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

test('Core cookie authorization writes native records that the real Twitter MF can read', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const archiveBase = getArchiveBase()
  const webOrigin = new URL(process.env.INKCRE_E2E_WEB_URL!).origin
  const stamp = `${Date.now()}`
  const userId = `${stamp}01`
  const postId = `${stamp}02`
  const quoteId = `${stamp}03`
  const replyId = `${stamp}04`
  const mediaId = `${stamp}05`
  const failedMediaId = `${stamp}07`
  const imageUrl = 'https://pbs.twimg.com/media/inkcre-acceptance-no-fetch.jpg'
  const failedImageUrl = 'https://pbs.twimg.com/media/inkcre-acceptance-controlled-failure.jpg'

  const twitterRemoteEntries: import('@playwright/test').Response[] = []
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (
      url.pathname.includes('/extensions/inkcre/twitter/') &&
      url.pathname.endsWith('/remoteEntry.js')
    )
      twitterRemoteEntries.push(response)
  })
  await page.goto('/peers')
  const currentPeerCard = page.locator('.peer-card').filter({ hasText: 'This browser' })
  await expect(currentPeerCard).toBeVisible({ timeout: 30_000 })
  await currentPeerCard.getByRole('button', { name: 'Edit Config', exact: true }).click()
  const peerConfig = page.getByRole('dialog', { name: 'Edit Config', exact: true })
  const registryOrigin = peerConfig.getByLabel('Extension registry URL')
  if ((await registryOrigin.inputValue()) !== webOrigin) {
    await registryOrigin.fill(webOrigin)
    await peerConfig.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(peerConfig).toBeHidden()
  } else {
    await peerConfig.getByRole('button', { name: 'Cancel', exact: true }).click()
  }
  await page.goto('/extensions')
  const twitter = page.locator('.extension-card[aria-label="Twitter"]')
  await expect(twitter).toBeVisible({ timeout: 30_000 })
  const currentPeer = twitter
    .locator('.extension-card__peer-row')
    .filter({ hasText: 'This browser' })
  const install = currentPeer.getByRole('button', { name: 'Install', exact: true })
  const enable = currentPeer.getByRole('button', { name: 'Enable', exact: true })
  if (await install.count()) {
    await install.click()
    const versionDialog = page.getByRole('dialog', { name: 'Install', exact: true })
    await expect(versionDialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled({
      timeout: 30_000,
    })
    await versionDialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(versionDialog).toBeHidden({ timeout: 30_000 })
    await expect(enable).toBeVisible({ timeout: 30_000 })
  }
  if (await enable.count()) await enable.click()
  await expect(currentPeer.getByText(/Running/)).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => twitterRemoteEntries.length, { timeout: 30_000 }).toBeGreaterThan(0)
  const remoteEntry = twitterRemoteEntries.at(-1)!
  expect(remoteEntry.ok()).toBe(true)
  expect(new URL(remoteEntry.url()).origin).toBe(webOrigin)
  await twitter.getByRole('button', { name: 'Setup' }).click()
  await expect(page.getByRole('button', { name: 'Connect x-monkey' })).toBeVisible()
  await expect(page.getByText(/x-monkey service address:/)).toContainText(
    new URL('twitter/x-monkey', coreBase()).toString()
  )
  const connectRequest = page.waitForRequest(
    (request) => request.url().endsWith('/twitter/x-monkey/session') && request.method() === 'POST'
  )
  await page.getByRole('button', { name: 'Connect x-monkey' }).click()
  const connect = await connectRequest
  expect(new URL(connect.url()).search).toBe('')
  expect([...new URLSearchParams(connect.postData() ?? '').keys()]).toEqual(['token'])
  await page.waitForURL('**/twitter/x-monkey/account')
  await expect(page.getByRole('heading', { name: 'InKCre x-monkey 连接' })).toBeVisible()
  const sessionCookie = (await page.context().cookies(coreUrl)).find(
    (cookie) => cookie.name === 'inkcre_twitter_archive'
  )
  expect(sessionCookie?.httpOnly).toBe(true)
  expect(sessionCookie?.secure).toBe(true)
  expect(sessionCookie?.sameSite).toBe('None')

  const submit = await page.request.post(new URL('api/v1/archive/submit', archiveBase).toString(), {
    headers: { 'x-tweet-db-client': 'x-monkey' },
    data: {
      users: [
        {
          id: userId,
          handle: `acceptance_${stamp}`,
          name: 'Archive Acceptance Author',
          bio: { text: 'Profile bio retained for lookup.' },
        },
      ],
      posts: [
        {
          id: quoteId,
          authorId: userId,
          createdAt: '2026-10-18T10:00:00Z',
          text: { text: 'Quoted native post.' },
        },
        {
          id: replyId,
          authorId: userId,
          createdAt: '2026-10-18T10:01:00Z',
          text: { text: 'Reply target native post.' },
        },
        {
          id: postId,
          authorId: userId,
          createdAt: '2026-10-18T10:02:00Z',
          text: {
            text: 'Rich text survives with its author and context.',
            styles: [{ range: [0, 9], styles: ['Bold'] }],
            entities: [{ type: 'url', range: [39, 47], expanded: 'https://example.com' }],
          },
          replyTo: { postId: replyId, userId, handle: `acceptance_${stamp}` },
          quote: { postId: quoteId, url: `https://x.com/${stamp}/status/${quoteId}` },
          mediaIds: [mediaId, failedMediaId],
          article: {
            id: `${stamp}06`,
            title: 'Long-form archive article title',
            blocks: [{ type: 'unstyled', text: 'Long-form paragraph remains readable.' }],
          },
          counts: { likes: 4 },
        },
      ],
      media: [
        { id: mediaId, type: 'photo', url: imageUrl, alt: 'Acceptance image metadata' },
        {
          id: failedMediaId,
          type: 'photo',
          url: failedImageUrl,
          alt: 'Controlled failure image metadata',
        },
      ],
    },
  })
  const submitBody = await submit.text()
  expect(submit.status(), submitBody).toBe(200)
  const submitted = JSON.parse(submitBody) as {
    summary: { accepted: number; failed: number; total: number }
  }
  expect(submitted.summary).toMatchObject({ accepted: 6, failed: 0, total: 6 })

  const query = await page.request.post(new URL('api/v1/archive/query', archiveBase).toString(), {
    headers: { 'x-tweet-db-client': 'x-monkey' },
    data: { users: [userId], posts: [postId], media: [mediaId, failedMediaId] },
  })
  expect(query.status()).toBe(200)
  const queried = (await query.json()) as {
    posts: Array<{ id: string; status: string; data?: unknown }>
  }
  expect(queried.posts).toEqual([
    {
      id: postId,
      status: 'found',
      data: expect.objectContaining({
        article: expect.any(Object),
        replyTo: expect.any(Object),
        quote: expect.any(Object),
      }),
    },
  ])

  const posts = await databaseRows<BlockRow>(
    'blocks?select=id,resolver,content&resolver=eq.extensions.twitter.tweet.v2&order=id.desc&limit=100'
  )
  const postBlock = posts.find((row) => (JSON.parse(row.content) as { id?: string }).id === postId)
  expect(postBlock).toBeDefined()
  const mediaBlocks = await databaseRows<BlockRow>(
    'blocks?select=id,resolver,content&resolver=eq.extensions.twitter.media.v1&order=id.desc&limit=100'
  )
  const mediaBlock = mediaBlocks.find(
    (row) => (JSON.parse(row.content) as { id?: string }).id === mediaId
  )
  expect(mediaBlock).toBeDefined()
  const failedMediaBlock = mediaBlocks.find(
    (row) => (JSON.parse(row.content) as { id?: string }).id === failedMediaId
  )
  expect(failedMediaBlock).toBeDefined()
  const relations = await databaseRows<RelationRow>(
    `relations?select=from_,to_,content&from_=eq.${postBlock!.id}`
  )
  expect(
    relations.some((row) => row.to_ === mediaBlock!.id && JSON.parse(row.content).type === 'media')
  ).toBe(true)
  expect(
    relations.some(
      (row) => row.to_ === failedMediaBlock!.id && JSON.parse(row.content).type === 'media'
    )
  ).toBe(true)

  const controlledMediaReads: string[] = []
  await page.route('https://pbs.twimg.com/media/**', async (route) => {
    const url = route.request().url()
    if (url === imageUrl) {
      controlledMediaReads.push(url)
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
          'base64'
        ),
      })
      return
    }
    if (url === failedImageUrl) {
      controlledMediaReads.push(url)
      await route.fulfill({
        status: 503,
        contentType: 'text/plain',
        body: 'controlled source failure',
      })
      return
    }
    await route.continue()
  })

  await page.goto(`/info-base/graph/blocks/${postBlock!.id}/content`)
  const content = page.locator('.solved-content-popup')
  await expect(content).toContainText('Archive Acceptance Author')
  await expect(content.getByRole('link', { name: `Original post · ${postId}` })).toHaveAttribute(
    'href',
    `https://x.com/i/status/${postId}`
  )
  const boldSegment = content.locator('.rich-text--bold').filter({ hasText: 'Rich text' })
  await expect(boldSegment).toBeVisible()
  expect(
    Number(await boldSegment.evaluate((element) => getComputedStyle(element).fontWeight))
  ).toBeGreaterThanOrEqual(600)
  await expect(content).toContainText('Long-form archive article title')
  await expect(content).toContainText('Long-form paragraph remains readable.')
  await expect(content).toContainText('Reply to @')
  await expect(content).toContainText(`Quoted post · ${quoteId}`)
  await expect(content).toContainText('Acceptance image metadata')
  await expect(content).toContainText('Controlled failure image metadata')
  const mediaCards = content.locator('.archive-media')
  await expect(mediaCards).toHaveCount(2)
  const imageCard = mediaCards.filter({ hasText: 'Acceptance image metadata' })
  const failedMediaCard = mediaCards.filter({ hasText: 'Controlled failure image metadata' })
  await expect(imageCard.getByRole('button', { name: 'Load media' })).toBeVisible()
  await expect(failedMediaCard.getByRole('button', { name: 'Load media' })).toBeVisible()
  expect(
    await page.evaluate(
      ({ imageUrl, failedImageUrl }) =>
        performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((name) => name === imageUrl || name === failedImageUrl),
      { imageUrl, failedImageUrl }
    )
  ).toEqual([])
  expect(controlledMediaReads).toEqual([])
  const imageRead = page.waitForRequest((request) => request.url() === imageUrl)
  await imageCard.getByRole('button', { name: 'Load media' }).click()
  await imageRead
  const loadedImage = imageCard.locator('img')
  await expect(loadedImage).toBeVisible()
  await expect(loadedImage).toHaveJSProperty('naturalWidth', 1)
  const failedImageRead = page.waitForRequest((request) => request.url() === failedImageUrl)
  await failedMediaCard.getByRole('button', { name: 'Load media' }).click()
  await failedImageRead
  await expect(failedMediaCard.getByRole('alert')).toContainText('HTTP 503')
  expect(controlledMediaReads).toEqual([imageUrl, failedImageUrl])

  await content.getByRole('button', { name: `View reply ${replyId}` }).click()
  await expect(page).toHaveURL(
    new RegExp(
      `/info-base/graph/blocks/${relations.find((row) => row.content.includes('reply'))?.to_}$`
    )
  )

  const indexJob = await maintainLexicalIndex(page)
  expect(indexJob.state).toMatchObject({ failed: 0, unavailable: 0 })
  for (const query of [postId, `acceptance_${stamp}`, 'Rich text survives with its author']) {
    await expectPostSearchResult(page, query, postBlock!.id)
  }
  const bodySearch = await expectPostSearchResult(
    page,
    'Rich text survives with its author',
    postBlock!.id
  )
  await bodySearch.locator('.info-base-list-view__match').click()
  await expect(page).toHaveURL(new RegExp(`/info-base/list/blocks/${postBlock!.id}$`))
  await expect(page.locator('.block-inspector-popup')).toContainText(`#${postBlock!.id}`)
  await page.locator('.block-inspector-popup').getByRole('button', { name: 'View content' }).click()
  await expect(page.locator('.solved-content-popup')).toContainText(
    'Rich text survives with its author and context.'
  )
})
