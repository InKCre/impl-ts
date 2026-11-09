import { markRaw } from 'vue'
import { Block, Relation, Resolver, type ProjectionOptions } from '@inkcre/core'
import {
  parseRecord,
  recordTitle,
  resolverTypes,
  type BilibiliRecord,
  type Membership,
} from './schema.ts'
import BilibiliContent from './BilibiliContent.vue'
import BilibiliPreview from './BilibiliPreview.vue'

export type RelatedRecord = BilibiliRecord & { blockId: number; membership?: Membership }
export interface RelatedGroup {
  title: string
  role: 'folders' | 'videos' | 'author' | 'item'
  items: RelatedRecord[]
  nextOffset: number | null
}
export interface SolvedBilibili {
  value: BilibiliRecord
  groups: RelatedGroup[]
}

async function recordBlock(block: Block): Promise<RelatedRecord | null> {
  const content = await block.getHydratedContent()
  if (typeof content !== 'string') throw new Error('B 站资料应为文本记录。')
  const value = parseRecord(block.resolver, JSON.parse(content))
  return value ? { ...value, blockId: block.id } : null
}

async function edges(ids: number[], role: string, incoming = false, offset = 0, limit = 51) {
  if (!ids.length) return []
  const result = await Relation.dbApi
    .from()
    .select()
    .in(incoming ? 'to_' : 'from_', ids)
    .eq('content', role)
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1)
    .throwOnError()
  return (result.data ?? []).map((row) => Relation.parse(row))
}

async function records(ids: number[]) {
  const result = await Promise.all((await Block.getMany(ids)).map(recordBlock))
  return result.filter((value): value is RelatedRecord => value !== null)
}

export abstract class BilibiliResolver extends Resolver<string, SolvedBilibili> {
  static readonly previewRenderer = markRaw(BilibiliPreview)
  static readonly solvedContentRenderer = markRaw(BilibiliContent)

  async readGroup(role: RelatedGroup['role'], offset = 0): Promise<RelatedGroup> {
    const value = parseRecord(this.block.resolver, JSON.parse(await this.getRawContent()))
    if (!value) throw new Error('无法识别 B 站资料类型。')
    let initial: Relation[] = []
    let title = ''
    let items: RelatedRecord[] = []
    if (value.kind === 'user' && role === 'folders') {
      title = '已保存的收藏夹'
      initial = await edges([this.block.id], 'owns', false, offset)
      items = (await records(initial.slice(0, 50).map((edge) => edge.to_))).filter(
        (item) => item.kind === 'folder'
      )
    } else if (value.kind === 'folder' && role === 'videos') {
      title = '已保存的收藏条目'
      initial = await edges([this.block.id], 'contains', false, offset)
      const memberships = (await records(initial.slice(0, 50).map((edge) => edge.to_))).filter(
        (item) => item.kind === 'membership'
      )
      const links = await edges(
        memberships.map((item) => item.blockId),
        'item',
        false,
        0,
        100
      )
      const videos = await records(links.map((edge) => edge.to_))
      for (const membership of memberships) {
        const link = links.find((edge) => edge.from_ === membership.blockId)
        const video = videos.find((item) => item.blockId === link?.to_)
        if (video?.kind === 'video' && membership.kind === 'membership')
          items.push({ ...video, membership: membership.record })
      }
    } else if (value.kind === 'video' && role === 'author') {
      title = 'UP 主'
      initial = await edges([this.block.id], 'author', false, offset)
      items = (await records(initial.slice(0, 50).map((edge) => edge.to_))).filter(
        (item) => item.kind === 'user'
      )
    } else if (value.kind === 'video' && role === 'folders') {
      title = '所在收藏夹'
      initial = await edges([this.block.id], 'item', true, offset)
      const membershipIds = initial.slice(0, 50).map((edge) => edge.from_)
      const memberships = await records(membershipIds)
      const links = await edges(membershipIds, 'contains', true, 0, 100)
      const folders = await records(links.map((edge) => edge.from_))
      for (const membership of memberships) {
        const link = links.find((edge) => edge.to_ === membership.blockId)
        const folder = folders.find((item) => item.blockId === link?.from_)
        if (folder?.kind === 'folder' && membership.kind === 'membership')
          items.push({ ...folder, membership: membership.record })
      }
    } else if (value.kind === 'membership' && role === 'item') {
      title = '视频'
      initial = await edges([this.block.id], 'item', false, offset)
      items = (await records(initial.slice(0, 50).map((edge) => edge.to_))).filter(
        (item) => item.kind === 'video'
      )
    } else throw new Error('此资料没有所选关系。')
    return { title, role, items, nextOffset: initial.length > 50 ? offset + 50 : null }
  }

  protected async _getSolvedContent(options: ProjectionOptions): Promise<SolvedBilibili> {
    const value = parseRecord(this.block.resolver, JSON.parse(await this.getRawContent(options)))
    if (!value) throw new Error('无法识别 B 站资料类型。')
    const roles: RelatedGroup['role'][] =
      value.kind === 'user'
        ? ['folders']
        : value.kind === 'folder'
          ? ['videos']
          : value.kind === 'video'
            ? ['author', 'folders']
            : ['item']
    return { value, groups: await Promise.all(roles.map((role) => this.readGroup(role))) }
  }

  async getText(options: ProjectionOptions = {}): Promise<string> {
    const value = parseRecord(this.block.resolver, JSON.parse(await this.getRawContent(options)))
    if (!value) throw new Error('无法识别 B 站资料类型。')
    const description =
      value.kind === 'video' || value.kind === 'folder' ? value.record.description : undefined
    return [recordTitle(value), description].filter(Boolean).join('\n')
  }
}

export class UserResolver extends BilibiliResolver {
  static readonly type = resolverTypes.user
}
export class FolderResolver extends BilibiliResolver {
  static readonly type = resolverTypes.folder
}
export class VideoResolver extends BilibiliResolver {
  static readonly type = resolverTypes.video
}
export class MembershipResolver extends BilibiliResolver {
  static readonly type = resolverTypes.membership
}
