import { z } from 'zod'

export const OBSERVABILITY_CAPABILITY = 'core.observability.v1'
export const ObservationRecordSchema = z.object({
  id: z.string().min(1).max(128),
  timestamp: z.iso.datetime({ offset: true }),
  kind: z.enum(['log', 'event', 'span']),
  event_name: z.string().nullable(),
  severity_number: z.number().int().min(1).max(24),
  severity_text: z.string(),
  body: z.string(),
  trace_id: z.string().nullable(),
  span_id: z.string().nullable(),
  attributes: z.record(z.string(), z.unknown()),
})
export type ObservationRecord = z.infer<typeof ObservationRecordSchema>

export const ObservationQuerySchema = z
  .object({
    since: z.iso.datetime({ offset: true }),
    until: z.iso.datetime({ offset: true }),
    limit: z.number().int().min(1).max(500).default(100),
    kind: z.enum(['log', 'event', 'span']).optional(),
    severity_min: z.number().int().min(1).max(24).optional(),
    job_id: z.number().int().positive().optional(),
    trace_id: z.string().min(1).max(128).optional(),
    peer_id: z.uuid().optional(),
    operation: z.string().min(1).max(128).optional(),
    text: z.string().max(256).optional(),
  })
  .refine((value) => Date.parse(value.since) < Date.parse(value.until), {
    message: 'Observation time range must end after it starts.',
  })
  .refine((value) => Date.parse(value.until) - Date.parse(value.since) <= 31 * 86400 * 1000, {
    message: 'Observation time range must not exceed 31 days.',
  })
export type ObservationQuery = z.input<typeof ObservationQuerySchema>
export const ObservationPageSchema = z.object({
  records: z.array(ObservationRecordSchema),
  truncated: z.boolean(),
  since: z.iso.datetime({ offset: true }),
  until: z.iso.datetime({ offset: true }),
  backend: z.enum(['postgresql', 'loki']),
})
export type ObservationPage = z.infer<typeof ObservationPageSchema>

export const ObservabilityStatusSchema = z.object({
  backend: z.enum(['postgresql', 'loki']),
  configured: z.boolean(),
  recording: z.boolean(),
  queryable: z.boolean(),
  scope: z.literal('selected_backend'),
  history: z.string(),
  dropped: z.number().int().nonnegative().nullable(),
  error: z.string().nullable(),
})
export type ObservabilityStatus = z.infer<typeof ObservabilityStatusSchema>

export class ObservabilityUnavailableError extends Error {
  override name = 'ObservabilityUnavailableError'
}
