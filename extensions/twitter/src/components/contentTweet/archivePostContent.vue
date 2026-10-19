<script setup lang="ts">
import { computed } from 'vue'
import { getInfoBaseRouter, type SolvedContentRendererProps } from '@inkcre/core'
import type { ArchivePostContentModel } from '../../resolver'
import RichTextView from './richTextView.vue'
import ArchiveMediaContent from './archiveMediaContent.vue'
import ArticleBlockView from './articleBlockView.vue'

const props = defineProps<SolvedContentRendererProps<ArchivePostContentModel>>()
const router = getInfoBaseRouter()
const post = computed(() => props.solvedContent.post)
const fullPost = computed(() => ('authorId' in post.value ? post.value : null))
const author = computed(() => props.solvedContent.author)
const linked = computed(() =>
  props.solvedContent.references.filter(({ reference }) => reference.type !== 'media')
)
const media = computed(() =>
  props.solvedContent.references
    .filter(({ reference }) => reference.type === 'media')
    .sort((left, right) => {
      if (left.reference.type !== 'media' || right.reference.type !== 'media') return 0
      return left.reference.position - right.reference.position
    })
)
function navigate(block: number): void {
  void router.push({ name: 'block', block })
}
</script>

<template>
  <article class="archive-post">
    <header>
      <strong v-if="author && 'handle' in author"
        >{{ author.name }} <span>@{{ author.handle }}</span></strong
      >
      <span v-else>Unknown author · {{ fullPost?.authorId || post.id }}</span>
      <time v-if="fullPost">{{ fullPost.createdAt }}</time>
      <a
        v-if="fullPost"
        :href="`https://x.com/i/status/${fullPost.id}`"
        target="_blank"
        rel="noopener noreferrer"
      >
        Original post · {{ fullPost.id }}
      </a>
    </header>
    <p v-if="fullPost?.contentWarning" class="warning">
      {{ fullPost.contentWarning.title }} {{ fullPost.contentWarning.text }}
    </p>
    <RichTextView v-if="fullPost?.text" :value="fullPost.text" />
    <section v-if="fullPost?.article" class="article">
      <h2>{{ fullPost.article.title }}</h2>
      <p v-if="fullPost.article.preview" class="preview">{{ fullPost.article.preview }}</p>
      <ArticleBlockView
        v-for="(block, index) in fullPost.article.blocks"
        :key="index"
        :block="block"
        :entities="fullPost.article.entities"
      />
    </section>
    <blockquote v-if="fullPost?.replyTo?.tombstone">{{ fullPost.replyTo.tombstone }}</blockquote>
    <blockquote v-if="fullPost?.quote?.tombstone">{{ fullPost.quote.tombstone }}</blockquote>
    <p v-if="fullPost?.replyTo && !fullPost.replyTo.tombstone" class="context">
      Reply to @{{ fullPost.replyTo.handle || fullPost.replyTo.userId || 'unknown' }} ·
      {{ fullPost.replyTo.postId }}
    </p>
    <p v-if="fullPost?.quote && !fullPost.quote.tombstone" class="context">
      Quoted post · {{ fullPost.quote.postId }}
    </p>
    <p v-if="fullPost?.repostOf" class="context">Repost · {{ fullPost.repostOf }}</p>
    <dl v-if="fullPost?.counts" class="counts">
      <template v-for="(value, key) in fullPost.counts" :key="key"
        ><dt>{{ key }}</dt>
        <dd>{{ value }}</dd></template
      >
    </dl>
    <section v-if="media.length" class="media-list" aria-label="Post media">
      <ArchiveMediaContent
        v-for="item in media"
        :key="item.blockId"
        :block-id="item.blockId"
        :record="item.record"
      />
    </section>
    <ul v-if="linked.length" class="related-records" aria-label="Related Twitter records">
      <li v-for="item in linked" :key="item.blockId">
        <button type="button" @click="navigate(item.blockId)">
          View {{ item.reference.type }} {{ item.record?.id ?? 'unavailable record' }}
        </button>
      </li>
    </ul>
  </article>
</template>

<style scoped>
.archive-post {
  display: grid;
  gap: 1rem;
  max-width: 52rem;
  overflow-wrap: anywhere;
}
header {
  display: grid;
  gap: 0.25rem;
}
header span,
time,
.context,
.counts {
  color: var(--sys-color-text-subtle);
}
time,
.context {
  font-size: 0.875em;
}
.warning {
  padding: 0.6rem;
  border: 1px solid currentColor;
}
.article {
  border-top: 1px solid var(--sys-color-border-subtle);
  padding-top: 1rem;
}
.article p {
  white-space: pre-wrap;
}
.preview {
  color: var(--sys-color-text-subtle);
}
.counts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.7rem;
  margin: 0;
}
.counts dt {
  text-transform: capitalize;
}
.counts dd {
  margin: 0 0.8rem 0 0;
}
.related-records {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  margin: 0;
  padding-left: 1.25rem;
}
.media-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 0.75rem;
}
blockquote {
  border-left: 3px solid currentColor;
  margin: 0;
  padding-left: 0.75rem;
}
</style>
