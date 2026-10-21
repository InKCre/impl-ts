<script setup lang="ts">
import { computed } from 'vue'
import type { RichText } from '../../schema'
import { safeUrl } from './presentation'

const props = defineProps<{ value: RichText }>()
const segments = computed(() => {
  const characters = [...props.value.text]
  const [visibleStart, visibleEnd] = props.value.visible ?? [0, characters.length]
  const styles = props.value.styles ?? []
  const links = (props.value.entities ?? []).flatMap((item) => {
    const label = characters.slice(...item.range).join('')
    const href =
      item.type === 'url'
        ? safeUrl(item.expanded)
        : item.type === 'mention'
          ? `https://x.com/i/user/${encodeURIComponent(item.userId)}`
          : item.type === 'hashtag'
            ? `https://x.com/hashtag/${encodeURIComponent(label.replace(/^#/, ''))}`
            : item.type === 'cashtag'
              ? `https://x.com/search?q=${encodeURIComponent(label)}`
              : undefined
    return href ? [{ range: item.range, href }] : []
  })
  const boundaries = new Set([visibleStart, visibleEnd])
  for (const item of [...styles, ...links]) {
    boundaries.add(Math.max(visibleStart, item.range[0]))
    boundaries.add(Math.min(visibleEnd, item.range[1]))
  }
  const ordered = [...boundaries]
    .filter((value) => value >= visibleStart && value <= visibleEnd)
    .sort((a, b) => a - b)
  return ordered.slice(0, -1).flatMap((start, index) => {
    const end = ordered[index + 1]!
    if (end <= start) return []
    const link = links.find((item) => item.range[0] <= start && item.range[1] >= end)
    return [
      {
        text: characters.slice(start, end).join(''),
        styles: styles
          .filter((item) => item.range[0] <= start && item.range[1] >= end)
          .flatMap((item) => item.styles),
        href: link?.href,
      },
    ]
  })
})
function classes(styles: string[]): string[] {
  return styles.map((style) => `rich-text--${style.toLowerCase().replace(/[^a-z0-9_-]/g, '')}`)
}
</script>

<template>
  <div class="rich-text">
    <p dir="auto">
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
  </div>
</template>

<style scoped>
.rich-text p {
  margin: 0;
  white-space: pre-wrap;
}
.rich-text--bold {
  font-weight: 700;
}
.rich-text--italic {
  font-style: italic;
}
.rich-text--underline {
  text-decoration: underline;
}
.rich-text--strikethrough {
  text-decoration: line-through;
}
</style>
