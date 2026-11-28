import { expect, test, type Page, type Route } from '@playwright/test'
import { setupNativeDatabase, serveBuiltExtension } from './native-extension-fixture'

// The Web Host, MF, and shared writes are real. Only the external native Peer's
// protocol is controlled so an ordinary user can retry the same source or credential.
async function openSetup(
  page: Page,
  slug: string,
  capabilities: string[],
  run: (fixture: {
    address: (capability: string) => string
    database: (path: string, method?: string, data?: object) => Promise<unknown[]>
    open: () => Promise<void>
    mutations: string[]
  }) => Promise<void>
) {
  const { database, browserPeer } = await setupNativeDatabase(page)
  const nativePeer = crypto.randomUUID()
  const name = `inkcre/${slug}`
  const address = (capability: string) => `https://setup-peer.example.invalid/${capability}`
  const extension = await serveBuiltExtension(page, slug)
  await extension.install()
  const management = 'core.extension.management.v2'
  const mutations: string[] = []
  const status = {
    name,
    peer_id: nativePeer,
    distribution: 'python',
    version: '1.0.0',
    enabled: true,
    config_schema: null,
    supported_distributions: ['python'],
    running: true,
    loaded_version: '1.0.0',
    restart_required: false,
    operation: null,
    error: null,
  }
  const shared = `extensions?name=eq.${name}`
  const [original] = await database<{ config: object }>(`${shared}&select=config`)
  try {
    await page.route(address(management), async (route) => {
      const command = route.request().postDataJSON()
      if (command.action !== 'status') mutations.push(command.action)
      if (command.action === 'patch_config')
        await database(shared, 'PATCH', { config: command.patch })
      await route.fulfill({
        headers: { 'Access-Control-Allow-Origin': '*' },
        json: { peer_id: nativePeer, supported_distributions: ['python'], extensions: [status] },
      })
    })
    await database('peers', 'POST', {
      id: nativePeer,
      name: 'Setup native fixture',
      labels: [],
      config: {},
      config_schema: {},
      lease_expires_at: new Date(Date.now() + 180_000).toISOString(),
      capabilities: [management, ...capabilities].map((id) => ({
        id,
        inbound: {
          protocol: 'core.peer.protocol.http.v1',
          parameters: { method: 'POST', url: address(id) },
        },
      })),
    })
    await database('extension_peer_participations', 'POST', {
      name,
      peer_id: nativePeer,
      distribution: 'python',
      version: '1.0.0',
      enabled: true,
      config_schema: null,
    })
    await run({
      address,
      database,
      mutations,
      async open() {
        await page.goto('/extensions')
        const card = page.getByRole('article').filter({ hasText: name })
        await card.getByRole('button', { name: 'Setup', exact: true }).click()
      },
    })
  } finally {
    if (!page.isClosed()) await page.goto('about:blank').catch(() => {})
    await database(shared, 'PATCH', original!)
    await database(
      `extension_peer_participations?peer_id=in.(${browserPeer},${nativePeer})`,
      'DELETE'
    )
    await database(`peers?id=in.(${browserPeer},${nativePeer})`, 'DELETE')
  }
}

test('Memos keeps its saved PAT when the selected Peer address is unavailable', async ({
  page,
}) => {
  await openSetup(
    page,
    'memos',
    ['memos.connection.v1'],
    async ({ address, database, mutations, open }) => {
      await database('extensions?name=eq.inkcre/memos', 'PATCH', { config: {} })
      let hasAddress = false
      await page.route(address('memos.connection.v1'), (route) =>
        route.fulfill({
          headers: { 'Access-Control-Allow-Origin': '*' },
          status: hasAddress ? 200 : 409,
          json: hasAddress
            ? { server_url: 'https://client.example.invalid/site/memos/' }
            : { detail: 'no public base URL' },
        })
      )
      await open()
      const setup = page.locator('.memos-setup')
      const choose = setup.getByRole('combobox', { name: 'Core providing Memos' })
      const prepare = setup.getByRole('button', { name: 'Prepare connection' })
      await expect(prepare).toBeVisible()
      if (await choose.isVisible()) {
        await choose.click()
        await page.getByRole('option', { name: /Setup native fixture/ }).click()
      }
      expect(mutations).toEqual([])
      await prepare.click()
      await expect(setup.getByRole('alert')).toContainText('PAT saved and Memos enabled')
      const [saved] = (await database('extensions?name=eq.inkcre/memos&select=config')) as {
        config: { personal_access_token: string }
      }[]
      expect(saved!.config.personal_access_token).toMatch(/^memos_pat_[0-9A-Za-z]{32}$/)
      hasAddress = true
      await setup.getByRole('button', { name: 'Refresh status' }).click()
      await expect(setup.getByLabel('Server URL', { exact: true })).toHaveValue(
        'https://client.example.invalid/site/memos/'
      )
      const pat = setup.getByLabel('Personal Access Token', { exact: true })
      await expect(pat).toHaveAttribute('type', 'password')
      await setup.getByRole('button', { name: 'Show PAT' }).click()
      await expect(pat).toHaveValue(saved!.config.personal_access_token)
      expect(mutations).toEqual(['patch_config'])
    }
  )
})

