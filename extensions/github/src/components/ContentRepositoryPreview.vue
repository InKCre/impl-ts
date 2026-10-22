<script setup lang="ts">
import type { SolvedContentRendererProps } from '@inkcre/core'
import type { Repository, SolvedGitHub } from '../schema'
import ContentRepository from './ContentRepository.vue'
defineProps<SolvedContentRendererProps<SolvedGitHub<Repository>>>()
</script>

<template><ContentRepository v-bind="$props" compact /></template>
