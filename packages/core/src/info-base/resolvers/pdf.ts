import { type ByteSolvedContent } from './actual-content'
import { Resolver } from './base'
import { type ProjectionOptions, UnsupportedResolverCapability } from './contracts'

export interface PdfSolvedContent extends ByteSolvedContent {
  pdf_version: string | null
  page_count: number | null
  is_encrypted: boolean | null
  title: string | null
  author: string | null
}

export class PdfResolver extends Resolver<Uint8Array, PdfSolvedContent> {
  static readonly type = 'core.pdf.v1'
  private readonly actualContent = this.createByteContent(async (_source: undefined, options) => ({
    content: await this.getRawContent(options),
    mediaType: 'application/pdf',
  }))

  protected async _getSolvedContent(options: ProjectionOptions): Promise<PdfSolvedContent> {
    return {
      ...(await this.actualContent.load(undefined, options)),
      pdf_version: null,
      page_count: null,
      is_encrypted: null,
      title: null,
      author: null,
    }
  }

  async getText(_options: ProjectionOptions = {}): Promise<never> {
    throw new UnsupportedResolverCapability(PdfResolver.type, 'text')
  }
}
