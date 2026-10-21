<script setup lang="ts">
import { computed } from 'vue'
import type { ArticleBlock, Article } from '../../schema'
import { safeUrl } from './presentation'

const props = defineProps<{ block: ArticleBlock; entities?: Article['entities'] }>()
const segments = computed(() => {
  const boundaries = new Set([0, props.block.text.length])
  for (const [offset, length] of props.block.styles ?? []) {
    boundaries.add(Math.max(0, offset))
    boundaries.add(Math.min(props.block.text.length, offset + length))
  }
  for (const [offset, length] of props.block.entities ?? []) {
    boundaries.add(Math.max(0, offset))
    boundaries.add(Math.min(props.block.text.length, offset + length))
  }
  const points = [...boundaries].sort((a, b) => a - b)
  return points.slice(0, -1).flatMap((start, index) => {
    const end = points[index + 1]!
    if (end <= start) return []
    const activeStyles = (props.block.styles ?? [])
      .filter(([offset, length]) => offset <= start && offset + length >= end)
      .map(([, , style]) => style.toLowerCase())
    const entityIndex = props.block.entities?.find(
      ([offset, length]) => offset <= start && offset + length >= end
    )?.[2]
    const entity = entityIndex === undefined ? undefined : props.entities?.[entityIndex]
    const candidate = entity?.data?.url ?? entity?.data?.href
    const href =
      entity?.type.toLowerCase() === 'link' && typeof candidate === 'string'
        ? safeUrl(candidate)
        : undefined
    return [{ text: props.block.text.slice(start, end), styles: activeStyles, href }]
  })
})
function classes(styles: string[]): string[] {
  return styles.map((style) => `article-style-${style.replace(/[^a-z0-9_-]/gi, '').toLowerCase()}`)
}
</script>

<template>
  <p dir="auto" :class="`article-${block.type}`">
    <template v-for="(segment, index) in segments" :key="index"
      ><a
        v-if="segment.href"
        :href="segment.href"
        target="_blank"
        rel="noopener noreferrer"
        :class="classes(segment.styles)"
        >{{ segment.text }}</a
      ><span v-else :class="classes(segment.styles)">{{ segment.text }}</span></template
    >
  </p>
</template>

<style scoped>
p {
  white-space: pre-wrap;
}
.article-unordered-list-item {
  margin-left: 1.5rem;
}
.article-header-two {
  font-size: 1.35em;
  font-weight: 650;
}
.article-header-three {
  font-size: 1.15em;
  font-weight: 600;
}
.article-style-bold {
  font-weight: 700;
}
.article-style-italic {
  font-style: italic;
}
.article-style-underline {
  text-decoration: underline;
}
.article-style-strikethrough {
  text-decoration: line-through;
}
</style>
