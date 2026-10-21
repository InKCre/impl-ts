<script setup lang="ts">
defineProps<{
  name:
    | 'replies'
    | 'reposts'
    | 'quotes'
    | 'likes'
    | 'bookmarks'
    | 'views'
    | 'photo'
    | 'video'
    | 'expand'
    | 'external'
}>()
const paths = {
  replies: 'M21 11.5a9 9 0 0 1-9 9H4l1.8-4A9 9 0 1 1 21 11.5Z',
  reposts: 'm3 7 4-4 4 4M7 3v12a3 3 0 0 0 3 3h2m9-1-4 4-4-4m4 4V9a3 3 0 0 0-3-3h-2',
  quotes: 'M10 6H3v8h4c0 3-1 4-3 5m17-13h-7v8h4c0 3-1 4-3 5',
  likes: 'M12 21S2 15 2 8a5 5 0 0 1 10-1 5 5 0 0 1 10 1c0 7-10 13-10 13Z',
  bookmarks: 'M5 3h14v18l-7-5-7 5Z',
  views: 'M4 20V10m6 10V4m6 16v-8m6 8V7',
  photo:
    'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm-1 14 5-5 4 4 4-6 5 8M8 7h.01',
  video: 'm9 6 10 6-10 6Z',
  expand: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
  external: 'M14 3h7v7m0-7L10 14M10 3H3v18h18v-7',
}
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name]" />
  </svg>
</template>

<style scoped>
svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
</style>
