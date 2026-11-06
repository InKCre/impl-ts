import { browser, type Browser } from 'wxt/browser'
import { z } from 'zod'
import { ExtensionTransport } from 'puppeteer-core/internal/cdp/ExtensionTransport.js'
import {
  BROWSER_AUTOMATION_PORT,
  BROWSER_AUTOMATION_PROTOCOL,
  BrowserBridgeRequestSchema,
  BrowserTabRefSchema,
  type BrowserBridgeRequest,
  type BrowserProviderBinding,
  type BrowserTabRef,
} from '@inkcre/core'
import { connections } from '../collection/store'
import { siteMatchPattern } from '../collection/permissions'

const STORAGE_KEY = 'inkcre-browser-automation-v1'
const StateSchema = z.object({
  instance: z.uuid().default(() => crypto.randomUUID()),
  grants: z.array(z.object({ origin: z.url(), provider: z.uuid() })).default([]),
})
type State = z.infer<typeof StateSchema>
type Port = Browser.runtime.Port
type Session = {
  id: string
  provider: string
  client: string
  port: Port
  tabId: number
  created: boolean
  transport: ExtensionTransport
  detached: boolean
  closing?: Promise<void>
}
const epoch = crypto.randomUUID()
const sessions = new Map<string, Session>()
const occupiedTabs = new Set<number>()
const ports = new Map<Port, string>()
const tabReferences = new Map<string, { tab: BrowserTabRef; port: Port; client: string }>()

export async function automationState(): Promise<State> {
  const stored = await browser.storage.local.get(STORAGE_KEY)
  const state = StateSchema.parse(stored[STORAGE_KEY] ?? {})
  if (!stored[STORAGE_KEY]) await browser.storage.local.set({ [STORAGE_KEY]: state })
  return state
}

function originOf(value: string): string {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只支持 HTTP(S) Web 地址。')
  if (url.username || url.password) throw new Error('Web 地址不能包含凭据。')
  return url.origin
}

export async function grantAutomation(origin: string, provider: string): Promise<void> {
  if (!import.meta.env.CHROME) throw new Error('此浏览器不支持调试自动化；请使用 Chromium。')
  const exactOrigin = originOf(origin)
  if (!(await connections()).some((target) => target.peerId === provider))
    throw new Error('请先为此浏览器配置所选信息库连接。')
  if (!(await browser.permissions.contains({ origins: [siteMatchPattern(exactOrigin)] })))
    throw new Error('请先授权此 Web 站点。')
  const state = await automationState()
  state.grants = [
    ...state.grants.filter((grant) => grant.origin !== exactOrigin || grant.provider !== provider),
    { origin: exactOrigin, provider },
  ]
  await browser.storage.local.set({ [STORAGE_KEY]: state })
  await syncAutomationScripts()
  for (const tab of await browser.tabs.query({})) {
    if (tab.id === undefined || !tab.url || new URL(tab.url).origin !== exactOrigin) continue
    await browser.scripting
      .executeScript({ target: { tabId: tab.id }, files: ['/content-scripts/browser-bridge.js'] })
      .catch(() => undefined)
  }
}

export async function revokeAutomation(origin: string, provider: string): Promise<void> {
  const state = await automationState()
  state.grants = state.grants.filter(
    (grant) => grant.origin !== origin || grant.provider !== provider
  )
  await browser.storage.local.set({ [STORAGE_KEY]: state })
  await Promise.all(
    [...sessions.values()]
      .filter((session) => ports.get(session.port) === origin && session.provider === provider)
      .map((session) => release(session))
  )
  if (!state.grants.some((grant) => grant.origin === origin))
    for (const [port, portOrigin] of ports) if (portOrigin === origin) port.disconnect()
  await syncAutomationScripts()
}

export async function syncAutomationScripts(): Promise<void> {
  const registered = (await browser.scripting.getRegisteredContentScripts())
    .filter((script) => script.id.startsWith('inkcre-browser-'))
    .map((script) => script.id)
  if (registered.length) await browser.scripting.unregisterContentScripts({ ids: registered })
  if (!import.meta.env.CHROME) return
  const state = await automationState()
  const matches: string[] = []
  for (const grant of state.grants) {
    const pattern = siteMatchPattern(grant.origin)
    if (!matches.includes(pattern) && (await browser.permissions.contains({ origins: [pattern] })))
      matches.push(pattern)
  }
  if (!matches.length) return
  await browser.scripting.registerContentScripts([
    {
      id: 'inkcre-browser-bridge-v1',
      matches,
      js: ['content-scripts/browser-bridge.js'],
      runAt: 'document_start',
      allFrames: false,
      persistAcrossSessions: true,
    },
  ])
}

function post(port: Port, value: unknown): void {
  try {
    port.postMessage(value)
  } catch {
    // A disappearing Web page is handled by the Port's disconnect cleanup.
  }
}

