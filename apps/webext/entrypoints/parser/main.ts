import { extractPage } from '@inkcre/web-collection/extract'
import { browser } from 'wxt/browser'

browser.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== browser.runtime.id || sender.tab || message.type !== 'collection-parse-html')
    return
  return Promise.resolve().then(() => extractPage(message.html, message.url))
})
