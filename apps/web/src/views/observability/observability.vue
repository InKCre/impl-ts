<script setup lang="ts">
import ObservationExplorer from '@/components/obsrv/ObservationExplorer/ObservationExplorer.vue'
</script>

<template>
  <main class="observability-view">
    <ObservationExplorer />
  </main>
</template>

<style scoped lang="scss">
.observability-view {
  width: 100%;
  max-width: 1280px;
  margin-inline: auto;
  padding: sys-var(space, lg);
  box-sizing: border-box;
}
</style>
