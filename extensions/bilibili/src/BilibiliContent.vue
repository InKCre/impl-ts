<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { InkButton } from '@inkcre/ui-web'
import { getInfoBaseRouter, type SolvedContentRendererProps } from '@inkcre/core'
import { recordTitle, safeWebUrl, videoUrl } from './schema.ts'
import type { BilibiliResolver, RelatedGroup, SolvedBilibili } from './resolver.ts'

const props = defineProps<SolvedContentRendererProps<SolvedBilibili, BilibiliResolver>>()
const router = getInfoBaseRouter()
const value = computed(() => props.solvedContent.value)
const title = computed(() => recordTitle(value.value))
const description = computed(() =>
  value.value.kind === 'video' || value.value.kind === 'folder'
    ? value.value.record.description
    : undefined
)
const original = computed(() => {
  const current = value.value
  if (current.kind === 'video') return videoUrl(current.record)
  if (current.kind === 'user') return `https://space.bilibili.com/${current.record.mid}`
  if (current.kind === 'folder') return `https://www.bilibili.com/list/ml${current.record.id}`
  return null
})
const groups = ref<RelatedGroup[]>([])
const loading = ref('')
const error = ref('')
let generation = 0
watch(
  () => props.solvedContent,
  (content) => {
    generation++
    groups.value = content.groups.map((group) => ({ ...group, items: [...group.items] }))
    error.value = ''
    loading.value = ''
  },
  { immediate: true }
)

async function more(group: RelatedGroup) {
  if (group.nextOffset === null || loading.value) return
  const epoch = generation
  loading.value = group.role
  error.value = ''
  try {
    const next = await props.resolver.readGroup(group.role, group.nextOffset)
    if (epoch !== generation) return
    group.items.push(...next.items)
    group.nextOffset = next.nextOffset
  } catch {
    if (epoch === generation) error.value = '无法读取更多已保存条目，请稍后重试。'
  } finally {
    if (epoch === generation) loading.value = ''
  }
}
</script>

<template>
  <article class="bilibili-content">
    <h2>{{ title }}</h2>
    <p v-if="value.kind === 'folder'" class="bilibili-meta">
      {{
        value.record.is_private === undefined
          ? '可见性未知'
          : value.record.is_private
            ? '私密收藏夹'
            : '公开收藏夹'
      }}
      <span v-if="value.record.reported_count !== undefined">
        · 来源最近报告 {{ value.record.reported_count }} 条</span
      >
    </p>
    <p v-if="value.kind === 'video'" class="bilibili-meta">
      {{ value.record.bvid || `av${value.record.aid}` }}
      <span v-if="value.record.duration_seconds !== undefined">
        · {{ value.record.duration_seconds }} 秒</span
      >
    </p>
    <p v-if="value.kind === 'membership'" class="bilibili-meta">
      {{
        value.record.availability === 'unavailable'
          ? '来源显示此收藏条目已失效，保留已知资料。'
          : '已保存的收藏条目'
      }}
    </p>
    <p v-if="description !== undefined" class="bilibili-description">
      {{ description || '简介为空' }}
    </p>
    <a
      v-if="original && safeWebUrl(original)"
      :href="original"
      target="_blank"
      rel="noopener noreferrer"
      >在 B 站打开</a
    >
    <section v-for="group in groups" :key="group.role" class="bilibili-related">
      <h3>{{ group.title }}</h3>
      <ul v-if="group.items.length">
        <li
          v-for="item in group.items"
          :key="`${item.blockId}:${item.membership?.observed_at || ''}`"
        >
          <InkButton
            :text="recordTitle(item)"
            size="sm"
            @click="router.push({ name: 'solved-content', block: item.blockId })"
          />
          <span v-if="item.membership?.availability === 'unavailable'" class="bilibili-meta"
            >来源条目已失效</span
          >
          <p v-if="item.kind === 'video' && item.record.description" class="bilibili-description">
            {{ item.record.description }}
          </p>
          <p v-if="item.membership?.favored_at" class="bilibili-meta">
            收藏于 {{ new Date(item.membership.favored_at).toLocaleString() }}
          </p>
        </li>
      </ul>
      <p v-else class="bilibili-meta">尚无已保存资料。</p>
      <InkButton
        v-if="group.nextOffset !== null"
        text="读取更多"
        :is-loading="loading === group.role"
        :disabled="!!loading"
        @click="more(group)"
      />
    </section>
    <p v-if="error" role="alert">{{ error }}</p>
  </article>
</template>

<style scoped>
.bilibili-content {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}
.bilibili-content h2,
.bilibili-content h3,
.bilibili-content p {
  margin: 0;
}
.bilibili-content h2 {
  font-size: 1.35rem;
  overflow-wrap: anywhere;
}
.bilibili-content h3 {
  font-size: 1rem;
}
.bilibili-meta {
  opacity: 0.65;
  font-size: 0.875rem;
}
.bilibili-description {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.65;
}
.bilibili-related {
  display: grid;
  gap: 0.5rem;
  padding-top: 0.75rem;
}
.bilibili-related ul {
  display: grid;
  gap: 1rem;
  padding: 0;
  margin: 0;
  list-style: none;
}
.bilibili-related li {
  display: grid;
  gap: 0.3rem;
  min-width: 0;
}
</style>
