<script setup lang="ts">
import { computed } from 'vue'
import type { SolvedContentRendererProps } from '@inkcre/core'
import type { ArchivePostContentModel } from '../../resolver'

const props = defineProps<SolvedContentRendererProps<ArchivePostContentModel>>()
const post = computed(() =>
  'authorId' in props.solvedContent.post ? props.solvedContent.post : null
)
const text = computed(() => {
  const value =
    post.value?.text?.text ??
    post.value?.article?.title ??
    post.value?.repostOf ??
    props.solvedContent.post.id
  return typeof value === 'string' && value.length > 180 ? `${value.slice(0, 180)}…` : value
})
const author = computed(() => props.solvedContent.author)
</script>

<template>
  <article class="archive-post-preview">
    <strong v-if="author && 'handle' in author">{{ author.name }} @{{ author.handle }}</strong>
    <p>{{ text }}</p>
    <small v-if="post">{{ post.createdAt }}</small>
  </article>
</template>

<style scoped>
.archive-post-preview {
  display: grid;
  gap: 0.4rem;
  min-width: 12rem;
  max-width: 24rem;
  overflow-wrap: anywhere;
}
p {
  margin: 0;
  white-space: pre-wrap;
}
small {
  color: var(--sys-color-text-subtle);
}
</style>
