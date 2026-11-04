import { computed, type MaybeRefOrGetter, toValue } from 'vue'

export function anyMeets<T = unknown>(args: T[], predicate: (arg: T) => boolean): boolean {
  return args.some(predicate)
}

export const anyTrue = (...args: MaybeRefOrGetter<unknown>[]) => {
  return computed(() => anyMeets(args, (arg) => Boolean(toValue(arg))))
}
