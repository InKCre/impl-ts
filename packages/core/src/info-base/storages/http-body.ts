export class StorageContentTooLargeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageContentTooLargeError'
  }
}

/** Bound both declared length and decoded bytes as the body arrives. */
export async function readResponseBytes(
  response: Response,
  maximumBytes: number
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (declaredLength > maximumBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new StorageContentTooLargeError(
      `HTTP response declares ${declaredLength} bytes; limit is ${maximumBytes}`
    )
  }
  if (!response.body) return new Uint8Array(await response.arrayBuffer())

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maximumBytes) {
        await reader.cancel().catch(() => undefined)
        throw new StorageContentTooLargeError(`HTTP response exceeded ${maximumBytes} bytes`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const content = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    content.set(chunk, offset)
    offset += chunk.byteLength
  }
  return content
}
