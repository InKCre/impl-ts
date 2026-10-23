import {
  context,
  createContextKey,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Context,
  type Span,
  type SpanOptions,
  type Tracer,
} from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { shallowRef } from 'vue'
import { z } from 'zod'
import type { MetaConfig } from '../config/schema'
import type { LoggerProvider } from '@opentelemetry/sdk-logs'
import type { MeterProvider } from '@opentelemetry/sdk-metrics'
import type { WebTracerProvider } from '@opentelemetry/sdk-trace-web'

// Shared config is public to admitted browsers; never accept credential-bearing URLs.
const PublicUrl = z.url().refine((value) => {
  const url = new URL(value)
  return (
    ['https:', 'http:'].includes(url.protocol) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
  )
}, 'Observability URLs must be HTTP(S) without credentials, query or fragment')
export const ObservabilityConfigSchema = z.object({
  deployment_id: z.uuid(),
  otlp_http_endpoints: z
    .object({
      traces: PublicUrl.nullish(),
      logs: PublicUrl.nullish(),
      metrics: PublicUrl.nullish(),
    })
    .nullish(),
  diagnostics_url: PublicUrl.nullish(),
})
export const telemetryDiagnosticsUrl = shallowRef<string | null>(null)
const propagator = new W3CTraceContextPropagator()
const getter = {
  keys: Object.keys,
  get: (carrier: Record<string, string>, key: string) => carrier[key],
}
const setter = {
  set: (carrier: Record<string, string>, key: string, value: string) => {
    carrier[key] = value
  },
}
let providers: Array<WebTracerProvider | LoggerProvider | MeterProvider> = []
let tracer: Tracer | undefined
let logger: ReturnType<LoggerProvider['getLogger']> | undefined
let duration: ReturnType<ReturnType<MeterProvider['getMeter']>['createHistogram']> | undefined
let droppedCarrier: ReturnType<ReturnType<MeterProvider['getMeter']>['createCounter']> | undefined
const operationLoggerKey = createContextKey('inkcre.operation.logger')
let initialization = Promise.resolve()

/** Serialized connection cutover; disabled peers do not even read shared telemetry configuration. */
export function initializeTelemetry(meta: MetaConfig, version: string): Promise<void> {
  const connection = { ...meta }
  initialization = initialization.then(async () => {
    await shutdownTelemetry()
    if (!connection.telemetry_enabled) return
    try {
      const { DBAPIClient } = await import('../base/db-api')
      const { signDatabaseToken } = await import('../auth')
      const tokenProvider = () => signDatabaseToken(connection.INKCRE_JWT_SECRET)
      const database = new DBAPIClient(
        'configs',
        undefined,
        'inkcre',
        connection.INKCRE_PGREST_URL,
        tokenProvider
      )
      const { data, error } = await database
        .from()
        .select('schema,value')
        .eq('key', 'inkcre.observability')
        .abortSignal(AbortSignal.timeout(10_000))
        .maybeSingle()
      if (error || !data || data.schema !== 'inkcre.observability.v1') {
        console.warn('[Telemetry] Shared observability configuration is unavailable.')
        return
      }
      await configureTelemetry(
        data.value,
        connection.INKCRE_PEER_ID,
        version,
        connection.telemetry_peer_relay_url
          ? { url: connection.telemetry_peer_relay_url, tokenProvider }
          : undefined
      )
    } catch {
      console.warn('[Telemetry] Initialization failed; business services remain available.')
      await shutdownTelemetry()
    }
  })
  return initialization
}

/** Initialize an explicitly enabled connection using its public deployment projection. */
export async function configureTelemetry(
  value: unknown,
  peerId: string,
  version: string,
  relay?: { url: string; tokenProvider: () => Promise<string> }
): Promise<void> {
  const config = ObservabilityConfigSchema.parse(value)
  telemetryDiagnosticsUrl.value = config.diagnostics_url ?? null
  const relayBase = relay ? PublicUrl.parse(relay.url).replace(/\/+$/, '') : null
  // The relay may spend up to 32 seconds forwarding a batch; allow network headroom.
  const transportTimeoutMs = relay ? 35_000 : 10_000
  const exportTimeoutMs = transportTimeoutMs + 5_000
  const endpoints = relayBase
    ? {
        traces: `${relayBase}/v1/traces`,
        logs: `${relayBase}/v1/logs`,
        metrics: `${relayBase}/v1/metrics`,
      }
    : (config.otlp_http_endpoints ?? {})
  if (!endpoints.traces && !endpoints.logs && !endpoints.metrics) {
    console.warn('[Telemetry] No OTLP endpoint is configured; remote export is disabled.')
    return
  }
  // Only an explicitly selected Peer relay receives the captured connection's short-lived JWT.
  const headers = relay
    ? async () => ({ Authorization: `Bearer ${await relay.tokenProvider()}` })
    : undefined
  const { resourceFromAttributes } = await import('@opentelemetry/resources')
  const resource = resourceFromAttributes({
    'service.name': 'inkcre.client-web',
    'service.version': version,
    'service.instance.id': crypto.randomUUID(),
    'inkcre.deployment.id': config.deployment_id,
    'inkcre.peer.id': peerId,
  })
  const { WebTracerProvider, BatchSpanProcessor } = await import('@opentelemetry/sdk-trace-web')
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-proto')
  const traceProvider = new WebTracerProvider({
    resource,
    spanProcessors: endpoints.traces
      ? [
          new BatchSpanProcessor(
            new OTLPTraceExporter({
              url: endpoints.traces,
              timeoutMillis: transportTimeoutMs,
              headers,
            }),
            { exportTimeoutMillis: exportTimeoutMs }
          ),
        ]
      : [],
  })
  providers.push(traceProvider)
  tracer = traceProvider.getTracer('inkcre.browser')
  if (endpoints.logs) {
    const { LoggerProvider, BatchLogRecordProcessor } = await import('@opentelemetry/sdk-logs')
    const { OTLPLogExporter } = await import('@opentelemetry/exporter-logs-otlp-proto')
    const provider = new LoggerProvider({
      resource,
      processors: [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({
            url: endpoints.logs,
            timeoutMillis: transportTimeoutMs,
            headers,
          }),
          exportTimeoutMillis: exportTimeoutMs,
        }),
      ],
    })
    providers.push(provider)
    logger = provider.getLogger('inkcre.browser')
  }
  if (endpoints.metrics) {
    const { MeterProvider, PeriodicExportingMetricReader, AggregationType } =
      await import('@opentelemetry/sdk-metrics')
    const { OTLPMetricExporter } = await import('@opentelemetry/exporter-metrics-otlp-proto')
    const provider = new MeterProvider({
      resource,
      // Match the Core histogram so cross-Peer aggregation keeps seconds and buckets aligned.
      views: [
        {
          instrumentName: 'inkcre.operation.duration',
          aggregation: {
            type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
            options: {
              boundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 300],
            },
          },
        },
      ],
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({
            url: endpoints.metrics,
            timeoutMillis: transportTimeoutMs,
            headers,
          }),
          exportIntervalMillis: 60_000,
          exportTimeoutMillis: exportTimeoutMs,
        }),
      ],
    })
    providers.push(provider)
    const meter = provider.getMeter('inkcre.browser')
    duration = meter.createHistogram('inkcre.operation.duration', { unit: 's' })
    droppedCarrier = meter.createCounter('inkcre.job.carrier.dropped')
  }
}

