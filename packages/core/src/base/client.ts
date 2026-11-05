import { PostgrestClient } from '@supabase/postgrest-js'
import type { Database, InkcreSchema, RelationName, RelationRow } from '../database'

type RelationInsert<Relation extends RelationName> = InkcreSchema['Tables'][Relation]['Insert']
type RelationUpdate<Relation extends RelationName> = InkcreSchema['Tables'][Relation]['Update']
export type DatabaseTokenProvider = () => Promise<string>

export interface DatabaseConnection {
  readonly baseUrl: string
  readonly tokenProvider: DatabaseTokenProvider
  /** Borrowed transport; the SDK does not close caller resources. */
  readonly fetch?: typeof globalThis.fetch
}

function encodeTransportValue<Value>(value: unknown): Value {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) {
    throw new TypeError('Database write value must be JSON serializable.')
  }
  return JSON.parse(encoded) as Value
}

function normalizePostgrestBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

/**
 * API Error class for handling API request errors
 */
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: any
  ) {
    super(message)
    this.name = 'APIError'
  }
}

export type RawPostgrestRequestOptions = RequestInit & {
  schema?: 'inkcre'
  baseUrl: string
  tokenProvider: DatabaseTokenProvider
  fetch?: typeof globalThis.fetch
}

/**
 * Execute a PostgREST request whose body or response is not JSON.
 *
 * The regular PostgREST client remains the owner of relational/JSON queries;
 * this seam exists for admitted media contracts such as raw bytea RPCs.
 */
export async function rawPostgrestFetch(
  path: string,
  options: RawPostgrestRequestOptions
): Promise<Response> {
  const {
    schema = 'inkcre',
    baseUrl,
    tokenProvider,
    fetch: fetcher = globalThis.fetch,
    ...init
  } = options
  const configuredBaseUrl = baseUrl
  if (!configuredBaseUrl) {
    throw new APIError('PostgREST URL is not configured.', 0)
  }

  const normalizedBaseUrl = configuredBaseUrl.endsWith('/')
    ? configuredBaseUrl
    : `${configuredBaseUrl}/`
  const url = new URL(path.replace(/^\//, ''), normalizedBaseUrl)
  const token = await tokenProvider()
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  headers.set('Accept-Profile', schema)
  headers.set('Content-Profile', schema)

  const response = await fetcher(url, { ...init, headers })
  if (!response.ok) {
    const errorResponse = response.clone()
    let details: unknown
    try {
      details = await errorResponse.json()
    } catch {
      details = await response.clone().text()
    }
    throw new APIError(
      `PostgREST request failed with status ${response.status}.`,
      response.status,
      details
    )
  }
  return response
}

/** Typed PostgREST operations bound to a caller-owned connection. */
export class DatabaseClient<
  Relation extends RelationName,
  DT = RelationRow<Relation>,
> extends PostgrestClient<Database, {}, 'inkcre'> {
  constructor(
    protected relation: Relation,
    protected defSchema: { parse(input: unknown): DT } | undefined,
    connection: DatabaseConnection
  ) {
    const { baseUrl, tokenProvider, fetch: fetcher = globalThis.fetch } = connection
    const url = new URL(baseUrl)
    if (!['https:', 'http:'].includes(url.protocol)) {
      throw new TypeError('PostgREST URL must use HTTP(S).')
    }
    super(normalizePostgrestBaseUrl(url.href), {
      schema: 'inkcre',
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers)
        headers.set('Authorization', `Bearer ${await tokenProvider()}`)
        return fetcher(input, { ...init, headers })
      },
    })
  }

  /**
   * Get a query builder for the configured relation
   * (PostgREST method)
   */
  public from() {
    return super.from(this.relation)
  }

  public insert(value: unknown) {
    type Insert = RelationInsert<Relation>
    const query = super.from(this.relation)
    const insert = query.insert.bind(query) as unknown as (
      transportValue: Insert | Insert[]
    ) => ReturnType<typeof query.insert>
    return insert(encodeTransportValue<Insert | Insert[]>(value))
  }

  public update(value: unknown) {
    type Update = RelationUpdate<Relation>
    const query = super.from(this.relation)
    const update = query.update.bind(query) as unknown as (
      transportValue: Update
    ) => ReturnType<typeof query.update>
    return update(encodeTransportValue<Update>(value))
  }

  public upsert(value: unknown) {
    type Insert = RelationInsert<Relation>
    const query = super.from(this.relation)
    const upsert = query.upsert.bind(query) as unknown as (
      transportValue: Insert | Insert[]
    ) => ReturnType<typeof query.upsert>
    return upsert(encodeTransportValue<Insert | Insert[]>(value))
  }

  /**
   * Extract the first item from a query response
   * (PostgREST helper method)
   *
   * @param res - Response from a PostgREST query
   * @param schema - Optional schema for parsing the item
   * @returns Parsed first item
   */
  public first<T = DT>(res: { data: unknown[] | null }, schema?: { parse(input: unknown): T }): T {
    const item = res.data?.[0]
    if (item === undefined) {
      throw new APIError(`Relation ${this.relation} returned no rows.`, 404)
    }
    if (schema) return schema.parse(item)
    if (this.defSchema) return this.defSchema.parse(item) as unknown as T
    return item as T
  }
}
