<script setup lang="ts">
import { computed } from 'vue'
import { InkContentReader } from '@inkcre/ui-web'
import type { SolvedContentRendererProps } from '@inkcre/core'
import type { LocalFileResolver } from './resolver'
import { peerFileLocation, type SolvedFile } from './schema'
const props = defineProps<SolvedContentRendererProps<SolvedFile, LocalFileResolver>>()
const location = computed(() => peerFileLocation(props.solvedContent.metadata.location))
</script>

<template>
  <article class="file-content">
    <header>
      <strong>{{ location.path.split('/').at(-1) }}</strong>
      <p>{{ location.path }}</p>
      <p>原件 Peer：{{ location.peer }}</p>
    </header>
    <p v-if="!solvedContent.metadata.available">原件已失效；已收入正文保留。</p>
    <p v-if="solvedContent.metadata.issue">
      {{ solvedContent.metadata.issue }}。以下为上次成功提取的正文。
    </p>
    <p v-if="solvedContent.metadata.revision?.scope === 'main_document'">
      DOCX 主文档文字（不含脚注、批注）
    </p>
    <p v-else-if="solvedContent.metadata.revision?.scope === 'text_layer'">PDF 文字层</p>
    <InkContentReader
      v-if="
        solvedContent.content !== null &&
        (solvedContent.format === 'html' || solvedContent.format === 'markdown')
      "
      :content="solvedContent.content"
      :format="solvedContent.format"
    />
    <div v-else-if="solvedContent.text !== null" class="body">
      {{ solvedContent.text || '空白文本' }}
    </div>
    <p v-else>尚无已收入正文</p>
  </article>
</template>

<style scoped>
.file-content {
  display: grid;
  gap: var(--sys-space-md);
  color: var(--sys-color-text-base);
  overflow-wrap: anywhere;
}
p {
  margin: 0;
  color: var(--sys-color-text-subtle);
}
header {
  display: grid;
  gap: var(--sys-space-xs);
}
.body {
  white-space: pre-wrap;
  border-top: 1px solid var(--sys-color-border-base);
  padding-top: var(--sys-space-md);
}
</style>
