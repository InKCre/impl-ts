import { browser } from 'wxt/browser'
import { parsePublicHTML } from '~/logic/collection/parse-html'

browser.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== browser.runtime.id || sender.tab || message.type !== 'collection-parse-html')
    return
  return Promise.resolve(parsePublicHTML(message.html, message.url))
})
