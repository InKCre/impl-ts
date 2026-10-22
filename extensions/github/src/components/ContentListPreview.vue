<script setup lang="ts">
import type { SolvedContentRendererProps } from '@inkcre/core'
import type { GitHubList, SolvedGitHub } from '../schema'
import ContentList from './ContentList.vue'
defineProps<SolvedContentRendererProps<SolvedGitHub<GitHubList>>>()
</script>

<template><ContentList v-bind="$props" compact /></template>
