<script setup lang="ts">
import { computed } from 'vue'
import type { SolvedContentRendererProps } from '@inkcre/core'
import { safeWebUrl, type Account, type SolvedGitHub } from '../schema'
import RelatedBlocks from './RelatedBlocks.vue'
import './content.scss'
const props = defineProps<
  SolvedContentRendererProps<SolvedGitHub<Account>> & { compact?: boolean }
>()
const account = computed(() => props.solvedContent.record)
const profileUrl = computed(() => safeWebUrl(account.value.url))
const avatarUrl = computed(() => safeWebUrl(account.value.avatar_url))
</script>

<template>
  <article class="github-content" :class="{ 'github-content--compact': compact }">
    <header class="github-account-heading">
      <img v-if="avatarUrl" :src="avatarUrl" alt="" loading="lazy" referrerpolicy="no-referrer" />
      <div>
        <h2>{{ account.name || `@${account.login}` }}</h2>
        <p v-if="account.name">@{{ account.login }}</p>
        <p class="github-metadata">
          {{ account.kind === 'organization' ? 'Organization' : 'User' }}
        </p>
      </div>
    </header>
    <a v-if="!compact && profileUrl" :href="profileUrl" target="_blank" rel="noopener noreferrer"
      >GitHub profile</a
    >
    <RelatedBlocks v-if="!compact" :groups="solvedContent.groups" />
  </article>
</template>
