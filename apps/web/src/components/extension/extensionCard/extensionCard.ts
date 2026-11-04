import { type PropType } from 'vue'
import type { InstalledExtension, ExtensionParticipation, Peer } from '@inkcre/core'

// --- Props ---
export const extensionCardProps = {
  extension: { type: Object as PropType<InstalledExtension>, required: true },
  participations: { type: Array as PropType<ExtensionParticipation[]>, required: true },
  peers: { type: Array as PropType<Peer[]>, required: true },
  livePeerIds: { type: Object as PropType<ReadonlySet<string>>, required: true },
  currentPeerId: { type: String, required: true },
  peerSelectionDisabled: { type: Boolean, default: false },
} as const

// --- Emits ---
export const extensionCardEmits = {
  updated: (_extension: InstalledExtension) => true,
  participationChanged: () => true,
} as const
