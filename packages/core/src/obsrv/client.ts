import { z } from 'zod'
import { DatabaseClient, type DatabaseConnection } from '../base/client'
import { PeerCapabilitySnapshotSchema, PEER_HTTP_PROTOCOL } from '../peer/contracts'
import {
  OBSERVABILITY_CAPABILITY,
  ObservationPageSchema,
  ObservationQuerySchema,
  ObservationRecordSchema,
  ObservabilityStatusSchema,
  ObservabilityUnavailableError,
  type ObservationQuery,
  type ObservationRecord,
  type ObservationPage,
  type ObservabilityStatus,
} from './contracts'

const BackendSchema = z.object({ backend: z.enum(['postgresql', 'loki']) })
const Scalar = z.union([z.string().max(1024), z.number().finite(), z.boolean(), z.null()])
const InputSchema = ObservationRecordSchema.extend({
  event_name: z.string().max(128).nullable(),
  severity_text: z.string().max(32),
  body: z.string().max(8192),
  trace_id: z.string().max(128).nullable(),
  span_id: z.string().max(128).nullable(),
  attributes: z
    .record(z.string().max(128), z.union([Scalar, z.array(Scalar).max(32)]))
    .refine((value) => Object.keys(value).length <= 64),
})
const EndpointSchema = z.object({
  method: z.literal('POST'),
  url: z.url().refine((value) => {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash
  }),
})
const HISTORY = 'Only the selected backend is queried. Data from previous backends remains there.'

/** One explicit deployment snapshot; queries never consult a selected App connection. */
export class ObservabilityClient {
  private readonly connection: DatabaseConnection
  private readonly logs: DatabaseClient<'logs'>
  private readonly configs: DatabaseClient<'configs'>
  private readonly peers: DatabaseClient<'peers'>
  private selectedBackend?: Promise<'postgresql' | 'loki'>

  constructor(connection: DatabaseConnection) {
    this.connection = { ...connection }
    this.logs = new DatabaseClient('logs', undefined, this.connection)
    this.configs = new DatabaseClient('configs', undefined, this.connection)
    this.peers = new DatabaseClient('peers', undefined, this.connection)
  }

  private backend(): Promise<'postgresql' | 'loki'> {
    this.selectedBackend ??= this.readBackend().catch((error: unknown) => {
      this.selectedBackend = undefined
      throw error
    })
    return this.selectedBackend
  }

  /** Bind this instance once; changing the deployment selector requires a new instance. */
  async prepare(): Promise<void> {
    await this.backend()
  }

  private async readBackend(): Promise<'postgresql' | 'loki'> {
    const result = await this.configs
      .from()
      .select('schema,value')
      .eq('key', 'inkcre.observability.backend')
      .abortSignal(AbortSignal.timeout(10_000))
      .maybeSingle()
    if (result.error)
      throw new ObservabilityUnavailableError('Observability configuration could not be read.')
    if (!result.data) return 'postgresql'
    if (result.data.schema !== 'inkcre.observability.backend.v1')
      throw new ObservabilityUnavailableError('Unsupported observability configuration version.')
    return BackendSchema.parse(result.data.value).backend
  }

  private async externalProvider(action: 'status' | 'query' | 'ingest' = 'status'): Promise<{
    endpoint: z.infer<typeof EndpointSchema>
    status: ObservabilityStatus
  }> {
    const result = await this.peers
      .from()
      .select('id,capabilities')
      .gt('lease_expires_at', 'now')
      .order('id')
      .abortSignal(AbortSignal.timeout(10_000))
    if (result.error)
      throw new ObservabilityUnavailableError('Observability Peer discovery failed.')
    const deadline = Date.now() + 10_000
    let diagnostic:
      | { endpoint: z.infer<typeof EndpointSchema>; status: ObservabilityStatus }
      | undefined
    for (const peer of result.data ?? []) {
      if (Date.now() >= deadline) break
      const capabilities = PeerCapabilitySnapshotSchema.safeParse(peer.capabilities)
      if (!capabilities.success) continue
      const capability = capabilities.data.find((item) => item.id === OBSERVABILITY_CAPABILITY)
      if (!capability || capability.inbound.protocol !== PEER_HTTP_PROTOCOL) continue
      const parsed = EndpointSchema.safeParse(capability.inbound.parameters)
      if (!parsed.success) continue
      const candidate = await this.dispatch(
        parsed.data,
        { action: 'status' },
        Math.min(3000, deadline - Date.now())
      ).catch(() => null)
      const status = ObservabilityStatusSchema.safeParse(candidate)
      if (!status.success || status.data.backend !== 'loki') continue
      diagnostic ??= { endpoint: parsed.data, status: status.data }
      const ready =
        status.data.configured &&
        (action === 'ingest' ? status.data.recording : status.data.queryable)
      if (ready) return { endpoint: parsed.data, status: status.data }
    }
    if (action === 'status' && diagnostic) return diagnostic
    throw new ObservabilityUnavailableError(
      'No live Peer provides the selected observability backend.'
    )
  }