test('Twitter retains the selected bookmark source on a failed switch and starts the saved schedule once', async ({
  page,
}) => {
  await openSetup(
    page,
    'twitter',
    ['inkcre.twitter.setup.status.v1'],
    async ({ address, database, open }) => {
      await database('extensions?name=eq.inkcre/twitter', 'PATCH', {
        config: { client_id: 'test-client', client_secret: 'fixture-only' },
      })
      await page.route(address('inkcre.twitter.setup.status.v1'), (route) =>
        route.fulfill({
          headers: { 'Access-Control-Allow-Origin': '*' },
          json: {
            callback_url: 'https://setup-peer.example.invalid/callback',
            connected: true,
            user_id: '42',
            handle: 'fixture',
            scopes: [],
            reconnect_required: false,
          },
        })
      )
      const type = 'extensions.twitter.bookmark.Source'
      const existingType = await database(`sources_types?id=eq.${type}`)
      if (!existingType.length)
        await database('sources_types', 'POST', {
          id: type,
          description: 'Twitter bookmark source',
          config_schema: {},
          collect_config_schema: {},
        })
      const ids: number[] = []
      try {
        for (const nickname of ['Morning bookmarks', 'Evening bookmarks']) {
          const [source] = (await database('sources', 'POST', {
            nickname,
            type,
            config: {},
            state: {},
          })) as { id: number }[]
          ids.push(source!.id)
        }
        await open()
        const setup = page.locator('.twitter-setup')
        const picker = setup.getByRole('combobox', { name: 'Bookmark Source' })
        const select = async (name: string) => {
          await picker.click()
          await page.getByRole('option', { name, exact: true }).click()
        }
        const time = setup.locator('.ink-picker')
        const editTime = async (hour: string, minute: string) => {
          await time.click()
          const dialog = page
            .getByRole('dialog')
            .filter({ has: page.getByRole('listbox', { name: /^Hour/ }) })
          await dialog.getByRole('listbox', { name: /^Hour/ }).selectOption(hour)
          await dialog.getByRole('listbox', { name: /^Minute/ }).selectOption(minute)
          await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
        }
        await select('Morning bookmarks')
        await editTime('7', '30')
        const crons = '**/crons?**'
        const rejectRead = (route: Route) =>
          route.fulfill({
            headers: { 'Access-Control-Allow-Origin': '*' },
            status: 403,
            json: { message: 'Unable to read the selected schedule' },
          })
        await page.route(crons, rejectRead)
        await select('Evening bookmarks')
        await expect(setup.getByRole('alert')).toContainText('Unable to read the selected schedule')
        await expect(picker).toHaveText('Morning bookmarks')
        await expect(time).toContainText('7:30')
        await page.unroute(crons, rejectRead)
        await select('Evening bookmarks')
        await expect(picker).toHaveText('Evening bookmarks')
        await expect(setup.getByRole('alert')).toHaveCount(0)
        await editTime('17', '45')
        const rejectWrite = (route: Route) =>
          route.request().method() === 'POST'
            ? route.fulfill({
                headers: { 'Access-Control-Allow-Origin': '*' },
                status: 403,
                json: { message: 'Schedule save rejected' },
              })
            : route.continue()
        await page.route(crons, rejectWrite)
        await setup.getByRole('button', { name: 'Continue', exact: true }).click()
        await expect(setup.getByRole('alert')).toContainText('Schedule save rejected')
        await page.unroute(crons, rejectWrite)
        await setup.getByRole('button', { name: 'Continue', exact: true }).click()
        await expect(setup.getByRole('heading', { name: 'Review and start' })).toBeVisible()
        await setup.getByRole('button', { name: 'Start collecting bookmarks' }).click()
        await expect(setup.getByRole('heading', { name: 'Twitter is ready' })).toBeVisible()
        const filter = encodeURIComponent(JSON.stringify({ source: ids[1] }))
        expect(await database(`crons?job_parameters=cs.${filter}&select=enabled,schedule`)).toEqual(
          [{ enabled: true, schedule: '45 17 * * *' }]
        )
        expect(await database(`jobs?parameters=cs.${filter}&select=type`)).toEqual([
          { type: 'core.source.collect.v1' },
        ])
      } finally {
        for (const id of ids) {
          const filter = encodeURIComponent(JSON.stringify({ source: id }))
          await database(`crons?job_parameters=cs.${filter}`, 'DELETE')
          await database(`jobs?parameters=cs.${filter}`, 'DELETE')
          await database(`sources?id=eq.${id}`, 'DELETE')
        }
        if (!existingType.length) await database(`sources_types?id=eq.${type}`, 'DELETE')
      }
    }
  )
})

