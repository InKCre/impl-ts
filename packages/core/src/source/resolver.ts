import { z } from 'zod'
import { Resolver } from '../info-base/resolvers/base'
import { ResolverContentError, type ProjectionOptions } from '../info-base/resolvers/contracts'
import { decodeUnicode } from '../info-base/resolvers/decode'

export const SourceAnchorSchema = z.strictObject({
  id: z.number().int(),
  type: z.string(),
  nickname: z.string().nullable().default(null),
})

/** The Source anchor describes collection provenance; its outgoing relations lead to business data. */
export class SourceResolver extends Resolver<string | Uint8Array, string> {
  static readonly type = 'core.source.v1'

  protected async _getSolvedContent(options: ProjectionOptions): Promise<string> {
    const raw = decodeUnicode(await this.getRawContent(options), SourceResolver.type)
    let decoded: unknown
    try {
      decoded = JSON.parse(raw)
    } catch {
      throw new ResolverContentError(SourceResolver.type, 'expected a JSON Source anchor')
    }
    const parsed = SourceAnchorSchema.safeParse(decoded)
    if (!parsed.success)
      throw new ResolverContentError(
        SourceResolver.type,
        'expected Source id, type and optional nickname'
      )
    const source = parsed.data
    const name = source.nickname ? ` named ${source.nickname}` : ''
    return `Source ${source.id}${name} uses ${source.type}.`
  }

  async getText(options: ProjectionOptions = {}): Promise<string> {
    return this.getSolvedContent(options)
  }
}
