<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getInfoBaseRouter } from '@inkcre/core'
import { InkButton } from '@inkcre/ui-web'
import type { ContentExtractionProps } from './ContentExtraction'

const props = defineProps<ContentExtractionProps>()
const { t } = useI18n()
const sources = ref<Record<string, number | null | 'error'>>({})

watch(
  [() => props.resolver, () => props.solvedContent],
  async ([resolver, content], _, onCleanup) => {
    let active = true
    onCleanup(() => {
      active = false
    })
    sources.value = {}
    for (const group of content.basis) {
      try {
        const source = await resolver.getSource(group.key)
        if (!active) return
        sources.value[group.key] = source
      } catch {
        if (!active) return
        sources.value[group.key] = 'error'
      }
    }
  },
  { immediate: true }
)

function onSourceClick(key: string): void {
  const block = sources.value[key]
  if (typeof block === 'number') void getInfoBaseRouter().push({ name: 'solved-content', block })
}
</script>

<template>
  <article class="content-extraction">
    <div class="content-extraction__text">{{ solvedContent.text }}</div>
    <section class="content-extraction__basis">
      <h3>{{ t('infoBase.extraction.excerpts') }}</h3>
      <section
        v-for="group in solvedContent.basis"
        :key="group.key"
        class="content-extraction__source"
      >
        <h4>{{ group.observed_origin.label }}</h4>
        <blockquote v-for="(excerpt, index) in group.excerpts" :key="index">
          {{ excerpt }}
        </blockquote>
        <InkButton
          v-if="typeof sources[group.key] === 'number'"
          size="sm"
          @click="onSourceClick(group.key)"
          >{{ t('infoBase.extraction.openSource') }}</InkButton
        >
        <span v-else class="content-extraction__source-state">
          {{
            t(
              sources[group.key] === 'error'
                ? 'infoBase.extraction.sourceError'
                : sources[group.key] === null
                  ? 'infoBase.extraction.sourceUnavailable'
                  : 'infoBase.extraction.sourceLoading'
            )
          }}
        </span>
      </section>
    </section>
  </article>
</template>

<style lang="scss" scoped src="./ContentExtraction.scss" />