  private async dispatch(
    endpoint: z.infer<typeof EndpointSchema>,
    body: unknown,
    timeoutMs = 30_000
  ): Promise<unknown> {
    // After provider selection, dispatch once. Never redirect a failed write to another backend.
    const response = await (this.connection.fetch ?? globalThis.fetch)(endpoint.url, {
      method: endpoint.method,
      headers: {
        Authorization: `Bearer ${await this.connection.tokenProvider()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
    })
    if (!response.ok)
      throw new ObservabilityUnavailableError(
        `Observability backend request failed (${response.status}).`
      )
    return response.json()
  }

  async status(): Promise<ObservabilityStatus> {
    const backend = await this.backend()
    if (backend === 'loki') {
      return (await this.externalProvider()).status
    }
    return {
      backend,
      configured: true,
      recording: true,
      queryable: true,
      scope: 'selected_backend',
      history: HISTORY,
      dropped: null,
      error: null,
    }
  }

  async query(input: ObservationQuery): Promise<ObservationPage> {
    const query = ObservationQuerySchema.parse(input)
    const backend = await this.backend()
    if (backend === 'loki') {
      const { endpoint } = await this.externalProvider('query')
      const page = ObservationPageSchema.parse(
        await this.dispatch(endpoint, { action: 'query', expected_backend: backend, query })
      )
      if (page.backend !== backend)
        throw new ObservabilityUnavailableError('Observability backend changed during this query.')
      return page
    }
    let request = this.logs
      .from()
      .select()
      .gte('timestamp', query.since)
      .lt('timestamp', query.until)
      .order('timestamp', { ascending: false })
      .order('id', { ascending: false })
      .limit(query.limit + 1)
    if (query.kind === 'log')
      request = request.or(
        'attributes->>"inkcre.record.kind".eq.log,attributes->>"inkcre.record.kind".is.null'
      )
    else if (query.kind)
      request = request.contains('attributes', { 'inkcre.record.kind': query.kind })
    if (query.severity_min !== undefined)
      request = request.gte('severity_number', query.severity_min)
    if (query.job_id !== undefined)
      request = request.or(
        `trace_id.eq.job.${query.job_id},attributes->>"inkcre.job.id".eq.${query.job_id},attributes->>job_id.eq.${query.job_id}`
      )
    if (query.trace_id) request = request.eq('trace_id', query.trace_id)
    if (query.peer_id) request = request.contains('attributes', { 'inkcre.peer.id': query.peer_id })
    if (query.operation)
      request = request.contains('attributes', { 'inkcre.operation': query.operation })
    if (query.text)
      request = request.filter('body', 'imatch', query.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const result = await request.abortSignal(AbortSignal.timeout(10_000))
    if (result.error)
      throw new ObservabilityUnavailableError(
        'Observations could not be read from the selected backend.'
      )
    const rows = result.data ?? []
    const records = rows.slice(0, query.limit).map((row) => {
      const attributes = z.record(z.string(), z.unknown()).parse(row.attributes ?? {})
      return ObservationRecordSchema.parse({
        ...row,
        id: attributes['inkcre.record.id'] ?? `pg.${row.id}`,
        kind: attributes['inkcre.record.kind'] ?? 'log',
        event_name: attributes['inkcre.event.name'] ?? null,
        attributes,
      })
    })
    return {
      records,
      truncated: rows.length > query.limit,
      since: query.since,
      until: query.until,
      backend,
    }
  }

  async emit(record: ObservationRecord): Promise<void> {
    const input = InputSchema.parse(record)
    const backend = await this.backend()
    if (backend === 'loki') {
      const { endpoint } = await this.externalProvider('ingest')
      const result = z.object({ accepted: z.number().int(), dropped: z.number().int() }).parse(
        await this.dispatch(endpoint, {
          action: 'ingest',
          expected_backend: backend,
          records: [input],
        })
      )
      if (result.accepted !== 1 || result.dropped !== 0)
        throw new ObservabilityUnavailableError(
          'The selected backend did not accept this observation.'
        )
      return
    }
    const result = await this.logs
      .insert({
        timestamp: input.timestamp,
        severity_number: input.severity_number,
        severity_text: input.severity_text,
        body: input.body,
        trace_id: input.trace_id,
        span_id: input.span_id,
        attributes: {
          ...input.attributes,
          'inkcre.record.id': input.id,
          'inkcre.record.kind': input.kind,
          'inkcre.event.name': input.event_name,
        },
      })
      .abortSignal(AbortSignal.timeout(10_000))
    if (result.error)
      throw new ObservabilityUnavailableError(
        'Observation could not be stored in the selected backend.'
      )
  }
}
