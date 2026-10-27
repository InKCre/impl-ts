import { Resolver } from './base'
import type { ProjectionOptions } from './contracts'
import { decodeUnicode } from './decode'

/** Source is preserved; GFM rendering belongs to readers, not persistence. */
export class MarkdownResolver extends Resolver<string | Uint8Array, string> {
  static readonly type = 'core.markdown.v1'

  protected async _getSolvedContent(options: ProjectionOptions): Promise<string> {
    return decodeUnicode(await this.getRawContent(options), MarkdownResolver.type)
  }

  async getText(options: ProjectionOptions = {}): Promise<string> {
    return this.getSolvedContent(options)
  }
}
