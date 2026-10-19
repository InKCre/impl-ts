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
  const archiveBase = getArchiveBase()
  const webOrigin = new URL(process.env.INKCRE_E2E_WEB_URL!).origin
  const stamp = `${Date.now()}`
  const userId = `${stamp}01`
  const postId = `${stamp}02`
  const quoteId = `${stamp}03`
  const replyId = `${stamp}04`
  const mediaId = `${stamp}05`
  const imageUrl = 'https://pbs.twimg.com/media/inkcre-acceptance-no-fetch.jpg'

  const twitterRemoteEntry = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      url.pathname.includes('/extensions/inkcre/twitter/') &&
      url.pathname.endsWith('/remoteEntry.js')
    )
  })
  await page.goto('/extensions')
  const remoteEntry = await twitterRemoteEntry
  expect(remoteEntry.ok()).toBe(true)
  expect(new URL(remoteEntry.url()).origin).toBe(webOrigin)
  const twitter = page.locator('.extension-card[aria-label="Twitter"]')
  await expect(twitter).toBeVisible()
  await twitter.getByRole('button', { name: 'Setup' }).click()
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
          mediaIds: [mediaId],
          article: {
            id: `${stamp}06`,
            title: 'Long-form archive article title',
            blocks: [{ type: 'unstyled', text: 'Long-form paragraph remains readable.' }],
          },
          counts: { likes: 4 },
        },
      ],
      media: [{ id: mediaId, type: 'photo', url: imageUrl, alt: 'Acceptance image metadata' }],
    },
  })
  const submitBody = await submit.text()
  expect(submit.status(), submitBody).toBe(200)
  const submitted = JSON.parse(submitBody) as {
    summary: { accepted: number; failed: number; total: number }
  }
  expect(submitted.summary).toMatchObject({ accepted: 5, failed: 0, total: 5 })

  const query = await page.request.post(new URL('api/v1/archive/query', archiveBase).toString(), {
    headers: { 'x-tweet-db-client': 'x-monkey' },
    data: { users: [userId], posts: [postId], media: [mediaId] },
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
  const relations = await databaseRows<RelationRow>(
    `relations?select=from_,to_,content&from_=eq.${postBlock!.id}`
  )
  expect(
    relations.some((row) => row.to_ === mediaBlock!.id && JSON.parse(row.content).type === 'media')
  ).toBe(true)

  await page.goto(`/info-base/graph/blocks/${postBlock!.id}/content`)
  const content = page.locator('.solved-content-popup')
  await expect(content).toContainText('Archive Acceptance Author')
  await expect(content.getByRole('link', { name: `Original post · ${postId}` })).toHaveAttribute(
    'href',
    `https://x.com/i/status/${postId}`
  )
  await expect(content.locator('.rich-text strong')).toHaveText('Rich text')
  await expect(content).toContainText('Long-form archive article title')
  await expect(content).toContainText('Long-form paragraph remains readable.')
  await expect(content).toContainText('Reply to @')
  await expect(content).toContainText(`Quoted post · ${quoteId}`)
  await expect(content).toContainText('Acceptance image metadata')
  await expect(content.getByRole('button', { name: 'Load media' })).toBeVisible()
  expect(
    await page.evaluate(
      (url) =>
        performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((name) => name === url),
      imageUrl
    )
  ).toEqual([])
  await content.getByRole('button', { name: `View reply ${replyId}` }).click()
  await expect(page).toHaveURL(
    new RegExp(
      `/info-base/graph/blocks/${relations.find((row) => row.content.includes('reply'))?.to_}$`
    )
  )
})
