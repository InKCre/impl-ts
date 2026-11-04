import { type PropType } from 'vue'
import { Peer, type PeerReadinessObservation } from '@inkcre/core'

export const peerCardProps = {
  peer: { type: Object as PropType<Peer>, required: true },
  current: { type: Boolean, default: false },
  readiness: { type: Object as PropType<PeerReadinessObservation>, default: undefined },
  status: {
    type: String as PropType<'online' | 'offline' | 'unknown'>,
    required: true,
  },
} as const

export const peerCardEmits = {
  updated: () => true,
} as const
