import { chromium, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Standalone candidate check: no test-runner configuration, shared database, or daily browser profile.
const output = resolve(process.argv[2] || '.runtime/twitter-rendering')
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({
  executablePath:
    process.env.TWITTER_UI_BROWSER || '/Applications/Helium.app/Contents/MacOS/Helium',
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const select = (id) => page.locator('#specimen').selectOption(String(id))
const shot = (name, fullPage = true) =>
  page.screenshot({ path: resolve(output, `${name}.png`), fullPage })
const check = async (code, message) => expect(await page.evaluate(code), message).toBe(true)
const reads = []
const pendingRequests = new Set()
page.on('request', (request) => {
  pendingRequests.add(request.url())
  if (/media.png|video.mp4|example.invalid/.test(request.url())) reads.push(request.url())
})
page.on('requestfinished', (request) => pendingRequests.delete(request.url()))
page.on('requestfailed', (request) => pendingRequests.delete(request.url()))
try {
  await page.goto('http://127.0.0.1:5188/', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#specimen')).toBeVisible()
  expect(reads, 'Media and avatars stay unloaded').toEqual([])
  const originalPost = page.getByRole('link', { name: 'View original post on X', exact: true })
  await expect(originalPost).toContainText('View original post')
  await expect(originalPost).toHaveAttribute('href', 'https://x.com/i/status/1848392839000000001')
  await expect(originalPost).toHaveAttribute('target', '_blank')
  await expect(
    page.locator(
      '.tweet-preview a, .tweet-preview button, .tweet-preview img, .tweet-preview video'
    )
  ).toHaveCount(0)
  await check(
    `(async () => { const { visibleText, safeUrl } = await import('/@fs' + ${JSON.stringify(resolve('extensions/twitter/src/components/contentTweet/presentation.ts'))}); return visibleText({text: '🌿Hello! hidden', visible: [0, 7]}) === '🌿Hello!' && safeUrl('javascript:alert(1)') === undefined && safeUrl('https://name:password@example.com') === undefined })()`,
    'Visible Unicode text and external link boundary'
  )
  await shot('after-detail-light')
  const objectUrls = []
  for (const [id, count] of [
    [100, 1],
    [101, 2],
    [102, 3],
    [103, 4],
  ]) {
    await select(id)
    for (let index = 0; index < count; index++) {
      await page.locator('.tweet-media__load').first().click()
      await expect(page.locator('.tweet-media img')).toHaveCount(index + 1)
    }
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.tweet-media img')].every((i) => i.naturalWidth > 0)
    )
    await check(
      "[...document.querySelectorAll('.tweet-media img')].every(i => i.getBoundingClientRect().height <= Math.min(440, innerHeight * .65))",
      'Images stay inside the reading area'
    )
    if (count === 1) {
      const expand = page.getByRole('button', { name: 'Expand image', exact: true })
      const thumbnailHeight = (await page.locator('.ink-image__img').boundingBox()).height
      const mediaReads = reads.length
      await expand.focus()
      await page.keyboard.press('Enter')
      await expect(page.locator('dialog[open]')).toBeVisible()
      const enlarged = page.locator('.ink-image__img-expanded')
      await expect(enlarged).toHaveJSProperty('naturalWidth', 900)
      expect((await enlarged.boundingBox()).height).toBeGreaterThan(thumbnailHeight)
      expect(reads.length, 'Enlargement reuses the loaded bytes').toBe(mediaReads)
      await shot('after-image-expanded', false)
      await page.keyboard.press('Escape')
      await expect(page.locator('dialog[open]')).toHaveCount(0)
      await expect(expand).toBeFocused()
      await page.locator('.ink-image__thumbnail').click()
      await page.locator('dialog[open]').getByRole('button', { name: 'Close', exact: true }).click()
      await expect(page.locator('.ink-image__thumbnail')).toBeFocused()
    }
    objectUrls.push(
      ...(await page
        .locator('.tweet-media img')
        .evaluateAll((images) => images.map((image) => image.src)))
    )
    await shot(`after-media-${count}`)
  }
  await select(104)
  expect(
    await page.evaluate(
      async (urls) =>
        Promise.all(
          urls.map(async (url) => {
            try {
              await fetch(url)
              return false
            } catch {
              return true
            }
          })
        ),
      objectUrls
    ),
    'Closed media URLs must be revoked'
  ).toEqual(objectUrls.map(() => true))
  await page.locator('.content-tweet__quote button').click()
  await expect(page.locator('.solved-content-popup')).toContainText('好的阅读体验')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await select(105)
  await expect(page.locator('.specimen-detail')).toContainText('全文结束标记')
  await select(108)
  await expect(page.locator('.specimen-detail')).toContainText('阅读节奏')
  await expect(page.locator('.tweet-identity').first()).not.toContainText('@123456789')
  await expect(originalPost).toHaveAttribute('href', 'https://x.com/i/status/12345')
  await page.getByRole('button', { name: 'Load 1 attachments', exact: true }).click()
  await page.getByRole('button', { name: 'Expand image', exact: true }).click()
  await expect(page.locator('dialog[open] img')).toHaveJSProperty('naturalWidth', 900)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Expand image', exact: true })).toBeFocused()
  await select(109)
  await expect(page.locator('.specimen-detail')).toContainText('not been captured')
  await select(107)
  await page.locator('.tweet-media__load').click()
  await expect(page.locator('.tweet-media [role=alert]')).toContainText('could not be displayed')
  await expect(page.locator('.tweet-media__load')).toContainText('Retry')
  await page.route('**/missing-media.jpg', (route) =>
    route.fulfill({ status: 503, body: 'Controlled failure' })
  )
  await page.locator('.tweet-media__load').click()
  await expect(page.locator('.tweet-media [role=alert]')).toContainText('HTTP 503')
  await select(110)
  await page.locator('.tweet-media__load').click()
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1)
  await check(
    "document.querySelector('video').paused && document.querySelector('video').controls",
    'Video loads with controls and no autoplay'
  )
  await page.locator('video').evaluate((video) => video.play())
  await page.waitForFunction(() => document.querySelector('video').currentTime > 0)
  await page.locator('video').evaluate((video) => video.pause())
  const videoTime = await page.locator('video').evaluate((video) => video.currentTime)
  const fullScreen = page.getByRole('button', { name: 'View video in full screen' })
  await fullScreen.click()
  await page.waitForFunction(() => document.fullscreenElement === document.querySelector('video'))
  await check(
    "document.querySelector('video').getBoundingClientRect().height === innerHeight && document.querySelector('video').paused",
    'Video fills the screen without forcing playback'
  )
  expect(await page.locator('video').evaluate((video) => video.currentTime)).toBe(videoTime)
  await shot('after-video-fullscreen', false)
  await page.evaluate(() => document.exitFullscreen())
  await page.waitForFunction(() => !document.fullscreenElement)
  await expect(fullScreen).toBeFocused()
  await page.locator('video').evaluate((video) => {
    video.requestFullscreen = () => Promise.reject(new Error('Controlled denial'))
  })
  await fullScreen.click()
  await expect(page.getByRole('alert')).toContainText('Full screen could not open')
  await page.locator('video').evaluate((video) => video.play())
  await check(
    "!document.querySelector('video').paused",
    'Fullscreen denial keeps the loaded player usable'
  )
  await select(111)
  await expect(page.locator('.content-tweet__counts dd')).toHaveCount(1)
  await expect(page.locator('.content-tweet__counts dd')).toHaveText('0')
  await select(112)
  await page.locator('.tweet-media__load').click()
  await expect(page.locator('.tweet-media img')).toHaveJSProperty('naturalWidth', 900)
  await select(104)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '深色', exact: true }).click()
  await check('document.documentElement.scrollWidth <= innerWidth', 'No narrow layout overflow')
  await shot('after-mobile-dark')
  await page.getByRole('button', { name: '打开实际内容弹窗' }).click()
  await expect(page.locator('.solved-content-popup')).toBeVisible()
  await check(
    "document.querySelector('.solved-content-popup').getBoundingClientRect().right <= innerWidth",
    'Actual popup fits narrow viewport'
  )
  await shot('after-popup-mobile-dark')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await select(100)
  await page.getByRole('button', { name: '打开实际内容弹窗' }).click()
  const popup = page.locator('.solved-content-popup')
  await popup.locator('.tweet-media__load').click()
  await popup.getByRole('button', { name: 'Expand image', exact: true }).click()
  await expect(page.locator('dialog[open] .ink-image__img-expanded')).toHaveJSProperty(
    'naturalWidth',
    900
  )
  await check(
    "(() => { const r = document.querySelector('.ink-image__img-expanded').getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })()",
    'Expanded image fits the narrow viewport above the actual popup'
  )
  await shot('after-image-expanded-mobile', false)
  await page.keyboard.press('Escape')
  await expect(popup).toBeVisible()
  await expect(popup.getByRole('button', { name: 'Expand image', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.locator('#view').selectOption('graph')
  await page.getByRole('button', { name: 'Explore Block #105', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('output')).toHaveText('Focused Block #105')
  await check(
    "[...document.querySelectorAll('.block-node')].every(n => n.getBoundingClientRect().width <= 320 && n.getBoundingClientRect().height <= 360)",
    'Graph nodes stay bounded'
  )
  await shot('after-graph-dark')
  await page.getByRole('button', { name: 'Inspect Block #105', exact: true }).click()
  await expect(page.locator('.solved-content-popup')).toContainText('全文结束标记')
  expect(
    reads.filter((url) => url.includes('example.invalid')),
    'Avatars never auto-load'
  ).toEqual([])
  console.log(`Twitter renderer checks passed. Screenshots: ${output}`)
} catch (error) {
  console.error('Unfinished requests:', [...pendingRequests])
  await shot('failure')
  throw error
} finally {
  await browser.close()
}
