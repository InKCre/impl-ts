<script setup lang="ts">
import { computed } from 'vue'
import type { SolvedContentRendererProps } from '@inkcre/core'
import type { SolvedMailingList } from '../schema'
import { HTML_BODIES, htmlText } from '../newsletter'

const props = defineProps<SolvedContentRendererProps<string | SolvedMailingList>>()
const text = computed(() => {
  const content = props.solvedContent
  if (typeof content !== 'string') return content.root.name || content.root.list_id
  const text = HTML_BODIES.has(props.resolver.block.resolver) ? htmlText(content, false) : content
  return text.replace(/\s+/g, ' ').trim().slice(0, 180)
})
</script>

<template>
  <p>{{ text }}</p>
</template>
