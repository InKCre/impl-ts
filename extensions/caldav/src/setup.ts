import corePackage from '../../../packages/core/package.json'
import {
  ExtensionModel,
  ExtensionRegistryOriginResolver,
  PeerConfigSchema,
  PeerManager,
  PeerProtocolResponseSchema,
  type ExtensionRuntimeStatus,
  type InstalledExtension,
  type Peer,
} from '@inkcre/core'
import {
  listAdvertisedExtensionManagementPeers,
  manageExtensionOnPeer,
  readExtensionPeerStatus,
  RegistryReleaseReader,
  sortPublishedReleases,
} from '@inkcre/extension-runtime-client-web'

export const extensionName = 'inkcre/caldav'
export interface Candidate {
  peer: Peer
  status: ExtensionRuntimeStatus | null
}

export function savedPassword(extension: InstalledExtension): string | null {
  const value = extension.config.password
  if (value == null) return null
  if (typeof value !== 'string' || Array.from(value).length < 32 || Array.from(value).length > 128)
    throw new Error('Invalid DAV password configuration.')
  return value
}

export function generatePassword(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
}

export function waitingForRuntime(status: ExtensionRuntimeStatus | null): boolean {
  return !!status && (status.restart_required || !!status.operation)
}

export function runtimeReady(status: ExtensionRuntimeStatus | null): boolean {
  return (
    !!status &&
    status.enabled &&
    status.running &&
    !waitingForRuntime(status) &&
    !!status.version &&
    status.loaded_version === status.version &&
    !status.error
  )
}

export async function readCandidates(): Promise<{ candidates: Candidate[]; unavailable: number }> {
  const peers = await listAdvertisedExtensionManagementPeers()
  const results = await Promise.allSettled(
    peers.map(async (peer) => {
      const current = await readExtensionPeerStatus(peer.id, extensionName)
      return current.supported_distributions.includes('python')
        ? { peer, status: current.extensions.find((row) => row.name === extensionName) ?? null }
        : null
    })
  )
  return {
    candidates: results.flatMap((result) =>
      result.status === 'fulfilled' && result.value ? [result.value] : []
    ),
    unavailable: results.filter((result) => result.status === 'rejected').length,
  }
}

export class ConnectionError extends Error {
  constructor(readonly status: number) {
    super('Unable to read DAV connection details.')
  }
}

export async function readConnection(
  peerId: string
): Promise<{ server_url: string; username: string }> {
  const response = PeerProtocolResponseSchema.parse(
    await PeerManager.delegate('caldav.connection.v1', {}, peerId)
  )
  if (response.status !== 200) throw new ConnectionError(response.status)
  const body = response.body
  if (
    !body ||
    typeof body !== 'object' ||
    !('server_url' in body) ||
    typeof body.server_url !== 'string' ||
    !('username' in body) ||
    body.username !== 'inkcre'
  )
    throw new ConnectionError(502)
  const url = new URL(body.server_url)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new ConnectionError(502)
  return { server_url: url.href, username: body.username }
}

/** Each explicit action advances only this Peer; a restart requires a read before further writes. */
export async function prepareConnection(peer: Peer): Promise<ExtensionRuntimeStatus> {
  const observed = await readExtensionPeerStatus(peer.id, extensionName)
  if (!observed.supported_distributions.includes('python'))
    throw new Error('Python is not supported.')
  let status = observed.extensions.find((row) => row.name === extensionName) ?? null
  if (waitingForRuntime(status)) return status!
  if (!status?.version) {
    const peerConfig = PeerConfigSchema.parse(peer.config)
    const registryOrigin = await new ExtensionRegistryOriginResolver(
      () => peerConfig.extension_registry_url
    ).resolve()
    const reader = new RegistryReleaseReader({
      registryOrigin,
      hostSdk: { name: '@inkcre/core', version: corePackage.version },
    })
    const release = sortPublishedReleases(
      (await reader.getExtension(extensionName, 'python')).releases ?? []
    )[0]
    if (!release) throw new Error('No published Python release.')
    status = await manageExtensionOnPeer(peer.id, {
      action: 'select',
      extension: extensionName,
      distribution: 'python',
      version: release.version,
    })
    if (waitingForRuntime(status)) return status
  }
  if (status.distribution !== 'python') throw new Error('The selected distribution is not Python.')
  const extension = await ExtensionModel.get(extensionName)
  if (!extension) throw new Error('CalDAV is not installed.')
  if (!savedPassword(extension)) {
    const password = generatePassword()
    status = await manageExtensionOnPeer(peer.id, {
      action: 'patch_config',
      extension: extensionName,
      patch: { password },
    })
    const saved = await ExtensionModel.get(extensionName)
    if (!saved || savedPassword(saved) !== password)
      throw new Error('Password save could not be confirmed.')
    if (waitingForRuntime(status)) return status
  }
  if (!runtimeReady(status)) {
    status = await manageExtensionOnPeer(peer.id, { action: 'enable', extension: extensionName })
  }
  return status
}
