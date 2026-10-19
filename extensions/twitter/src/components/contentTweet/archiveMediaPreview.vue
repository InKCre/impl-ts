<script setup lang="ts">
import type { SolvedContentRendererProps } from '@inkcre/core'
import type { MediaRecord } from '../../schema'

defineProps<SolvedContentRendererProps<MediaRecord>>()
</script>

<template>
  <article class="archive-media-preview">
    <template v-if="'type' in solvedContent"
      ><strong>{{ solvedContent.type }}</strong>
      <p>
        {{
          solvedContent.alt || solvedContent.title || solvedContent.description || solvedContent.id
        }}
      </p></template
    >
    <span v-else>Media {{ solvedContent.id }} (identity only)</span>
  </article>
</template>

<style scoped>
.archive-media-preview {
  display: grid;
  gap: 0.3rem;
  min-width: 8rem;
  max-width: 20rem;
  overflow-wrap: anywhere;
}
p {
  margin: 0;
}
</style>
