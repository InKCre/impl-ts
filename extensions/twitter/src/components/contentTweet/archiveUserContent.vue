<script setup lang="ts">
import type { SolvedContentRendererProps } from '@inkcre/core'
import { computed } from 'vue'
import type { UserRecord } from '../../schema'
import RichTextView from './richTextView.vue'

const props = defineProps<SolvedContentRendererProps<UserRecord>>()
function safeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const parsed = new URL(value)
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password
      ? parsed.toString()
      : undefined
  } catch {
    return undefined
  }
}
const website = computed(() =>
  'handle' in props.solvedContent ? safeUrl(props.solvedContent.website) : undefined
)
const avatar = computed(() =>
  'handle' in props.solvedContent ? safeUrl(props.solvedContent.avatarUrl) : undefined
)
</script>

<template>
  <article class="archive-user">
    <template v-if="'handle' in solvedContent">
      <header>
        <div>
          <h2>{{ solvedContent.name }}</h2>
          <p>@{{ solvedContent.handle }}</p>
        </div>
        <a v-if="avatar" :href="avatar" target="_blank" rel="noopener noreferrer"
          >Open captured avatar URL</a
        >
      </header>
      <div v-if="solvedContent.bio"><RichTextView :value="solvedContent.bio" /></div>
      <dl>
        <template v-if="solvedContent.location"
          ><dt>Location</dt>
          <dd>{{ solvedContent.location }}</dd></template
        ><template v-if="website"
          ><dt>Website</dt>
          <dd>
            <a :href="website" target="_blank" rel="noopener noreferrer">{{ website }}</a>
          </dd></template
        ><template v-if="solvedContent.counts"
          ><dt>Followers</dt>
          <dd>{{ solvedContent.counts.followers }}</dd>
          <dt>Following</dt>
          <dd>{{ solvedContent.counts.following }}</dd>
          <dt>Posts</dt>
          <dd>{{ solvedContent.counts.posts }}</dd></template
        >
      </dl>
    </template>
    <p v-else>
      User {{ solvedContent.id }} is an identity placeholder; a later capture may add profile
      fields.
    </p>
  </article>
</template>

<style scoped>
.archive-user {
  display: grid;
  gap: 1rem;
  max-width: 42rem;
  overflow-wrap: anywhere;
}
header {
  display: flex;
  align-items: center;
  gap: 1rem;
}
h2,
p {
  margin: 0;
}
dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.4rem 0.8rem;
}
dt {
  color: var(--sys-color-text-subtle);
}
dd {
  margin: 0;
}
</style>
