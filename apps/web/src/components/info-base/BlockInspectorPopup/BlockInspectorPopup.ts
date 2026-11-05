import type { BlockRef } from '@inkcre/core'

export interface BlockInspectorPopupProps {
  block: BlockRef
}

export const blockInspectorPopupEmits = {
  ruminated: () => true,
} as const
