import { Block, Resolver, type ProjectionOptions } from '@inkcre/core'
import {
  WEB_RECORD_RESOLVER,
  selectMaterialParts,
  WEB_MATERIAL_RESOLVER,
  type SourceRecord,
  type MaterialMetadata,
} from './index'

export type WebCollectionContent = {
  mode: 'record' | 'current' | 'fixed'
  source: SourceRecord
  material?: MaterialMetadata
}

/** Consumers bind their own presentation, just as for the core semantic resolvers. */
abstract class WebCollectionResolver extends Resolver<string, WebCollectionContent> {
  protected async _getSolvedContent(options: ProjectionOptions): Promise<WebCollectionContent> {
    return JSON.parse(await this.getRawContent(options)) as WebCollectionContent
  }

  async getText(options: ProjectionOptions = {}): Promise<string> {
    const root = await this.getSolvedContent(options)
    const text = [
      root.material?.title ?? root.source.metadata.title,
      root.material?.url ?? root.source.metadata.url,
    ].filter((value): value is string => typeof value === 'string')
    const relations = await this.getRelations({ ...options, includeIn: false, includeOut: true })
    const body = selectMaterialParts(relations).body
    if (body?.to_ !== undefined && body.to_ !== null) {
      const block = await Block.get(body.to_)
      // PDF retains its existing root metadata projection; its text capability stays unsupported.
      if (block.resolver !== 'core.pdf.v1')
        text.push((await new (Resolver.getClass(block.resolver))(block).getText(options)) ?? '')
    }
    return text.filter(Boolean).join('\n\n')
  }
}

export class WebRecordResolver extends WebCollectionResolver {
  static readonly type = WEB_RECORD_RESOLVER
}
export class WebMaterialResolver extends WebCollectionResolver {
  static readonly type = WEB_MATERIAL_RESOLVER
}
