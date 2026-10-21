<script setup lang="ts">
import { computed } from 'vue'
import type { UserRecord } from '../../schema'

const props = defineProps<{ author?: UserRecord | null; compact?: boolean }>()
const user = computed(() => (props.author && 'handle' in props.author ? props.author : null))
</script>

<template>
  <div class="tweet-identity" :class="{ 'tweet-identity--compact': compact }">
    <span class="tweet-identity__avatar" aria-hidden="true">{{
      user ? [...(user.name || user.handle)][0] : '𝕏'
    }}</span>
    <div class="tweet-identity__text">
      <span class="tweet-identity__name">
        <strong>{{ user?.name || user?.handle || 'Unknown author' }}</strong>
        <svg
          v-if="user?.verified?.blue || user?.verified?.type"
          class="tweet-identity__verified"
          :class="{
            'tweet-identity__verified--business': user.verified?.type === 'Business',
            'tweet-identity__verified--government': user.verified?.type === 'Government',
          }"
          viewBox="0 0 24 24"
          role="img"
          aria-label="Verified account"
        >
          <path
            fill="currentColor"
            d="m12 1 3 2 3.5.5 1 3.5L22 10l-1 3.5.5 3.5-3 2-2 3-3.5-.5L10 23l-3-2-3.5-.5-1-3.5L0 14l1-3.5L.5 7l3-2 2-3L9 2.5Z"
          />
          <path
            d="m7 12 3 3 7-7"
            fill="none"
            stroke="var(--sys-color-surface-base)"
            stroke-width="2"
          />
        </svg>
      </span>
      <span class="tweet-identity__handle">{{
        user ? `@${user.handle}` : 'Profile not captured'
      }}</span>
    </div>
  </div>
</template>

<style scoped>
.tweet-identity {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  font-size: 15px;
  line-height: 1.35;
}
.tweet-identity__avatar {
  display: grid;
  place-items: center;
  flex: 0 0 42px;
  height: 42px;
  border-radius: 50%;
  background: var(--sys-color-surface-subtle);
  border: 1px solid var(--sys-color-border-subtle);
  color: var(--sys-color-text-subtle);
  font-size: 19px;
}
.tweet-identity__text {
  min-width: 0;
  display: grid;
  gap: 2px;
}
.tweet-identity__name {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.tweet-identity__name strong,
.tweet-identity__handle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tweet-identity__handle {
  color: var(--sys-color-text-subtle);
  font-size: 14px;
}
.tweet-identity__verified {
  width: 17px;
  height: 17px;
  flex: none;
  color: #1d9bf0;
}
.tweet-identity__verified--business {
  color: #b88b12;
}
.tweet-identity__verified--government {
  color: var(--sys-color-text-subtle);
}
.tweet-identity--compact {
  font-size: 13px;
  gap: 8px;
}
.tweet-identity--compact .tweet-identity__avatar {
  flex-basis: 32px;
  height: 32px;
  font-size: 15px;
}
.tweet-identity--compact .tweet-identity__handle {
  font-size: 12px;
}
</style>
