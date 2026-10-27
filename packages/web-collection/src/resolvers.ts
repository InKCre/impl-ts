import { Block, Resolver, TextResolver, type ProjectionOptions } from '@inkcre/core'
import {
  WEB_RECORD_RESOLVER,
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
    const body = relations.find(
      (relation) => relation.content === 'extensions.web-collection.part.text'
    )
    if (body?.to_ !== undefined)
      text.push(await new TextResolver(await Block.get(body.to_)).getText(options))
    return text.filter(Boolean).join('\n\n')
  }
}

export class WebRecordResolver extends WebCollectionResolver {
  static readonly type = WEB_RECORD_RESOLVER
}
export class WebMaterialResolver extends WebCollectionResolver {
  static readonly type = WEB_MATERIAL_RESOLVER
}
