import { Storage, type IStorageBlock } from './base'
import { readResponseBytes } from './http-body'

export { StorageContentTooLargeError } from './http-body'

export type HttpStorageConfig = {
  timeout?: number
  follow_redirects?: boolean
  max_response_bytes?: number
}

const DEFAULT_TIMEOUT_SECONDS = 30
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024 * 1024

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/** Fetch opaque bytes over HTTP(S) without assigning content semantics. */
export class HttpStorage extends Storage<Uint8Array> {
  protected async _getRawContent(block: IStorageBlock): Promise<Uint8Array> {
    const url = block.content.trim()
    const parsedUrl = new URL(url)
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new TypeError('HTTP storage pointer must use http:// or https://')
    }

    const config = this.config as HttpStorageConfig
    const timeoutSeconds = positiveNumber(config.timeout, DEFAULT_TIMEOUT_SECONDS)
    const maximumBytes = positiveNumber(config.max_response_bytes, DEFAULT_MAX_RESPONSE_BYTES)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000)

    try {
      const response = await fetch(parsedUrl, {
        signal: controller.signal,
        redirect: config.follow_redirects === false ? 'manual' : 'follow',
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      return await readResponseBytes(response, maximumBytes)
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

Storage.register('http', HttpStorage)
