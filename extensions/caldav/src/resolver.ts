import { markRaw } from 'vue'
import { Block, Resolver, Storage, type ProjectionOptions } from '@inkcre/core'
import { contentTitle, parseCollection, parseResource, type DAVContent } from './content'
import {
  composeGraph,
  graphContentSchema,
  propertyLinkSchema,
  propertyPrefix,
  resourceUid,
  type GraphProperty,
} from './graph-content'
import DAVContentView from './DAVContent.vue'
import DAVPreview from './DAVPreview.vue'

export class LegacyCalendarResolver extends Resolver<string, DAVContent> {
  static readonly type: string = 'extensions.caldav.calendar.v1'
  static readonly previewRenderer = markRaw(DAVPreview)
  static readonly solvedContentRenderer = markRaw(DAVContentView)

  protected async _getSolvedContent(options: ProjectionOptions): Promise<DAVContent> {
    return parseResource(await this.getRawContent(options), 'calendar')
  }

  async getText(options: ProjectionOptions = {}): Promise<string | null> {
    const content = await this.getSolvedContent(options)
    return content.kind === 'invalid' ? null : content.text
  }
}

export class LegacyContactResolver extends LegacyCalendarResolver {
  static readonly type: string = 'extensions.caldav.contact.v1'
  protected async _getSolvedContent(options: ProjectionOptions): Promise<DAVContent> {
    return parseResource(await this.getRawContent(options), 'contact')
  }
}

async function solveGraph(
  resolver: Resolver<string, DAVContent>,
  kind: 'calendar' | 'contact',
  options: ProjectionOptions
): Promise<DAVContent> {
  const canonical = graphContentSchema.parse(JSON.parse(await resolver.getRawContent(options)))
  const relations = (
    await resolver.getRelations({ includeIn: false, refresh: options.refresh })
  ).filter((relation) => relation.content.startsWith(propertyPrefix))
  const blocks = new Map(
    (await Block.getMany(relations.map((relation) => relation.to_))).map((block) => [
      block.id,
      block,
    ])
  )
  const properties: GraphProperty[] = []
  for (const relation of relations) {
    const block = blocks.get(relation.to_)
    if (!block) throw new Error('DAV property target is missing.')
    const link = propertyLinkSchema.parse(JSON.parse(relation.content.slice(propertyPrefix.length)))
    let value: string | Uint8Array
    if (/^extensions\.caldav\.(calendar|contact)\.v[12]$/.test(block.resolver)) {
      const root = JSON.parse(block.content)
      value = resourceUid(
        block.resolver.endsWith('.v1') ? root.text : graphContentSchema.parse(root).remainder
      )
    } else {
      if (block.storage === null && block.resolver !== 'core.text.v1') {
        throw new Error('DAV inline property requires a text Block.')
      }
      if (
        block.storage !== null &&
        (await Storage.get(block.storage)).type !== 'postgresql_binary'
      ) {
        throw new Error('DAV embedded property requires database-owned bytes.')
      }
      value = await block.getHydratedContent(options)
    }
    properties.push({ id: block.id, link, value })
  }
  const text = composeGraph(canonical.remainder, properties)
  const content = parseResource(JSON.stringify({ href: canonical.href, text }), kind)
  if (content.kind === 'invalid') throw new Error('The DAV graph cannot be rendered.')
  content.links = properties.map(({ id, link, value }) => ({
    id,
    name: link.name.toLowerCase(),
    label: link.params.TYPE?.join(' · ') ?? '',
    value: typeof value === 'string' ? value : '',
  }))
  return content
}

export class CalendarResolver extends LegacyCalendarResolver {
  static readonly type = 'extensions.caldav.calendar.v2'
  protected async _getSolvedContent(options: ProjectionOptions): Promise<DAVContent> {
    return solveGraph(this, 'calendar', options)
  }
}

export class ContactResolver extends LegacyContactResolver {
  static readonly type = 'extensions.caldav.contact.v2'
  protected async _getSolvedContent(options: ProjectionOptions): Promise<DAVContent> {
    return solveGraph(this, 'contact', options)
  }
}

export class LegacyCollectionResolver extends Resolver<string, DAVContent> {
  static readonly type: string = 'extensions.caldav.collection.v1'
  static readonly previewRenderer = markRaw(DAVPreview)
  static readonly solvedContentRenderer = markRaw(DAVContentView)

  protected async _getSolvedContent(options: ProjectionOptions): Promise<DAVContent> {
    const content = parseCollection(await this.getRawContent(options))
    if (content.kind !== 'collection') return content
    const relations = await this.getRelations({ includeIn: false, refresh: options.refresh })
    const blocks = await Block.getMany(
      relations.filter((relation) => relation.content === 'member').map((relation) => relation.to_)
    )
    content.members = blocks.map((block) => {
      const raw = JSON.parse(block.content)
      const kind = block.resolver.includes('.contact.') ? 'contact' : 'calendar'
      const title = parseResource(
        JSON.stringify({ href: raw.href, text: raw.remainder ?? raw.text }),
        kind
      )
      return { id: block.id, title: contentTitle(title) }
    })
    return content
  }

  async getText(options: ProjectionOptions = {}): Promise<string | null> {
    const content = parseCollection(await this.getRawContent(options))
    return content.kind === 'collection' ? content.title : null
  }
}

export class CollectionResolver extends LegacyCollectionResolver {
  static readonly type = 'extensions.caldav.collection.v2'
}
