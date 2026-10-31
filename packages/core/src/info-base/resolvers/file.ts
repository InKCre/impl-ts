import { ActualContentHandle, type ByteSolvedContent } from './actual-content'
import { Resolver } from './base'
import { type ProjectionOptions, UnsupportedResolverCapability } from './contracts'

export type FileSolvedContent = ByteSolvedContent

export class FileResolver extends Resolver<Uint8Array, FileSolvedContent> {
  static readonly type = 'core.file.v1'
  private readonly actualContent = new ActualContentHandle()

  protected async _getSolvedContent(options: ProjectionOptions): Promise<FileSolvedContent> {
    return this.actualContent.replace(await this.getRawContent(options))
  }

  async getText(_options: ProjectionOptions = {}): Promise<never> {
    throw new UnsupportedResolverCapability(FileResolver.type, 'text')
  }

  async dispose(): Promise<void> {
    this.actualContent.dispose()
    await super.dispose()
  }
}
