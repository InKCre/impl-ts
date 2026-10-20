import { markRaw } from 'vue'
import { Block, Resolver, type ProjectionOptions } from '@inkcre/core'
import { contentTitle, parseCollection, parseResource, type DAVContent } from './content'
import DAVContentView from './DAVContent.vue'
import DAVPreview from './DAVPreview.vue'

export class CalendarResolver extends Resolver<string, DAVContent> {
  static readonly type = 'extensions.caldav.calendar.v1'
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

export class ContactResolver extends Resolver<string, DAVContent> {
  static readonly type = 'extensions.caldav.contact.v1'
  static readonly previewRenderer = markRaw(DAVPreview)
  static readonly solvedContentRenderer = markRaw(DAVContentView)

  protected async _getSolvedContent(options: ProjectionOptions): Promise<DAVContent> {
    return parseResource(await this.getRawContent(options), 'contact')
  }

  async getText(options: ProjectionOptions = {}): Promise<string | null> {
    const content = await this.getSolvedContent(options)
    return content.kind === 'invalid' ? null : content.text
  }
}

export class CollectionResolver extends Resolver<string, DAVContent> {
  static readonly type = 'extensions.caldav.collection.v1'
  static readonly previewRenderer = markRaw(DAVPreview)
  static readonly solvedContentRenderer = markRaw(DAVContentView)

  protected async _getSolvedContent(options: ProjectionOptions): Promise<DAVContent> {
    const content = parseCollection(await this.getRawContent(options))
    if (content.kind !== 'collection') return content
    const relations = await this.getRelations({ includeIn: false, refresh: options.refresh })
    const blocks = await Block.getMany(
      relations.filter((relation) => relation.content === 'member').map((relation) => relation.to_)
    )
    content.members = blocks.map((block) => ({
      id: block.id,
      title: contentTitle(
        parseResource(
          block.content,
          block.resolver === ContactResolver.type ? 'contact' : 'calendar'
        )
      ),
    }))
    return content
  }

  async getText(options: ProjectionOptions = {}): Promise<string | null> {
    const content = parseCollection(await this.getRawContent(options))
    return content.kind === 'collection' ? content.title : null
  }
}
