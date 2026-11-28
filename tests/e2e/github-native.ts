import { expect, test } from '@playwright/test'
import { connectNativeHost, databaseToken, serveBuiltExtension } from './native-extension-fixture'

/** Uses the real built MF module and disposable suite DB; only Registry delivery is served locally. */
export function registerGitHubNativeTests(): void {
  test('GitHub MF reads three stored record types and current relationships through its real Host', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const postgrestUrl = process.env.INKCRE_E2E_POSTGREST_URL!
    const jwtSecret = process.env.INKCRE_E2E_JWT_SECRET!
    const peerId = crypto.randomUUID()
    const extension = await serveBuiltExtension(page, 'github')
    const authorization = await databaseToken(jwtSecret)
    const headers = { Authorization: `Bearer ${authorization}`, 'Content-Type': 'application/json' }
    let githubApiCalls = 0
    await page.route('https://api.github.com/**', async (route) => {
      githubApiCalls++
      await route.abort()
    })
    await connectNativeHost(page, { postgrestUrl, jwtSecret, browserPeer: peerId })
    const createdBlocks: number[] = []
    const createdRelations: number[] = []
    async function createBlock(resolver: string, content: unknown): Promise<number> {
      const response = await fetch(`${postgrestUrl}blocks`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ resolver, content: JSON.stringify(content), storage: null }),
      })
      expect(response.status, await response.clone().text()).toBe(201)
      const [block] = await response.json()
      createdBlocks.push(block.id)
      return block.id
    }
    async function relate(from: number, to: number, content: string): Promise<number> {
      const response = await fetch(`${postgrestUrl}relations`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ from_: from, to_: to, content }),
      })
      expect(response.status, await response.clone().text()).toBe(201)
      const [relation] = await response.json()
      createdRelations.push(relation.id)
      return relation.id
    }
    try {
      const user = await createBlock('extensions.github.account.v1', {
        node_id: 'FixtureUser',
        kind: 'user',
        login: 'fixture-user',
        name: 'Fixture Reader',
        url: 'https://example.invalid/fixture-user',
        avatar_url: null,
      })
      const organization = await createBlock('extensions.github.account.v1', {
        node_id: 'FixtureOrg',
        kind: 'organization',
        login: 'fixture-org',
        name: null,
        url: 'javascript:alert(1)',
        avatar_url: 'data:text/html,unsafe',
      })
      const repository = await createBlock('extensions.github.repository.v1', {
        node_id: 'FixtureRepo',
        name_with_owner: 'fixture-org/demo',
        description: '<script>unsafe()</script> Stored repository description',
        url: 'https://example.invalid/fixture-org/demo',
        homepage_url: 'https://user:secret@example.invalid/',
        primary_language: 'Python',
        topics: ['fixture', 'reader'],
        is_private: true,
        is_archived: true,
      })
      const list = await createBlock('extensions.github.list.v1', {
        node_id: 'FixtureList',
        name: 'Fixture Favorites',
        description: 'Current stored membership',
        slug: 'fixture-favorites',
        is_private: false,
      })
      const invalid = await createBlock('extensions.github.list.v1', {
        node_id: 'InvalidList',
        name: 'Invalid',
        slug: 'invalid',
        is_private: false,
        invented_membership: [repository],
      })
      await relate(user, repository, 'stars')
      await relate(user, list, 'owns')
      await relate(organization, repository, 'owns')
      const membership = await relate(list, repository, 'contains')
      const { row, version } = await extension.install()
      extension.hold()
      await page.goto(`/info-base/graph?focal_block=${list}`, { waitUntil: 'domcontentloaded' })
      await expect.poll(extension.waiting).toBe(true)
      await expect(
        page.getByRole('button', { name: `Explore entry #${list}`, exact: true })
      ).toBeVisible()
      extension.release()
      await expect(
        page
          .getByRole('button', { name: `Explore entry #${list}`, exact: true })
          .locator('.github-content--compact')
      ).toContainText('Fixture Favorites')
      await expect(
        page
          .getByRole('button', { name: `Explore entry #${repository}`, exact: true })
          .locator('.github-content--compact')
      ).toContainText('fixture-org/demo')
      await expect(
        page
          .getByRole('button', { name: `Explore entry #${user}`, exact: true })
          .locator('.github-content--compact')
      ).toContainText('Fixture Reader')
      const accountPreview = page.getByRole('button', {
        name: `Explore entry #${user}`,
        exact: true,
      })
      await accountPreview.press('Enter')
      await expect(page).toHaveURL((url) => url.searchParams.get('focal_block') === String(user))
      await page.goto(`/info-base/list/blocks/${user}/content`)
      const content = page.locator('.github-content:not(.github-content--compact)')
      await expect(
        content.getByRole('heading', { name: 'Fixture Reader', exact: true })
      ).toBeVisible()
      await page.goto(`/info-base/list/blocks/${list}/content`)
      await expect(
        content.getByRole('heading', { name: 'Fixture Favorites', exact: true })
      ).toBeVisible()
      await expect(
        content.getByRole('button', { name: 'fixture-org/demo', exact: true })
      ).toBeVisible()
      await content.getByRole('button', { name: 'fixture-org/demo', exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`/blocks/${repository}/content`))
      await expect(content).toContainText('Private')
      await expect(content).toContainText('Archived')
      await expect(content).toContainText('Python')
      await expect(content.getByRole('link', { name: 'Homepage', exact: true })).toHaveCount(0)
      await expect(content).toContainText('<script>unsafe()</script> Stored repository description')
      expect(await page.locator('.github-content script').count()).toBe(0)
      await page.goto(`/info-base/list/blocks/${organization}/content`)
      await expect(
        content.getByRole('heading', { name: '@fixture-org', exact: true })
      ).toBeVisible()
      await expect(content).toContainText('Organization')
      await expect(content.getByRole('link', { name: 'GitHub profile', exact: true })).toHaveCount(
        0
      )
      await expect(content.locator('img')).toHaveCount(0)
      await page.goto(`/info-base/list/blocks/${list}/content`)
      await expect(
        content.getByRole('button', { name: 'fixture-org/demo', exact: true })
      ).toBeVisible()
      const focalBefore = await (
        await fetch(`${postgrestUrl}blocks?select=updated_at&id=eq.${list}`, { headers })
      ).json()
      const removed = await fetch(`${postgrestUrl}relations?id=eq.${membership}`, {
        method: 'DELETE',
        headers,
      })
      expect(removed.status).toBe(204)
      expect(
        await (
          await fetch(`${postgrestUrl}blocks?select=updated_at&id=eq.${list}`, { headers })
        ).json()
      ).toEqual(focalBefore)
      await page.getByRole('button', { name: 'Refresh', exact: true }).click()
      await expect(
        content.getByRole('button', { name: 'fixture-org/demo', exact: true })
      ).toHaveCount(0)
      await expect(content).toContainText('None collected')
      const updated = await fetch(`${postgrestUrl}blocks?id=eq.${list}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          content: JSON.stringify({
            node_id: 'FixtureList',
            name: 'Updated Favorites',
            description: null,
            slug: 'fixture-favorites',
            is_private: false,
          }),
        }),
      })
      expect(updated.status).toBe(204)
      await page.getByRole('button', { name: 'Refresh', exact: true }).click()
      await expect(
        content.getByRole('heading', { name: 'Updated Favorites', exact: true })
      ).toBeVisible()
      await page.goto(`/info-base/list/blocks/${invalid}/content`)
      await expect(content).toHaveCount(0)
      await expect(page.locator('.solved-content-popup__state')).toContainText(
        'invented_membership'
      )
      await page.goto('/extensions')
      await row.getByRole('button', { name: 'Disable', exact: true }).click()
      await expect(row.getByText('Not running', { exact: true })).toBeVisible()
      await page.goto(`/info-base/list/blocks/${repository}/content`)
      await expect(
        page.getByText(/Unknown resolver ID: extensions.github.repository.v1/)
      ).toBeVisible()
      await page.goto('/extensions')
      await row.getByRole('button', { name: 'Enable', exact: true }).click()
      await expect(row.getByText(`Running ${version}`, { exact: true })).toBeVisible()
      // Stopping background participation keeps already loaded local resolvers usable.
      const graph = `/info-base/graph?focal_block=${repository}`
      const preview = page.getByRole('button', {
        name: `Explore entry #${repository}`,
        exact: true,
      })
      await page.goto(graph)
      await expect(preview).toContainText('fixture-org/demo')
      const documentStartedAt = await page.evaluate(() => performance.timeOrigin)
      await page.locator('button[aria-controls="app-side-panel"]').click()
      await page.getByLabel('Primary').getByRole('link', { name: 'Settings', exact: true }).click()
      await page.getByLabel('Lease renewal and job check interval (seconds; 0 disables)').fill('0')
      await page.getByRole('button', { name: 'Save and use connection', exact: true }).click()
      await expect(
        page.getByText('Configuration saved successfully', { exact: true }).first()
      ).toBeVisible()
      await page.goBack()
      await expect(page).toHaveURL(graph)
      await page.getByRole('button', { name: `Inspect entry #${repository}`, exact: true }).click()
      await page.getByRole('button', { name: 'View content', exact: true }).click()
      await expect(content).toContainText('Stored repository description')
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStartedAt)
      // A new document must also restore the reader without starting background participation.
      await page.goto(`/info-base/list/blocks/${repository}/content`)
      await expect(
        content.getByRole('heading', { name: 'fixture-org/demo', exact: true })
      ).toBeVisible()
      expect(githubApiCalls).toBe(0)
    } finally {
      extension.release()
      // Timeout teardown may already have closed the page; DB cleanup must still run.
      if (!page.isClosed()) await page.goto('about:blank').catch(() => {})
      for (const id of createdRelations)
        await fetch(`${postgrestUrl}relations?id=eq.${id}`, { method: 'DELETE', headers })
      for (const id of createdBlocks)
        await fetch(`${postgrestUrl}blocks?id=eq.${id}`, { method: 'DELETE', headers })
      await fetch(
        `${postgrestUrl}extension_peer_participations?name=eq.inkcre/github&peer_id=eq.${peerId}`,
        { method: 'DELETE', headers }
      )
      await fetch(`${postgrestUrl}peers?id=eq.${peerId}`, { method: 'DELETE', headers })
    }
  })
}
