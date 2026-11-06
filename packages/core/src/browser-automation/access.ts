import type {
  Browser,
  ConnectionTransport,
  Page,
} from 'puppeteer-core/lib/puppeteer/puppeteer-core-browser.js'
import { configStore } from '../config'
import type { PeerRef } from '../peer/peer'
import {
  BROWSER_AUTOMATION_PROTOCOL,
  BrowserBridgeEventSchema,
  BrowserBridgeResponseSchema,
  BrowserProviderBindingSchema,
  BrowserTabRefSchema,
  type BrowserBridgeEvent,
  type BrowserBridgeRequest,
  type BrowserProviderBinding,
  type BrowserTabRef,
} from './protocol'

export type BrowserPage = Page
export type BrowserPageOptions = {
  provider: PeerRef
  target: { kind: 'new' } | { kind: 'existing'; tab: BrowserTabRef }
  signal?: AbortSignal
}

export class BrowserAutomationError extends Error {
  override name = 'BrowserAutomationError'
}

const requests = new Map<
  string,
  { binding: BrowserProviderBinding; resolve(value: unknown): void; reject(error: Error): void }
>()
const sessions = new Map<string, RelayTransport>()
const discoveries = new Set<(binding: BrowserProviderBinding) => void>()
let client: string | undefined

function clientId(): string {
  if (client) return client
  if (typeof window === 'undefined')
    throw new BrowserAutomationError('浏览器能力需要 Web 页面运行时。')
  client = crypto.randomUUID()
  window.addEventListener('message', receive)
  return client
}

function receive(event: MessageEvent<unknown>): void {
  if (event.source !== window || event.origin !== window.location.origin) return
  const response = BrowserBridgeResponseSchema.safeParse(event.data)
  if (response.success && response.data.client === client) {
    const reply = response.data
    const pending = requests.get(reply.request)
    if (pending) {
      const exactProvider =
        pending.binding.provider === reply.provider && pending.binding.instance === reply.instance
      if (!exactProvider) return
      if (reply.ok) pending.resolve(reply.value)
      else pending.reject(new BrowserAutomationError(reply.error ?? '浏览器操作失败。'))
    } else if (reply.ok) {
      const binding = BrowserProviderBindingSchema.safeParse(reply.value)
      if (binding.success) for (const observe of discoveries) observe(binding.data)
    }
    return
  }
  const incoming = BrowserBridgeEventSchema.safeParse(event.data)
  if (!incoming.success || incoming.data.client !== client) return
  sessions.get(incoming.data.session)?.receive(incoming.data)
}

function bindingKey(): string {
  const { INKCRE_PEER_ID, INKCRE_PGREST_URL } = configStore.metaConfig
  if (!INKCRE_PEER_ID || !INKCRE_PGREST_URL)
    throw new BrowserAutomationError('请先连接信息库，再配置本 Peer 的浏览器绑定。')
  return `inkcre.browser-bindings.v1:${INKCRE_PGREST_URL}:${INKCRE_PEER_ID}`
}

function bindingFor(provider: PeerRef): BrowserProviderBinding {
  const binding = BrowserAccess.bindings().find((item) => item.provider === provider)
  if (!binding) throw new BrowserAutomationError('本 Web Peer 尚未绑定所选浏览器。')
  return binding
}

function request(
  binding: BrowserProviderBinding,
  operation: BrowserBridgeRequest['operation'],
  parameters: Record<string, unknown> = {},
  signal?: AbortSignal
): Promise<unknown> {
  signal?.throwIfAborted()
  const id = crypto.randomUUID()
  const pageClient = clientId()
  return new Promise((resolve, reject) => {
    const finish = (error?: Error, value?: unknown) => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      requests.delete(id)
      if (error) reject(error)
      else resolve(value)
    }
    const abort = () => finish(new BrowserAutomationError('浏览器操作已取消。'))
    const timeout = setTimeout(
      () =>
        finish(
          new BrowserAutomationError('浏览器桥未响应；已发送操作的结果可能未知，请勿自动重放。')
        ),
      15_000
    )
    requests.set(id, {
      binding,
      resolve: (value) => finish(undefined, value),
      reject: (error) => finish(error),
    })
    signal?.addEventListener('abort', abort, { once: true })
    window.postMessage(
      {
        protocol: BROWSER_AUTOMATION_PROTOCOL,
        kind: 'request',
        client: pageClient,
        request: id,
        provider: binding.provider,
        instance: binding.instance,
        operation,
        parameters,
      } satisfies BrowserBridgeRequest,
      window.location.origin
    )
  })
}

