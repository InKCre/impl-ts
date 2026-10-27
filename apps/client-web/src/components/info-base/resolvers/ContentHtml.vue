<script setup lang="ts">
import { InkContentReader } from '@inkcre/ui-web'
import type { SolvedContentRendererProps } from '@inkcre/core'
defineProps<SolvedContentRendererProps<string>>()
</script>
<template>
  <InkContentReader
    :content="solvedContent"
    :format="resolver.block.resolver === 'core.markdown.v1' ? 'markdown' : 'html'"
  />
</template>
