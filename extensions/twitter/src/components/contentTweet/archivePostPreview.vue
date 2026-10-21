<script setup lang="ts">
import { computed } from 'vue'
import type { SolvedContentRendererProps } from '@inkcre/core'
import type { ArchivePostContentModel } from '../../resolver'
import { visibleText } from './presentation'
import TweetPreview from './tweetPreview.vue'

const props = defineProps<SolvedContentRendererProps<ArchivePostContentModel>>()
const post = computed(() =>
  'authorId' in props.solvedContent.post ? props.solvedContent.post : null
)
const mediaCount = computed(
  () =>
    props.solvedContent.references.filter(({ reference }) => reference.type === 'media').length ||
    post.value?.mediaIds?.length
)
const context = computed(() =>
  post.value?.repostOf
    ? 'Reposted post'
    : post.value?.replyTo
      ? post.value.replyTo.handle
        ? `Replying to @${post.value.replyTo.handle}`
        : 'Replying to a post'
      : post.value?.quote
        ? 'Includes a quoted post'
        : undefined
)
</script>

<template>
  <TweetPreview
    :author="solvedContent.author"
    :text="visibleText(post?.text) || post?.article?.preview || ''"
    :article-title="post?.article?.title"
    :created-at="post?.createdAt"
    :media-count="mediaCount"
    :context="context"
  />
</template>
