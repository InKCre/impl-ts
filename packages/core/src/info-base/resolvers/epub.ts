import { ActualContentHandle, type ByteSolvedContent } from './actual-content'
import { Resolver } from './base'
import { type ProjectionOptions, UnsupportedResolverCapability } from './contracts'

export interface EpubSolvedContent extends ByteSolvedContent {
  epub_version: string | null
  title: string | null
  creators: string[] | null
  languages: string[] | null
  modified_at: Date | null
  manifest_count: number | null
  spine_count: number | null
  has_navigation: boolean | null
}

export class EpubResolver extends Resolver<Uint8Array, EpubSolvedContent> {
  static readonly type = 'core.epub.v1'
  private readonly actualContent = new ActualContentHandle()

  protected async _getSolvedContent(options: ProjectionOptions): Promise<EpubSolvedContent> {
    const rawContent = await this.getRawContent(options)
    return {
      ...this.actualContent.replace(rawContent, 'application/epub+zip'),
      epub_version: null,
      title: null,
      creators: null,
      languages: null,
      modified_at: null,
      manifest_count: null,
      spine_count: null,
      has_navigation: null,
    }
  }

  async getText(_options: ProjectionOptions = {}): Promise<never> {
    throw new UnsupportedResolverCapability(EpubResolver.type, 'text')
  }

  async dispose(): Promise<void> {
    this.actualContent.dispose()
    await super.dispose()
  }
}
