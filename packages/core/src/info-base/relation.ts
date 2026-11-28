import { z } from 'zod'
import { Z } from 'zod-class'
import { DBAPIClient } from '../base/db-api'
import { BlockRefZ, type BlockRef } from './block'
import { makeNumberProp, makeObjectProp } from '../utils/vue-props'

export type RelationRef = number
export const makeRelationProp = (v?: any) => makeObjectProp<Relation>(v)
export const makeRelationRefProp = (v?: any) => makeNumberProp<RelationRef>(v)
export const RelationRefZ = z.number()

/**
 * Relation represents a directed edge between two blocks in the info-base.
 * Relations can have typed content (e.g., "attachment:photo", "reference:cite").
 */
export class Relation extends Z.class({
  id: RelationRefZ,
  updated_at: z.coerce
    .date()
    .optional()
    .default(() => new Date()),
  from_: BlockRefZ,
  to_: BlockRefZ,
  content: z.string(),
}) {
  static dbApi: DBAPIClient<'relations', Relation> = new DBAPIClient<'relations', Relation>(
    'relations',
    Relation
  )

  static async get(id: RelationRef): Promise<Relation> {
    const relation = await this.find(id)
    if (!relation) throw new Error(`Relation ${id} does not exist`)
    return relation
  }

  static async find(
    id: RelationRef,
    options: { requireEndpoints?: boolean } = {}
  ): Promise<Relation | null> {
    let query = this.dbApi.from().select().eq('id', id)
    if (options.requireEndpoints) query = query.not('from_', 'is', null).not('to_', 'is', null)
    const result = await query.maybeSingle()
    if (result.error) throw result.error
    return result.data ? Relation.parse(result.data) : null
  }

  static async getAll(): Promise<Relation[]> {
    return ((await this.dbApi.from().select()).data ?? []).map((item) => Relation.parse(item))
  }

  static async getEndpointPage(options: {
    blockIds: Iterable<BlockRef>
    endpoint: 'from_' | 'to_'
    contents?: Iterable<string>
    cursor?: RelationRef
    limit: number
  }): Promise<Relation[]> {
    const blockIds = [...new Set(options.blockIds)]
    if (blockIds.length === 0 || options.limit <= 0) return []
    const opposite = options.endpoint === 'from_' ? 'to_' : 'from_'
    let query = this.dbApi
      .from()
      .select()
      .in(options.endpoint, blockIds)
      .not(opposite, 'is', null)
      .order('id', { ascending: false })
      .limit(options.limit)
    const contents = [...new Set(options.contents ?? [])]
    if (contents.length > 0) query = query.in('content', contents)
    if (options.cursor !== undefined) query = query.lt('id', options.cursor)
    const result = await query
    if (result.error) throw result.error
    return (result.data ?? []).map((item) => Relation.parse(item))
  }

  /**
   * Get all relations for a block (where block is from_ or to_).
   * @param blockId - The block ID to find relations for
   */
  static async getByBlock(blockId: BlockRef): Promise<Relation[]> {
    const result = await this.dbApi.from().select().or(`from_.eq.${blockId},to_.eq.${blockId}`)
    return (result.data ?? []).map((item) => Relation.parse(item))
  }

  /**
   * Get relations by content pattern (e.g., "attachment:photo").
   * @param blockId - The block ID to find relations for
   * @param pattern - The content pattern to match (prefix match)
   */
  static async getByPattern(blockId: BlockRef, pattern: string): Promise<Relation[]> {
    const result = await this.dbApi
      .from()
      .select()
      .or(`from_.eq.${blockId},to_.eq.${blockId}`)
      .like('content', `${pattern}%`)
    return (result.data ?? []).map((item) => Relation.parse(item))
  }

  public async update(): Promise<Relation> {
    return Relation.dbApi.first(await Relation.dbApi.upsert(this).select())
  }
}

export class RelationForm extends Z.class({
  ...Relation.shape,
  id: z.undefined(),
}) {
  public async create() {
    return Relation.parse((await Relation.dbApi.insert(this).select()).data?.[0])
  }
}
