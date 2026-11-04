import { DBAPIClient, rawPostgrestFetch } from '../../base/db-api'
import { Storage, WritableStorage, type IStorageBlock } from './base'
import { PostgreSQLBlobStorage } from './blob'
export type { PostgreSQLBlobPointer } from './blob'

/** Vue model compatibility; byte operations are implemented by the standalone SDK. */
export class PostgreSQLBinaryStorage extends WritableStorage<Uint8Array> {
  private static blobApi = new DBAPIClient<'storage_blobs'>('storage_blobs')
  private readonly content: PostgreSQLBlobStorage

  constructor(
    data: ConstructorParameters<typeof Storage>[0],
    request: typeof rawPostgrestFetch = rawPostgrestFetch,
    blobs = PostgreSQLBinaryStorage.blobApi
  ) {
    super(data)
    this.content = new PostgreSQLBlobStorage(request, blobs)
  }

  protected _getRawContent(block: IStorageBlock): Promise<Uint8Array> {
    return this.content.getRawContent(block.content)
  }

  createRawContent(content: Uint8Array): Promise<string> {
    return this.content.createRawContent(content)
  }

  updateRawContent(pointer: string, content: Uint8Array): Promise<boolean> {
    return this.content.updateRawContent(pointer, content)
  }

  deleteRawContent(pointer: string): Promise<boolean> {
    return this.content.deleteRawContent(pointer)
  }
}

Storage.register('postgresql_binary', PostgreSQLBinaryStorage)
