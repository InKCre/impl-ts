import { markRaw } from 'vue'
import { Block, Resolver, type ProjectionOptions } from '@inkcre/core'
import {
  AccountSchema,
  RepositorySchema,
  ListSchema,
  type Account,
  type Repository,
  type GitHubList,
  type RelatedRecord,
  type RelatedGroup,
  type SolvedGitHub,
} from './schema'
import ContentAccount from './components/ContentAccount.vue'
import ContentAccountPreview from './components/ContentAccountPreview.vue'
import ContentRepository from './components/ContentRepository.vue'
import ContentRepositoryPreview from './components/ContentRepositoryPreview.vue'
import ContentList from './components/ContentList.vue'
import ContentListPreview from './components/ContentListPreview.vue'

function relatedRecord(block: Block): RelatedRecord | null {
  if (![AccountResolver.type, RepositoryResolver.type, ListResolver.type].includes(block.resolver))
    return null
  const content: unknown = JSON.parse(block.content)
  switch (block.resolver) {
    case AccountResolver.type:
      return { type: 'account', content: AccountSchema.parse(content) }
    case RepositoryResolver.type:
      return { type: 'repository', content: RepositorySchema.parse(content) }
    case ListResolver.type:
      return { type: 'list', content: ListSchema.parse(content) }
    default:
      return null
  }
}
interface Relationship {
  title: string
  role: 'owns' | 'stars' | 'contains'
  incoming?: boolean
  type: RelatedRecord['type']
}
async function relatedGroups(
  resolver: Resolver,
  relationships: Relationship[]
): Promise<RelatedGroup[]> {
  // A graph scene can preload only a bounded incident fragment; membership needs stored edges.
  const relations = await resolver.getRelations({ refresh: true })
  const groups: RelatedGroup[] = []
  for (const relationship of relationships) {
    const matches = relations.filter((relation) => {
      const focal = relationship.incoming ? relation.to_ : relation.from_
      return focal === resolver.block.id && relation.content === relationship.role
    })
    const refs = new Set(
      matches.map((relation) => (relationship.incoming ? relation.from_ : relation.to_))
    )
    const blocks = await Promise.all([...refs].map((ref) => Block.find(ref)))
    const group: RelatedGroup = { title: relationship.title, blocks: [] }
    for (const block of blocks) {
      if (!block) continue
      const record = relatedRecord(block)
      if (record?.type === relationship.type) group.blocks.push({ ...record, blockId: block.id })
    }
    groups.push(group)
  }
  return groups
}

export class AccountResolver extends Resolver<string, SolvedGitHub<Account>> {
  static readonly type = 'extensions.github.account.v1'
  static readonly previewRenderer = markRaw(ContentAccountPreview)
  static readonly solvedContentRenderer = markRaw(ContentAccount)
  protected async _getSolvedContent(options: ProjectionOptions): Promise<SolvedGitHub<Account>> {
    return {
      record: AccountSchema.parse(JSON.parse(await this.getRawContent(options))),
      groups: await relatedGroups(this, [
        { title: 'Starred repositories', role: 'stars', type: 'repository' },
        { title: 'Owned repositories', role: 'owns', type: 'repository' },
        { title: 'Lists', role: 'owns', type: 'list' },
      ]),
    }
  }
  async getText(options: ProjectionOptions = {}): Promise<string> {
    const account = AccountSchema.parse(JSON.parse(await this.getRawContent(options)))
    return account.name ? `${account.name} (@${account.login})` : `@${account.login}`
  }
}
export class RepositoryResolver extends Resolver<string, SolvedGitHub<Repository>> {
  static readonly type = 'extensions.github.repository.v1'
  static readonly previewRenderer = markRaw(ContentRepositoryPreview)
  static readonly solvedContentRenderer = markRaw(ContentRepository)
  protected async _getSolvedContent(options: ProjectionOptions): Promise<SolvedGitHub<Repository>> {
    return {
      record: RepositorySchema.parse(JSON.parse(await this.getRawContent(options))),
      groups: await relatedGroups(this, [
        { title: 'Owner', role: 'owns', incoming: true, type: 'account' },
      ]),
    }
  }
  async getText(options: ProjectionOptions = {}): Promise<string> {
    const repository = RepositorySchema.parse(JSON.parse(await this.getRawContent(options)))
    return [
      repository.name_with_owner,
      repository.description,
      repository.primary_language ? `Language: ${repository.primary_language}` : null,
      repository.topics.length ? `Topics: ${repository.topics.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join('\n')
  }
}
export class ListResolver extends Resolver<string, SolvedGitHub<GitHubList>> {
  static readonly type = 'extensions.github.list.v1'
  static readonly previewRenderer = markRaw(ContentListPreview)
  static readonly solvedContentRenderer = markRaw(ContentList)
  protected async _getSolvedContent(options: ProjectionOptions): Promise<SolvedGitHub<GitHubList>> {
    return {
      record: ListSchema.parse(JSON.parse(await this.getRawContent(options))),
      groups: await relatedGroups(this, [
        { title: 'Owner', role: 'owns', incoming: true, type: 'account' },
        { title: 'Repositories', role: 'contains', type: 'repository' },
      ]),
    }
  }
  async getText(options: ProjectionOptions = {}): Promise<string> {
    const list = ListSchema.parse(JSON.parse(await this.getRawContent(options)))
    return [list.name, list.description].filter(Boolean).join('\n')
  }
}
