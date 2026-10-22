import { expect, test } from '@playwright/test'

test('reading, original content and publication archive preserve meaningful differences', async ({
  page,
}) => {
  page.on('pageerror', (error) => console.error(error))
  const externalRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('tracker.invalid') || request.url().includes('example.org')) {
      externalRequests.push(request.url())
    }
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Weekly research' })).toBeVisible()
  const body = page.frameLocator('iframe[title="Email HTML body"]')
  await expect(body.getByRole('heading', { name: 'Two useful articles' })).toBeVisible()
  await expect(body.getByRole('heading', { name: 'Article two' })).toBeVisible()
  await expect(body.getByRole('link', { name: 'Article one' })).toHaveAttribute(
    'href',
    'https://example.org/one?id=a%2Fb&edition=x%2By#section'
  )
  await expect(body.getByRole('link', { name: 'Unsubscribe' })).toHaveCount(0)
  await expect(body.getByText('Update your email preferences or unsubscribe')).toHaveCount(0)
  await expect(body.getByRole('link', { name: 'Read online' })).toHaveCount(0)
  await expect(body.getByText('Preview noise')).toHaveCount(0)
  await expect(page.getByText('Plain alternative should not appear twice')).toHaveCount(0)
  await expect(page.getByText('Inner plain alternative should not appear twice')).toHaveCount(0)
  await expect(page.getByText('Separate mixed section must remain.')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('reading.png'), fullPage: true })
  await page.getByRole('button', { name: '查看原文' }).first().click()
  await expect(body.getByRole('link', { name: 'Unsubscribe' })).toBeVisible()
  await expect(body.getByAltText('tracker')).not.toHaveAttribute('src')
  await page.getByRole('button', { name: '阅读视图' }).click()
  await expect(body.getByRole('link', { name: 'Unsubscribe' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Research Weekly · 查看各期' }).click()
  await expect(page.getByRole('heading', { name: 'Research Weekly' })).toBeVisible()
  await expect(page.getByText('2 期', { exact: true })).toBeVisible()
  await expect(page.getByText('weekly.example.org', { exact: true })).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Weekly research', exact: true })).toHaveCount(2)
  await page.getByText('2 份投递副本').click()
  await expect(page.getByRole('button', { name: '打开投递副本 2' })).toBeVisible()
  await page.getByRole('button', { name: '打开投递副本 1' }).click()
  await expect(body.getByRole('heading', { name: 'Article two' })).toBeVisible()
  expect(externalRequests).toEqual([])
})

test('publication archive uses full-width rows and keyboard-accessible secondary details', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/?archive')
  const archive = page.getByRole('article', { name: '刊物归档' })
  const issues = archive.getByRole('list', { name: '各期邮件' })
  await expect(issues.getByRole('listitem')).toHaveCount(2)
  const issue = issues.getByRole('button', { name: 'Weekly research', exact: true }).first()
  const geometry = await issue.evaluate((button) => ({
    rowWidth: button.getBoundingClientRect().width,
    listWidth: button.closest('ol')!.getBoundingClientRect().width,
    height: button.getBoundingClientRect().height,
  }))
  expect(geometry.rowWidth).toBe(geometry.listWidth)
  expect(geometry.height).toBeGreaterThanOrEqual(44)
  await expect(issue).toHaveAccessibleDescription(/2026/)
  const copies = archive.locator('summary', { hasText: '2 份投递副本' })
  await copies.focus()
  await page.keyboard.press('Enter')
  await expect(archive.getByRole('button', { name: '打开投递副本 2' })).toBeVisible()
  const identity = archive.locator('summary', { hasText: '刊物信息' })
  await identity.focus()
  await page.keyboard.press('Space')
  await expect(archive.getByText('weekly.example.org', { exact: true })).toBeVisible()
  await issue.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Weekly research' })).toBeVisible()
})

test('publication archive keeps long titles and unknown dates readable in a narrow container', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?archive=long')
  const archive = page.getByRole('article', { name: '刊物归档' })
  await expect(archive.getByText('日期未知')).toBeVisible()
  const title = archive.getByRole('button', { name: /A long newsletter title/ })
  await expect(title).toBeVisible()
  const layout = await archive.evaluate((element) => ({
    width: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }))
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width)
  await expect(archive.getByRole('listitem')).toHaveCount(2)
  await page.goto('/?archive=empty')
  await expect(page.getByText('暂无已归档邮件')).toBeVisible()
  await expect(page.getByRole('list', { name: '各期邮件' })).toHaveCount(0)
})

test('legacy multipart email keeps its HTML-first reading view', async ({ page }) => {
  await page.goto('/?legacy')
  const body = page.frameLocator('iframe[title="Email HTML body"]')
  await expect(body.getByRole('heading', { name: 'Legacy HTML content' })).toBeVisible()
  await expect(page.getByText('Legacy plain alternative')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '查看原文' })).toHaveCount(0)
})

