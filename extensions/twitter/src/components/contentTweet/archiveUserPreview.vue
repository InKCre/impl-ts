<script setup lang="ts">
import type { SolvedContentRendererProps } from '@inkcre/core'
import type { UserRecord } from '../../schema'

defineProps<SolvedContentRendererProps<UserRecord>>()
</script>

<template>
  <article class="archive-user-preview">
    <template v-if="'handle' in solvedContent"
      ><strong>{{ solvedContent.name }}</strong
      ><span>@{{ solvedContent.handle }}</span>
      <p>{{ solvedContent.bio?.text }}</p></template
    >
    <span v-else>User {{ solvedContent.id }} (identity only)</span>
  </article>
</template>

<style scoped>
.archive-user-preview {
  display: grid;
  gap: 0.3rem;
  min-width: 10rem;
  max-width: 24rem;
  overflow-wrap: anywhere;
}
p {
  margin: 0;
  white-space: pre-wrap;
}
</style>
