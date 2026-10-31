import {
  listAdvertisedExtensionManagementPeers,
  manageExtensionOnPeer,
  readExtensionPeerStatus,
} from '@inkcre/core'
import { ensureExtensionSelection } from '@inkcre/ext-dev-utils/selection'
import {
  ExtensionModel,
  PeerManager,
  PeerProtocolResponseSchema,
  type ExtensionRuntimeStatus,
  type Peer,
} from '@inkcre/core'

import {
  generatePassword,
  runtimeFailed,
  runtimeReady,
  savedPassword,
  waitingForRuntime,
} from './setup-state'

export const extensionName = 'inkcre/caldav'
export interface Candidate {
  peer: Peer
  status: ExtensionRuntimeStatus | null
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
  let status = await ensureExtensionSelection(peer, extensionName, 'python')
  if (runtimeFailed(status)) throw new Error('Recover the failed Peer operation before continuing.')
  if (waitingForRuntime(status)) return status
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
    if (runtimeFailed(status) || waitingForRuntime(status)) return status
  }
  if (!runtimeReady(status)) {
    status = await manageExtensionOnPeer(peer.id, { action: 'enable', extension: extensionName })
  }
  return status
}
