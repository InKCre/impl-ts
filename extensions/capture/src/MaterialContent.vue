<script setup lang="ts">
import { computed } from 'vue'
import { Resolver } from '@inkcre/core'
import type { SolvedMaterial } from './schema'

const props = defineProps<{ material: SolvedMaterial }>()
const renderer = computed(
  () => Resolver.getClass(props.material.block.resolver).solvedContentRenderer
)
</script>

<template>
  <component
    :is="renderer"
    :resolver="material.resolver"
    :solved-content="material.solvedContent"
  />
</template>
