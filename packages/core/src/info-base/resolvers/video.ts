import { type ByteSolvedContent } from './actual-content'
import { Resolver } from './base'
import { type ProjectionOptions, UnsupportedResolverCapability } from './contracts'

export interface VideoSolvedContent extends ByteSolvedContent {
  container: string | null
  video_codec: string | null
  duration_ms: number | null
  width: number | null
  height: number | null
  frame_rate: number | null
}

export class VideoResolver extends Resolver<Uint8Array, VideoSolvedContent> {
  static readonly type = 'core.video.v1'
  private readonly actualContent = this.createByteContent(async (_source: undefined, options) => ({
    content: await this.getRawContent(options),
  }))

  protected async _getSolvedContent(options: ProjectionOptions): Promise<VideoSolvedContent> {
    return {
      ...(await this.actualContent.load(undefined, options)),
      container: null,
      video_codec: null,
      duration_ms: null,
      width: null,
      height: null,
      frame_rate: null,
    }
  }

  async getText(_options: ProjectionOptions = {}): Promise<never> {
    throw new UnsupportedResolverCapability(VideoResolver.type, 'text')
  }
}
