import type { EdgeProps } from '@vue-flow/core'
import type { RelationEdgeData } from '@/views/info-base/graph/graph-model'

export interface RelationEdgeEmits {
  (event: 'focus', relation: number): void
}

export type RelationEdgeProps = EdgeProps<RelationEdgeData>
