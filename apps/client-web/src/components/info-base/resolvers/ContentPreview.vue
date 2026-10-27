<script setup lang="ts">
import { computed } from 'vue'
import type { SolvedContentRendererProps } from '@inkcre/core'

const props = defineProps<SolvedContentRendererProps<unknown>>()

const kind = computed(() => props.resolver.block.resolver.split('.')[1]?.toUpperCase() ?? 'BLOCK')
const text = computed(() => {
  if (typeof props.solvedContent !== 'string') return null
  const source = props.solvedContent
  const plain = (
    props.resolver.block.resolver === 'core.html.v1'
      ? source
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<[^>]+>/g, ' ')
      : source
  )
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > 180 ? `${plain.slice(0, 180)}…` : plain
})
const objectUrl = computed(() => {
  if (!props.solvedContent || typeof props.solvedContent !== 'object') return null
  if (!('objectUrl' in props.solvedContent)) return null
  return typeof props.solvedContent.objectUrl === 'string' ? props.solvedContent.objectUrl : null
})
</script>

<template>
  <div class="content-preview">
    <img v-if="resolver.block.resolver === 'core.image.v1' && objectUrl" :src="objectUrl" alt="" />
    <video
      v-else-if="resolver.block.resolver === 'core.video.v1' && objectUrl"
      :src="objectUrl"
      muted
      preload="metadata"
    />
    <p v-else-if="text">{{ text }}</p>
    <div v-else class="content-preview__fact">
      <span>{{ kind }}</span>
      <span
        v-if="solvedContent && typeof solvedContent === 'object' && 'byte_size' in solvedContent"
      >
        {{ String(solvedContent.byte_size) }} bytes
      </span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.content-preview {
  display: grid;
  min-width: 160px;
  max-width: 320px;
  color: sys-var(color, text, base);

  p {
    margin: 0;
    @include apply-font(body-sm);
    overflow-wrap: anywhere;
  }

  img,
  video {
    display: block;
    width: 100%;
    max-height: 220px;
    object-fit: cover;
    background: sys-var(color, surface, subtle);
  }

  &__fact {
    display: flex;
    justify-content: space-between;
    gap: sys-var(space, md);
    color: sys-var(color, text, subtle);
    @include apply-font(label-md, $mono: true);
  }
}
</style>
