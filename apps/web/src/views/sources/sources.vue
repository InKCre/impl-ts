<script setup lang="ts">
import { computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute } from 'vue-router'
import { useAsyncState } from '@vueuse/core'
import SourceCard from '@/components/source/sourceCard/sourceCard.vue'
import CreateSource from '@/components/source/createSource/createSource.vue'
import { InkSkeleton, InkButton, InkPlaceholder } from '@inkcre/ui-web'
import { Source, configStore } from '@inkcre/core'

const { t } = useI18n()
const route = useRoute()
const connected = computed(
  () => !!configStore.metaConfig.INKCRE_PGREST_URL && !!configStore.metaConfig.INKCRE_JWT_SECRET
)
const {
  state: sources,
  execute: refetchSources,
  isLoading,
  error,
} = useAsyncState(() => Source.getAll(), [], {
  resetOnExecute: false,
  immediate: connected.value,
  // The region renders error and retry; this handled failure must not reach reportError.
  onError: () => undefined,
  onSuccess: () => {
    void nextTick(() => {
      if (!/^#source-\d+$/.test(route.hash)) return
      const row = document.getElementById(route.hash.slice(1))
      row?.scrollIntoView({ block: 'nearest' })
      row?.querySelector<HTMLAnchorElement>('a')?.focus({ preventScroll: true })
    })
  },
})
async function onCreateSource(source: Source) {
  sources.value = [source, ...sources.value]
  await nextTick()
  document.getElementById(`source-${source.id}`)?.scrollIntoView({ block: 'nearest' })
}
</script>

<template>
  <main class="sources-view" :aria-label="t('sidePanel.sources')">
    <header v-if="connected" class="sources-view__header">
      <CreateSource @create="onCreateSource" />
      <InkButton
        :text="t('common.refresh')"
        size="sm"
        :is-loading="isLoading"
        @click="refetchSources()"
      />
    </header>
    <InkPlaceholder v-if="!connected" :title="t('extension.connectDeployment')"
      ><template #actions
        ><RouterLink to="/settings">{{ t('common.settings') }}</RouterLink></template
      ></InkPlaceholder
    >
    <div
      v-else-if="isLoading && !sources.length"
      class="sources-view__skeletons"
      role="status"
      :aria-label="t('common.loading')"
    >
      <div v-for="index in 3" :key="index" class="sources-view__skeleton" aria-hidden="true">
        <InkSkeleton style="width: 40%" /><InkSkeleton style="width: 65%" />
      </div>
    </div>
    <div v-else-if="error" class="sources-view__feedback">
      <p role="alert" class="text-feedback-error">{{ t('source.listFailed') }}</p>
      <InkButton :text="t('source.retry')" theme="subtle" @click="refetchSources()" />
    </div>
    <p v-else-if="!sources.length && !isLoading">{{ t('source.empty') }}</p>
    <div class="sources-view__list">
      <SourceCard
        v-for="source in sources"
        :id="`source-${source.id}`"
        :key="source.id"
        :source="source"
      />
    </div>
  </main>
</template>

<style lang="scss" scoped src="./sources.scss" />
