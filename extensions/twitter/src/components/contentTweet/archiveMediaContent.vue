<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Block, type Resolver } from '@inkcre/core'
import { InkButton, InkImage } from '@inkcre/ui-web'
import type { MediaRecord } from '../../schema'
import { ArchiveMediaResolver, type ArchiveMediaContentModel } from '../../resolver'
import TweetIcon from './tweetIcon.vue'

// Also accepts the host renderer contract when a media Block is opened directly.
const props = defineProps<{
  blockId?: number
  record?: MediaRecord | null
  resolver?: Resolver
  solvedContent?: MediaRecord
}>()
const pending = ref(false)
const opened = ref(false)
const expanded = ref(false)
const video = ref<HTMLVideoElement | null>(null)
const fullscreenError = ref(false)
const canFullscreen = typeof document !== 'undefined' && document.fullscreenEnabled
const result = ref<ArchiveMediaContentModel | null>(null)
const error = ref<string | null>(null)
const record = computed<MediaRecord | null>(() => props.record ?? props.solvedContent ?? null)
const media = computed(() => (record.value && 'type' in record.value ? record.value : null))
let generation = 0
let ownedResolver: ArchiveMediaResolver | null = null
let fullscreenTrigger: HTMLButtonElement | null = null

function reset(): void {
  generation++
  void ownedResolver?.dispose()
  ownedResolver = null
  pending.value = false
  opened.value = false
  expanded.value = false
  fullscreenError.value = false
  fullscreenTrigger = null
  result.value = null
  error.value = null
}
watch(() => [props.blockId, props.record, props.resolver, props.solvedContent], reset)
onBeforeUnmount(reset)

async function openMedia(): Promise<void> {
  if (pending.value || opened.value) return
  const request = ++generation
  pending.value = true
  error.value = null
  let candidate: ArchiveMediaResolver | null = null
  try {
    const block = props.resolver?.block ?? (await Block.get(props.blockId!))
    if (request !== generation) return
    candidate = new ArchiveMediaResolver(block)
    const content = await candidate.loadContent()
    if (request !== generation) return
    void ownedResolver?.dispose()
    ownedResolver = candidate
    candidate = null
    result.value = content
    opened.value = true
  } catch (cause) {
    if (request === generation) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    void candidate?.dispose()
    if (request === generation) pending.value = false
  }
}
function mediaFailed(): void {
  void ownedResolver?.dispose()
  ownedResolver = null
  result.value = null
  opened.value = false
  expanded.value = false
  error.value = 'This media could not be displayed. Try loading it again.'
}

async function expandVideo(event: MouseEvent): Promise<void> {
  if (!video.value) return
  const request = generation
  fullscreenError.value = false
  fullscreenTrigger = event.currentTarget as HTMLButtonElement
  try {
    await video.value.requestFullscreen()
  } catch {
    if (request === generation) {
      fullscreenError.value = true
      fullscreenTrigger = null
    }
  }
}
function fullscreenChanged(): void {
  if (!document.fullscreenElement) {
    fullscreenTrigger?.focus({ preventScroll: true })
    fullscreenTrigger = null
  }
}
</script>

<template>
  <div class="tweet-media" :class="{ 'tweet-media--loaded': result?.content }" :aria-busy="pending">
    <div v-if="!media || media.unavailable" class="tweet-media__unavailable">
      <TweetIcon name="photo" /><span>{{ media?.unavailable || 'Media not captured' }}</span>
    </div>
    <template v-else>
      <InkImage
        v-if="result?.content && media.type === 'photo'"
        v-model:expanded="expanded"
        :src="result.content.objectUrl"
        :alt="media.alt || media.title || 'Post image'"
        :title="media.alt || media.title || ''"
        :lazy="false"
        @error="mediaFailed"
      />
      <video
        v-else-if="result?.content"
        ref="video"
        :src="result.content.objectUrl"
        controls
        playsinline
        preload="metadata"
        :aria-label="media.alt || media.title || 'Post video'"
        @error="mediaFailed"
        @fullscreenchange="fullscreenChanged"
      />
      <div v-else class="tweet-media__placeholder">
        <InkButton
          v-if="!opened"
          class="tweet-media__load"
          size="sm"
          :is-loading="pending"
          :disabled="pending"
          @click="openMedia"
        >
          <template #prefix-icon>
            <TweetIcon :name="media.type === 'photo' ? 'photo' : 'video'" />
          </template>
          {{
            pending
              ? 'Loading…'
              : error
                ? 'Retry media'
                : media.type === 'photo'
                  ? 'Load photo'
                  : media.type === 'gif'
                    ? 'Load GIF'
                    : 'Load video'
          }}
        </InkButton>
        <span v-if="!opened">{{
          media.width && media.height ? `${media.width} × ${media.height}` : 'Load on demand'
        }}</span>
        <p v-else>Media unavailable. Saved metadata is still accessible.</p>
        <p v-if="error" class="tweet-media__error" role="alert">{{ error }}</p>
      </div>
      <InkButton
        v-if="result?.content && (media.type === 'photo' || canFullscreen)"
        class="tweet-media__expand"
        size="sm"
        :aria-label="media.type === 'photo' ? 'Expand image' : 'View video in full screen'"
        @click="media.type === 'photo' ? (expanded = true) : expandVideo($event)"
      >
        <template #prefix-icon><TweetIcon name="expand" /></template>
        {{ media.type === 'photo' ? 'Expand' : 'Full screen' }}
      </InkButton>
      <p v-if="fullscreenError" class="tweet-media__fullscreen-error" role="alert">
        Full screen could not open. You can continue watching here.
      </p>
      <details v-if="media.alt || media.title || media.description" class="tweet-media__alt">
        <summary>{{ media.alt ? 'ALT' : 'Info' }}</summary>
        <p v-if="media.alt">{{ media.alt }}</p>
        <p v-if="media.title">{{ media.title }}</p>
        <p v-if="media.description">{{ media.description }}</p>
      </details>
    </template>
  </div>
</template>

<style scoped src="./mediaControls.css" />
<style scoped>
.tweet-media {
  position: relative;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: var(--sys-color-surface-subtle);
}
.tweet-media :deep(.ink-image),
.tweet-media :deep(.ink-image__thumbnail) {
  width: 100%;
  height: 100%;
  display: block;
}
.tweet-media :deep(.ink-image__img),
video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  max-height: min(440px, 65vh);
}
video:fullscreen {
  max-height: none;
  background: black;
}
.tweet-media__fullscreen-error {
  position: absolute;
  top: 48px;
  right: 8px;
  left: 8px;
  margin: 0;
  padding: 8px;
  color: white;
  background: #000c;
  font-size: 13px;
}
.tweet-media__placeholder,
.tweet-media__unavailable {
  height: 100%;
  min-height: 130px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  text-align: center;
  overflow: auto;
  color: var(--sys-color-text-subtle);
  font-size: 13px;
}
.tweet-media__error,
.tweet-media__placeholder p {
  margin: 0;
  overflow-wrap: anywhere;
}
.tweet-media__error {
  color: var(--sys-color-text-base);
}
.tweet-media__alt {
  position: absolute;
  bottom: 8px;
  left: 8px;
  max-width: calc(100% - 16px);
  color: white;
  background: #000c;
  border-radius: 4px;
  font-size: 11px;
}
.tweet-media__alt summary {
  padding: 3px 6px;
  font-weight: 700;
  cursor: pointer;
}
.tweet-media__alt p {
  margin: 0;
  padding: 8px;
  font-size: 13px;
  max-height: 100px;
  overflow: auto;
}
</style>
