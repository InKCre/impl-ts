<script setup lang="ts">
import type { SolvedContentRendererProps } from '@inkcre/core'
import type { AttachmentResolver } from './resolver'
import type { SolvedAttachment } from './schema'
import MaterialContent from './MaterialContent.vue'

defineProps<SolvedContentRendererProps<SolvedAttachment, AttachmentResolver>>()
</script>

<template>
  <figure>
    <MaterialContent :material="solvedContent.content" />
    <figcaption>
      {{ solvedContent.metadata.filename || '原始图片' }} · {{ solvedContent.metadata.mime_type }}
    </figcaption>
  </figure>
</template>

<style scoped>
figure {
  margin: 0;
  min-width: 0;
}
figcaption {
  margin-top: var(--sys-space-xs);
  color: var(--sys-color-text-subtle);
}
</style>
