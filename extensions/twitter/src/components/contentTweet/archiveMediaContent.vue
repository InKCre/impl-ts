<script setup lang="ts">
import { computed, ref } from 'vue'
import { Block, ResolverCache } from '@inkcre/core'
import { InkButton, InkImage } from '@inkcre/ui-web'
import type { MediaRecord } from '../../schema'
import { ArchiveMediaResolver, type ArchiveMediaContentModel } from '../../resolver'

const props = defineProps<{ blockId: number; record: MediaRecord | null }>()
const pending = ref(false)
const opened = ref(false)
const result = ref<ArchiveMediaContentModel | null>(null)
const error = ref<string | null>(null)
const media = computed(() => (props.record && 'type' in props.record ? props.record : null))

async function openMedia(): Promise<void> {
  if (pending.value || opened.value) return
  pending.value = true
  error.value = null
  try {
    const block = await Block.get(props.blockId)
    const resolver = await ResolverCache.getResolver(block)
    if (!(resolver instanceof ArchiveMediaResolver))
      throw new Error('Media resolver is unavailable.')
    result.value = await resolver.loadContent()
    opened.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <article class="archive-media">
    <p v-if="!media">Media record {{ record?.id ?? blockId }} is an identity placeholder.</p>
    <template v-else>
      <p>{{ media.alt || media.title || media.description || `${media.type} · ${media.id}` }}</p>
      <InkButton
        v-if="!opened"
        text="Load media"
        theme="subtle"
        :is-loading="pending"
        :disabled="pending"
        @click="openMedia"
      />
      <InkImage
        v-if="result?.content && media.type === 'photo'"
        :src="result.content.objectUrl"
        :alt="media.alt || media.title || 'Post image'"
        :title="media.title || media.alt || ''"
      />
      <video
        v-else-if="result?.content"
        :src="result.content.objectUrl"
        controls
        preload="none"
        :aria-label="media.alt || media.title || 'Post video'"
      />
      <p v-else-if="opened" class="empty">Media bytes are not available; metadata is preserved.</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </template>
  </article>
</template>

<style scoped>
.archive-media {
  display: grid;
  align-content: start;
  gap: 0.5rem;
  min-width: 0;
}
.archive-media p {
  margin: 0;
  overflow-wrap: anywhere;
}
.archive-media img,
.archive-media video {
  width: 100%;
  max-height: 30rem;
  object-fit: contain;
}
.empty {
  color: var(--sys-color-text-subtle);
}
.error {
  color: var(--sys-color-feedback-error);
}
</style>
