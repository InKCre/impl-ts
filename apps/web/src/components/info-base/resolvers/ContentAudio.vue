<script setup lang="ts">
import type { AudioSolvedContent, SolvedContentRendererProps } from '@inkcre/core'

defineProps<SolvedContentRendererProps<AudioSolvedContent>>()
</script>

<template>
  <div class="content-audio">
    <audio :src="solvedContent.objectUrl" controls preload="metadata" />
  </div>
</template>

<style lang="scss" scoped>
.content-audio {
  padding: sys-var(space, sm);
  background: sys-var(color, surface, subtle);

  audio {
    display: block;
    width: 100%;
  }
}
</style>
