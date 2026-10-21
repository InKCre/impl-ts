<script setup lang="ts">
import type { SolvedContentRendererProps } from '@inkcre/core'
import type { AttachmentResolver } from './resolver'
import type { SolvedAttachment } from './schema'
defineProps<SolvedContentRendererProps<SolvedAttachment, AttachmentResolver>>()
</script>
<template>
  <span
    >{{ solvedContent.metadata.filename || '原始图片' }} ·
    {{ solvedContent.metadata.mime_type }}</span
  >
</template>
