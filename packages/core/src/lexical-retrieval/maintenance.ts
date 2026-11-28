import { z } from 'zod'

export const LEXICAL_INDEX_JOB_TYPES = {
  maintain: 'core.feature_retrieval.lexical.maintain.v1',
  rebuild: 'core.feature_retrieval.lexical.rebuild.v1',
} as const

const count = z.number().int().nonnegative()

export const LexicalIndexReportSchema = z.object({
  indexed: count,
  unavailable: count,
  failed: count,
  next_after_block: count.positive().nullable().optional(),
  rebuild_cutoff: z.iso.datetime({ offset: true }).nullable().optional(),
})
