<script setup lang="ts">
import type { SolvedContentRendererProps } from '@inkcre/core'
import type { Account, SolvedGitHub } from '../schema'
import ContentAccount from './ContentAccount.vue'
defineProps<SolvedContentRendererProps<SolvedGitHub<Account>>>()
</script>

<template><ContentAccount v-bind="$props" compact /></template>
