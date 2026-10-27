<script setup lang="ts">
import { computed } from 'vue'
import { InkButton, InkContentReader } from '@inkcre/ui-web'
import { decodeBytes, partRole, partFormat, type MaterialRead } from '@inkcre/web-collection'
const props = defineProps<{ material: MaterialRead }>()
const body = computed(() => props.material.parts.find((part) => partRole(part) === 'body'))
const format = computed(() => (body.value ? partFormat(body.value) : null))
const content = computed(() =>
  body.value && format.value !== 'pdf'
    ? new TextDecoder('utf-8', { fatal: true }).decode(decodeBytes(body.value.base64))
    : ''
)
const html = computed(() => {
  const part = props.material.parts.find(
    (part) => partRole(part) === 'original' && partFormat(part) === 'html'
  )
  return part ? new TextDecoder('utf-8', { fatal: true }).decode(decodeBytes(part.base64)) : ''
})
function download() {
  const part = props.material.parts.find((part) => partFormat(part) === 'pdf')!
  const data = decodeBytes(part.base64)
  const url = URL.createObjectURL(
    new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
  )
  const link = document.createElement('a')
  link.href = url
  link.download = 'saved-document.pdf'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
</script>
<template>
  <article class="reader" aria-label="已保存材料">
    <div class="row">
      <h2>{{ material.material?.title || material.source.metadata.title || '已保存材料' }}</h2>
      <span class="muted">{{
        material.mode === 'current'
          ? '当前内容 · LIVE'
          : material.mode === 'fixed'
            ? '主动留存'
            : '仅来源记录'
      }}</span>
    </div>
    <a
      class="item-url"
      :href="String(material.material?.url ?? material.source.metadata.url)"
      target="_blank"
      rel="noopener noreferrer"
      >{{ material.material?.url ?? material.source.metadata.url }}</a
    >
    <p v-if="material.material" class="muted">
      取得于 {{ material.material.captured_at }} · {{ material.material.method }}
    </p>
    <p v-for="gap in material.material?.coverage" :key="gap" class="muted">{{ gap }}</p>
    <InkContentReader
      v-if="format === 'html' || format === 'markdown'"
      :content="content"
      :format="format"
    />
    <pre v-else-if="format === 'text'">{{ content }}</pre>
    <InkButton
      v-if="material.parts.some((part) => partFormat(part) === 'pdf')"
      text="下载已保存的 PDF 原始内容"
      @click="download"
    />
    <p v-if="material.mode === 'record'" class="muted">链接和来源信息已保存，尚无正文。</p>
    <div v-for="note in material.notes" :key="note.id">
      <h3>附注</h3>
      <pre>{{ note.text }}</pre>
    </div>
    <details v-if="html">
      <summary>查看已保存的 HTML 源码</summary>
      <pre><code>{{ html }}</code></pre>
    </details>
    <details>
      <summary>来源信息</summary>
      <pre>{{ JSON.stringify(material.source.metadata, null, 2) }}</pre>
    </details>
  </article>
</template>