test('newsletter layout reflows while data tables and image-only article links remain', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const body = page.frameLocator('iframe[title="Email HTML body"]')
  await expect(
    body.getByRole('heading', { name: 'Small heading must stay readable' })
  ).toBeVisible()
  const layout = await body.locator('body').evaluate((element) => ({
    width: element.clientWidth,
    scrollWidth: element.scrollWidth,
    headingSize: parseFloat(getComputedStyle(element.querySelector('h6')!).fontSize),
    bodySize: parseFloat(getComputedStyle(element).fontSize),
  }))
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width)
  expect(layout.headingSize).toBeGreaterThanOrEqual(layout.bodySize)
  await expect(body.getByRole('link', { name: '查看图片链接' })).toHaveAttribute(
    'href',
    'https://example.org/image-article'
  )
  await expect(body.getByRole('link', { name: 'Results chart' })).toHaveAttribute(
    'href',
    'https://example.org/chart'
  )
  await expect(body.locator('a[href="https://example.org/share"]')).toHaveCount(0)
  const table = body.getByRole('table', { name: 'Measurements' })
  await expect(table).toHaveAttribute('width', '180')
  await expect(table.getByRole('columnheader')).toHaveAttribute('colspan', '2')
  await expect(table.getByRole('cell', { name: 'Median' })).toHaveAttribute('rowspan', '2')
  await expect(table.getByRole('cell', { name: '43' })).toBeVisible()
  await page.getByRole('button', { name: '查看原文' }).first().click()
  await expect(body.locator('table[role="none"]')).toHaveAttribute('width', '670')
})

test('recall groups one email while preserving ambiguous, orphan and unavailable evidence', async ({
  page,
}) => {
  await page.goto('/?recall')
  const result = page.locator('#recall-result')
  await expect(result).toBeVisible()
  const groups = JSON.parse((await result.textContent())!)
  expect(groups.map((group: { id: number }) => group.id)).toEqual([2, 4, 16, 17, 18, 15])
  expect(groups[0].label).toBe('Weekly research')
  expect(groups[0].readable).toBe(true)
  expect(groups[0].excerpt).toBe('Article 11 tracker.invalid')
  expect(groups[0].evidence.map((match: { id: number }) => match.id)).toEqual([11, 2, 10])
  expect(groups[0].evidence.map((match: { rank: number }) => match.rank)).toEqual([10, 9, 8])
  expect(groups[0].evidence[0].excerpt).toContain('opaque-subscriber-token')
  expect(groups.flatMap((group: { evidence: unknown[] }) => group.evidence)).toHaveLength(8)
  expect(
    groups.every((group: { evidence: { unchanged: boolean }[] }) =>
      group.evidence.every((match) => match.unchanged)
    )
  ).toBe(true)
  expect(groups.slice(2).every((group: { readable: boolean }) => !group.readable)).toBe(true)
})

test('lexical text excludes derived links while reading and default projections retain them', async ({
  page,
}) => {
  await page.goto('/?projection')
  const result = page.locator('#projection-result')
  await expect(result).toBeVisible()
  const projection = JSON.parse((await result.textContent())!)
  expect(projection.lexical).toContain('Article two')
  expect(projection.lexical).toContain('https://example.org/reference')
  expect(projection.lexical).toContain('left | right')
  expect(projection.lexical).not.toContain('https://example.org/one')
  expect(projection.lexical).not.toContain('tracker.invalid')
  expect(projection.default).toContain('https://example.org/one?id=a%2Fb&edition=x%2By')
  expect(projection.solved).toContain('https://example.org/one?id=a%2Fb&amp;edition=x%2By')
  expect(projection.raw).toContain('utm_source=mail')
})

test('desktop outline scrolls the reader, restores position and retains script isolation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?long')
  const frame = page.locator('iframe[title="Email HTML body"]')
  const body = page.frameLocator('iframe[title="Email HTML body"]')
  const outline = page.getByRole('navigation', { name: '文章目录' })
  await expect(outline).toBeVisible()
  await expect(frame).toHaveAttribute(
    'sandbox',
    'allow-same-origin allow-popups allow-popups-to-escape-sandbox'
  )
  await expect(body.locator('script, [onerror]')).toHaveCount(0)
  expect(await page.locator('body').getAttribute('data-message-script')).toBeNull()
  const layout = await page.locator('.newsletter-reader').evaluate((reader) => {
    const iframe = reader.querySelector('iframe')!
    const nav = reader.querySelector('aside')!
    return {
      sidebarRight: nav.getBoundingClientRect().right,
      bodyLeft: iframe.getBoundingClientRect().left,
      frameHeight: iframe.clientHeight,
      documentHeight: iframe.contentDocument!.documentElement.scrollHeight,
    }
  })
  expect(layout.sidebarRight).toBeLessThan(layout.bodyLeft)
  expect(Math.abs(layout.documentHeight - layout.frameHeight)).toBeLessThanOrEqual(1)
  await outline.getByRole('button', { name: 'Long article 10', exact: true }).click()
  const position = () =>
    page.locator('.newsletter-reader').evaluate((reader) => {
      const iframe = reader.querySelector('iframe')!
      const heading = [...iframe.contentDocument!.querySelectorAll('h2')].find(
        (el) => el.textContent === 'Long article 10'
      )!
      return (
        iframe.getBoundingClientRect().top +
        heading.getBoundingClientRect().top -
        document.getElementById('app')!.getBoundingClientRect().top
      )
    })
  await expect.poll(position).toBeGreaterThanOrEqual(20)
  expect(await position()).toBeLessThanOrEqual(30)
  await expect(outline).toBeInViewport()
  await outline.getByRole('button', { name: '下一篇', exact: true }).click()
  await expect(
    outline.getByRole('button', { name: 'Long article 11', exact: true })
  ).toHaveAttribute('aria-current', 'location')
  await outline.getByRole('button', { name: '上一篇', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: '继续阅读：Long article 10', exact: true }).click()
  await expect.poll(position).toBeGreaterThanOrEqual(20)
  expect(await position()).toBeLessThanOrEqual(30)
  await page.getByRole('button', { name: '查看原文' }).first().click()
  await expect(frame).toHaveAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox')
  await expect(outline).toHaveCount(0)
  await page.getByRole('button', { name: '阅读视图' }).click()
  await expect(outline).toBeVisible()
})
