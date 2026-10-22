<script setup lang="ts">
import { computed } from 'vue'
import type { SolvedContentRendererProps } from '@inkcre/core'
import type { GitHubList, SolvedGitHub } from '../schema'
import RelatedBlocks from './RelatedBlocks.vue'
import './content.scss'
const props = defineProps<
  SolvedContentRendererProps<SolvedGitHub<GitHubList>> & { compact?: boolean }
>()
const list = computed(() => props.solvedContent.record)
</script>

<template>
  <article class="github-content" :class="{ 'github-content--compact': compact }">
    <h2>{{ list.name }}</h2>
    <p v-if="list.description" class="github-description">{{ list.description }}</p>
    <p class="github-metadata">{{ list.is_private ? 'Private list' : 'Public list' }}</p>
    <p v-if="!compact && list.slug" class="github-metadata">{{ list.slug }}</p>
    <RelatedBlocks v-if="!compact" :groups="solvedContent.groups" />
  </article>
</template>
