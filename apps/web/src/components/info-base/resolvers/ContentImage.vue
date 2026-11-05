<script setup lang="ts">
import { ref } from 'vue'
import type { SolvedContentRendererProps } from '@inkcre/core'
import type { ImageSolvedContent } from '@inkcre/core'

const props = defineProps<SolvedContentRendererProps<ImageSolvedContent>>()

const imageError = ref(false)

const onError = () => {
  imageError.value = true
}
</script>

<template>
  <div class="content-image">
    <img
      v-if="!imageError"
      :src="props.solvedContent.objectUrl"
      alt="Block image"
      class="content-image__img"
      @error="onError"
    />
    <div v-else class="content-image__error">
      <span class="content-image__error-icon">!</span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.content-image {
  border-radius: sys-var(radius, none);
  overflow: hidden;
  background: sys-var(color, surface, subtle);
  display: flex;
  align-items: center;
  justify-content: center;

  &__img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  &__error {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: sys-var(color, text, subtle);
  }

  &__error-icon {
    @include apply-font(label-lg);
    color: sys-var(color, text, subtle);
  }
}
</style>