function release(session: Session): Promise<void> {
  if (session.closing) return session.closing
  if (!sessions.has(session.id)) return Promise.resolve()
  session.closing = (async () => {
    try {
      await session.transport.close()
    } catch (error) {
      if (!session.detached) throw error
    } finally {
      if (session.created) await browser.tabs.remove(session.tabId).catch(() => undefined)
      sessions.delete(session.id)
      occupiedTabs.delete(session.tabId)
      const state = await automationState()
      post(session.port, {
        protocol: BROWSER_AUTOMATION_PROTOCOL,
        kind: 'event',
        client: session.client,
        provider: session.provider,
        instance: state.instance,
        session: session.id,
        event: 'closed',
      })
    }
  })()
  return session.closing
}

async function providers(origin: string): Promise<BrowserProviderBinding[]> {
  const state = await automationState()
  const targets = await connections()
  const allowed = state.grants.filter((grant) => grant.origin === origin)
  if (!(await browser.permissions.contains({ origins: [siteMatchPattern(origin)] }))) return []
  return targets
    .filter((target) => allowed.some((grant) => grant.provider === target.peerId))
    .map((target) => ({
      provider: target.peerId,
      instance: state.instance,
      name: target.name,
      extensionVersion: browser.runtime.getManifest().version,
      protocol: 1,
    }))
}

function tabRef(tab: Browser.tabs.Tab, binding: BrowserProviderBinding): BrowserTabRef {
  if (tab.id === undefined) throw new Error('浏览器未返回标签页身份。')
  return {
    provider: binding.provider,
    instance: binding.instance,
    epoch,
    reference: crypto.randomUUID(),
    tabId: tab.id,
    title: tab.title,
    url: tab.url,
  }
}

async function dispatch(
  port: Port,
  request: BrowserBridgeRequest,
  binding: BrowserProviderBinding
): Promise<unknown> {
  if (request.operation === 'tabs') {
    for (const [reference, issued] of tabReferences)
      if (issued.port === port && issued.client === request.client) tabReferences.delete(reference)
    const tabs = (await browser.tabs.query({}))
      .filter((tab) => tab.id !== port.sender?.tab?.id && tab.url && /^https?:\/\//.test(tab.url))
      .map((tab) => tabRef(tab, binding))
    for (const tab of tabs) tabReferences.set(tab.reference, { tab, port, client: request.client })
    return tabs
  }

  if (request.operation === 'open') {
    const parameters = z
      .object({
        session: z.uuid(),
        target: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('new') }),
          z.object({ kind: z.literal('existing'), tab: BrowserTabRefSchema }),
        ]),
      })
      .parse(request.parameters)
    if (sessions.has(parameters.session)) throw new Error('浏览器会话身份已被使用。')
    const created = parameters.target.kind === 'new'
    if (parameters.target.kind === 'existing') {
      const ref = parameters.target.tab
      if (
        ref.provider !== binding.provider ||
        ref.instance !== binding.instance ||
        ref.epoch !== epoch
      )
        throw new Error('标签页引用已过期或属于其他浏览器。')
      const issued = tabReferences.get(ref.reference)
      if (
        !issued ||
        issued.port !== port ||
        issued.client !== request.client ||
        issued.tab.tabId !== ref.tabId
      )
        throw new Error('标签页引用已经使用或过期，请刷新标签页列表。')
      if (ref.tabId === port.sender?.tab?.id)
        throw new Error('不能控制正在运行此 Source 的 Web 标签页。')
      if (occupiedTabs.has(ref.tabId)) throw new Error('此标签页正在被另一个自动化会话使用。')
      for (const [reference, issued] of tabReferences)
        if (issued.tab.tabId === ref.tabId) tabReferences.delete(reference)
      occupiedTabs.add(ref.tabId)
    }
    let tab: Browser.tabs.Tab | undefined
    let transport: ExtensionTransport | undefined
    try {
      tab = created
        ? await browser.tabs.create({ url: 'about:blank', active: true })
        : await browser.tabs.update(
            parameters.target.kind === 'existing' ? parameters.target.tab.tabId : -1,
            { active: true }
          )
      if (!tab || tab.id === undefined) throw new Error('无法取得浏览器标签页。')
      occupiedTabs.add(tab.id)
      transport = await ExtensionTransport.connectTab(tab.id)
      const session: Session = {
        id: parameters.session,
        provider: binding.provider,
        client: request.client,
        port,
        tabId: tab.id,
        created,
        transport,
        detached: false,
      }
      sessions.set(session.id, session)
      transport.onmessage = (data) =>
        post(port, {
          protocol: BROWSER_AUTOMATION_PROTOCOL,
          kind: 'event',
          client: request.client,
          provider: binding.provider,
          instance: binding.instance,
          session: session.id,
          event: 'message',
          data,
        })
      transport.onclose = () => void release(session)
      if (!ports.has(port)) {
        await release(session)
        throw new Error('调用页面已断开，浏览器会话已释放。')
      }
      return { session: session.id, tab: tabRef(tab, binding) }
    } catch (error) {
      if (tab?.id !== undefined) {
        occupiedTabs.delete(tab.id)
        await transport?.close()
        if (created) await browser.tabs.remove(tab.id).catch(() => undefined)
      } else if (parameters.target.kind === 'existing')
        occupiedTabs.delete(parameters.target.tab.tabId)
      throw error
    }
  }

  const sessionId = z.uuid().parse(request.parameters.session)
  const session = sessions.get(sessionId)
  if (!session) {
    if (request.operation === 'close') return null
    throw new Error('浏览器会话已结束，旧引用不能再次执行。')
  }
  if (
    session.port !== port ||
    session.client !== request.client ||
    session.provider !== binding.provider
  )
    throw new Error('此浏览器会话属于另一个调用者。')
  if (request.operation === 'close') {
    await release(session)
    return null
  }
  if (request.operation === 'cdp') {
    if (session.closing) throw new Error('浏览器会话正在释放。')
    session.transport.send(z.string().parse(request.parameters.message))
    return null
  }
  throw new Error('不支持的浏览器操作。')
}

