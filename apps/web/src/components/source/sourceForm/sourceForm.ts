import type { PropType } from 'vue'
import { Source, SourceForm } from '@inkcre/core'

export const sourceFormProps = {
  disabled: { type: Boolean, default: false },
  modelValue: { type: Object as PropType<Source | SourceForm>, required: true },
} as const
