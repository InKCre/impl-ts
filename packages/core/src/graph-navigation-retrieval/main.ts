import { z } from 'zod'

import { Block, BlockRefZ, type BlockRef } from '../info-base/block'
import { Relation, RelationRefZ, type RelationRef } from '../info-base/relation'
import { zinstance } from '../utils'

export const GraphDirectionSchema = z.enum(['in', 'out', 'both'])
export type GraphDirection = z.infer<typeof GraphDirectionSchema>

export const GraphModelSchema = z.object({
  blocks: z.array(zinstance<Block>(Block)),
  relations: z.array(zinstance<Relation>(Relation)),
})
export interface GraphModel {
  blocks: Block[]
  relations: Relation[]
}

export const BlockNeighborhoodSchema = z.object({
  focal_block: BlockRefZ,
  graph: GraphModelSchema,
  next_cursor: RelationRefZ.nullable(),
})
export interface BlockNeighborhood {
  focal_block: BlockRef
  graph: GraphModel
  next_cursor: RelationRef | null
}

export const RelationNeighborhoodSchema = z.object({
  focal_relation: RelationRefZ,
  graph: GraphModelSchema,
})
export interface RelationNeighborhood {
  focal_relation: RelationRef
  graph: GraphModel
}

export const PathFoundSchema = z.object({
  status: z.literal('found'),
  graph: GraphModelSchema,
  block_path: z.array(BlockRefZ),
  relation_path: z.array(RelationRefZ),
})
export const PathNotFoundSchema = z.object({ status: z.literal('not_found') })
export const PathLimitReachedSchema = z.object({ status: z.literal('limit_reached') })
export const PathResultSchema = z.discriminatedUnion('status', [
  PathFoundSchema,
  PathNotFoundSchema,
  PathLimitReachedSchema,
])
export type PathResult =
  | { status: 'found'; graph: GraphModel; block_path: BlockRef[]; relation_path: RelationRef[] }
  | { status: 'not_found' }
  | { status: 'limit_reached' }

const DEFAULT_NEIGHBORHOOD_LIMIT = 20
const MAX_NEIGHBORHOOD_LIMIT = 100
const DEFAULT_MAX_HOPS = 4
const MAX_MAX_HOPS = 8
const DEFAULT_MAX_EXPLORED_BLOCKS = 1000
const MAX_MAX_EXPLORED_BLOCKS = 10000
const FRONTIER_QUERY_SIZE = 200
const FRONTIER_RELATION_PAGE_SIZE = 1000

type PathStep = { block: BlockRef; relation: RelationRef } | null

export class GraphNavigationRetrievalManager {
  static getRandomBlock(): Promise<Block | null> {
    return Block.getRandom()
  }

  static async getBlockNeighborhood(
    focalBlock: BlockRef,
    options: {
      direction?: GraphDirection
      contents?: Iterable<string>
      limit?: number
      cursor?: RelationRef
    } = {}
  ): Promise<BlockNeighborhood | null> {
    const direction = options.direction ?? 'both'
    const limit = options.limit ?? DEFAULT_NEIGHBORHOOD_LIMIT
    if (limit < 1 || limit > MAX_NEIGHBORHOOD_LIMIT) {
      throw new RangeError(`limit must be between 1 and ${MAX_NEIGHBORHOOD_LIMIT}`)
    }
    const focal = await Block.find(focalBlock)
    if (!focal) return null
    const requested = limit + 1
    const queries: Promise<Relation[]>[] = []
    if (direction === 'out' || direction === 'both') {
      queries.push(
        Relation.getEndpointPage({
          blockIds: [focalBlock],
          endpoint: 'from_',
          contents: options.contents,
          cursor: options.cursor,
          limit: requested,
        })
      )
    }
    if (direction === 'in' || direction === 'both') {
      queries.push(
        Relation.getEndpointPage({
          blockIds: [focalBlock],
          endpoint: 'to_',
          contents: options.contents,
          cursor: options.cursor,
          limit: requested,
        })
      )
    }
    const relationById = new Map(
      (await Promise.all(queries)).flat().map((relation) => [relation.id, relation])
    )
    const page = [...relationById.values()].sort((a, b) => b.id - a.id).slice(0, requested)
    const hasMore = page.length > limit
    const visiblePage = page.slice(0, limit)
    const blocks = await Block.getMany([
      focalBlock,
      ...visiblePage.flatMap((relation) => [relation.from_, relation.to_]),
    ])
    const blockIds = new Set(blocks.map((block) => block.id))
    const relations = visiblePage.filter(
      (relation) => blockIds.has(relation.from_) && blockIds.has(relation.to_)
    )
    return BlockNeighborhoodSchema.parse({
      focal_block: focalBlock,
      graph: { blocks, relations },
      next_cursor:
        hasMore && visiblePage.length > 0 ? visiblePage[visiblePage.length - 1]!.id : null,
    }) as BlockNeighborhood
  }

