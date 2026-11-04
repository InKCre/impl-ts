<script setup lang="ts">
import { computed } from 'vue'
import { Resolver } from '@inkcre/core'

import type { SolvedContentRendererProps } from './SolvedContentRenderer'

const props = defineProps<SolvedContentRendererProps>()
const renderer = computed(
  () => Resolver.getClass(props.resolver.block.resolver).solvedContentRenderer
)
</script>

<template>
  <component :is="renderer" :resolver="resolver" :solved-content="solvedContent" />
</template>
