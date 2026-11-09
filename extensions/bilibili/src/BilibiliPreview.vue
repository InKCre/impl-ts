<script setup lang="ts">
import { computed } from 'vue'
import type { SolvedContentRendererProps } from '@inkcre/core'
import { recordTitle } from './schema.ts'
import type { SolvedBilibili } from './resolver.ts'
const props = defineProps<SolvedContentRendererProps<SolvedBilibili>>()
const value = computed(() => props.solvedContent.value)
const description = computed(() =>
  value.value.kind === 'video' || value.value.kind === 'folder'
    ? value.value.record.description
    : undefined
)
</script>

<template>
  <article class="bilibili-preview">
    <strong>{{ recordTitle(value) }}</strong>
    <p v-if="description">{{ description }}</p>
    <small v-if="value.kind === 'folder'">B 站收藏夹</small>
    <small v-else-if="value.kind === 'video'">{{
      value.record.bvid || `av${value.record.aid}`
    }}</small>
    <small v-else-if="value.kind === 'user'">UID {{ value.record.mid }}</small>
    <small v-else>{{
      value.record.availability === 'unavailable' ? '来源条目已失效' : 'B 站收藏条目'
    }}</small>
  </article>
</template>

<style scoped>
.bilibili-preview {
  display: grid;
  gap: 0.25rem;
  min-width: 0;
}
.bilibili-preview strong {
  overflow-wrap: anywhere;
}
.bilibili-preview p {
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-wrap;
}
.bilibili-preview small {
  opacity: 0.65;
}
</style>
