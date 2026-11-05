<script setup lang="ts">
import type { SolvedContentRendererProps, VideoSolvedContent } from '@inkcre/core'

defineProps<SolvedContentRendererProps<VideoSolvedContent>>()
</script>

<template>
  <div class="content-video">
    <video :src="solvedContent.objectUrl" controls preload="metadata" />
  </div>
</template>

<style lang="scss" scoped>
.content-video {
  background: sys-var(color, surface, subtle);

  video {
    display: block;
    width: 100%;
    max-height: 240px;
  }
}
</style>
