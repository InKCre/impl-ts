import { browser } from 'wxt/browser'
import { capturePage } from '~/logic/collection/capture'
import { collectionMessage } from '~/logic/collection/messages'

export default defineContentScript({
  matches: [],
  registration: 'runtime',
  main(ctx) {
    let route = location.href
    let previous = ''
    let delay = 30_000
    let timer: number | undefined
    let running = false
    function routeObservation() {
      if (route !== location.href) {
        route = location.href
        previous = ''
        delay = 1_000
      }
    }
    async function observe(final = false) {
      if (running || (!final && document.visibilityState !== 'visible')) return
      running = true
      try {
        routeObservation()
        const allowed = await collectionMessage<{ allowed: boolean }>({
          type: 'collection-auto-allowed',
        })
        if (!allowed?.allowed) {
          delay = 300_000
          return
        }
        const capture = capturePage(false)
        const fingerprint = JSON.stringify({
          parts: capture.parts,
          url: capture.material.url,
          title: capture.material.title,
        })
        if (previous !== fingerprint) {
          const result = (await browser.runtime.sendMessage({
            type: 'collection-observe',
            capture,
          })) as { ok?: boolean; value?: unknown }
          if (result?.ok && result.value) previous = fingerprint
          delay = 30_000
        } else delay = Math.min(delay * 2, 300_000)
      } catch (error) {
        await browser.runtime
          .sendMessage({
            type: 'collection-observation-error',
            error: error instanceof Error ? error.message : String(error),
          })
          .catch(() => undefined)
      } finally {
        running = false
        if (!final && document.visibilityState === 'visible') schedule(delay)
      }
    }
    function schedule(milliseconds: number) {
      if (timer) clearTimeout(timer)
      timer = ctx.setTimeout(() => void observe(), milliseconds)
    }
    const onMessage: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (
      message,
      sender
    ) => {
      if (sender.id !== browser.runtime.id) return
      if (message.type === 'collection-capture') {
        routeObservation()
        return Promise.resolve(capturePage(message.selection === true))
      }
    }
    browser.runtime.onMessage.addListener(onMessage)
    ctx.onInvalidated(() => browser.runtime.onMessage.removeListener(onMessage))
    ctx.addEventListener(window, 'wxt:locationchange', () => schedule(1_000))
    ctx.addEventListener(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        if (timer) clearTimeout(timer)
        void observe(true)
      } else schedule(1_000)
    })
    ctx.addEventListener(window, 'pagehide', () => void observe(true))
    ctx.addEventListener(window, 'pageshow', () => schedule(1_000))
    schedule(1_000)
  },
})
