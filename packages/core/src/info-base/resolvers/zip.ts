import { type ByteSolvedContent } from './actual-content'
import { Resolver } from './base'
import { type ProjectionOptions, UnsupportedResolverCapability } from './contracts'

export interface ZipSolvedContent extends ByteSolvedContent {
  member_count: number | null
  total_compressed_bytes: number | null
  total_uncompressed_bytes: number | null
  compression_methods: number[] | null
  encrypted_member_count: number | null
}

export class ZipResolver extends Resolver<Uint8Array, ZipSolvedContent> {
  static readonly type = 'core.zip.v1'
  private readonly actualContent = this.createByteContent(async (_source: undefined, options) => ({
    content: await this.getRawContent(options),
    mediaType: 'application/zip',
  }))

  protected async _getSolvedContent(options: ProjectionOptions): Promise<ZipSolvedContent> {
    return {
      ...(await this.actualContent.load(undefined, options)),
      member_count: null,
      total_compressed_bytes: null,
      total_uncompressed_bytes: null,
      compression_methods: null,
      encrypted_member_count: null,
    }
  }

  async getText(_options: ProjectionOptions = {}): Promise<never> {
    throw new UnsupportedResolverCapability(ZipResolver.type, 'text')
  }
}
