<script setup lang="ts">
import { computed } from 'vue'
import { getInfoBaseRouter, type SolvedContentRendererProps } from '@inkcre/core'
import type { ArchivePostContentModel } from '../../resolver'
import { compactCount, postDate, safeUrl } from './presentation'
import TweetIdentity from './tweetIdentity.vue'
import TweetIcon from './tweetIcon.vue'
import RichTextView from './richTextView.vue'
import ArchiveMediaContent from './archiveMediaContent.vue'
import ArticleBlockView from './articleBlockView.vue'

const props = defineProps<SolvedContentRendererProps<ArchivePostContentModel>>()
const router = getInfoBaseRouter()
const post = computed(() => props.solvedContent.post)
const fullPost = computed(() => ('authorId' in post.value ? post.value : null))
const media = computed(() =>
  props.solvedContent.references
    .filter(({ reference }) => reference.type === 'media')
    .sort((a, b) =>
      a.reference.type === 'media' && b.reference.type === 'media'
        ? a.reference.position - b.reference.position
        : 0
    )
)
const reply = computed(() =>
  props.solvedContent.references.find(({ reference }) => reference.type === 'reply')
)
const authorBlock = computed(() =>
  props.solvedContent.references.find(({ reference }) => reference.type === 'author')
)
const contextPosts = computed(() =>
  [
    {
      kind: 'quote',
      id: fullPost.value?.quote?.postId,
      label: 'Quoted post',
      tombstone: fullPost.value?.quote?.tombstone,
    },
    { kind: 'repost', id: fullPost.value?.repostOf, label: 'Reposted post', tombstone: undefined },
  ]
    .filter((item) => item.id)
    .map((item) => {
      const reference = props.solvedContent.references.find(
        ({ reference }) => reference.type === item.kind
      )
      return {
        ...item,
        blockId: reference?.blockId,
        post: reference?.record && 'authorId' in reference.record ? reference.record : null,
      }
    })
)
const countLabels = {
  replies: 'Replies',
  reposts: 'Reposts',
  quotes: 'Quotes',
  likes: 'Likes',
  bookmarks: 'Bookmarks',
  views: 'Views',
} as const
const cardHost = computed(() => {
  const url = safeUrl(fullPost.value?.card?.url)
  return url ? new URL(url).hostname : ''
})
const counts = computed(() =>
  (Object.keys(countLabels) as (keyof typeof countLabels)[]).flatMap((key) => {
    const value = fullPost.value?.counts?.[key]
    return value === undefined ? [] : [{ key, value, label: countLabels[key] }]
  })
)
function navigate(block: number): void {
  void router.push({ name: 'solved-content', block })
}
</script>

