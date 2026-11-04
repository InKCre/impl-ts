import { computedAsync } from '@vueuse/core'
import type { ComputedRef } from 'vue'

/**
 * Composable for handling props that can be either an id or the actual object
 * Returns the resolved object computed asynchronously
 * @param id - The id value (can be undefined)
 * @param object - The object value (can be undefined)
 * @param fetcher - Function to fetch the object by id
 * @returns ComputedRef of the resolved object or undefined
 */
export function useEither<T>(
  id: any,
  object: any,
  fetcher: (id: any) => Promise<T>
): ComputedRef<T | undefined> {
  return computedAsync(
    async (): Promise<T | undefined> => {
      if (object) {
        return object
      } else if (id) {
        return await fetcher(id)
      }
      return undefined
    },
    undefined,
    { shallow: false }
  )
}
