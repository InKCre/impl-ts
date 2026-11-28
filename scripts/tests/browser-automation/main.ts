import { BrowserAccess, configStore, MetaConfigSchema } from '@inkcre/core'

let stage = 'discover'

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

async function rejectsWith(operation: Promise<unknown>, name: string, message: RegExp) {
  const failure: unknown = await operation.then(
    () => undefined,
    (error: unknown) => error
  )
  check(
    failure instanceof Error && failure.name === name && message.test(failure.message),
    `Expected ${name} matching ${message}, received ${String(failure)}`
  )
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
  const query = new URLSearchParams(location.search)
  const provider = query.get('provider')
  const secondProvider = query.get('secondProvider')
  const otherOrigin = query.get('otherOrigin')
  check(provider && secondProvider && otherOrigin, 'Missing fixture provider or origin')
  configStore.metaConfig = MetaConfigSchema.parse({
    INKCRE_PGREST_URL: `${location.origin}/unused-database`,
    INKCRE_PEER_ID: crypto.randomUUID(),
  })
  const found = await BrowserAccess.discover()
  check(found.length === 2, `Expected two authorized providers, found ${found.length}`)
  const binding = found.find((item) => item.provider === provider)
  check(binding, 'The authorized provider was not discovered')
  BrowserAccess.bind(binding)
  check(BrowserAccess.hasBinding(binding.provider), 'Explicit binding is not available to Sources')
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
  check(
    JSON.stringify(extracted.body) === JSON.stringify({ entries: ['three', 'four'] }),
    'Network response body did not cross the bridge'
  )
  check(
    (await BrowserAccess.tabs(binding.provider)).length === baseline.length,
    'Owned tab was not closed'
  )
  stage = 'stale-page'
  const staleFailure: unknown = await stalePage!.evaluate('1').then(
    () => undefined,
    (error: unknown) => error
  )
  // Puppeteer may finish frame teardown before the stale command reaches its closed session.
  const closedSession =
    staleFailure instanceof Error &&
    staleFailure.name === 'TargetCloseError' &&
    /Session closed/.test(staleFailure.message)
  const detachedFrame =
    staleFailure instanceof Error &&
    staleFailure.name === 'Error' &&
    /^Attempted to use detached Frame '[^']+'\.$/.test(staleFailure.message)
  check(
    closedSession || detachedFrame,
    `Expected a closed session or detached frame, received ${String(staleFailure)}`
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
      await rejectsWith(
        BrowserAccess.withPage(
          { provider: binding.provider, target: { kind: 'existing', tab: busyTab } },
          async () => null
        ),
        'BrowserAutomationError',
        /此标签页正在被另一个自动化会话使用/
      )
    }
  )
  check(
    (await BrowserAccess.tabs(binding.provider)).some(
      (tab) => tab.tabId === borrowed.tabId && tab.title === 'borrowed-preserved'
    ),
    'Borrowed tab was closed'
  )
  await rejectsWith(
    BrowserAccess.withPage(
      { provider: binding.provider, target: { kind: 'existing', tab: borrowed } },
      async () => null
    ),
    'BrowserAutomationError',
    /标签页引用已经使用或过期/
  )

  const controller = new AbortController()
  const abortReason = new Error('fixture cancelled the active callback')
  stage = 'abort'
  let releaseCallback = () => {}
  const callbackGate = new Promise<void>((resolve) => {
    releaseCallback = resolve
  })
  let reportCallbackClosing = () => {}
  const callbackClosing = new Promise<void>((resolve) => {
    reportCallbackClosing = resolve
  })
  let callbackExited = false
  let cancelledSettled = false
  const cancelled = BrowserAccess.withPage(
    { provider: binding.provider, target: { kind: 'new' }, signal: controller.signal },
    async (page) => {
      await page.goto(`${location.origin}/target`)
      await page.waitForSelector('#more')
      const waiting = page.waitForSelector('#never', { timeout: 0 })
      controller.abort(abortReason)
      try {
        check(
          await waiting.then(
            () => false,
            () => true
          ),
          'Abort did not interrupt the pending Page operation'
        )
      } finally {
        reportCallbackClosing()
        await callbackGate
        callbackExited = true
      }
    }
  )
  const cancellationResult = cancelled.then(
    () => {
      cancelledSettled = true
      return undefined
    },
    (error: unknown) => {
      cancelledSettled = true
      return error
    }
  )
  await Promise.race([
    callbackClosing,
    cancellationResult.then((error) => {
      throw new Error('withPage ended before reaching callback cleanup', { cause: error })
    }),
  ])
  try {
    // A native round trip lets cancellation propagate while the callback is still held.
    await BrowserAccess.tabs(binding.provider)
    check(!cancelledSettled, 'withPage settled before the active callback exited')
  } finally {
    releaseCallback()
  }
  check((await cancellationResult) === abortReason, 'Abort did not preserve its target reason')
  check(callbackExited, 'Abort completed without waiting for the callback to exit')
  check(
    (await BrowserAccess.tabs(binding.provider)).length === baseline.length,
    'Aborted owned tab was not cleaned up'
  )

  stage = 'provider-revoke-isolation'
  const secondBinding = found.find((item) => item.provider === secondProvider)
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
  const stillAuthorized = await BrowserAccess.discover()
  check(
    stillAuthorized.length === 1 && stillAuthorized[0]?.provider === secondProvider,
    'Discovery did not reflect the provider-specific revocation'
  )
  const wrongProvider = crypto.randomUUID()
  BrowserAccess.bind({ ...binding, provider: wrongProvider })
  const wrongProviderSignal = AbortSignal.timeout(100)
  await rejectsWith(
    BrowserAccess.tabs(wrongProvider, wrongProviderSignal),
    'BrowserAutomationError',
    /浏览器操作已取消/
  )
  check(wrongProviderSignal.aborted, 'Exact-provider probe failed before its deadline')
  check(
    (await BrowserAccess.tabs(secondBinding.provider)).some((tab) => tab.tabId === borrowed.tabId),
    'Exact-provider rejection was caused by a broken authorized bridge'
  )
  BrowserAccess.unbind(wrongProvider)
  const probe = async (route: string): Promise<{ count: number; providers: string[] }> => {
    const token = crypto.randomUUID()
    const opened = await fetch('/fixture-command', {
      method: 'POST',
      body: JSON.stringify({
        type: 'fixture-open-probe',
        url: `${otherOrigin}${route}?token=${token}`,
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
      origin: otherOrigin,
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