<template>
  <article class="content-tweet">
    <header class="content-tweet__header">
      <TweetIdentity :author="solvedContent.author" />
      <a
        class="content-tweet__source"
        :href="`https://x.com/i/status/${post.id}`"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="View original post on X"
        title="Open original post on X"
        ><span>View original post</span><TweetIcon name="external"
      /></a>
    </header>
    <div v-if="fullPost?.replyTo" class="content-tweet__context">
      <button v-if="reply" type="button" @click="navigate(reply.blockId)">
        Replying to {{ fullPost.replyTo.handle ? `@${fullPost.replyTo.handle}` : 'a post' }}
      </button>
      <span v-else
        >Replying to {{ fullPost.replyTo.handle ? `@${fullPost.replyTo.handle}` : 'a post' }}</span
      >
      <p v-if="fullPost.replyTo.tombstone">{{ fullPost.replyTo.tombstone }}</p>
    </div>
    <p v-if="!fullPost" class="content-tweet__notice">
      This post has not been captured yet. Open the original post on X to read it.
    </p>
    <p v-if="fullPost?.contentWarning" class="content-tweet__notice">
      <strong>{{ fullPost.contentWarning.title }}</strong> {{ fullPost.contentWarning.text }}
    </p>
    <RichTextView v-if="fullPost?.text" class="content-tweet__text" :value="fullPost.text" />
    <section v-if="fullPost?.article" class="content-tweet__article">
      <span class="content-tweet__eyebrow">Article</span>
      <h2>{{ fullPost.article.title }}</h2>
      <p v-if="fullPost.article.preview" class="content-tweet__subtle">
        {{ fullPost.article.preview }}
      </p>
      <ArticleBlockView
        v-for="(block, index) in fullPost.article.blocks"
        :key="index"
        :block="block"
        :entities="fullPost.article.entities"
      />
    </section>
    <section
      v-if="media.length"
      class="tweet-media-grid"
      :class="`tweet-media-grid--${Math.min(media.length, 4)}`"
      aria-label="Post media"
    >
      <ArchiveMediaContent
        v-for="item in media"
        :key="item.blockId"
        :block-id="item.blockId"
        :record="item.record"
      />
    </section>
    <section
      v-for="item in contextPosts"
      :key="item.kind"
      class="content-tweet__quote"
      :aria-label="item.label"
    >
      <div class="content-tweet__quote-heading">
        <TweetIcon :name="item.kind === 'quote' ? 'quotes' : 'reposts'" /><strong>{{
          item.label
        }}</strong
        ><time v-if="item.post" :datetime="item.post.createdAt">{{
          postDate(item.post.createdAt, true)
        }}</time>
      </div>
      <p v-if="item.tombstone" class="content-tweet__subtle">{{ item.tombstone }}</p>
      <template v-else-if="item.post">
        <RichTextView v-if="item.post.text" :value="item.post.text" />
        <strong v-if="item.post.article">{{ item.post.article.title }}</strong>
        <span v-if="item.post.mediaIds?.length" class="content-tweet__subtle"
          >{{ item.post.mediaIds.length }} attachments</span
        >
      </template>
      <p v-else class="content-tweet__subtle">Post content not captured.</p>
      <button
        v-if="item.blockId"
        type="button"
        class="content-tweet__text-link"
        @click="navigate(item.blockId)"
      >
        Open saved post →
      </button>
      <a
        v-else
        :href="`https://x.com/i/status/${item.id}`"
        target="_blank"
        rel="noopener noreferrer"
        >View on X ↗</a
      >
    </section>
    <a
      v-if="fullPost?.card && safeUrl(fullPost.card.url)"
      class="content-tweet__card"
      :href="safeUrl(fullPost.card.url)"
      target="_blank"
      rel="noopener noreferrer"
    >
      <span class="content-tweet__subtle">{{ fullPost.card.domain || cardHost }} ↗</span>
      <strong>{{ fullPost.card.title || fullPost.card.url }}</strong>
      <span v-if="fullPost.card.description">{{ fullPost.card.description }}</span>
    </a>
    <aside v-if="fullPost?.communityNote" class="content-tweet__quote" aria-label="Community note">
      <strong>{{ fullPost.communityNote.title || 'Readers added context' }}</strong>
      <RichTextView :value="fullPost.communityNote.text" />
    </aside>
    <footer v-if="fullPost" class="content-tweet__footer">
      <div class="content-tweet__metadata">
        <time :datetime="fullPost.createdAt">{{ postDate(fullPost.createdAt) }}</time
        ><span v-if="fullPost.source">· {{ fullPost.source }}</span>
      </div>
      <dl v-if="counts.length" class="content-tweet__counts" aria-label="Engagement at capture">
        <div
          v-for="item in counts"
          :key="item.key"
          :title="`${item.value.toLocaleString()} ${item.label.toLowerCase()}`"
        >
          <dt>
            <TweetIcon :name="item.key" /><span class="content-tweet__sr-only">{{
              item.label
            }}</span>
          </dt>
          <dd>{{ compactCount(item.value) }}</dd>
        </div>
      </dl>
      <div class="content-tweet__footnote">
        <span v-if="counts.length">Counts at capture</span
        ><button
          v-if="authorBlock"
          type="button"
          class="content-tweet__text-link"
          @click="navigate(authorBlock.blockId)"
        >
          Saved profile →
        </button>
      </div>
    </footer>
  </article>
</template>

<style lang="scss" scoped src="./contentTweet.scss" />
