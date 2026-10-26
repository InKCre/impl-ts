/**
 * Block module for client-webext
 *
 * Extends @inkcre/core Block with extension-specific features (vector search).
 */

import { Block as CoreBlock } from '@inkcre/core'
import { inkcreApi, inkcreApiReady } from '~/logic/storage'

/**
 * Extended Block class with vector search capability
 */
export class Block extends CoreBlock {
  /**
   * Vector similarity search for blocks
   *
   * @param blockQuery Block ID to use as query
   * @param query Text query string
   * @param resolver Filter by resolver type
   * @param distanceThreshold Distance threshold (0~2)
   * @param num Number of results to return
   * @returns Array of similar blocks
   */
  static async vectorSearch(params: {
    blockQuery?: number
    query?: string
    resolver?: string
    distanceThreshold?: number
    num?: number
  }): Promise<Block[]> {
    await inkcreApiReady
    const url = new URL('/blocks/query/by_embedding', inkcreApi.value)
    if (params.query !== undefined) {
      url.searchParams.set('query', params.query)
    }
    if (params.blockQuery !== undefined) {
      url.searchParams.set('block_id', params.blockQuery.toString())
    }
    if (params.resolver !== undefined) {
      url.searchParams.set('resolver', params.resolver)
    }
    if (params.distanceThreshold !== undefined) {
      url.searchParams.set('distance_threshold', params.distanceThreshold.toString())
    }
    if (params.num !== undefined) {
      url.searchParams.set('num', params.num.toString())
    }

    const response = await fetch(url.toString())
    if (!response.ok) {
      throw new Error(`Failed to fetch blocks by embedding: ${response.statusText}`)
    }

    const data: any[] = await response.json()
    return data.map((item) => new Block(item))
  }
}

/**
 * Re-export BlockForm from core
 */
export { BlockForm } from '@inkcre/core'
