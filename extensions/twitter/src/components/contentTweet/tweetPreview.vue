<script setup lang="ts">
import type { UserRecord } from '../../schema'
import { postDate } from './presentation'
import TweetIdentity from './tweetIdentity.vue'
import TweetIcon from './tweetIcon.vue'

defineProps<{
  author?: UserRecord | null
  text: string
  createdAt?: string
  mediaCount?: number
  context?: string
  articleTitle?: string
}>()
</script>

<template>
  <article class="tweet-preview">
    <TweetIdentity :author="author" compact />
    <span v-if="context" class="tweet-preview__context">{{ context }}</span>
    <strong v-if="articleTitle" class="tweet-preview__title">{{ articleTitle }}</strong>
    <p v-if="text || (!mediaCount && !articleTitle)" class="tweet-preview__text" dir="auto">
      {{ text || 'No saved text.' }}
    </p>
    <footer>
      <span v-if="mediaCount" class="tweet-preview__media"
        ><TweetIcon name="photo" />{{ mediaCount }}
        {{ mediaCount === 1 ? 'attachment' : 'attachments' }}</span
      >
      <time v-if="createdAt" :datetime="createdAt" :title="postDate(createdAt)">{{
        postDate(createdAt, true)
      }}</time>
      <span class="tweet-preview__source" aria-label="X / Twitter">𝕏</span>
    </footer>
  </article>
</template>

<style scoped>
.tweet-preview {
  min-width: 0;
  max-width: 300px;
  display: grid;
  gap: 10px;
  color: var(--sys-color-text-base);
  font-size: 14px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.tweet-preview__text,
.tweet-preview__title {
  margin: 0;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 5;
  overflow: hidden;
  white-space: pre-wrap;
}
.tweet-preview__title {
  -webkit-line-clamp: 2;
  font-size: 16px;
  line-height: 1.3;
}
.tweet-preview__context {
  color: var(--sys-color-text-subtle);
  font-size: 12px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  color: var(--sys-color-text-subtle);
  font-size: 11px;
}
.tweet-preview__media {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.tweet-preview__media svg {
  width: 14px;
  height: 14px;
}
.tweet-preview__source {
  margin-left: auto;
  font-size: 16px;
}
</style>
