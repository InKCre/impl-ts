<script setup lang="ts">
import { computed } from 'vue'
import type { SolvedContentRendererProps } from '@inkcre/core'
import type { CaptureResolver } from './resolver'
import { safeSourceURL, type SolvedCapture } from './schema'
import MaterialContent from './MaterialContent.vue'

const props = defineProps<SolvedContentRendererProps<SolvedCapture, CaptureResolver>>()
const sourceURL = computed(() => safeSourceURL(props.solvedContent.metadata.origin?.url))
const entries = { selection: '选区', paste: '明确粘贴', screenshot: '框选截图', manual: '想法' }
</script>

<template>
  <article class="capture-content">
    <header>
      <strong>{{ solvedContent.metadata.origin?.title || '随手收集' }}</strong>
      <p>
        {{ entries[solvedContent.metadata.entry] }} ·
        <time :datetime="solvedContent.metadata.captured_at">
          {{ new Date(solvedContent.metadata.captured_at).toLocaleString() }}
        </time>
      </p>
      <p v-if="solvedContent.metadata.origin?.application_id">
        {{ solvedContent.metadata.origin.application_id }}
      </p>
      <a v-if="sourceURL" :href="sourceURL" target="_blank" rel="noopener noreferrer">{{
        sourceURL
      }}</a>
      <p v-else-if="solvedContent.metadata.origin?.url">{{ solvedContent.metadata.origin.url }}</p>
    </header>
    <section aria-label="原始材料" class="materials">
      <MaterialContent
        v-for="material in solvedContent.materials"
        :key="material.block.id"
        :material="material"
      />
    </section>
    <section v-if="solvedContent.annotation" class="annotation" aria-label="补充想法">
      <h3>补充想法</h3>
      <MaterialContent :material="solvedContent.annotation" />
    </section>
  </article>
</template>

<style scoped>
.capture-content,
.materials {
  display: grid;
  gap: var(--sys-space-lg);
  min-width: 0;
  overflow-wrap: anywhere;
}
.capture-content {
  color: var(--sys-color-text-base);
}
header p {
  margin: var(--sys-space-xs) 0;
  color: var(--sys-color-text-subtle);
}
.annotation {
  border-top: 1px solid var(--sys-color-border-base);
  padding-top: var(--sys-space-md);
}
h3 {
  font: inherit;
  font-weight: 600;
  margin: 0 0 var(--sys-space-sm);
}
</style>