  static async getRelationNeighborhood(
    focalRelation: RelationRef
  ): Promise<RelationNeighborhood | null> {
    const relation = await Relation.find(focalRelation, { requireEndpoints: true })
    if (!relation) return null
    const endpoints = new Set([relation.from_, relation.to_])
    const blocks = await Block.getMany(endpoints)
    const blockIds = new Set(blocks.map((block) => block.id))
    if (blockIds.size !== endpoints.size || [...endpoints].some((id) => !blockIds.has(id)))
      return null
    return RelationNeighborhoodSchema.parse({
      focal_relation: focalRelation,
      graph: { blocks, relations: [relation] },
    }) as RelationNeighborhood
  }

  static async findPath(
    fromBlock: BlockRef,
    toBlock: BlockRef,
    options: {
      direction?: GraphDirection
      contents?: Iterable<string>
      maxHops?: number
      maxExploredBlocks?: number
    } = {}
  ): Promise<PathResult> {
    const direction = options.direction ?? 'both'
    const contents = [...new Set(options.contents ?? [])]
    const maxHops = options.maxHops ?? DEFAULT_MAX_HOPS
    const maxExplored = options.maxExploredBlocks ?? DEFAULT_MAX_EXPLORED_BLOCKS
    if (maxHops < 0 || maxHops > MAX_MAX_HOPS) {
      throw new RangeError(`maxHops must be between 0 and ${MAX_MAX_HOPS}`)
    }
    if (maxExplored < 1 || maxExplored > MAX_MAX_EXPLORED_BLOCKS) {
      throw new RangeError(`maxExploredBlocks must be between 1 and ${MAX_MAX_EXPLORED_BLOCKS}`)
    }
    const endpoints = await Block.getMany([fromBlock, toBlock])
    if (new Set(endpoints.map((block) => block.id)).size !== (fromBlock === toBlock ? 1 : 2)) {
      return { status: 'not_found' }
    }
    if (fromBlock === toBlock) {
      return PathFoundSchema.parse({
        status: 'found',
        graph: { blocks: endpoints, relations: [] },
        block_path: [fromBlock],
        relation_path: [],
      }) as PathResult
    }
    if (maxExplored < 2) return { status: 'limit_reached' }

    const forwardSteps = new Map<BlockRef, PathStep>([[fromBlock, null]])
    const backwardSteps = new Map<BlockRef, PathStep>([[toBlock, null]])
    const forwardDepths = new Map<BlockRef, number>([[fromBlock, 0]])
    const backwardDepths = new Map<BlockRef, number>([[toBlock, 0]])
    let forwardFrontier = new Set([fromBlock])
    let backwardFrontier = new Set([toBlock])
    const traversedRelations = new Map<RelationRef, Relation>()
    const exploredBlocks = new Set([fromBlock, toBlock])

    while (forwardFrontier.size > 0 && backwardFrontier.size > 0) {
      const forwardLevel = forwardDepths.get(forwardFrontier.values().next().value!)!
      const backwardLevel = backwardDepths.get(backwardFrontier.values().next().value!)!
      if (forwardLevel + backwardLevel >= maxHops) return { status: 'limit_reached' }
      const expandForward = forwardFrontier.size <= backwardFrontier.size
      const expanded = await this.expandFrontier({
        frontier: expandForward ? forwardFrontier : backwardFrontier,
        direction,
        contents,
        reverse: !expandForward,
        ownSteps: expandForward ? forwardSteps : backwardSteps,
        ownDepths: expandForward ? forwardDepths : backwardDepths,
        otherDepths: expandForward ? backwardDepths : forwardDepths,
        maxHops,
        maxExplored,
        exploredBlocks,
        traversedRelations,
      })
      if (!expanded) return { status: 'limit_reached' }
      if (expandForward) forwardFrontier = expanded.frontier
      else backwardFrontier = expanded.frontier
      if (expanded.meeting !== null) {
        return this.assemblePath({
          fromBlock,
          toBlock,
          meeting: expanded.meeting,
          forwardSteps,
          backwardSteps,
          traversedRelations,
        })
      }
    }
    return { status: 'not_found' }
  }

