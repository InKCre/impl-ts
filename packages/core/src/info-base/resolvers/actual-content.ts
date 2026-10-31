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
