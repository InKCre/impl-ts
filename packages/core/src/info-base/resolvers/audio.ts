import { ActualContentHandle, type ByteSolvedContent } from './actual-content'
import { Resolver } from './base'
import { type ProjectionOptions, UnsupportedResolverCapability } from './contracts'

export interface AudioSolvedContent extends ByteSolvedContent {
  container: string | null
  codec: string | null
  duration_ms: number | null
  channels: number | null
  sample_rate_hz: number | null
  bitrate_bps: number | null
}

export class AudioResolver extends Resolver<Uint8Array, AudioSolvedContent> {
  static readonly type = 'core.audio.v1'
  private readonly actualContent = new ActualContentHandle()

  protected async _getSolvedContent(options: ProjectionOptions): Promise<AudioSolvedContent> {
    const rawContent = await this.getRawContent(options)
    return {
      ...this.actualContent.replace(rawContent),
      container: null,
      codec: null,
      duration_ms: null,
      channels: null,
      sample_rate_hz: null,
      bitrate_bps: null,
    }
  }

  async getText(_options: ProjectionOptions = {}): Promise<never> {
    throw new UnsupportedResolverCapability(AudioResolver.type, 'text')
  }

  async dispose(): Promise<void> {
    this.actualContent.dispose()
    await super.dispose()
  }
}
