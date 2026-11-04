import { z } from 'zod'
import { Z } from 'zod-class'
import { DBAPIClient } from '../base/db-api'

export type LogRef = number
export const LogRefZ = z.number()

/**
 * @deprecated Physical PostgreSQL row compatibility API, including historical rows.
 * Use ObservabilityClient for the selected backend. Numeric IDs/cursors cannot
 * represent external observations and this legacy API intentionally does not.
 */
export class Log extends Z.class({
  id: LogRefZ,
  timestamp: z.coerce.date().default(() => new Date()),
  severity_number: z.number(),
  severity_text: z.string(),
  body: z.string(),
  trace_id: z.string().nullable(),
  span_id: z.string().nullable(),
  attributes: z.looseObject({}).default(() => ({})),
}) {
  static dbApi: DBAPIClient<'logs', Log> = new DBAPIClient<'logs', Log>('logs', Log)

  static async get(id: LogRef): Promise<Log> {
    return Log.parse((await this.dbApi.from().select().eq('id', id).single()).data)
  }

  static async getByTraceId(
    traceId: string,
    options?: { limit?: number; cursor?: number }
  ): Promise<Log[]> {
    let query = this.dbApi.from().select().eq('trace_id', traceId).order('id', { ascending: true })
    if (options?.cursor) {
      query = query.gt('id', options.cursor)
    }
    if (options?.limit) {
      query = query.limit(options.limit)
    }
    return (await query.throwOnError()).data?.map((item) => Log.parse(item)) ?? []
  }
}
