import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  configStore,
  MetaConfigSchema,
  WebPeerRuntime,
  readConnectionSettings,
} from '../../packages/core/dist/index.js'

void test('saved connection snapshots restore identity and preserve the selection on connection or write failure', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'inkcre-connections-'))
  const file = path.join(directory, 'connections.json')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const priorMeta = configStore.metaConfig
  const priorSettings = configStore.connectionSettings
  const priorPeer = configStore.peerConfig
  const priorAdapter = configStore.metaAdapter
  t.after(() => {
    configStore.metaConfig = priorMeta
    configStore.connectionSettings = priorSettings
    configStore.peerConfig = priorPeer
    configStore.metaAdapter = priorAdapter
  })
  const first = MetaConfigSchema.parse({
    INKCRE_PGREST_URL: 'https://one.example',
    INKCRE_JWT_SECRET: 'fixture-one',
  })
  await writeFile(file, JSON.stringify(first))
  const readSnapshot = async () => JSON.parse(await readFile(file, 'utf8'))
  let rejectWrite = false
  const adapter = {
    name: 'file-fixture',
    read: readSnapshot,
    write: async (value) => {
      if (rejectWrite) throw new Error('disk full')
      await writeFile(file, JSON.stringify(value))
    },
  }
  let stopped = 0
  let rejectConnection = false
  t.mock.method(WebPeerRuntime, 'connect', async () => {
    if (rejectConnection) throw new Error('unreachable')
    return {
      runtime: {
        stop() {
          stopped += 1
        },
      },
      peer: { config: {} },
    }
  })
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
  assert.equal((await readSnapshot()).connections.length, 2)
  await configStore.connectAndSave(first, {}, { id: firstId, name: '个人' })
  // Rebuild runtime state from bytes written by the production store, without old selections.
  configStore.metaConfig = MetaConfigSchema.parse({})
  configStore.connectionSettings = { connections: [], activeConnectionId: null }
  await configStore.initializeMeta(adapter)
  assert.equal(configStore.connectionSettings.activeConnectionId, firstId)
  assert.equal(configStore.metaConfig.INKCRE_PEER_ID, first.INKCRE_PEER_ID)
  assert.equal(
    configStore.connectionSettings.connections[1].config.INKCRE_PEER_ID,
    second.INKCRE_PEER_ID
  )
  const snapshot = await readSnapshot()
  const selectedMeta = JSON.parse(JSON.stringify(configStore.metaConfig))
  rejectConnection = true
  await assert.rejects(configStore.connectAndSave(second, {}, { id: secondId, name: '工作' }), {
    message: 'unreachable',
  })
  assert.deepEqual(await readSnapshot(), snapshot)
  assert.equal(configStore.connectionSettings.activeConnectionId, firstId)
  assert.deepEqual(JSON.parse(JSON.stringify(configStore.metaConfig)), selectedMeta)
  rejectConnection = false
  rejectWrite = true
  await assert.rejects(configStore.connectAndSave(second, {}, { id: secondId, name: '工作' }), {
    message: 'disk full',
  })
  assert.equal(stopped, 1)
  assert.deepEqual(await readSnapshot(), snapshot)
  assert.equal(configStore.connectionSettings.activeConnectionId, firstId)
  assert.deepEqual(JSON.parse(JSON.stringify(configStore.metaConfig)), selectedMeta)
  rejectWrite = false
  const exported = JSON.parse(JSON.stringify(configStore.connectionSettings))
  await configStore.resetMeta()
  await configStore.connectAndSave(first, {}, exported.connections[0], exported)
  assert.deepEqual(JSON.parse(JSON.stringify(configStore.connectionSettings)), exported)
  assert.deepEqual((await readSnapshot()).connections, exported.connections)
  assert.equal(
    readConnectionSettings(first, first).connections[0].config.INKCRE_PEER_ID,
    first.INKCRE_PEER_ID
  )
  const invalid = {
    ...first,
    connections: exported.connections,
    activeConnectionId: crypto.randomUUID(),
  }
  await writeFile(file, JSON.stringify(invalid))
  await assert.rejects(configStore.initializeMeta(adapter), {
    name: 'ZodError',
    message: /Invalid connection selection/,
  })
  assert.deepEqual(await readSnapshot(), invalid)
})
