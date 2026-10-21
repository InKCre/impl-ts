<script setup lang="ts">
import { computed } from 'vue'
import type { SolvedContentRendererProps } from '@inkcre/core'
import type { CaptureResolver } from './resolver'
import type { SolvedCapture } from './schema'

const props = defineProps<SolvedContentRendererProps<SolvedCapture, CaptureResolver>>()
const text = computed(
  () =>
    props.solvedContent.materials.find((item) => item.block.resolver === 'core.text.v1')
      ?.solvedContent
)
const images = computed(
  () =>
    props.solvedContent.materials.filter(
      (item) => item.block.resolver === 'extensions.capture.attachment.v1'
    ).length
)
</script>

<template>
  <article class="capture-preview">
    <strong>{{ solvedContent.metadata.origin?.title || '随手收集' }}</strong>
    <p v-if="typeof text === 'string'">{{ text }}</p>
    <span v-if="images">{{ images }} 张原图</span>
    <span v-if="solvedContent.annotation">含补充想法</span>
  </article>
</template>

<style scoped>
.capture-preview {
  display: grid;
  gap: var(--sys-space-xs);
  min-width: 0;
  max-width: 360px;
}
p {
  margin: 0;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
span {
  color: var(--sys-color-text-subtle);
}
</style>
