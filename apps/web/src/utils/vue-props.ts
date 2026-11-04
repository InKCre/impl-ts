import { computed, ref, watch, type PropType } from 'vue'

export const unknownProp = null as unknown as PropType<unknown>

export const numericProp = [Number, String]

export const truthProp = {
  type: Boolean,
  default: true as const,
}

export const makeRequiredProp = <T>(type: T) => ({
  type,
  required: true as const,
})

export const makeArrayProp = <T>(defaultVal: T[] = []) => ({
  type: Array as PropType<T[]>,
  default: () => defaultVal,
})

export const makeBooleanProp = <T>(defaultVal: T) => ({
  type: Boolean,
  default: defaultVal,
})

export const makeNumberProp = <T>(defaultVal: T) => ({
  type: Number,
  default: defaultVal,
})

export const makeNumericProp = <T>(defaultVal: T) => ({
  type: numericProp,
  default: defaultVal,
})

export const makeStringProp = <T>(defaultVal?: T) => ({
  type: String as unknown as PropType<T>,
  default: defaultVal,
})

export const makeObjectProp = <T>(defaultVal: T) => ({
  type: Object as PropType<T>,
  default: () => defaultVal,
})

/**
 * useOptionalVModel
 *
 * Creates a writable computed that mirrors a v-model prop if provided by parent,
 * otherwise falls back to an internal state. It always emits `update:<propName>`
 * so parents can start controlling later without breaking the internal state.
 *
 * Keep the API tiny and obvious for reusability across components.
 */
export function useOptionalVModel<T>(options: {
  props: Record<string, unknown>
  emit: (...args: any[]) => void
  modelName: string
  defaultValue?: T
}) {
  const { props, emit, modelName, defaultValue } = options

  const inner = ref<T>(
    props[modelName] !== undefined ? (props[modelName] as T) : (defaultValue as T)
  )

  watch(
    () => props[modelName],
    (val) => (inner.value = val)
  )

  return computed<T>({
    get() {
      return inner.value
    },
    set(val: T) {
      inner.value = val
      emit(`update:${modelName}`, val)
    },
  })
}

/**
 * XOR type
 *
 * Used to create mutually exclusive types
 * e.g. a type that can be either A or B, but not both
 */
export type XOR<A, B> = (A & { [K in keyof B]?: never }) | (B & { [K in keyof A]?: never })
