import { type ByteSolvedContent } from './actual-content'
import { Resolver } from './base'
import { type ProjectionOptions, UnsupportedResolverCapability } from './contracts'

export interface ImageSolvedContent extends ByteSolvedContent {
  format: string | null
  width: number | null
  height: number | null
  frame_count: number | null
}

export class ImageResolver extends Resolver<Uint8Array, ImageSolvedContent> {
  static readonly type = 'core.image.v1'
  private readonly actualContent = this.createByteContent(async (_source: undefined, options) => ({
    content: await this.getRawContent(options),
  }))

  protected async _getSolvedContent(options: ProjectionOptions): Promise<ImageSolvedContent> {
    return {
      ...(await this.actualContent.load(undefined, options)),
      format: null,
      width: null,
      height: null,
      frame_count: null,
    }
  }

  async getText(_options: ProjectionOptions = {}): Promise<never> {
    throw new UnsupportedResolverCapability(ImageResolver.type, 'text')
  }
}
