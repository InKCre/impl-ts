import type { Context } from '../obsrv/telemetry'
import { z } from 'zod'

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[]

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ])
)

export type CapabilityID = string
export type PeerProtocolID = string

export const PEER_HTTP_PROTOCOL = 'core.peer.protocol.http.v1'
export const PEER_EXECUTION_HEADER = 'InkCre-Peer-Execution'
export const PEER_NOT_EXECUTED = 'not-executed'

export const PeerInboundInterfaceSchema = z.object({
  protocol: z.string().min(1),
  parameters: z.record(z.string(), JsonValueSchema),
})

export const PeerCapabilityAdvertisementSchema = z.object({
  id: z.string().min(1),
  inbound: PeerInboundInterfaceSchema,
})

export const PeerCapabilitySnapshotSchema = z
  .array(PeerCapabilityAdvertisementSchema)
  .superRefine((capabilities, context) => {
    const ids = new Set<string>()
    for (const capability of capabilities) {
      if (ids.has(capability.id)) {
        context.addIssue({
          code: 'custom',
          message: `Peer capability IDs must be unique: ${capability.id}`,
        })
      }
      ids.add(capability.id)
    }
  })

export type PeerCapabilityAdvertisement = z.infer<typeof PeerCapabilityAdvertisementSchema>

const NormalizedMultimapSchema = z
  .record(z.string().min(1), z.array(z.string()))
  .superRefine((value, context) => {
    const names = new Set<string>()
    for (const rawName of Object.keys(value)) {
      const name = rawName.toLowerCase()
      if (names.has(name)) {
        context.addIssue({
          code: 'custom',
          message: `normalized map contains duplicate name: ${name}`,
        })
      }
      names.add(name)
    }
  })
  .transform((value) =>
    Object.fromEntries(Object.entries(value).map(([name, values]) => [name.toLowerCase(), values]))
  )

export const PeerProtocolRequestSchema = z.object({
  query: NormalizedMultimapSchema.optional().default({}),
  headers: NormalizedMultimapSchema.optional().default({}),
  body: JsonValueSchema.optional(),
})

export const PeerProtocolResponseSchema = z.object({
  status: z.number().int().min(100).max(599),
  headers: NormalizedMultimapSchema.optional().default({}),
  body: JsonValueSchema.optional(),
})

export type PeerProtocolRequest = z.infer<typeof PeerProtocolRequestSchema>
export type PeerProtocolResponse = z.infer<typeof PeerProtocolResponseSchema>

export interface PeerOutbound {
  execute(payload: JsonValue, parent?: Context): Promise<JsonValue>
}

export class PeerError extends Error {}
export class DuplicatePeerRegistrationError extends PeerError {}
export class CapabilityDelegationUnavailable extends PeerError {}
export class PeerProtocolError extends PeerError {}
export class PeerProtocolConfigurationError extends PeerProtocolError {}
export class PeerRequestNotExecuted extends PeerProtocolError {}
export class PeerOutcomeUnknown extends PeerProtocolError {}