class RelayTransport implements ConnectionTransport {
  onmessage?: (message: string) => void
  onclose?: () => void
  private closed = false

  constructor(
    readonly binding: BrowserProviderBinding,
    readonly session: string
  ) {
    sessions.set(session, this)
  }

  send(message: string): void {
    if (this.closed) throw new BrowserAutomationError('此浏览器会话已经结束。')
    void request(this.binding, 'cdp', { session: this.session, message }).catch(() => this.close())
  }

  receive(event: BrowserBridgeEvent): void {
    if (
      this.closed ||
      event.provider !== this.binding.provider ||
      event.instance !== this.binding.instance
    )
      return
    if (event.event === 'closed') this.close()
    else if (event.data !== undefined) this.onmessage?.(event.data)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    sessions.delete(this.session)
    this.onclose?.()
  }
}

/** Local binding is an execution scope, independent of current browser connectivity or login. */
export class BrowserAccess {
  static bindings(): BrowserProviderBinding[] {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(bindingKey()) ?? '[]')
      return BrowserProviderBindingSchema.array().parse(raw)
    } catch {
      return []
    }
  }

  static hasBinding(provider: PeerRef): boolean {
    return this.bindings().some((item) => item.provider === provider && item.protocol === 1)
  }

  static bind(binding: BrowserProviderBinding): void {
    const parsed = BrowserProviderBindingSchema.parse(binding)
    localStorage.setItem(
      bindingKey(),
      JSON.stringify([
        ...this.bindings().filter((item) => item.provider !== parsed.provider),
        parsed,
      ])
    )
  }

  static unbind(provider: PeerRef): void {
    localStorage.setItem(
      bindingKey(),
      JSON.stringify(this.bindings().filter((item) => item.provider !== provider))
    )
  }

  /** Discover only extensions whose settings explicitly authorized this exact Web origin. */
  static async discover(signal?: AbortSignal): Promise<BrowserProviderBinding[]> {
    signal?.throwIfAborted()
    const found = new Map<string, BrowserProviderBinding>()
    const pageClient = clientId()
    const observe = (binding: BrowserProviderBinding) => found.set(binding.provider, binding)
    discoveries.add(observe)
    try {
      window.postMessage(
        {
          protocol: BROWSER_AUTOMATION_PROTOCOL,
          kind: 'request',
          client: pageClient,
          request: crypto.randomUUID(),
          operation: 'discover',
          parameters: {},
        } satisfies BrowserBridgeRequest,
        window.location.origin
      )
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer)
          reject(signal?.reason)
        }
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', abort)
          resolve()
        }, 1000)
        signal?.addEventListener('abort', abort, { once: true })
      })
      return [...found.values()]
    } finally {
      discoveries.delete(observe)
    }
  }

  static async tabs(provider: PeerRef, signal?: AbortSignal): Promise<BrowserTabRef[]> {
    return BrowserTabRefSchema.array().parse(
      await request(bindingFor(provider), 'tabs', {}, signal)
    )
  }

  static async withPage<T>(
    options: BrowserPageOptions,
    action: (page: Page) => Promise<T>
  ): Promise<T> {
    options.signal?.throwIfAborted()
    const binding = bindingFor(options.provider)
    // Opening is not cancellable midway: learn the session identity before releasing it.
    const session = crypto.randomUUID()
    try {
      await request(binding, 'open', { session, target: options.target })
    } catch (error) {
      await request(binding, 'close', { session }).catch(() => undefined)
      throw error
    }
    const transport = new RelayTransport(binding, session)
    let releasing: Promise<unknown> | undefined
    const release = () => {
      releasing ??= request(binding, 'close', { session })
      return releasing
    }
    const abort = () => {
      transport.close()
      void release().catch(() => undefined)
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    let browser: Browser | undefined
    try {
      options.signal?.throwIfAborted()
      // The pinned CDP entry avoids the browser entry's Node channel/BiDi import graph.
      const { _connectToCdpBrowser } =
        await import('puppeteer-core/internal/cdp/BrowserConnector.js')
      browser = await _connectToCdpBrowser(
        transport,
        '',
        { defaultViewport: null, protocolTimeout: 30_000 },
        () => undefined
      )
      const [page] = await browser.pages()
      if (!page) throw new BrowserAutomationError('浏览器没有返回可控制页面。')
      options.signal?.throwIfAborted()
      const result = await action(page)
      options.signal?.throwIfAborted()
      return result
    } finally {
      options.signal?.removeEventListener('abort', abort)
      // Await the callback before cleanup; an abort does not roll back already dispatched effects.
      try {
        await release()
      } finally {
        transport.close()
        await browser?.disconnect()
      }
    }
  }
}
