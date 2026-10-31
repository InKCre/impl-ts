export interface ByteSolvedContent {
  content: Uint8Array
  byte_size: number
  detected_media_type: string | null
  objectUrl: string
}

export class ActualContentHandle {
  private objectUrl: string | null = null
  private disposed = false

  replace(content: Uint8Array, mediaType?: string): ByteSolvedContent {
    // Hydration can finish after its view or cache entry has been disposed.
    if (this.disposed) throw new Error('Resolver content handle is disposed.')
    this.release()
    const blob = new Blob([content as BlobPart], mediaType ? { type: mediaType } : undefined)
    this.objectUrl = URL.createObjectURL(blob)
    return {
      content,
      byte_size: content.byteLength,
      detected_media_type: null,
      objectUrl: this.objectUrl,
    }
  }

  dispose(): void {
    this.disposed = true
    this.release()
  }

  private release(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = null
    }
  }
}

export type ByteContentSource = { content: Uint8Array; mediaType?: string }
export type ByteContentOptions = { refresh?: boolean }

/** A lazy byte operation owned by a Resolver, including its browser handle. */
export interface ByteContentResource<Source> {
  load(source: Source, options?: ByteContentOptions): Promise<ByteSolvedContent>
}

export class ManagedByteContent<Source> implements ByteContentResource<Source> {
  private readonly handle = new ActualContentHandle()
  private content: ByteSolvedContent | null = null
  private contentSource: Source | undefined
  private pending: {
    source: Source
    refresh: boolean
    promise: Promise<ByteSolvedContent>
  } | null = null
  private disposed = false

  constructor(
    private readonly read: (
      source: Source,
      options: ByteContentOptions
    ) => Promise<ByteContentSource>
  ) {}

  load(source: Source, options: ByteContentOptions = {}): Promise<ByteSolvedContent> {
    if (this.disposed) return Promise.reject(new Error('Resolver is disposed.'))
    const refresh = options.refresh ?? false
    const previous = this.pending
    if (previous?.refresh === refresh && Object.is(previous.source, source)) return previous.promise
    if (!previous && this.content && Object.is(this.contentSource, source) && !refresh)
      return Promise.resolve(this.content)
    const promise = (async () => {
      await previous?.promise.catch(() => undefined)
      if (this.disposed) throw new Error('Resolver is disposed.')
      const loaded = await this.read(source, { refresh })
      // The handle owns both replacement and late-arrival rejection.
      this.content = this.handle.replace(loaded.content, loaded.mediaType)
      this.contentSource = source
      return this.content
    })().finally(() => {
      if (this.pending?.promise === promise) this.pending = null
    })
    this.pending = { source, refresh, promise }
    return promise
  }

  dispose(): void {
    this.disposed = true
    this.handle.dispose()
    this.content = null
  }
}