async function handle(port: Port, origin: string, request: BrowserBridgeRequest): Promise<void> {
  const available = await providers(origin)
  if (request.operation === 'discover') {
    for (const binding of available)
      post(port, {
        protocol: BROWSER_AUTOMATION_PROTOCOL,
        kind: 'response',
        client: request.client,
        request: request.request,
        provider: binding.provider,
        instance: binding.instance,
        ok: true,
        value: binding,
      })
    return
  }
  const binding = available.find(
    (item) => item.provider === request.provider && item.instance === request.instance
  )
  if (!binding) return
  try {
    if (!import.meta.env.CHROME) throw new Error('此浏览器不支持调试自动化。')
    const value = await dispatch(port, request, binding)
    post(port, {
      ...request,
      kind: 'response',
      provider: binding.provider,
      instance: binding.instance,
      ok: true,
      value,
    })
  } catch (error) {
    post(port, {
      ...request,
      kind: 'response',
      provider: binding.provider,
      instance: binding.instance,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export function initializeBrowserAutomation(): void {
  void syncAutomationScripts().catch((error) =>
    console.error('Browser bridge initialization failed:', error)
  )
  browser.runtime.onMessage.addListener((raw: unknown, sender) => {
    if (!raw || typeof raw !== 'object' || !('type' in raw)) return
    if (!String(raw.type).startsWith('browser-automation-')) return
    if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('/')))
      return Promise.resolve({ ok: false, error: '仅扩展设置页面可修改浏览器授权。' })
    const message = raw as { type: string; origin?: string; provider?: string }
    const execute = async () => {
      if (message.type === 'browser-automation-grant')
        await grantAutomation(z.string().parse(message.origin), z.uuid().parse(message.provider))
      else if (message.type === 'browser-automation-revoke')
        await revokeAutomation(z.string().parse(message.origin), z.uuid().parse(message.provider))
      else if (message.type !== 'browser-automation-state') throw new Error('未知浏览器设置操作。')
      return automationState()
    }
    return execute().then(
      (value) => ({ ok: true, value }),
      (error: unknown) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    )
  })
  browser.runtime.onConnect.addListener((port) => {
    const sender = port.sender
    if (
      port.name !== BROWSER_AUTOMATION_PORT ||
      sender?.id !== browser.runtime.id ||
      sender.frameId !== 0 ||
      sender.tab?.id === undefined ||
      !sender.url
    )
      return
    let origin: string
    try {
      origin = originOf(sender.url)
    } catch {
      port.disconnect()
      return
    }
    ports.set(port, origin)
    // Opening and closing are serialized per page; CDP traffic must keep flowing concurrently.
    let lifecycle = Promise.resolve()
    port.onMessage.addListener((raw: unknown) => {
      const parsed = BrowserBridgeRequestSchema.safeParse(raw)
      if (!parsed.success) return
      const run = () => handle(port, origin, parsed.data)
      if (parsed.data.operation === 'open' || parsed.data.operation === 'close') {
        lifecycle = lifecycle.then(run).catch(() => undefined)
      } else void run().catch(() => undefined)
    })
    port.onDisconnect.addListener(() => {
      ports.delete(port)
      for (const [reference, issued] of tabReferences)
        if (issued.port === port) tabReferences.delete(reference)
      for (const session of sessions.values()) if (session.port === port) void release(session)
    })
  })
  if (import.meta.env.CHROME)
    browser.debugger.onDetach.addListener((source) => {
      for (const session of sessions.values()) {
        if (session.tabId !== source.tabId) continue
        session.detached = true
        void release(session).catch(() => undefined)
      }
    })
  browser.permissions.onRemoved.addListener(() => {
    void syncAutomationScripts()
    for (const session of sessions.values()) {
      const origin = ports.get(session.port)
      if (origin)
        void providers(origin).then((available) => {
          if (!available.some((binding) => binding.provider === session.provider))
            void release(session)
        })
    }
  })
}
