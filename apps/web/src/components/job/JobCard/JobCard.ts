import type { PropType } from 'vue'
import { Job } from '@inkcre/core'

// --- Props ---
export const jobCardProps = {
  job: {
    type: Object as PropType<Job>,
    required: true,
  },
} as const

// --- Emits ---
export const jobCardEmits = {
  click: () => true,
} as const
