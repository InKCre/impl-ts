import { ref, computed, type Ref } from 'vue'

/**
 * Options for useAsyncState composable
 */
export interface UseAsyncStateOptions {
  /** Whether to execute immediately on initialization */
  immediate?: boolean
  /** Callback when async operation succeeds */
  onSuccess?: (data: any) => void
  /** Callback when async operation fails */
  onError?: (error: Error) => void
  /** Whether to use last state instead of initial state during loading */
  useLast?: boolean
}

/**
 * Enhanced useAsyncState composable that can optionally use last state during loading
 * @param asyncFn - The async function to execute
 * @param initialState - The initial state value
 * @param options - Configuration options
 * @returns Object with state, isLoading, error, and execute function
 */
export function useEAsyncState<T>(
  asyncFn: () => Promise<T>,
  initialState: T,
  options: UseAsyncStateOptions = {}
) {
  const state = ref<T>(initialState) as Ref<T>
  const isLoading = ref(false)
  const error = ref<Error | null>(null)

  const execute = async () => {
    isLoading.value = true
    error.value = null
    if (!options.useLast) {
      state.value = initialState
    }
    try {
      const result = await asyncFn()
      state.value = result
      options.onSuccess?.(result)
    } catch (e) {
      error.value = e as Error
      options.onError?.(error.value)
    } finally {
      isLoading.value = false
    }
  }

  if (options.immediate) {
    void execute()
  }

  return {
    state: computed(() => state.value),
    isLoading: computed(() => isLoading.value),
    error: computed(() => error.value),
    execute,
  }
}
