import { browser } from 'wxt/browser'
import {
  handleCollectionMessage,
  handlesCollectionMessage,
  initializeCollection,
  refreshPeers,
  syncAutomaticScripts,
  wakeWork,
} from '~/logic/collection/runtime'

export default defineBackground(() => {
  const initialized = initializeCollection()
  initialized
    .then(() => Promise.all([wakeWork(), refreshPeers()]))
    .catch((error) => console.error('Collection startup failed:', error))
  browser.runtime.onMessage.addListener((message, sender) => {
    if (!handlesCollectionMessage(message)) return
    return initialized
      .then(() => handleCollectionMessage(message, sender))
      .then(
        (value) => ({ ok: true, value }),
        (error: unknown) => ({
          ok: false,
          error:
            error && typeof error === 'object' && 'message' in error
              ? String(error.message)
              : String(error),
        })
      )
  })
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'inkcre-collection')
      void initialized
        .then(() => Promise.all([wakeWork(), refreshPeers()]))
        .catch((error) => console.error('Collection batch failed:', error))
  })
  browser.permissions.onRemoved.addListener(() => {
    void initialized.then(() => syncAutomaticScripts())
  })
})
