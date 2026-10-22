<script setup lang="ts">
import { computed } from 'vue'
import type { SolvedContentRendererProps } from '@inkcre/core'
import { safeWebUrl, type Repository, type SolvedGitHub } from '../schema'
import RelatedBlocks from './RelatedBlocks.vue'
import './content.scss'
const props = defineProps<
  SolvedContentRendererProps<SolvedGitHub<Repository>> & { compact?: boolean }
>()
const repository = computed(() => props.solvedContent.record)
const repositoryUrl = computed(() => safeWebUrl(repository.value.url))
const homepageUrl = computed(() => safeWebUrl(repository.value.homepage_url))
</script>

<template>
  <article class="github-content" :class="{ 'github-content--compact': compact }">
    <h2>{{ repository.name_with_owner }}</h2>
    <p v-if="repository.description" class="github-description">{{ repository.description }}</p>
    <p class="github-metadata">
      <span v-if="repository.primary_language">{{ repository.primary_language }} · </span>
      {{ repository.is_private ? 'Private' : 'Public'
      }}<span v-if="repository.is_archived"> · Archived</span>
    </p>
    <ul v-if="repository.topics.length" class="github-topics" aria-label="Topics">
      <li v-for="topic in repository.topics" :key="topic">{{ topic }}</li>
    </ul>
    <nav
      v-if="!compact && (repositoryUrl || homepageUrl)"
      class="github-links"
      aria-label="Repository links"
    >
      <a v-if="repositoryUrl" :href="repositoryUrl" target="_blank" rel="noopener noreferrer"
        >GitHub repository</a
      >
      <a v-if="homepageUrl" :href="homepageUrl" target="_blank" rel="noopener noreferrer"
        >Homepage</a
      >
    </nav>
    <RelatedBlocks v-if="!compact" :groups="solvedContent.groups" />
  </article>
</template>
