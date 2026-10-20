import { observeOperation, type Context } from '../obsrv/telemetry'
import { APIError } from '../base'
import { configStore } from '../config'
import { ZodError } from 'zod'
import {
  CapabilityDelegationUnavailable,
  type CapabilityID,
  DuplicatePeerRegistrationError,
  type JsonValue,
  type PeerOutbound,
  PeerOutcomeUnknown,
  PeerProtocolConfigurationError,
  PeerRequestNotExecuted,
} from './contracts'
import { PeerHTTPOutbound } from './http'
import { Peer, type PeerRef } from './peer'

type PeerOutboundFactory = (peer: Peer, parameters: Record<string, JsonValue>) => PeerOutbound

type Candidate = {
  peer: Peer
  protocol: string
  parameters: Record<string, JsonValue>
}

const createPeerHTTPOutbound: PeerOutboundFactory = (peer, parameters) =>
  new PeerHTTPOutbound(peer, parameters)

export class PeerManager {
  private static readonly outbounds = new Map<string, PeerOutboundFactory>()

  static getCurrentPeerRef(): PeerRef {
    const peer = configStore.metaConfig.INKCRE_PEER_ID
    if (!peer) throw new Error('INKCRE_PEER_ID is not configured')
    return peer
  }

  static registerOutbound(protocol: string, factory: PeerOutboundFactory): void {
    const existing = PeerManager.outbounds.get(protocol)
    if (existing === factory) return
    if (existing) {
      throw new DuplicatePeerRegistrationError(`Peer outbound ${protocol} is already registered`)
    }
    PeerManager.outbounds.set(protocol, factory)
  }

  static setupBuiltinOutbounds(): void {
    PeerManager.registerOutbound('core.peer.protocol.http.v1', createPeerHTTPOutbound)
  }

  static async delegate(
    capability: CapabilityID,
    payload: JsonValue,
    routeToPeer: PeerRef | null = null,
    parent?: Context
  ): Promise<JsonValue> {
    return observeOperation(
      'peer.delegate',
      async (active) => {
        const candidates = await PeerManager.candidates(capability, routeToPeer)
        let attempted = 0
        for (const candidate of candidates) {
          const factory = PeerManager.outbounds.get(candidate.protocol)
          if (!factory) continue
          let outbound: PeerOutbound
          try {
            outbound = factory(candidate.peer, candidate.parameters)
          } catch (error) {
            if (error instanceof PeerProtocolConfigurationError) continue
            throw error
          }
          attempted += 1
          try {
            return await outbound.execute(payload, active)
          } catch (error) {
            if (error instanceof PeerRequestNotExecuted) {
              if (routeToPeer !== null) break
              continue
            }
            if (error instanceof PeerOutcomeUnknown) throw error
            throw error
          }
        }
        throw new CapabilityDelegationUnavailable(
          `No eligible Peer completed capability ${capability}; attempted=${attempted}`
        )
      },
      {},
      parent
    )
  }

  static async listLive(): Promise<Peer[]> {
    const result = await Peer.dbApi
      .from()
      .select()
      .gt('lease_expires_at', 'now')
      .order('name', { ascending: true })
    if (result.error) throw new APIError(result.error.message, result.status, result.error)
    return (result.data ?? []).map((row) => Peer.parse(row))
  }

  private static async candidates(
    capability: CapabilityID,
    routeToPeer: PeerRef | null
  ): Promise<Candidate[]> {
    let query = Peer.dbApi
      .from()
      .select()
      .gt('lease_expires_at', 'now')
      .neq('id', PeerManager.getCurrentPeerRef())
    if (routeToPeer !== null) query = query.eq('id', routeToPeer)
    const result = await query
    if (result.error) throw new APIError(result.error.message, result.status, result.error)

    const candidates: Candidate[] = []
    for (const row of result.data ?? []) {
      try {
        const peer = Peer.parse(row)
        const advertisement = peer
          .capabilitySnapshot()
          .find((candidate) => candidate.id === capability)
        if (!advertisement || !PeerManager.outbounds.has(advertisement.inbound.protocol)) continue
        candidates.push({
          peer,
          protocol: advertisement.inbound.protocol,
          parameters: advertisement.inbound.parameters,
        })
      } catch (error) {
        if (error instanceof ZodError) continue
        throw error
      }
    }
    return routeToPeer === null ? PeerManager.shuffled(candidates) : candidates
  }

  private static shuffled<Value>(values: Value[]): Value[] {
    const shuffled = [...values]
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const random = crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32
      const other = Math.floor(random * (index + 1))
      ;[shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]]
    }
    return shuffled
  }
}
