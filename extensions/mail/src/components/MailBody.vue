<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ResolverCache, type Block } from '@inkcre/core'
import { InkButton } from '@inkcre/ui-web'
import { HTML_BODIES, NEWSLETTER_HTML, NEWSLETTER_TEXT } from '../newsletter'
import { isolateMailHtml } from '../mailHtml'
import type { SolvedEmail } from '../schema'
import NewsletterReader from './NewsletterReader.vue'

const props = defineProps<{
  block: Block
  content: string
  embedded?: SolvedEmail['embedded']
}>()
const original = ref<string | null>(null)
const showOriginal = ref(false)
const loading = ref(false)
const error = ref('')
const newsletter = computed(() => [NEWSLETTER_HTML, NEWSLETTER_TEXT].includes(props.block.resolver))
watch(
  () => props.block.id,
  () => {
    original.value = null
    showOriginal.value = false
    error.value = ''
  }
)
const content = computed(() =>
  showOriginal.value ? (original.value ?? props.content) : props.content
)
const html = computed(() => {
  if (!HTML_BODIES.has(props.block.resolver)) return ''
  const cidUrls = new Map<string, string>()
  for (const item of props.embedded ?? []) {
    if (item.body.id !== props.block.id) continue
    const child = item.mimePart.solvedContent.content?.solvedContent
    if (
      child &&
      typeof child === 'object' &&
      'objectUrl' in child &&
      typeof child.objectUrl === 'string'
    )
      cidUrls.set(item.reference.toLowerCase(), child.objectUrl)
  }
  return isolateMailHtml(content.value, cidUrls, newsletter.value && !showOriginal.value)
})

async function toggleOriginal(): Promise<void> {
  if (showOriginal.value) {
    showOriginal.value = false
    return
  }
  loading.value = true
  error.value = ''
  const blockId = props.block.id
  try {
    const resolver = await ResolverCache.borrow(props.block)
    const raw = await resolver.getRawContent()
    if (typeof raw !== 'string') throw new TypeError('邮件正文不是文本')
    if (props.block.id === blockId) {
      original.value = raw
      showOriginal.value = true
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="mail-body">
    <InkButton
      v-if="newsletter"
      class="mail-body__original"
      :is-loading="loading"
      :disabled="loading"
      @click="toggleOriginal"
    >
      {{ showOriginal ? '阅读视图' : '查看原文' }}
    </InkButton>
    <p v-if="error" role="alert">{{ error }}</p>
    <NewsletterReader
      v-if="newsletter && HTML_BODIES.has(block.resolver) && !showOriginal"
      :key="block.id"
      :block="block"
      :html="html"
    />
    <iframe
      v-else-if="HTML_BODIES.has(block.resolver)"
      class="content-email__html"
      title="Email HTML body"
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      :srcdoc="html"
    />
    <pre v-else class="content-email__text">{{ content }}</pre>
  </section>
</template>

<style scoped lang="scss">
.mail-body {
  display: grid;
  gap: sys-var(space, sm);
  min-width: 0;
}
.mail-body__original {
  justify-self: start;
}
iframe {
  width: 100%;
  min-height: 60vh;
  border: 0;
  background: #fff;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
}
</style>
