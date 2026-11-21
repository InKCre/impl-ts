import { Storage, WritableStorage, type IStorageBlock } from './base'
import {
  S3BlobStorage,
  WebDAVBlobStorage,
  type S3StorageConfig,
  type WebDAVStorageConfig,
} from './remote-blob'

class RemoteWritableStorage extends WritableStorage<Uint8Array> {
  private readonly blobs: S3BlobStorage | WebDAVBlobStorage

  constructor(data: ConstructorParameters<typeof Storage>[0]) {
    super(data)
    this.blobs =
      data.type === 's3'
        ? new S3BlobStorage(this.config as S3StorageConfig)
        : new WebDAVBlobStorage(this.config as WebDAVStorageConfig)
  }

  protected _getRawContent(block: IStorageBlock): Promise<Uint8Array> {
    return this.blobs.getRawContent(block.content)
  }

  createRawContent(content: Uint8Array): Promise<string> {
    return this.blobs.createRawContent(content)
  }

  updateRawContent(pointer: string, content: Uint8Array): Promise<boolean> {
    return this.blobs.updateRawContent(pointer, content)
  }

  deleteRawContent(pointer: string): Promise<boolean> {
    return this.blobs.deleteRawContent(pointer)
  }
}

Storage.register('s3', RemoteWritableStorage)
Storage.register('webdav', RemoteWritableStorage)
