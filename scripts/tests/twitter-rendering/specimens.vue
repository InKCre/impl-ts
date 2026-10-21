<script setup lang="ts">
import { computed, markRaw, ref } from 'vue'
import { VueFlow } from '@vue-flow/core'
import { setInfoBaseRouter, type InfoBaseRoute } from '@inkcre/core'
import SolvedContentRenderer from '../../../apps/client-web/src/components/info-base/SolvedContentRenderer/SolvedContentRenderer.vue'
import PreviewRenderer from '../../../apps/client-web/src/components/info-base/PreviewRenderer/PreviewRenderer.vue'
import BlockNode from '../../../apps/client-web/src/components/info-base/BlockNode/BlockNode.vue'
import SolvedContentPopup from '../../../apps/client-web/src/components/info-base/SolvedContentPopup/SolvedContentPopup.vue'
import { specimens, blocks, resolverFor, solvedFor } from './fixtures'

const selected = ref(100)
const mode = ref('comparison')
const dark = ref(false)
document.documentElement.dataset.theme = 'light'
const popup = ref<number | null>(null)
const focused = ref<number | null>(null)
const current = ref<InfoBaseRoute | null>(null)
setInfoBaseRouter({
  current,
  push(route) {
    current.value = route
    if ('block' in route) {
      selected.value = route.block
      popup.value = route.block
    }
  },
  back() {
    popup.value = null
  },
})
const resolver = computed(() => markRaw(resolverFor(selected.value)))
const solved = computed(() => solvedFor(selected.value))
const nodes = ref(
  [100, 104, 105, 108].map((id, index) => ({
    id: String(id),
    type: 'block',
    position: { x: 50 + (index % 2) * 380, y: 40 + Math.floor(index / 2) * 350 },
    data: {
      block: blocks.get(id)!,
      resolver: markRaw(resolverFor(id)),
      solvedContent: solvedFor(id),
      previewStatus: 'success',
      focal: false,
      muted: false,
    },
  }))
)
function changeTheme() {
  dark.value = !dark.value
  document.documentElement.dataset.theme = dark.value ? 'dark' : 'light'
}
</script>

<template>
  <main>
    <header class="specimen-toolbar">
      <strong>Twitter · 内容与预览</strong>
      <label
        >样本
        <select id="specimen" v-model="selected">
          <option v-for="item in specimens" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select></label
      >
      <label
        >视图
        <select id="view" v-model="mode">
          <option value="comparison">详情与预览</option>
          <option value="graph">真实图谱节点</option>
        </select></label
      >
      <button type="button" @click="changeTheme">{{ dark ? '浅色' : '深色' }}</button>
      <button type="button" @click="popup = selected">打开实际内容弹窗</button>
    </header>
    <p class="specimen-note">隔离 UI 样例 · 合成内容 / 实际 renderer 与宿主组件 · 不连接信息库</p>
    <div v-if="mode === 'comparison'" class="specimen-comparison">
      <section class="specimen-detail" aria-label="Post detail">
        <SolvedContentRenderer :key="selected" :resolver="resolver" :solved-content="solved" />
      </section>
      <aside>
        <p class="specimen-caption">Block preview · 288px</p>
        <div class="specimen-preview">
          <PreviewRenderer :resolver="resolver" :solved-content="solved" />
        </div>
      </aside>
    </div>
    <div v-else class="specimen-graph">
      <VueFlow v-model:nodes="nodes" :min-zoom="0.5" :max-zoom="1.5">
        <template #node-block="props"
          ><BlockNode v-bind="props" @focus="focused = $event" @inspect="popup = $event"
        /></template>
      </VueFlow>
      <output v-if="focused">Focused Block #{{ focused }}</output>
    </div>
    <SolvedContentPopup v-if="popup !== null" :key="popup" :block="popup" />
  </main>
</template>

<style>
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  background: var(--sys-color-surface-base);
  color: var(--sys-color-text-base);
  font:
    15px/1.5 system-ui,
    sans-serif;
}
button,
select {
  font: inherit;
  color: inherit;
}
.specimen-toolbar {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--sys-color-border-base);
  padding: 16px 24px;
}
.specimen-toolbar label {
  display: flex;
  gap: 8px;
  align-items: center;
}
.specimen-toolbar button,
select {
  padding: 6px 10px;
  border: 1px solid var(--sys-color-border-base);
  background: var(--sys-color-surface-base);
}
.specimen-note,
.specimen-caption {
  color: var(--sys-color-text-subtle);
  font-size: 12px;
}
.specimen-note {
  padding: 0 24px;
}
.specimen-comparison {
  display: grid;
  grid-template-columns: minmax(0, 660px) 288px;
  gap: 48px;
  justify-content: center;
  padding: 24px;
  align-items: start;
}
.specimen-detail {
  min-width: 0;
  border: 1px solid var(--sys-color-border-base);
  padding: 24px;
}
.specimen-preview {
  border: 1px solid var(--sys-color-border-base);
  padding: 16px;
}
.specimen-graph {
  height: 820px;
  width: 100%;
}
.specimen-graph output {
  position: fixed;
  bottom: 16px;
  left: 16px;
}
@media (max-width: 760px) {
  .specimen-comparison {
    grid-template-columns: minmax(0, 1fr);
    padding: 12px;
    gap: 24px;
  }
  .specimen-detail {
    padding: 16px;
  }
  aside {
    max-width: 288px;
  }
}
</style>
