<script setup lang="ts">
import { computed } from 'vue'
import { Resolver } from '@inkcre/core'

import type { PreviewRendererProps } from './PreviewRenderer'

const props = defineProps<PreviewRendererProps>()
const renderer = computed(() => Resolver.getClass(props.resolver.block.resolver).previewRenderer)
</script>

<template>
  <component :is="renderer" :resolver="resolver" :solved-content="solvedContent" />
</template>
