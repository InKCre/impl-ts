import { z } from 'zod'
import { PeerManager } from '../peer/manager'
import type { Peer } from '../peer/peer'
import { JsonValueSchema, PeerProtocolResponseSchema } from '../peer/contracts'
import {
  ExtensionNameSchema,
  ExtensionRuntimeStatusSchema,
  ExtensionVersionSchema,
  NativeDistributionSchema,
  type ExtensionRuntimeStatus,
} from './model'

export const EXTENSION_MANAGEMENT_CAPABILITY = 'core.extension.management.v2'

export const ExtensionManagementCommandSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('select'),
    extension: ExtensionNameSchema,
    distribution: NativeDistributionSchema,
    version: ExtensionVersionSchema,
  }),
  z.object({
    action: z.enum(['enable', 'disable', 'unselect']),
    extension: ExtensionNameSchema,
  }),
  z.object({
    action: z.literal('patch_config'),
    extension: ExtensionNameSchema,
    patch: z.record(z.string(), JsonValueSchema),
  }),
])
export type ExtensionManagementCommand = z.infer<typeof ExtensionManagementCommandSchema>

export const ExtensionPeerStatusSchema = z.object({
  peer_id: z.uuid(),
  supported_distributions: z.array(NativeDistributionSchema),
  extensions: z.array(ExtensionRuntimeStatusSchema),
})
export type ExtensionPeerStatus = z.infer<typeof ExtensionPeerStatusSchema>

/** A response failed the management contract; transport outcomes retain their own error types. */
export class ExtensionManagementError extends Error {
  override name = 'ExtensionManagementError'
}

/** Live advertisements are discovery candidates, not proof of a usable outbound route. */
export async function listAdvertisedExtensionManagementPeers(): Promise<Peer[]> {
  return (await PeerManager.listLive()).filter((peer) => {
    try {
      return peer.capabilitySnapshot().some(({ id }) => id === EXTENSION_MANAGEMENT_CAPABILITY)
    } catch {
      return false
    }
  })
}

async function sendCommand(
  peerId: string,
  command: ExtensionManagementCommand | { action: 'status'; extension?: string }
): Promise<ExtensionPeerStatus> {
  if (!peerId) throw new TypeError('Extension management requires an exact Peer ID.')
  const result = await PeerManager.delegate(
    EXTENSION_MANAGEMENT_CAPABILITY,
    { body: command },
    peerId
  )
  const response = PeerProtocolResponseSchema.safeParse(result)
  if (!response.success)
    throw new ExtensionManagementError('Extension management Peer returned an invalid response.')
  if (response.data.status !== 200)
    throw new ExtensionManagementError(
      `Extension management Peer returned HTTP ${response.data.status}.`
    )
  const status = ExtensionPeerStatusSchema.safeParse(response.data.body)
  // Validation issues and remote bodies may contain configuration credentials.
  if (
    !status.success ||
    status.data.peer_id !== peerId ||
    status.data.extensions.some((row) => row.peer_id !== peerId)
  ) {
    throw new ExtensionManagementError('Extension management Peer returned an invalid status.')
  }
  return status.data
}

/** Read actual runtime facts from the exact target; Registry selection remains a separate policy. */
export function readExtensionPeerStatus(
  peerId: string,
  extension?: string
): Promise<ExtensionPeerStatus> {
  return sendCommand(peerId, { action: 'status', ...(extension ? { extension } : {}) })
}

/** No target substitution, Registry lookup, version selection or ambiguous-dispatch retry. */
export async function manageExtensionOnPeer(
  peerId: string,
  command: ExtensionManagementCommand
): Promise<ExtensionRuntimeStatus> {
  const status = await sendCommand(peerId, command)
  const extension = status.extensions.find((row) => row.name === command.extension)
  if (!extension)
    throw new ExtensionManagementError(
      'Extension management Peer returned no exact Extension status.'
    )
  return extension
}
