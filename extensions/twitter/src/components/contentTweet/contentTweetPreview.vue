<script setup lang="ts">
import type { SolvedContentRendererProps } from '@inkcre/core'
import type { Tweet } from '../../schema'
import { legacyText } from './presentation'
import TweetPreview from './tweetPreview.vue'

defineProps<SolvedContentRendererProps<Tweet>>()
</script>

<template>
  <TweetPreview
    :text="legacyText(solvedContent.text)"
    :media-count="solvedContent.attachments?.length"
    :context="solvedContent.quote ? 'Includes a quoted post' : undefined"
  />
</template>
