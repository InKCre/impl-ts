<script setup lang="ts">
import type { SolvedContentRendererProps } from '@inkcre/core'

defineProps<SolvedContentRendererProps<string>>()
</script>

<template>
  <div class="content-text">
    <div class="content-text__content">{{ solvedContent }}</div>
  </div>
</template>

<style lang="scss" scoped>
.content-text {
  padding: sys-var(space, sm) sys-var(space, md);
  background: sys-var(color, surface, base);
  min-width: 80px;
  overflow: hidden;

  &__content {
    @include apply-font(body-md);
    color: sys-var(color, text, base);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
}
</style>
