import { z } from 'zod'

import { Resolver } from './base'
import { ResolverContentError, type ProjectionOptions } from './contracts'
import { decodeUnicode } from './decode'

const nonBlankText = z.string().refine((value) => value.trim().length > 0)

export const ExtractionContentSchema = z.strictObject({
  text: nonBlankText,
  basis: z
    .array(
      z.strictObject({
        key: nonBlankText,
        observed_origin: z.strictObject({ label: nonBlankText }),
        excerpts: z.array(nonBlankText).min(1),
      })
    )
    .min(1)
    .refine((groups) => new Set(groups.map((group) => group.key)).size === groups.length),
})

export type ExtractionContent = z.infer<typeof ExtractionContentSchema>

const sourceRelationSchema = z.strictObject({
  kind: z.literal('core.organization.extraction.source.v1'),
  basis_key: nonBlankText,
})

export class ExtractionResultResolver extends Resolver<string | Uint8Array, ExtractionContent> {
  static readonly type = 'core.organization.extraction-result.v1'

  protected async _getSolvedContent(options: ProjectionOptions): Promise<ExtractionContent> {
    const text = decodeUnicode(await this.getRawContent(options), ExtractionResultResolver.type)
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      throw new ResolverContentError(ExtractionResultResolver.type, 'invalid extraction JSON')
    }
    const result = ExtractionContentSchema.safeParse(value)
    if (!result.success) {
      throw new ResolverContentError(ExtractionResultResolver.type, 'invalid extraction content')
    }
    return result.data
  }

  async getText(options: ProjectionOptions = {}): Promise<string> {
    const result = await this.getSolvedContent(options)
    const parts = [`整理正文\n${result.text}`, '原文依据']
    for (const group of result.basis) {
      parts.push(group.observed_origin.label)
      parts.push(
        ...group.excerpts.map((excerpt) =>
          excerpt
            .split('\n')
            .map((line) => `> ${line}`)
            .join('\n')
        )
      )
    }
    return parts.join('\n\n')
  }

  async getSource(basisKey: string, options: ProjectionOptions = {}): Promise<number | null> {
    const result = await this.getSolvedContent(options)
    if (!result.basis.some((group) => group.key === basisKey)) {
      throw new ResolverContentError(ExtractionResultResolver.type, 'unknown basis key')
    }
    const relations = await this.getRelations({ refresh: options.refresh, includeOut: false })
    const sources: number[] = []
    for (const relation of relations) {
      let value: unknown
      try {
        value = JSON.parse(relation.content)
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
        continue
      }
      if (typeof value !== 'object' || value === null || !('kind' in value)) continue
      if (value.kind !== 'core.organization.extraction.source.v1') continue
      const mapping = sourceRelationSchema.safeParse(value)
      if (!mapping.success) {
        throw new ResolverContentError(ExtractionResultResolver.type, 'invalid source mapping')
      }
      if (mapping.data.basis_key === basisKey) sources.push(relation.from_)
    }
    if (sources.length > 1) {
      throw new ResolverContentError(ExtractionResultResolver.type, 'ambiguous source mapping')
    }
    return sources[0] ?? null
  }
}
