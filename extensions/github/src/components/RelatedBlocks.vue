<script setup lang="ts">
import { getInfoBaseRouter } from '@inkcre/core'
import { InkButton } from '@inkcre/ui-web'
import { relatedTitle, type RelatedGroup } from '../schema'

defineProps<{ groups: RelatedGroup[] }>()
const router = getInfoBaseRouter()
</script>

<template>
  <section v-for="group in groups" :key="group.title" class="github-related">
    <h3>{{ group.title }}</h3>
    <ul v-if="group.blocks.length">
      <li v-for="block in group.blocks" :key="block.blockId">
        <InkButton
          :text="relatedTitle(block)"
          size="sm"
          @click="router.push({ name: 'solved-content', block: block.blockId })"
        />
        <p v-if="block.type === 'repository' && block.content.description">
          {{ block.content.description }}
        </p>
      </li>
    </ul>
    <p v-else class="github-empty">None collected</p>
  </section>
</template>
