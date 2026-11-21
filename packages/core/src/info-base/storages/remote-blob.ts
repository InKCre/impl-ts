import { AwsClient } from 'aws4fetch'
import { z } from 'zod'
import { readResponseBytes, StorageContentTooLargeError } from './http-body'

const optionsSchema = z.strictObject({
  endpoint: z.string(),
  timeout: z.int().positive().default(30),
  max_bytes: z
    .int()
    .positive()
    .default(64 * 1024 * 1024),
})

const webDAVConfigSchema = optionsSchema.extend({
  username: z
    .string()
    .min(1)
    .refine((username) => !username.includes(':'), {
      message: 'A WebDAV username cannot contain a colon',
    }),
  password: z.string().min(1),
})

const s3ConfigSchema = optionsSchema.extend({
  region: z.string().min(1),
  access_key_id: z.string().min(1),
  secret_access_key: z.string().min(1),
  session_token: z.string().min(1).nullish(),
})

export type WebDAVStorageConfig = z.input<typeof webDAVConfigSchema>
export type S3StorageConfig = z.input<typeof s3ConfigSchema>

const pointerPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function parseEndpoint(input: string): URL {
  // URL accepts and normalizes several malformed forms, so validate the original spelling.
  const authority = /^https?:\/\/([^/]+)/i.exec(input)?.[1]
  if (
    !authority ||
    authority.includes('@') ||
    input !== input.trim() ||
    /[\r\n\t\\?#]/.test(input)
  ) {
    throw new TypeError(
      'Storage endpoint must be an HTTP(S) URL without user info, query or fragment'
    )
  }
  const url = new URL(input)
  url.pathname = url.pathname.replace(/\/+$/, '') + '/'
  return url
}

function validatePointer(pointer: string): void {
  if (pointer.length !== 36 || !pointerPattern.test(pointer)) {
    throw new TypeError('Storage pointer must be a lowercase UUIDv4')
  }
}

function requireSuccess(response: Response): void {
  if (!response.ok || response.status === 207) {
    throw new Error(`Storage request failed with HTTP ${response.status}`)
  }
}

type Method = 'HEAD' | 'GET' | 'PUT' | 'DELETE'
type StorageRequest = {
  method: Method
  headers: Headers
  body?: Uint8Array<ArrayBuffer>
}

abstract class RemoteBlobStorage {
  private readonly endpoint: URL

  protected constructor(private readonly options: z.output<typeof optionsSchema>) {
    this.endpoint = parseEndpoint(options.endpoint)
  }

  async getRawContent(pointer: string): Promise<Uint8Array> {
    const response = await this.request('GET', pointer)
    if (response.status !== 200) {
      throw new Error(`Storage GET expected a complete body, got HTTP ${response.status}`)
    }
    return readResponseBytes(response, this.options.max_bytes)
  }

  async createRawContent(content: Uint8Array): Promise<string> {
    this.validateSize(content)
    const pointer = crypto.randomUUID()
    const response = await this.request('PUT', pointer, { 'If-None-Match': '*' }, content)
    requireSuccess(response)
    return pointer
  }

  async updateRawContent(pointer: string, content: Uint8Array): Promise<boolean> {
    validatePointer(pointer)
    this.validateSize(content)
    const current = await this.request('HEAD', pointer)
    if (current.status === 404) return false
    requireSuccess(current)
    const condition = this.updateCondition(current)
    const response = await this.request('PUT', pointer, { 'If-Match': condition }, content)
    if ([404, 412].includes(response.status) || this.isConcurrentUpdate(response)) return false
    requireSuccess(response)
    return true
  }

  async deleteRawContent(pointer: string): Promise<boolean> {
    const response = await this.request('DELETE', pointer)
    if (response.status !== 404) requireSuccess(response)
    return true
  }

  protected abstract authorize(url: URL, request: StorageRequest): Request | Promise<Request>

  protected updateCondition(_current: Response): string {
    return '*'
  }

  protected isConcurrentUpdate(_response: Response): boolean {
    return false
  }

  private async request(
    method: Method,
    pointer: string,
    headers: Record<string, string> = {},
    content?: Uint8Array
  ): Promise<Response> {
    validatePointer(pointer)
    const target = new URL(pointer, this.endpoint)
    const init: StorageRequest = { method, headers: new Headers(headers) }
    if (content !== undefined) {
      init.headers.set('Content-Type', 'application/octet-stream')
      init.body = Uint8Array.from(content)
    }
    const request = await this.authorize(target, init)
    const response = await fetch(request, {
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(Math.min(this.options.timeout * 1000, 2_147_483_647)),
    })
    if (method !== 'GET' || response.status !== 200) {
      await response.body?.cancel().catch(() => undefined)
    }
    return response
  }

  private validateSize(content: Uint8Array): void {
    if (content.byteLength > this.options.max_bytes) {
      throw new StorageContentTooLargeError(
        `Storage content exceeds ${this.options.max_bytes} bytes`
      )
    }
  }
}

export class WebDAVBlobStorage extends RemoteBlobStorage {
  private readonly authorization: string

  constructor(config: WebDAVStorageConfig) {
    const parsed = webDAVConfigSchema.parse(config)
    super(parsed)
    const encoded = new TextEncoder().encode(`${parsed.username}:${parsed.password}`)
    const binary = Array.from(encoded, (byte) => String.fromCharCode(byte)).join('')
    this.authorization = `Basic ${btoa(binary)}`
  }

  protected authorize(url: URL, request: StorageRequest): Request {
    request.headers.set('Authorization', this.authorization)
    return new Request(url, request)
  }
}

export class S3BlobStorage extends RemoteBlobStorage {
  private readonly client: AwsClient

  constructor(config: S3StorageConfig) {
    const parsed = s3ConfigSchema.parse(config)
    super(parsed)
    this.client = new AwsClient({
      region: parsed.region,
      service: 's3',
      accessKeyId: parsed.access_key_id,
      secretAccessKey: parsed.secret_access_key,
      sessionToken: parsed.session_token ?? undefined,
    })
  }

  protected async authorize(url: URL, request: StorageRequest): Promise<Request> {
    // The signer decodes a bare plus as a space. Encode literal plus signs before signing.
    url.pathname = url.pathname.replace(/\+/g, '%2B')
    if (request.body !== undefined) {
      const digest = await crypto.subtle.digest('SHA-256', request.body)
      const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
      request.headers.set('X-Amz-Content-Sha256', hex.join(''))
    }
    return this.client.sign(url.toString(), { ...request, aws: { allHeaders: true } })
  }

  protected override updateCondition(current: Response): string {
    const etag = current.headers.get('ETag')
    if (!etag) throw new Error('S3 HEAD response is missing the ETag required for update')
    return etag
  }

  protected override isConcurrentUpdate(response: Response): boolean {
    return response.status === 409
  }
}