  private static async expandFrontier(options: {
    frontier: Set<BlockRef>
    direction: GraphDirection
    contents: string[]
    reverse: boolean
    ownSteps: Map<BlockRef, PathStep>
    ownDepths: Map<BlockRef, number>
    otherDepths: Map<BlockRef, number>
    maxHops: number
    maxExplored: number
    exploredBlocks: Set<BlockRef>
    traversedRelations: Map<RelationRef, Relation>
  }): Promise<{ frontier: Set<BlockRef>; meeting: BlockRef | null } | null> {
    const blocks = [...options.frontier]
    const nextFrontier = new Set<BlockRef>()
    let meeting: BlockRef | null = null
    let bestHops = Number.POSITIVE_INFINITY
    for (let offset = 0; offset < blocks.length; offset += FRONTIER_QUERY_SIZE) {
      const chunk = new Set(blocks.slice(offset, offset + FRONTIER_QUERY_SIZE))
      const relations = this.getFrontierRelations(
        chunk,
        options.direction,
        options.contents,
        options.reverse
      )
      for await (const relation of relations) {
        for (const [current, neighbor] of this.relationSteps(
          relation,
          chunk,
          options.direction,
          options.reverse
        )) {
          if (options.ownSteps.has(neighbor)) continue
          options.exploredBlocks.add(neighbor)
          if (options.exploredBlocks.size > options.maxExplored) return null
          options.traversedRelations.set(relation.id, relation)
          options.ownSteps.set(neighbor, { block: current, relation: relation.id })
          options.ownDepths.set(neighbor, options.ownDepths.get(current)! + 1)
          nextFrontier.add(neighbor)
          const otherDepth = options.otherDepths.get(neighbor)
          if (otherDepth === undefined) continue
          const hops = options.ownDepths.get(neighbor)! + otherDepth
          if (hops <= options.maxHops && hops < bestHops) {
            bestHops = hops
            meeting = neighbor
          }
        }
      }
    }
    return { frontier: nextFrontier, meeting }
  }

  private static async *getFrontierRelations(
    frontier: Set<BlockRef>,
    direction: GraphDirection,
    contents: string[],
    reverse: boolean
  ): AsyncGenerator<Relation> {
    const needsFrom = reverse ? direction !== 'out' : direction !== 'in'
    const needsTo = reverse ? direction !== 'in' : direction !== 'out'
    const endpoints: ('from_' | 'to_')[] = []
    if (needsFrom) endpoints.push('from_')
    if (needsTo) endpoints.push('to_')
    for (const endpoint of endpoints) {
      let cursor: RelationRef | undefined
      // Parallel edges do not exhaust the Block budget, and PostgREST may shorten a page.
      while (true) {
        const page = await Relation.getEndpointPage({
          blockIds: frontier,
          endpoint,
          contents,
          cursor,
          limit: FRONTIER_RELATION_PAGE_SIZE,
        })
        const last = page.at(-1)
        if (!last) break
        yield* page
        cursor = last.id
      }
    }
  }

  private static relationSteps(
    relation: Relation,
    frontier: Set<BlockRef>,
    direction: GraphDirection,
    reverse: boolean
  ): [BlockRef, BlockRef][] {
    const steps: [BlockRef, BlockRef][] = []
    if (!reverse) {
      if (direction !== 'in' && frontier.has(relation.from_)) {
        steps.push([relation.from_, relation.to_])
      }
      if (direction !== 'out' && frontier.has(relation.to_)) {
        steps.push([relation.to_, relation.from_])
      }
    } else {
      if (direction !== 'in' && frontier.has(relation.to_)) {
        steps.push([relation.to_, relation.from_])
      }
      if (direction !== 'out' && frontier.has(relation.from_)) {
        steps.push([relation.from_, relation.to_])
      }
    }
    return steps
  }

  private static async assemblePath(options: {
    fromBlock: BlockRef
    toBlock: BlockRef
    meeting: BlockRef
    forwardSteps: Map<BlockRef, PathStep>
    backwardSteps: Map<BlockRef, PathStep>
    traversedRelations: Map<RelationRef, Relation>
  }): Promise<PathResult> {
    const blockPath = [options.meeting]
    const relationPath: RelationRef[] = []
    let current = options.meeting
    while (current !== options.fromBlock) {
      const step = options.forwardSteps.get(current)
      if (!step) throw new Error('Path reconstruction lost its parent.')
      current = step.block
      blockPath.push(current)
      relationPath.push(step.relation)
    }
    blockPath.reverse()
    relationPath.reverse()
    current = options.meeting
    while (current !== options.toBlock) {
      const step = options.backwardSteps.get(current)
      if (!step) throw new Error('Path reconstruction lost its next step.')
      current = step.block
      blockPath.push(current)
      relationPath.push(step.relation)
    }
    const blocks = await Block.getMany(blockPath)
    const relations = relationPath.flatMap((id) => {
      const relation = options.traversedRelations.get(id)
      return relation ? [relation] : []
    })
    if (blocks.length !== new Set(blockPath).size || relations.length !== relationPath.length) {
      return { status: 'not_found' }
    }
    return PathFoundSchema.parse({
      status: 'found',
      graph: { blocks, relations },
      block_path: blockPath,
      relation_path: relationPath,
    }) as PathResult
  }
}
