<script setup lang="ts">
import type { SolvedContentRendererProps } from '@inkcre/core'
import MailBody from './MailBody.vue'

defineProps<SolvedContentRendererProps<string>>()
</script>

<template>
  <MailBody :block="resolver.block" :content="solvedContent" />
</template>
