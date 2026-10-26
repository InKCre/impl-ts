import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { store } from '../store'
import type { ConfigAdapterWithWrite } from './types'
import { MetaConfigSchema, PeerConfigSchema, type MetaConfig, type PeerConfig } from './schema'
import {
  ConnectionSettingsSchema,
  readConnectionSettings,
  type ConnectionSettings,
} from './connections'
import type { WebPeerIdentity } from '../peer/runtime'

// Lazy import Peer to avoid circular imports
const lazyPeer = async () => (await import('../peer/peer')).Peer
const lazyWebPeerRuntime = async () => (await import('../peer/runtime')).WebPeerRuntime

const unconfiguredAdapter: ConfigAdapterWithWrite = {
  name: 'unconfigured',
  read: async () => ({}),
  write: async () => {
    throw new Error('[Config] Initialize a runtime-owned meta adapter before saving.')
  },
}

/**
 * Config store, includes metaConfig and peerConfig, managing their loading and saving.
 */
export const useConfigStore = defineStore('inkcre-config', () => {
  const metaAdapter = shallowRef<ConfigAdapterWithWrite>(unconfiguredAdapter)
  const metaConfig = ref<MetaConfig>(MetaConfigSchema.parse({}))
  const peerConfig = ref<PeerConfig>(PeerConfigSchema.parse({}))
  const connectionSettings = ref<ConnectionSettings>({ connections: [], activeConnectionId: null })
  const isLoading = ref(false)
  const error = ref<Error | null>(null)

  async function initializeMeta(adapter: ConfigAdapterWithWrite): Promise<void> {
    metaAdapter.value = adapter
    isLoading.value = true
    error.value = null

    try {
      const stored = await adapter.read()
      const current = MetaConfigSchema.parse(stored)
      const settings = readConnectionSettings(stored, current)
      connectionSettings.value = settings
      metaConfig.value =
        settings.connections.find((item) => item.id === settings.activeConnectionId)?.config ??
        current
    } catch (err) {
      error.value = err as Error
      console.error('[Config] Failed to initialize meta config.')
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function loadPeerConfig(): Promise<void> {
    if (!metaConfig.value.INKCRE_PGREST_URL || !metaConfig.value.INKCRE_JWT_SECRET) {
      peerConfig.value = PeerConfigSchema.parse({})
      return
    }

    const Peer = await lazyPeer()
    try {
      const loaded = await Peer.getSelf()
      peerConfig.value = PeerConfigSchema.parse(loaded.config)
    } catch {
      peerConfig.value = PeerConfigSchema.parse({})
      console.error('[Config] Failed to load Peer config.')
    }
  }

  async function saveMeta(): Promise<void> {
    error.value = null
    try {
      const settings = ConnectionSettingsSchema.parse(connectionSettings.value)
      settings.connections = settings.connections.map((item) =>
        item.id === settings.activeConnectionId
          ? { ...item, config: MetaConfigSchema.parse(metaConfig.value) }
          : item
      )
      await metaAdapter.value.write({ ...metaConfig.value, ...settings })
      connectionSettings.value = settings
    } catch (err) {
      error.value = err as Error
      console.error('[Config] Failed to save meta config:', err)
      throw err
    }
  }

  async function connectAndSave(
    metaCandidate: MetaConfig,
    identity: WebPeerIdentity,
    selection?: { id: string; name: string },
    imported?: ConnectionSettings
  ) {
    error.value = null
    const nextMeta = MetaConfigSchema.parse(metaCandidate)
    const settings = ConnectionSettingsSchema.parse(imported ?? connectionSettings.value)
    const existing = settings.connections.find((item) => item.id === settings.activeConnectionId)
    const selected = selection ??
      existing ?? {
        id: crypto.randomUUID(),
        name: new URL(nextMeta.INKCRE_PGREST_URL).host,
      }
    const entry = { id: selected.id, name: selected.name, config: nextMeta }
    const index = settings.connections.findIndex((item) => item.id === selected.id)
    if (index < 0) settings.connections.push(entry)
    else settings.connections[index] = entry
    settings.activeConnectionId = selected.id
    const nextSettings = ConnectionSettingsSchema.parse(settings)
    let candidateRuntime: InstanceType<Awaited<ReturnType<typeof lazyWebPeerRuntime>>> | null = null

    try {
      const WebPeerRuntime = await lazyWebPeerRuntime()
      const connection = await WebPeerRuntime.connect(nextMeta, identity)
      candidateRuntime = connection.runtime
      await metaAdapter.value.write({ ...nextMeta, ...nextSettings })
      connectionSettings.value = nextSettings
      metaConfig.value = nextMeta
      peerConfig.value = PeerConfigSchema.parse(connection.peer.config)
      return candidateRuntime
    } catch (err) {
      candidateRuntime?.stop()
      error.value = err as Error
      throw err
    }
  }

  async function resetMeta(): Promise<void> {
    const resetMetaConfig = MetaConfigSchema.parse({})
    const resetPeerConfig = PeerConfigSchema.parse({})
    error.value = null
    try {
      const settings: ConnectionSettings = { connections: [], activeConnectionId: null }
      await metaAdapter.value.write({ ...resetMetaConfig, ...settings })
      connectionSettings.value = settings
      metaConfig.value = resetMetaConfig
      peerConfig.value = resetPeerConfig
    } catch (err) {
      error.value = err as Error
      throw err
    }
  }

  return {
    metaConfig,
    connectionSettings,
    peerConfig,
    metaAdapter,
    isLoading,
    error,
    initializeMeta,
    loadPeerConfig,
    connectAndSave,
    saveMeta,
    resetMeta,
  }
})

export const configStore = useConfigStore(store)
