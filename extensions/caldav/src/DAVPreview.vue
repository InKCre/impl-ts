<script setup lang="ts">
import { computed } from 'vue'
import type { SolvedContentRendererProps } from '@inkcre/core'
import { contentTitle, type DAVContent } from './content'
import { useText } from './locale'

const props = defineProps<SolvedContentRendererProps<DAVContent>>()
const tr = useText()
const title = computed(() => contentTitle(props.solvedContent) || tr('Untitled', '未命名'))
const item = computed(() =>
  props.solvedContent.kind === 'calendar' ? props.solvedContent.items[0] : null
)
const date = computed(() => item.value?.due ?? item.value?.start)
</script>

<template>
  <article class="dav-preview">
    <p v-if="solvedContent.kind === 'invalid'">
      {{
        tr(
          'Unable to read DAV content. Open to inspect the original.',
          '无法解析 DAV 内容，可打开查看原文。'
        )
      }}
    </p>
    <template v-else>
      <small v-if="item"
        >{{ item.kind === 'vtodo' ? tr('Task', '任务') : tr('Event', '日程')
        }}<span v-if="item.status"> · {{ item.status }}</span></small
      >
      <small v-else>{{
        solvedContent.kind === 'contact' ? tr('Contact', '联系人') : tr('Collection', '集合')
      }}</small>
      <strong>{{ title }}</strong>
      <p v-if="date">
        {{ date.value }}
        {{
          date.dateOnly
            ? tr('All day', '全天')
            : date.zone === 'floating'
              ? tr('Floating time', '未指定时区')
              : date.zone
        }}
      </p>
      <p v-if="item?.description">{{ item.description }}</p>
      <p v-if="solvedContent.kind === 'contact'">
        {{
          solvedContent.fields.find((field) => field.name === 'org')?.values[0]?.value ||
          solvedContent.fields.find((field) => field.name === 'email')?.values[0]?.value
        }}
      </p>
      <p v-if="solvedContent.kind === 'collection'">
        {{ solvedContent.members.length }} {{ tr('items', '项内容') }}
      </p>
      <small v-if="solvedContent.kind === 'calendar' && solvedContent.items.length > 1"
        >{{ solvedContent.items.length }}
        {{ tr('components, including recurrence exceptions', '个组件，包含重复例外') }}</small
      >
    </template>
  </article>
</template>

<style scoped>
.dav-preview {
  display: grid;
  gap: 0.35rem;
  min-width: 0;
  max-width: 24rem;
  overflow-wrap: anywhere;
}
p,
strong {
  margin: 0;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
small {
  color: var(--sys-color-text-subtle);
}
</style>
