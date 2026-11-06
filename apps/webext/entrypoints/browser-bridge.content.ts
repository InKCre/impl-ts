import { browser, type Browser } from 'wxt/browser'
import {
  BROWSER_AUTOMATION_PORT,
  BROWSER_AUTOMATION_PROTOCOL,
  BrowserBridgeRequestSchema,
  BrowserBridgeResponseSchema,
  BrowserBridgeEventSchema,
  type BrowserBridgeRequest,
  type BrowserBridgeEvent,
} from '@inkcre/core/browser-automation/protocol'

export default defineContentScript({
  matches: [],
  registration: 'runtime',
  main(ctx) {
    // Granting a second information-base binding may inject the bridge again in the same page.
    const marker = '__inkcreBrowserBridgeV1'
    const scope = globalThis as typeof globalThis & { [marker]?: boolean }
    if (scope[marker]) return
    scope[marker] = true
    let port: Browser.runtime.Port | undefined
    const pending = new Map<string, BrowserBridgeRequest>()
    const sessions = new Map<string, Omit<BrowserBridgeEvent, 'event'>>()
    const disconnected = () => {
      for (const request of pending.values()) {
        if (!request.provider || !request.instance) continue
        window.postMessage(
          {
            ...request,
            kind: 'response',
            ok: false,
            error: '浏览器桥已断开；已发送操作的结果可能未知。',
          },
          location.origin
        )
      }
      for (const session of sessions.values())
        window.postMessage({ ...session, event: 'closed' }, location.origin)
      pending.clear()
      sessions.clear()
      port = undefined
    }
    ctx.addEventListener(window, 'message', (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== location.origin) return
      const request = BrowserBridgeRequestSchema.safeParse(event.data)
      if (!request.success) return
      if (!port) {
        port = browser.runtime.connect({ name: BROWSER_AUTOMATION_PORT })
        port.onMessage.addListener((reply: unknown) => {
          const response = BrowserBridgeResponseSchema.safeParse(reply)
          if (response.success) {
            const outgoing = pending.get(response.data.request)
            const opened = response.data.value as { session?: string } | undefined
            if (outgoing?.operation === 'open' && response.data.ok && opened?.session)
              sessions.set(opened.session, {
                protocol: BROWSER_AUTOMATION_PROTOCOL,
                kind: 'event',
                client: response.data.client,
                provider: response.data.provider,
                instance: response.data.instance,
                session: opened.session,
              })
            pending.delete(response.data.request)
          }
          const event = BrowserBridgeEventSchema.safeParse(reply)
          if (event.success && event.data.event === 'closed') sessions.delete(event.data.session)
          window.postMessage(reply, location.origin)
        })
        port.onDisconnect.addListener(disconnected)
      }
      try {
        pending.set(request.data.request, request.data)
        port.postMessage(request.data)
      } catch {
        disconnected()
      }
    })
    ctx.addEventListener(window, 'pagehide', () => port?.disconnect())
    ctx.onInvalidated(() => {
      port?.disconnect()
      delete scope[marker]
    })
  },
})
