/**
 * Resolver Cache System
 *
 * Provides a global cache for resolver instances to avoid redundant
 * content loading and improve performance when resolving nested content.
 *
 * Cache Strategy:
 * - Global cache map: {blockId -> {resolver, blockUpdatedAt}}
 * - Timestamp-based invalidation: Cache entry expires if block.updated_at changes
 * - Per-resolver block update tracking for optimistic expiration checks
 */

import type { Block } from '../block'
import type { Relation } from '../relation'
import { Resolver } from './base'

interface CacheEntry {
  resolver: Resolver
  blockUpdatedAt: Date
}

/**
 * Global resolver cache to avoid duplicate resolver instantiation.
 * Validates cache entries based on block update timestamps.
 */
export class ResolverCache {
  private static cache: Map<number, CacheEntry> = new Map()

  /**
   * Get or create a resolver for a block.
   * Returns cached resolver if block hasn't been updated since caching.
   * Creates new resolver if cache miss or block has been updated.
   *
   * @param block - The block to resolve
   * @param relations - Optional pre-loaded relations
   * @returns Resolver instance
   */
  static async getResolver<T extends Resolver = Resolver>(
    block: Block,
    relations?: Relation[]
  ): Promise<T> {
    // A disabled or replaced native module cannot serve its old cached resolver.
    const resolverClass = Resolver.getClass(block.resolver)
    const cached = this.cache.get(block.id)

    // Check if cache is valid (block hasn't been updated)
    if (cached) {
      const cachedTime = cached.blockUpdatedAt.getTime()
      const currentTime = block.updated_at?.getTime() ?? 0
      if (cachedTime === currentTime && cached.resolver.constructor === resolverClass) {
        return cached.resolver as T
      }
      // Block content or its registered native implementation changed.
      void cached.resolver.dispose()
      this.cache.delete(block.id)
    }

    // Create new resolver and cache it
    const resolver = new resolverClass(block, relations)

    this.cache.set(block.id, {
      resolver,
      blockUpdatedAt: block.updated_at ?? new Date(),
    })

    return resolver as T
  }

  /**
   * Invalidate a specific cache entry.
   * Called when a block is updated externally.
   *
   * @param blockId - The block ID to invalidate
   */
  static invalidate(blockId: number): void {
    void this.cache.get(blockId)?.resolver.dispose()
    this.cache.delete(blockId)
  }

  /**
   * Clear entire cache.
   * Use cautiously - should only be needed for testing or major state changes.
   */
  static clear(): void {
    for (const entry of this.cache.values()) void entry.resolver.dispose()
    this.cache.clear()
  }

  /**
   * Get cache size (for debugging/monitoring).
   */
  static size(): number {
    return this.cache.size
  }
}