async function bounded(operation: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      operation.catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 1500)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
export async function flushTelemetry(): Promise<void> {
  if (providers.length)
    await bounded(Promise.allSettled(providers.map((provider) => provider.forceFlush())))
}
export async function shutdownTelemetry(): Promise<void> {
  const closing = providers
  providers = []
  tracer = undefined
  logger = undefined
  duration = undefined
  droppedCarrier = undefined
  telemetryDiagnosticsUrl.value = null
  if (closing.length)
    await bounded(Promise.allSettled(closing.map((provider) => provider.shutdown())))
}

type OperationResult = { outcome: 'success' | 'error' | 'cancelled' | 'timeout' }

/** Explicit SDK context survives native browser await without a global Promise patch. */
export async function observeOperation<T>(
  name: 'job.submit' | 'job.execute' | 'peer.delegate' | 'peer.http' | 'postgrest.http',
  operation: (parent: Context, span: Span | undefined, result: OperationResult) => Promise<T>,
  options: SpanOptions = {},
  parent: Context = context.active()
): Promise<T> {
  const result: OperationResult = { outcome: 'success' }
  if (!tracer) return operation(parent, undefined, result)
  const span = tracer.startSpan(name, options, parent)
  const operationDuration = duration
  const operationLogger = logger
  const active = trace.setSpan(parent, span).setValue(operationLoggerKey, operationLogger)
  const started = performance.now()
  try {
    return await operation(active, span, result)
  } catch (error) {
    result.outcome = 'error'
    span.setStatus({ code: SpanStatusCode.ERROR })
    throw error
  } finally {
    span.end()
    const attributes = { 'inkcre.operation': name, 'inkcre.outcome': result.outcome }
    operationDuration?.record((performance.now() - started) / 1000, {
      operation: name,
      outcome: result.outcome,
    })
    operationLogger?.emit({
      context: active,
      eventName: 'inkcre.operation.completed',
      body: 'inkcre.operation.completed',
      attributes,
    })
  }
}

export function captureSubmission(parent: Context): {
  submission_traceparent?: string
  submission_tracestate?: string
} {
  const carrier: Record<string, string> = {}
  if (tracer) propagator.inject(parent, carrier, setter)
  if (!carrier.traceparent) return {}
  const state = carrier.tracestate
  const oversized = state !== undefined && new TextEncoder().encode(state).length > 512
  if (oversized) droppedCarrier?.add(1, { reason: 'tracestate_too_large' })
  return {
    submission_traceparent: carrier.traceparent,
    ...(state && !oversized ? { submission_tracestate: state } : {}),
  }
}
export function submissionLinks(job: {
  submission_traceparent?: string | null
  submission_tracestate?: string | null
}): SpanOptions {
  if (!tracer || !job.submission_traceparent) return {}
  const carrier = {
    traceparent: job.submission_traceparent,
    tracestate: job.submission_tracestate ?? '',
  }
  const extracted = trace.getSpanContext(propagator.extract(ROOT_CONTEXT, carrier, getter))
  return extracted ? { links: [{ context: extracted }] } : {}
}
export function injectPeerContext(parent: Context, headers: Headers): boolean {
  if (!tracer) return false
  headers.delete('traceparent')
  headers.delete('tracestate')
  propagator.inject(parent, headers, { set: (target, key, value) => target.set(key, value) })
  return true
}
export function emitJobEvent(
  name: 'job.submitted' | 'job.started' | 'job.closed',
  jobId: number,
  parent: Context,
  status?: string
): void {
  const operationLogger = parent.getValue(operationLoggerKey) as typeof logger
  operationLogger?.emit({
    context: parent,
    eventName: name,
    body: name,
    attributes: { 'inkcre.job.id': jobId, ...(status ? { 'inkcre.job.status': status } : {}) },
  })
}
export { ROOT_CONTEXT, SpanKind, SpanStatusCode }
export type { Context }
