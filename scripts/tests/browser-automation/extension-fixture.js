// This page runs in the copied extension so the web driver does not claim its debugger.
const { appOrigin, otherOrigin } = Object.fromEntries(new URLSearchParams(location.search))

async function message(request) {
  const response = await chrome.runtime.sendMessage(request)
  if (!response?.ok) throw new Error(response?.error ?? 'Collection background did not answer')
  return response.value
}

async function run() {
  const providers = []
  for (const name of ['First fixture browser', 'Second fixture browser']) {
    const id = await message({
      type: 'collection-connect',
      connection: {
        name,
        url: appOrigin + '/unused-database',
        secret: 'synthetic-browser-automation-credential',
        storageId: -4,
      },
    })
    const { connections } = await message({ type: 'collection-status' })
    const provider = connections.find((item) => item.id === id).peerId
    await message({ type: 'browser-automation-grant', origin: appOrigin, provider })
    providers.push(provider)
  }
  const query = new URLSearchParams({
    provider: providers[0],
    secondProvider: providers[1],
    otherOrigin,
  })
  await chrome.tabs.create({ url: appOrigin + '/borrowed', active: false })
  await chrome.tabs.create({ url: appOrigin + '/app?' + query, active: false })
  for (;;) {
    const command = await fetch(appOrigin + '/fixture-next').then((response) => response.json())
    if (command) {
      let reply
      if (command.message.type === 'fixture-open-probe')
        reply = {
          ok: true,
          value: await chrome.tabs.create({ url: command.message.url, active: false }),
        }
      else if (command.message.type === 'fixture-close-probe') {
        await chrome.tabs.remove(command.message.tabId)
        reply = { ok: true }
      } else reply = await chrome.runtime.sendMessage(command.message)
      await fetch(appOrigin + '/fixture-reply', {
        method: 'POST',
        body: JSON.stringify({ id: command.id, reply }),
      })
    }
    const { complete } = await fetch(appOrigin + '/state').then((response) => response.json())
    if (complete) {
      const targets = await chrome.debugger.getTargets()
      const attached = targets
        .filter((target) => target.attached)
        .map(({ id, tabId, url }) => ({ id, tabId, url }))
      await fetch(appOrigin + '/native-report', {
        method: 'POST',
        body: JSON.stringify({ attached }),
      })
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

void run().catch(async (error) => {
  await fetch(appOrigin + '/report', {
    method: 'POST',
    body: JSON.stringify({ ok: false, error: error.stack }),
  })
  await fetch(appOrigin + '/native-report', { method: 'POST', body: '{}' })
})
