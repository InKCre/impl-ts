import {
  ExtensionModel,
  ExtensionParticipationModel,
  Peer,
  type ExtensionParticipation,
  type ExtensionRuntimeStatus,
  type NativeDistribution,
} from '@inkcre/core'
import {
  EXTENSION_MANAGEMENT_CAPABILITY,
  manageExtensionOnPeer,
  readExtensionPeerStatus,
  type ExtensionManager,
  type RegistryReleaseReader,
} from '@inkcre/extension-runtime-client-web'

export { EXTENSION_MANAGEMENT_CAPABILITY }
export type ExtensionPeerControlMode = 'current-runtime' | 'remote-host' | 'desired-state'

export function peerAdvertises(peer: Peer, capability: string): boolean {
  try {
    return peer.capabilitySnapshot().some((candidate) => candidate.id === capability)
  } catch {
    return false
  }
}

export function extensionPeerControlMode(
  peer: Peer,
  currentPeerId: string,
  livePeerIds: ReadonlySet<string>
): ExtensionPeerControlMode {
  if (peer.id === currentPeerId) return 'current-runtime'
  return livePeerIds.has(peer.id) && peerAdvertises(peer, EXTENSION_MANAGEMENT_CAPABILITY)
    ? 'remote-host'
    : 'desired-state'
}

export async function observeExtensionPeer(input: {
  name: string
  peer: Peer
  currentPeerId: string
  livePeerIds: ReadonlySet<string>
  manager: ExtensionManager
}): Promise<{
  supported_distributions: NativeDistribution[]
  status: ExtensionRuntimeStatus | null
}> {
  const mode = extensionPeerControlMode(input.peer, input.currentPeerId, input.livePeerIds)
  if (mode === 'current-runtime') {
    return {
      supported_distributions: ['module_federation'],
      status: await input.manager.getStatus(input.name, input.currentPeerId),
    }
  }
  if (mode === 'desired-state') return { supported_distributions: [], status: null }
  const response = await readExtensionPeerStatus(input.peer.id, input.name)
  return {
    supported_distributions: response.supported_distributions,
    status: response.extensions.find((row) => row.name === input.name) ?? null,
  }
}

export async function setExtensionPeerEnabled(input: {
  name: string
  peer: Peer
  currentPeerId: string
  livePeerIds: ReadonlySet<string>
  enabled: boolean
  manager: ExtensionManager
}): Promise<ExtensionParticipation | ExtensionRuntimeStatus> {
  const mode = extensionPeerControlMode(input.peer, input.currentPeerId, input.livePeerIds)
  if (mode === 'current-runtime') {
    return input.enabled
      ? input.manager.enable(input.name, input.currentPeerId)
      : input.manager.disable(input.name, input.currentPeerId)
  }
  if (mode === 'desired-state') {
    const participation = await ExtensionParticipationModel.get(input.peer.id, input.name)
    if (!participation) throw new Error('Select a version for this Peer first.')
    return participation.setEnabled(input.enabled)
  }
  return manageExtensionOnPeer(input.peer.id, {
    action: input.enabled ? 'enable' : 'disable',
    extension: input.name,
  })
}

export async function selectExtensionPeerVersion(input: {
  name: string
  nickname: string
  releases: RegistryReleaseReader
  version: string
  distribution: NativeDistribution
  peer: Peer
  currentPeerId: string
  livePeerIds: ReadonlySet<string>
  manager: ExtensionManager
}): Promise<ExtensionParticipation | ExtensionRuntimeStatus> {
  const mode = extensionPeerControlMode(input.peer, input.currentPeerId, input.livePeerIds)
  if (mode === 'current-runtime') {
    if (input.distribution !== 'module_federation')
      throw new Error('This Peer supports Module Federation.')
    return input.manager.install({ name: input.name, version: input.version }, input.currentPeerId)
  }
  if (mode === 'remote-host') {
    return manageExtensionOnPeer(input.peer.id, {
      action: 'select',
      extension: input.name,
      distribution: input.distribution,
      version: input.version,
    })
  }
  await input.releases.getRelease(input.name, input.version, true, input.distribution)
  const previous = await ExtensionParticipationModel.get(input.peer.id, input.name)
  if (previous?.distribution !== input.distribution)
    throw new Error('Connect this Peer to verify its supported distributions.')
  await ExtensionModel.install({ name: input.name, nickname: input.nickname })
  return ExtensionParticipationModel.select({
    name: input.name,
    peerId: input.peer.id,
    distribution: input.distribution,
    version: input.version,
    expectedVersion: previous.version,
  })
}
