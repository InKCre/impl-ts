import { type ByteSolvedContent } from './actual-content'
import { Resolver } from './base'
import { type ProjectionOptions, UnsupportedResolverCapability } from './contracts'

export type FileSolvedContent = ByteSolvedContent

export class FileResolver extends Resolver<Uint8Array, FileSolvedContent> {
  static readonly type = 'core.file.v1'
  private readonly actualContent = this.createByteContent(async (_source: undefined, options) => ({
    content: await this.getRawContent(options),
  }))

  protected async _getSolvedContent(options: ProjectionOptions): Promise<FileSolvedContent> {
    return this.actualContent.load(undefined, options)
  }

  async getText(_options: ProjectionOptions = {}): Promise<never> {
    throw new UnsupportedResolverCapability(FileResolver.type, 'text')
  }
}