test('Twitter setup preserves rejected credentials and polls the transaction returned by the chosen Peer', async ({
  page,
}) => {
  const status = 'inkcre.twitter.setup.status.v1'
  const configure = 'inkcre.twitter.oauth-app.configure.v1'
  const begin = 'inkcre.twitter.oauth.begin.v1'
  const poll = 'inkcre.twitter.oauth.transaction.read.v1'
  await openSetup(
    page,
    'twitter',
    [status, configure, begin, poll],
    async ({ open, address, database }) => {
      const shared = 'extensions?name=eq.inkcre/twitter'
      await database(shared, 'PATCH', { config: {} })
      const headers = { 'Access-Control-Allow-Origin': '*' }
      const disconnected = {
        callback_url: 'https://setup-peer.example.invalid/callback',
        connected: false,
        user_id: null,
        handle: null,
        scopes: [],
        reconnect_required: false,
      }
      await page.route(address(status), (route) => route.fulfill({ headers, json: disconnected }))
      let allowSave = false
      await page.route(address(configure), async (route) => {
        if (!allowSave)
          return route.fulfill({
            headers,
            status: 403,
            json: { detail: 'Application save rejected' },
          })
        const { client_id, client_secret, confirm_account_reset } = route.request().postDataJSON()
        expect(confirm_account_reset).toBe(false)
        await database(shared, 'PATCH', { config: { client_id, client_secret } })
        await route.fulfill({ headers, json: disconnected })
      })
      const transaction = {
        id: crypto.randomUUID(),
        status: 'pending',
        authorize_url: 'https://x.com/i/oauth2/authorize?state=fixture',
        expires_at: '2099-01-01T00:00:00Z',
        error: null,
      }
      let starts = 0
      await page.route(address(begin), async (route) => {
        starts++
        await route.fulfill({ headers, json: transaction })
      })
      await page.route(address(poll), async (route) => {
        expect(route.request().postDataJSON()).toEqual({ transaction_id: transaction.id })
        await route.fulfill({
          headers,
          json: {
            ...transaction,
            status: 'failed',
            error: 'Authorization was declined',
            authorize_url: null,
          },
        })
      })
      await open()
      const setup = page.locator('.twitter-setup')
      const id = setup.getByRole('textbox', { name: 'Client ID', exact: true })
      const secret = setup.getByLabel(/Client Secret/)
      await id.fill('fixture-client')
      await secret.fill('fixture-only')
      await setup.getByRole('button', { name: 'Save application' }).click()
      await expect(setup.getByRole('alert')).toContainText('Application save rejected')
      await expect(id).toHaveValue('fixture-client')
      await expect(secret).toHaveValue('fixture-only')
      allowSave = true
      await setup.getByRole('button', { name: 'Save application' }).click()
      const create = setup.getByRole('button', { name: 'Create authorization link' })
      await create.click()
      await expect(setup.getByRole('link', { name: 'Open X authorization' })).toHaveAttribute(
        'href',
        transaction.authorize_url
      )
      await expect(create).toHaveCount(0)
      await expect(setup.getByRole('alert')).toContainText('Authorization was declined')
      await expect(create).toBeEnabled()
      expect(starts).toBe(1)
    }
  )
})
