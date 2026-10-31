import { ResolverCache, UnknownResolverError, type RecallTarget } from '../info-base'
import type { LexicalRetrievalMatch } from './main'

export interface RecallGroup extends RecallTarget {
  /** True when a Resolver supplied a reading destination rather than a raw Block. */
  readable: boolean
  matches: LexicalRetrievalMatch[]
}

/** Group this result window for reading without changing retrieval evidence or rank. */
export async function presentLexicalMatches(
  matches: LexicalRetrievalMatch[]
): Promise<RecallGroup[]> {
  const targets = await Promise.all(
    matches.map(async (match) => {
      try {
        const resolver = await ResolverCache.borrow(match.block)
        return await resolver.getRecallTarget(match)
      } catch (error) {
        if (error instanceof UnknownResolverError) return null
        throw error
      }
    })
  )
  const groups = new Map<number, RecallGroup>()
  for (const [index, match] of matches.entries()) {
    const target = targets[index]
    const block = target?.block ?? match.block
    const existing = groups.get(block.id)
    if (existing) {
      existing.matches.push(match)
      continue
    }
    groups.set(block.id, {
      block,
      label: target?.label ?? match.label,
      description: target?.description ?? '',
      excerpt: target?.excerpt ?? match.excerpt,
      readable: target != null,
      matches: [match],
    })
  }
  return [...groups.values()]
}
