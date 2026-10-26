import assert from 'node:assert/strict'
import test from 'node:test'
import {
  configStore,
  MetaConfigSchema,
  WebPeerRuntime,
  readConnectionSettings,
} from '../../packages/core/dist/index.js'

void test('saved connections preserve identity, switch atomically, and survive restart/import', async () => {
  const first = MetaConfigSchema.parse({
    INKCRE_PGREST_URL: 'https://one.example',
    INKCRE_JWT_SECRET: 'fixture-one',
  })
  let persisted = structuredClone(first)
  let rejectWrite = false
  const adapter = {
    name: 'memory',
    read: async () => persisted,
    write: async (value) => {
      if (rejectWrite) throw new Error('disk full')
      persisted = structuredClone(value)
    },
  }
  const connect = WebPeerRuntime.connect.bind(WebPeerRuntime)
  let stopped = 0
  let rejectConnection = false
  WebPeerRuntime.connect = async () => {
    if (rejectConnection) throw new Error('unreachable')
    return {
      runtime: {
        stop() {
          stopped += 1
        },
      },
      peer: { config: {} },
    }
  }
  try {
    await configStore.initializeMeta(adapter)
    const firstId = configStore.connectionSettings.activeConnectionId
    assert.equal(configStore.connectionSettings.connections.length, 1)
    assert.equal(configStore.metaConfig.INKCRE_PEER_ID, first.INKCRE_PEER_ID)
    await configStore.saveMeta()
    const second = MetaConfigSchema.parse({
      INKCRE_PGREST_URL: 'https://two.example',
      INKCRE_JWT_SECRET: 'fixture-two',
    })
    const secondId = crypto.randomUUID()
    await configStore.connectAndSave(second, {}, { id: secondId, name: '工作' })
    assert.equal(persisted.connections.length, 2)
    await configStore.connectAndSave(first, {}, { id: firstId, name: '个人' })
    await configStore.initializeMeta(adapter)
    assert.equal(configStore.connectionSettings.activeConnectionId, firstId)
    assert.equal(configStore.metaConfig.INKCRE_PEER_ID, first.INKCRE_PEER_ID)
    assert.equal(
      configStore.connectionSettings.connections[1].config.INKCRE_PEER_ID,
      second.INKCRE_PEER_ID
    )
    const snapshot = JSON.stringify(persisted)
    rejectConnection = true
    await assert.rejects(configStore.connectAndSave(second, {}, { id: secondId, name: '工作' }))
    assert.equal(JSON.stringify(persisted), snapshot)
    assert.equal(configStore.connectionSettings.activeConnectionId, firstId)
    rejectConnection = false
    rejectWrite = true
    await assert.rejects(configStore.connectAndSave(second, {}, { id: secondId, name: '工作' }))
    assert.equal(stopped, 1)
    assert.equal(configStore.connectionSettings.activeConnectionId, firstId)
    rejectWrite = false
    const exported = JSON.parse(JSON.stringify(configStore.connectionSettings))
    await configStore.resetMeta()
    await configStore.connectAndSave(first, {}, exported.connections[0], exported)
    assert.deepEqual(JSON.parse(JSON.stringify(configStore.connectionSettings)), exported)
    assert.equal(
      readConnectionSettings(first, first).connections[0].config.INKCRE_PEER_ID,
      first.INKCRE_PEER_ID
    )
    persisted = {
      ...first,
      connections: exported.connections,
      activeConnectionId: crypto.randomUUID(),
    }
    await assert.rejects(configStore.initializeMeta(adapter))
    assert.equal(persisted.connections.length, 2)
  } finally {
    WebPeerRuntime.connect = connect
  }
})
