import { BrowserAccess, configStore, MetaConfigSchema } from '@inkcre/core'

let stage = 'discover'

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

async function main() {
  if (location.pathname === '/unpaired' || location.pathname === '/paired') {
    const found = await BrowserAccess.discover()
    await fetch('/probe-report', {
      method: 'POST',
      body: JSON.stringify({
        token: new URLSearchParams(location.search).get('token'),
        count: found.length,
        providers: found.map((item) => item.provider),
      }),
    })
    return
  }
  const config = await fetch('/config').then((response) => response.json())
  configStore.metaConfig = MetaConfigSchema.parse({
    INKCRE_PGREST_URL: `${location.origin}/unused-database`,
    INKCRE_PEER_ID: crypto.randomUUID(),
  })
  const found = await BrowserAccess.discover()
  check(found.length === 2, `Expected two authorized providers, found ${found.length}`)
  const binding = found.find((item) => item.provider === config.provider)!
  check(binding.provider === config.provider, 'Discovery returned another provider')
  BrowserAccess.bind(binding)
  check(BrowserAccess.hasBinding(binding.provider), 'Explicit binding was not persisted')
  const baseline = await BrowserAccess.tabs(binding.provider)
  let stalePage: { evaluate: (value: string) => Promise<unknown> } | undefined
  const extracted = await BrowserAccess.withPage(
    { provider: binding.provider, target: { kind: 'new' } },
    async (page) => {
      stalePage = page
      stage = 'goto'
      await page.goto(`${location.origin}/target`)
      stage = 'wait-selector'
      await page.waitForSelector('#more')
      stage = 'read-account'
      check(
        await page.$eval('#account', (node) => node.textContent === 'fixture-account'),
        'Target lost login state'
      )
      const response = page.waitForResponse((reply) => reply.url().endsWith('/data?page=2'))
      stage = 'click-more'
      await page.click('#more')
      stage = 'response-json'
      const body = await (await response).json()
      stage = 'wait-later-batch'
      await page.waitForFunction(() => document.querySelectorAll('li').length === 4, {
        polling: 100,
      })
      return {
        body,
        entries: await page.$$eval('li', (nodes) => nodes.map((node) => node.textContent)),
      }
    }
  )
  check(
    extracted.entries.join(',') === 'one,two,three,four',
    'Page interactions did not load the later batch'
  )
  check(extracted.body.entries.length === 2, 'Network response body did not cross the bridge')
  check(
    (await BrowserAccess.tabs(binding.provider)).length === baseline.length,
    'Owned tab was not closed'
  )
  check(
    await stalePage!.evaluate('1').then(
      () => false,
      () => true
    ),
    'Old Page still executed after release'
  )

  const borrowed = (await BrowserAccess.tabs(binding.provider)).find((tab) =>
    tab.url?.endsWith('/borrowed')
  )
  check(borrowed, 'Fixture borrowed tab is missing')
  stage = 'borrowed-tab'
  await BrowserAccess.withPage(
    { provider: binding.provider, target: { kind: 'existing', tab: borrowed } },
    async (page) => {
      await page.evaluate(() => {
        document.title = 'borrowed-preserved'
      })
      const busyTab = (await BrowserAccess.tabs(binding.provider)).find(
        (tab) => tab.tabId === borrowed.tabId
      )
      check(busyTab, 'Active borrowed tab disappeared')
      check(
        await BrowserAccess.withPage(
          { provider: binding.provider, target: { kind: 'existing', tab: busyTab } },
          async () => null
        ).then(
          () => false,
          () => true
        ),
        'Two sessions acquired the same borrowed tab'
      )
    }
  )
  check(
    (await BrowserAccess.tabs(binding.provider)).some((tab) => tab.tabId === borrowed.tabId),
    'Borrowed tab was closed'
  )
  check(
    await BrowserAccess.withPage(
      { provider: binding.provider, target: { kind: 'existing', tab: borrowed } },
      async () => null
    ).then(
      () => false,
      () => true
    ),
    'Consumed tab reference was reused'
  )

  const controller = new AbortController()
  stage = 'abort'
  let entered = false
  const cancelled = BrowserAccess.withPage(
    { provider: binding.provider, target: { kind: 'new' }, signal: controller.signal },
    async (page) => {
      await page.goto(`${location.origin}/target`)
      entered = true
      setTimeout(() => controller.abort(), 50)
      await page.waitForSelector('#never', { timeout: 0 })
    }
  )
  check(
    await cancelled.then(
      () => false,
      () => true
    ),
    'Aborted callback completed successfully'
  )
  check(entered, 'Abort did not exercise an active callback')
  check(
    (await BrowserAccess.tabs(binding.provider)).length === baseline.length,
    'Aborted owned tab was not cleaned up'
  )

  stage = 'provider-revoke-isolation'
  const secondBinding = found.find((item) => item.provider === config.secondProvider)
  check(secondBinding, 'Second provider is missing')
  BrowserAccess.bind(secondBinding)
  await BrowserAccess.withPage(
    { provider: secondBinding.provider, target: { kind: 'new' } },
    async (page) => {
      await page.goto(`${location.origin}/target`)
      const revoked = await fetch('/fixture-command', {
        method: 'POST',
        body: JSON.stringify({
          type: 'browser-automation-revoke',
          origin: location.origin,
          provider: binding.provider,
        }),
      }).then((response) => response.json())
      check(revoked.ok, 'Native provider revocation failed')
      check(
        await page.$$eval('li', (nodes) => nodes.length === 2),
        'Revoking provider A disconnected provider B'
      )
    }
  )
  const wrongProvider = crypto.randomUUID()
  BrowserAccess.bind({ ...binding, provider: wrongProvider })
  check(
    await BrowserAccess.tabs(wrongProvider, AbortSignal.timeout(100)).then(
      () => false,
      () => true
    ),
    'Another provider silently substituted for the exact target'
  )
  BrowserAccess.unbind(wrongProvider)
  const probe = async (route: string): Promise<{ count: number; providers: string[] }> => {
    const token = crypto.randomUUID()
    const opened = await fetch('/fixture-command', {
      method: 'POST',
      body: JSON.stringify({
        type: 'fixture-open-probe',
        url: `${config.otherOrigin}${route}?token=${token}`,
      }),
    }).then((response) => response.json())
    check(opened.ok, 'Could not open a separate top-level Web origin')
    const observed = await fetch(`/probe-result?token=${token}`).then((response) => response.json())
    await fetch('/fixture-command', {
      method: 'POST',
      body: JSON.stringify({ type: 'fixture-close-probe', tabId: opened.value.id }),
    })
    return observed
  }
  check(
    (await probe('/unpaired')).count === 0,
    'An unpaired origin on the same permitted host acquired a provider'
  )
  const granted = await fetch('/fixture-command', {
    method: 'POST',
    body: JSON.stringify({
      type: 'browser-automation-grant',
      origin: config.otherOrigin,
      provider: secondBinding.provider,
    }),
  }).then((response) => response.json())
  check(granted.ok, 'Second origin could not be paired dynamically')
  const paired = await probe('/paired')
  check(
    paired.count === 1 && paired.providers[0] === secondBinding.provider,
    'Second origin did not discover its exact authorized provider'
  )
  await fetch('/report', {
    method: 'POST',
    body: JSON.stringify({
      ok: true,
      entries: extracted.entries,
      cases: [
        'provider-revoke-isolation',
        'second-origin-pairing',
        'login-state',
        'page-navigation',
        'dynamic-batch',
        'network-json',
        'new-tab-cleanup',
        'borrowed-tab-preserved',
        'borrowed-tab-exclusion',
        'stale-page',
        'stale-tab-reference',
        'abort-cleanup',
        'exact-provider',
        'exact-origin',
      ],
    }),
  })
  document.querySelector('#status')!.textContent = 'Passed'
}

void main().catch(async (error: unknown) => {
  document.querySelector('#status')!.textContent = String(error)
  await fetch('/report', {
    method: 'POST',
    body: JSON.stringify({
      ok: false,
      error: `${stage}: ${error instanceof Error ? `${error.name}: ${error.message}\n${error.stack}` : String(error)}`,
    }),
  })
})
