<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { browser } from 'wxt/browser'
import { InkButton, InkTextarea } from '@inkcre/ui-web'
import logo from '@inkcre/ui-web/logo/svg/original-transparent/inkcre-original-transparent-32.svg?url'
import reverseLogo from '@inkcre/ui-web/logo/svg/reverse-transparent/inkcre-reverse-transparent-32.svg?url'
import { collectionMessage } from '~/logic/collection/messages'
import { siteMatchPattern } from '~/logic/collection/permissions'
import { deliveryLabels, useCollectionStatus } from '~/logic/collection/ui'

const { status, error, feedback, busy, action, updateSettings } = useCollectionStatus()
const currentURL = ref('')
const tabId = ref<number>()
const note = ref('')
const origin = computed(() => {
  try {
    return new URL(currentURL.value).origin
  } catch {
    return ''
  }
})
const currentTarget = computed(() =>
  status.value?.connections.find((target) => target.id === status.value?.config.activeConnectionId)
)
onMounted(async () => {
  const tab = (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0]
  currentURL.value = tab?.url ?? ''
  tabId.value = tab?.id
})
async function save(kind: 'page' | 'selection' | 'pdf' | 'link') {
  if (
    kind === 'pdf' &&
    !(await browser.permissions.request({ origins: [siteMatchPattern(origin.value)] }))
  )
    throw new Error('未取得 PDF 原站访问权限。')
  await collectionMessage({
    type: 'collection-save',
    kind,
    note: note.value,
    tabId: tabId.value,
    expectedURL: currentURL.value,
  })
}
async function enableAutomatic() {
  if (!(await browser.permissions.request({ origins: [siteMatchPattern(origin.value)] })))
    throw new Error('未取得站点权限。')
  await collectionMessage({ type: 'collection-enable-origin', origin: origin.value })
}
function openResult(connectionId: string, blockId: number) {
  void browser.tabs.create({
    url: browser.runtime.getURL(`/options.html#read=${blockId}&connection=${connectionId}`),
  })
}
</script>

<template>
  <main class="collection-popup">
    <div class="stack">
      <div class="brand">
        <picture>
          <source :srcset="reverseLogo" media="(prefers-color-scheme: dark)" />
          <img :src="logo" alt="" width="32" height="32" />
        </picture>
        InKCre / WebExt
      </div>
      <h1>保存浏览中的材料</h1>
      <p class="muted">
        {{ currentTarget ? currentTarget.name : '尚未加入信息库' }}
      </p>
    </div>
    <p v-if="error" role="alert" class="feedback error">{{ error }}</p>
    <p v-if="feedback" role="status" class="feedback">{{ feedback }}</p>
    <InkTextarea v-model:value="note" label="附注（可选）" :rows="2" />
    <div class="actions">
      <InkButton
        theme="primary"
        text="保存当前页"
        :disabled="!currentTarget || busy"
        @click="action(() => save('page'), '已在本机等待发送。')"
      /><InkButton
        text="保存选区"
        :disabled="!currentTarget || busy"
        @click="action(() => save('selection'), '已在本机等待发送。')"
      />
    </div>
    <div class="actions">
      <InkButton
        text="保存在线 PDF"
        size="sm"
        :disabled="!currentTarget || busy"
        @click="action(() => save('pdf'), '已在本机等待发送。')"
      /><InkButton
        text="仅保存链接"
        size="sm"
        :disabled="!currentTarget || busy"
        @click="action(() => save('link'), '链接已在本机等待发送，未采集正文。')"
      />
    </div>
    <section v-if="status" class="section stack">
      <p class="muted">
        自动采集{{
          status.config.paused
            ? '已暂停'
            : status.config.origins.includes(origin)
              ? '已在此站点开启'
              : '未在此站点开启'
        }}。主动保存保留本次内容，自动采集维护当前内容。
      </p>
      <InkButton
        v-if="origin && !status.config.origins.includes(origin)"
        text="开启此站点自动采集"
        :disabled="busy || !currentTarget"
        @click="action(enableAutomatic, '此站点已启用自动采集。')"
      />
      <InkButton
        v-if="status.config.origins.length"
        :text="status.config.paused ? '恢复自动采集' : '暂停所有自动采集'"
        :disabled="busy"
        @click="action(() => updateSettings({ ...status!.config, paused: !status!.config.paused }))"
      />
      <InkButton
        v-if="origin"
        text="排除此站点"
        size="sm"
        :disabled="busy"
        @click="
          action(
            () =>
              updateSettings({
                ...status!.config,
                excluded: [...new Set([...status!.config.excluded, origin])],
              }),
            '此站点后续自动采集已停止。'
          )
        "
      />
    </section>
    <article v-for="item in status?.items.slice(0, 3)" :key="item.id" class="item">
      <span>{{ deliveryLabels[item.state] }}</span>
      <p v-if="item.error" class="muted">{{ item.error }}</p>
      <InkButton
        v-if="item.receipt"
        text="查看已保存材料"
        size="sm"
        @click="openResult(item.connectionId, item.receipt!.root_id)"
      />
    </article>
    <InkButton text="设置、导入与保存结果" @click="browser.runtime.openOptionsPage()" />
  </main>
</template>
