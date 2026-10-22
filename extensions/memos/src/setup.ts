import corePackage from '../../../packages/core/package.json'
import {
  ExtensionModel,
  ExtensionParticipationModel,
  configStore,
  ExtensionRegistryOriginResolver,
  PeerManager,
  PeerProtocolResponseSchema,
  type InstalledExtension,
  type Peer,
} from '@inkcre/core'
import {
  getExtensionDocumentation,
  RegistryReleaseReader,
  sortPublishedReleases,
  manageExtensionOnPeer,
  readExtensionPeerStatus,
  listAdvertisedExtensionManagementPeers,
} from '@inkcre/extension-runtime-client-web'

export const extensionName = 'inkcre/memos'
export const tokenPattern = /^memos_pat_[0-9A-Za-z]{32}$/

export function personalAccessToken(extension: InstalledExtension): string | null {
  const token = extension.config.personal_access_token
  return typeof token === 'string' && tokenPattern.test(token) ? token : null
}

export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return `memos_pat_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export async function readSetup(): Promise<{ extension: ExtensionModel; peers: Peer[] }> {
  const [extension, peers] = await Promise.all([
    ExtensionModel.get(extensionName),
    listAdvertisedExtensionManagementPeers(),
  ])
  if (!extension) throw new Error('Memos is not installed.')
  const statuses = await Promise.all(
    peers.map(async (peer) => ({
      peer,
      status: await readExtensionPeerStatus(peer.id, extensionName),
    }))
  )
  return {
    extension,
    peers: statuses
      .filter(({ status }) => status.supported_distributions.includes('python'))
      .map(({ peer }) => peer),
  }
}

/** An explicit connection-preparation action may create a native selection, never background restore. */
export async function ensureMemosParticipation(peerId: string): Promise<void> {
  if (await ExtensionParticipationModel.get(peerId, extensionName)) return
  const origin = await new ExtensionRegistryOriginResolver(
    () => configStore.peerConfig.extension_registry_url
  ).resolve()
  const reader = new RegistryReleaseReader({
    registryOrigin: origin,
    hostSdk: { name: '@inkcre/core', version: corePackage.version },
  })
  const catalog = await reader.getExtension(extensionName, 'python')
  const release = sortPublishedReleases(catalog.releases ?? [])[0]
  if (!release) throw new Error('Memos has no published Python distribution.')
  await manageExtensionOnPeer(peerId, {
    action: 'select',
    extension: extensionName,
    distribution: 'python',
    version: release.version,
  })
}

export class MemosConnectionError extends Error {
  constructor(readonly status: number) {
    super(`Memos connection returned HTTP ${status}.`)
  }
}

export async function readServerUrl(peerId: string): Promise<string> {
  const result = await PeerManager.delegate('memos.connection.v1', {}, peerId)
  const response = PeerProtocolResponseSchema.parse(result)
  if (response.status !== 200) throw new MemosConnectionError(response.status)
  const body = response.body
  if (
    !body ||
    typeof body !== 'object' ||
    !('server_url' in body) ||
    typeof body.server_url !== 'string'
  )
    throw new Error('Memos connection did not return a server URL.')
  const url = new URL(body.server_url)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Memos connection returned an invalid server URL.')
  return url.href
}

export async function readHelpUrl(version: string): Promise<string | null> {
  const origin = await new ExtensionRegistryOriginResolver(
    () => configStore.peerConfig.extension_registry_url
  ).resolve()
  const documentation = await getExtensionDocumentation(
    origin,
    extensionName,
    version,
    'module_federation'
  )
  const entry = documentation?.find((link) => link.scope === 'module-federation')
  if (!entry) return null
  const url = new URL(entry.entry_url)
  url.hash = 'prepare-your-client-connection'
  return url.href
}
