import { watch } from 'vue'
import { configStore } from '../config'
import { authStore } from '../auth'
import { observeOperation, SpanKind, SpanStatusCode } from '../obsrv/telemetry'
import type { RelationName, RelationRow } from '../database'
import {
  DatabaseClient,
  createPostgrestFetch,
  rawPostgrestFetchWithAuthorization,
  type DatabaseTokenProvider,
  type RawPostgrestRequestOptions as ExplicitRequestOptions,
} from './client'

export { APIError } from './client'
export type { DatabaseTokenProvider } from './client'

const observedFetch: typeof fetch = (input, init) =>
  observeOperation(
    'postgrest.http',
    async (_active, span, outcome) => {
      const response = await fetch(input, init)
      span?.setAttribute('http.response.status_code', response.status)
      if (response.status >= 400) {
        outcome.outcome = 'error'
        span?.setStatus({ code: SpanStatusCode.ERROR })
      }
      return response
    },
    { kind: SpanKind.CLIENT }
  )

export type RawPostgrestRequestOptions = Omit<
  ExplicitRequestOptions,
  'baseUrl' | 'tokenProvider'
> & {
  baseUrl?: string
  tokenProvider?: DatabaseTokenProvider
}

/** Compatibility with the published Vue entry; new SDK callers supply a connection. */
export function rawPostgrestFetch(path: string, options: RawPostgrestRequestOptions = {}) {
  const { baseUrl, tokenProvider, fetch: fetcher, ...init } = options
  return rawPostgrestFetchWithAuthorization(
    path,
    {
      ...init,
      baseUrl: baseUrl ?? configStore.metaConfig.INKCRE_PGREST_URL,
      tokenProvider: tokenProvider ?? authStore.getToken,
      fetch: fetcher ?? observedFetch,
    },
    tokenProvider ? undefined : authStore.requestAuthorizer()
  )
}

/** Application-selected default retained for published Vue consumers. */
export class DBAPIClient<
  Relation extends RelationName,
  DT = RelationRow<Relation>,
> extends DatabaseClient<Relation, DT> {
  constructor(
    relation: Relation,
    defSchema?: { parse(input: unknown): DT },
    public schemaName: 'inkcre' = 'inkcre',
    baseUrl = '',
    tokenProvider?: DatabaseTokenProvider
  ) {
    // Unconfigured UI may construct models before the connection form is completed.
    super(relation, defSchema, {
      baseUrl: baseUrl || configStore.metaConfig.INKCRE_PGREST_URL || 'http://unconfigured.invalid',
      tokenProvider: tokenProvider ?? authStore.getToken,
      fetch: observedFetch,
    })
    if (!baseUrl || !tokenProvider) {
      watch(
        () =>
          [
            configStore.metaConfig.INKCRE_PGREST_URL,
            configStore.metaConfig.INKCRE_JWT_SECRET,
          ] as const,
        ([selectedUrl]) => {
          if (!baseUrl) this.url = selectedUrl.replace(/\/+$/, '')
          if (!tokenProvider) {
            // PostgREST builders retain this Fetch when created.
            this.fetch = createPostgrestFetch(observedFetch, authStore.requestAuthorizer())
          }
        },
        { immediate: true, flush: 'sync' }
      )
    }
  }
}
