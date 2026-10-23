import { z } from 'zod'

import { APIError, DBAPIClient, rawPostgrestFetch } from '../../base/db-api'
import { Storage, WritableStorage, type IStorageBlock } from './base'

const PostgreSQLBlobPointerSchema = z.object({
  blob_id: z.uuid(),
})

export type PostgreSQLBlobPointer = z.infer<typeof PostgreSQLBlobPointerSchema>

function parsePointer(blockContent: string): PostgreSQLBlobPointer {
  return PostgreSQLBlobPointerSchema.parse(JSON.parse(blockContent))
}

function serializePointer(pointer: PostgreSQLBlobPointer): string {
  return JSON.stringify(PostgreSQLBlobPointerSchema.parse(pointer))
}

function postgresBytea(content: Uint8Array): string {
  let hexadecimal = '\\x'
  for (const byte of content) hexadecimal += byte.toString(16).padStart(2, '0')
  return hexadecimal
}

/** PostgreSQL/PostgREST peer-local byte storage with a stable UUID pointer. */
export class PostgreSQLBinaryStorage extends WritableStorage<Uint8Array> {
  private static blobApi = new DBAPIClient<'storage_blobs'>('storage_blobs')

  constructor(
    data: ConstructorParameters<typeof Storage>[0],
    private readonly request: typeof rawPostgrestFetch = rawPostgrestFetch,
    private readonly blobs = PostgreSQLBinaryStorage.blobApi
  ) {
    super(data)
  }

  protected async _getRawContent(block: IStorageBlock): Promise<Uint8Array> {
    const pointer = parsePointer(block.content)
    const response = await this.request('/rpc/read_storage_blob', {
      method: 'POST',
      headers: {
        Accept: 'application/octet-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(pointer),
    })
    return new Uint8Array(await response.arrayBuffer())
  }

  async createRawContent(content: Uint8Array): Promise<string> {
    const response = await this.request('/rpc/create_storage_blob', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/octet-stream',
      },
      body: Uint8Array.from(content).buffer as ArrayBuffer,
    })
    const blobId = z.uuid().parse(await response.json())
    return serializePointer({ blob_id: blobId })
  }

  async updateRawContent(blockContent: string, content: Uint8Array): Promise<boolean> {
    const pointer = parsePointer(blockContent)
    const { data, error } = await this.blobs
      .update({ data: postgresBytea(content) })
      .eq('id', pointer.blob_id)
      .select('id')
    if (error) throw new APIError(error.message, 400, error)
    return data?.length === 1
  }

  async deleteRawContent(blockContent: string): Promise<boolean> {
    const pointer = parsePointer(blockContent)
    const { data, error } = await this.blobs.from().delete().eq('id', pointer.blob_id).select('id')
    if (error) throw new APIError(error.message, 400, error)
    return data?.length === 1
  }
}

Storage.register('postgresql_binary', PostgreSQLBinaryStorage)
