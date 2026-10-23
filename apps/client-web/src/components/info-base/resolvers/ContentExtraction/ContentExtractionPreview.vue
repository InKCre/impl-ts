<script setup lang="ts">
import type { ContentExtractionProps } from './ContentExtraction'
defineProps<ContentExtractionProps>()
</script>

<template>
  <div class="content-extraction-preview">{{ solvedContent.text }}</div>
</template>

<style scoped lang="scss">
.content-extraction-preview {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-width: 160px;
  max-width: 320px;
  overflow-wrap: anywhere;
  color: sys-var(color, text, base);
  @include apply-font(body-sm);
}
</style>
