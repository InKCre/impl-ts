<script setup lang="ts">
import { computed } from 'vue'
import type { SolvedContentRendererProps } from '@inkcre/core'
import type { LocalFileResolver } from './resolver'
import { peerFileLocation, type SolvedFile } from './schema'
const props = defineProps<SolvedContentRendererProps<SolvedFile, LocalFileResolver>>()
const name = computed(() =>
  peerFileLocation(props.solvedContent.metadata.location).path.split('/').at(-1)
)
</script>
<template>
  <article>
    <strong>{{ name }}</strong>
    <p>{{ solvedContent.text ?? '尚无已收入正文' }}</p>
    <span v-if="!solvedContent.metadata.available">原件失效</span
    ><span v-else-if="solvedContent.metadata.issue">提取失败</span>
  </article>
</template>
<style scoped>
article {
  display: grid;
  gap: var(--sys-space-xs);
  max-width: 360px;
  min-width: 0;
  overflow-wrap: anywhere;
}
p {
  margin: 0;
  white-space: pre-wrap;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}
span {
  color: var(--sys-color-text-subtle);
}
</style>
