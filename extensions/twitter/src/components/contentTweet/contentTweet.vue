<script setup lang="ts">
import { ref, watch } from 'vue'
import { InkButton, InkImage } from '@inkcre/ui-web'
import type { SolvedContentRendererProps } from '@inkcre/core'
import type { Tweet } from '../../schema'
import { legacyText } from './presentation'
import TweetIdentity from './tweetIdentity.vue'
import TweetIcon from './tweetIcon.vue'

const props = defineProps<SolvedContentRendererProps<Tweet>>()
const expanded = ref(false)
const expandedAttachment = ref<string | null>(null)
const failed = ref(new Set<string>())
watch(
  () => props.solvedContent,
  () => {
    expanded.value = false
    expandedAttachment.value = null
    failed.value.clear()
  }
)
</script>

<template>
  <article class="content-tweet">
    <header class="content-tweet__header">
      <TweetIdentity /><a
        class="content-tweet__source"
        :href="`https://x.com/i/status/${solvedContent.id}`"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="View original post on X"
        ><span>View original post</span><TweetIcon name="external"
      /></a>
    </header>
    <div class="content-tweet__text" dir="auto">{{ legacyText(solvedContent.text) }}</div>
    <template v-if="solvedContent.attachments?.length">
      <InkButton v-if="!expanded" @click="expanded = true">
        Load {{ solvedContent.attachments.length }} attachments
      </InkButton>
      <section
        v-else
        class="tweet-media-grid tweet-media-grid--loaded"
        :class="`tweet-media-grid--${Math.min(solvedContent.attachments.length, 4)}`"
        aria-label="Post media"
      >
        <div v-for="attachment in solvedContent.attachments" :key="attachment" class="legacy-media">
          <InkImage
            v-if="!failed.has(attachment)"
            :src="attachment"
            :expanded="expandedAttachment === attachment"
            alt="Post attachment"
            @update:expanded="expandedAttachment = $event ? attachment : null"
            @error="failed.add(attachment)"
          />
          <button
            v-else
            type="button"
            class="content-tweet__text-link"
            @click="failed.delete(attachment)"
          >
            Image unavailable · Retry
          </button>
          <InkButton
            v-if="!failed.has(attachment)"
            class="tweet-media__expand"
            size="sm"
            aria-label="Expand image"
            @click="expandedAttachment = attachment"
          >
            <template #prefix-icon><TweetIcon name="expand" /></template>
            Expand
          </InkButton>
        </div>
      </section>
    </template>
    <p class="content-tweet__subtle">
      Saved in the legacy format. Author profile and publication time were not captured.
    </p>
  </article>
</template>

<style lang="scss" scoped src="./contentTweet.scss" />
<style scoped src="./mediaControls.css" />
<style scoped>
.legacy-media {
  position: relative;
  min-width: 0;
  min-height: 0;
  background: var(--sys-color-surface-subtle);
}
.legacy-media :deep(.ink-image),
.legacy-media :deep(.ink-image__thumbnail) {
  width: 100%;
  height: 100%;
  display: block;
}
.legacy-media :deep(.ink-image__img) {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
p {
  margin: 0;
  font-size: 12px;
}
</style>
