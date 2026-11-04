<script setup lang="ts">
import { computed } from 'vue'
import type { ByteSolvedContent, SolvedContentRendererProps } from '@inkcre/core'

const props = defineProps<SolvedContentRendererProps<ByteSolvedContent>>()

const label = computed(() => props.resolver.block.resolver.split('.')[1]?.toUpperCase() ?? 'FILE')
</script>

<template>
  <div class="content-file">
    <span class="content-file__label">{{ label }}</span>
    <span class="content-file__size">{{ solvedContent.byte_size }} bytes</span>
    <a :href="solvedContent.objectUrl" target="_blank" rel="noopener">Open</a>
  </div>
</template>

<style lang="scss" scoped>
.content-file {
  display: flex;
  align-items: center;
  gap: sys-var(space, sm);
  padding: sys-var(space, sm) sys-var(space, md);
  background: sys-var(color, surface, subtle);

  &__label {
    @include apply-font(label-md, $mono: true);
  }

  &__size {
    color: sys-var(color, text, subtle);
  }
}
</style>
