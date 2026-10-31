<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { browser } from 'wxt/browser'
import { InkButton, InkDropdown, InkForm, InkInput, InkSwitch, InkTextarea } from '@inkcre/ui-web'
import type { MaterialRead } from '@inkcre/web-collection'
import MaterialReader from '~/components/collection/MaterialReader.vue'
import logo from '@inkcre/ui-web/logo/svg/original-transparent/inkcre-original-transparent-32.svg?url'
import reverseLogo from '@inkcre/ui-web/logo/svg/reverse-transparent/inkcre-reverse-transparent-32.svg?url'
import { collectionMessage } from '~/logic/collection/messages'
import { siteMatchPattern } from '~/logic/collection/permissions'
import { connection } from '~/logic/collection/store'
import { deliveryLabels, useCollectionStatus } from '~/logic/collection/ui'
import { exportLocalData, importLocalData } from '~/logic/collection/transfer'

const { status, error, feedback, busy, action, updateSettings } = useCollectionStatus()
const version = browser.runtime.getManifest().version
const transferFile = ref<HTMLInputElement>()
async function downloadLocalData() {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(await exportLocalData())], { type: 'application/json' })
  )
  const link = document.createElement('a')
  link.href = url
  link.download = `inkcre-webext-${version}-local-data.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function restoreLocalData(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  await action(async () => {
    await importLocalData(JSON.parse(await file.text()))
    input.value = ''
  }, '数据已迁入。请停用旧实例，再检查连接并重新授权站点；浏览器授权不会随文件转移。')
}
const target = ref({ name: '我的信息库', url: '', secret: '', storageId: '-4' })
const editingConnection = ref<string>()
const showConnectionForm = ref(false)
const currentConnection = computed(() =>
  status.value?.connections.find(
    (connection) => connection.id === status.value?.config.activeConnectionId
  )
)
const origin = ref('')
const exclusions = ref('')
const folders = ref([{ label: '全部书签', value: '' }])
const importKind = ref<'bookmarks' | 'history'>('bookmarks')
const folder = ref('')
const since = ref(new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10))
const until = ref(new Date().toISOString().slice(0, 10))
const site = ref('')
const visits = ref('1')
const fetchContent = ref(true)
const reader = ref<MaterialRead>()
const draft = ref<{
  text: string
  url: string
  title: string
  captured_at: string
  method?: 'selected-text' | 'legacy-note-recovery'
}>()
const note = ref('')
const connectionOptions = computed(
  () =>
    status.value?.connections.map((target) => ({
      label: target.name,
      value: target.id,
      description: target.url,
    })) ?? []
)
const activeConnection = computed({
  get: () => status.value?.config.activeConnectionId ?? '',
  set: (value: string | number) => {
    if (status.value)
      void action(() =>
        updateSettings({ ...status.value!.config, activeConnectionId: String(value) })
      )
  },
})
async function connect() {
  const url = new URL(target.value.url)
  if (!editingConnection.value || target.value.url !== currentConnection.value?.url)
    await browser.permissions.request({ origins: [siteMatchPattern(url.href)] })
  await collectionMessage({
    type: 'collection-connect',
    connectionId: editingConnection.value,
    connection: { ...target.value, storageId: Number(target.value.storageId) },
  })
  target.value.secret = ''
  editingConnection.value = undefined
  showConnectionForm.value = false
}
async function configureConnection(edit: boolean) {
  const existing =
    edit && currentConnection.value ? await connection(currentConnection.value.id) : undefined
  editingConnection.value = existing?.id
  target.value = {
    name: existing?.name ?? '我的信息库',
    url: existing?.url ?? '',
    secret: existing?.secret ?? '',
    storageId: String(existing?.storageId ?? -4),
  }
  showConnectionForm.value = true
}
async function checkConnection() {
  const target = currentConnection.value!
  if (!(await browser.permissions.request({ origins: [siteMatchPattern(target.url)] })))
    throw new Error('未取得数据库地址的访问权限；本机配置仍然保留。')
  await collectionMessage({ type: 'collection-check-connection', connectionId: target.id })
}
function editExclusions(event: Event) {
  if ((event.currentTarget as HTMLDetailsElement).open)
    exclusions.value = status.value!.config.excluded.join('\n')
}
async function enableOrigin() {
  const parsed = new URL(origin.value)
  if (!(await browser.permissions.request({ origins: [siteMatchPattern(parsed.href)] })))
    throw new Error('未取得站点权限。')
  await collectionMessage({ type: 'collection-enable-origin', origin: parsed.origin })
  origin.value = ''
}
async function saveExclusions() {
  const excluded = exclusions.value
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const url = new URL(value)
      return url.pathname === '/' && !url.search && !url.hash ? url.origin : url.href
    })
  await updateSettings({ ...status.value!.config, excluded })
}
async function preview() {
  if (
    !(await browser.permissions.request({
      permissions: [importKind.value === 'bookmarks' ? 'bookmarks' : 'history'],
    }))
  )
    throw new Error('未取得此来源的读取权限。')
  if (importKind.value === 'bookmarks')
    folders.value = await collectionMessage({ type: 'collection-folders' })
  await collectionMessage({
    type: 'collection-preview-import',
    options: {
      kind: importKind.value,
      folder: folder.value,
      since: new Date(since.value).getTime(),
      until: new Date(until.value).getTime() + 86400_000 - 1,
      site: site.value.trim(),
      minVisits: Number(visits.value),
      fetchContent: fetchContent.value,
    },
  })
}
async function controlImport(id: string, command: 'start' | 'pause' | 'resume' | 'retry') {
  const run = status.value!.imports.find((run) => run.id === id)!
  if (
    command !== 'pause' &&
    run.fetchContent &&
    run.origins.length &&
    !(await browser.permissions.request({
      origins: [...new Set(run.origins.map(siteMatchPattern))],
    }))
  )
    throw new Error('未取得原站访问权限。也可以重新预览并选择只导入记录。')
  await collectionMessage({ type: 'collection-control-import', id, action: command })
}
async function read(connectionId: string, blockId: number) {
  reader.value = await collectionMessage({ type: 'collection-read', connectionId, blockId })
}
function recover(task: { text: string; url: string }) {
  draft.value = {
    text: task.text,
    url: task.url,
    title: '旧摘录',
    captured_at: new Date().toISOString(),
    method: 'legacy-note-recovery',
  }
  location.hash = 'save'
}
onMounted(() => {
  const hash = new URLSearchParams(location.hash.slice(1))
  const block = hash.get('read'),
    connectionId = hash.get('connection')
  if (block && connectionId) void action(() => read(connectionId, Number(block)))
})
</script>

<template>
  <main class="collection-page">
    <header class="settings-header">
      <picture>
        <source :srcset="reverseLogo" media="(prefers-color-scheme: dark)" />
        <img :src="logo" alt="InKCre" width="32" height="32" />
      </picture>
      <div class="stack">
        <span class="brand">InKCre / WebExt {{ version }}</span>
        <h1>扩展设置</h1>
      </div>
    </header>
    <p v-if="error" role="alert" class="feedback error">{{ error }}</p>
    <p v-if="feedback" role="status" class="feedback">{{ feedback }}</p>
    <p v-if="status?.migrationWarning" class="feedback">{{ status.migrationWarning }}</p>
    <section class="section" aria-labelledby="connection-heading">
      <h2 id="connection-heading">信息库</h2>
      <InkDropdown
        v-if="connectionOptions.length"
        v-model="activeConnection"
        label="当前信息库"
        :options="connectionOptions"
        :disabled="busy"
      />
      <div v-if="currentConnection" class="stack">
        <div class="row">
          <span>本 Peer</span
          ><code class="item-url" aria-label="本 Peer ID">{{ currentConnection.peerId }}</code>
        </div>
        <div class="actions">
          <InkButton
            text="修改连接"
            size="sm"
            :disabled="busy"
            @click="action(() => configureConnection(true))"
          />
          <InkButton
            text="加入另一个信息库"
            size="sm"
            :disabled="busy"
            @click="action(() => configureConnection(false))"
          />
          <InkButton text="检查连接" size="sm" :disabled="busy" @click="action(checkConnection)" />
        </div>
        <p v-if="status?.peerErrors[currentConnection.id]" role="alert" class="feedback error">
          Peer 登记未完成：{{ status.peerErrors[currentConnection.id] }}
        </p>
      </div>
      <InkForm
        v-if="showConnectionForm || !connectionOptions.length"
        :key="editingConnection ?? 'new'"
        layout="col"
        @submit="action(connect, '连接配置已保存。')"
      >
        <div class="two-column">
          <InkInput v-model="target.name" label="信息库名称" required /><InkInput
            v-model="target.url"
            label="PostgREST 地址"
            native-type="url"
            placeholder="https://database.example/rest/v1"
            :disabled="busy"
            required
          />
        </div>
        <p v-if="editingConnection && target.url !== currentConnection?.url" class="muted">
          原信息库换地址后，未发送材料也使用此地址。另一个信息库请新建连接。
        </p>
        <InkInput
          v-model="target.secret"
          label="数据库 JWT 密钥"
          native-type="password"
          autocomplete="off"
          required
        />
        <details>
          <summary>PDF 存储</summary>
          <InkInput
            v-model="target.storageId"
            label="PDF 可写存储 ID"
            native-type="number"
            required
          />
        </details>
        <div class="actions">
          <InkButton
            theme="primary"
            native-type="submit"
            :text="editingConnection ? '更新连接' : '加入信息库'"
            :is-loading="busy"
          />
          <InkButton
            v-if="connectionOptions.length"
            text="取消"
            :disabled="busy"
            @click="showConnectionForm = false"
          />
        </div>
      </InkForm>
    </section>
    <section id="save" v-if="draft" class="section" aria-labelledby="draft-heading">
      <h2 id="draft-heading">保存摘录</h2>
      <p class="muted">旧待办可能已在原信息库保存，迁入前请先核对。</p>
      <InkForm
        layout="col"
        @submit="
          action(
            () => collectionMessage({ type: 'collection-save-draft', draft: draft!, note }),
            '已在本机等待发送。'
          )
        "
      >
        <InkInput v-model="draft.url" label="原网页地址" native-type="url" required />
        <InkTextarea v-model:value="draft.text" label="摘录原文" :rows="6" required />
        <InkTextarea v-model:value="note" label="附注（可选）" :rows="3" />
        <InkButton theme="primary" native-type="submit" text="保存摘录" :is-loading="busy" />
      </InkForm>
    </section>
    <section v-if="status" class="section" aria-labelledby="automatic-heading">
      <div class="section-heading">
        <h2 id="automatic-heading">自动采集</h2>
        <div class="row">
          <span>暂停自动采集</span
          ><InkSwitch
            size="xs"
            :model-value="status.config.paused"
            aria-label="暂停自动采集"
            :is-switching="busy"
            @update:model-value="
              (value) => action(() => updateSettings({ ...status!.config, paused: value }))
            "
          />
        </div>
      </div>
      <p class="muted">
        默认关闭，仅在授权站点维护当前内容。切换网站账户可能替换同一地址的当前内容；重要材料请主动保存，主动原文和附注不会被改写。
      </p>
      <InkForm layout="col" @submit="action(enableOrigin, '此站点已启用自动采集。')"
        ><InkInput
          v-model="origin"
          label="添加站点"
          native-type="url"
          placeholder="https://example.com"
          required /><InkButton native-type="submit" text="授权并启用此站点" :disabled="busy"
      /></InkForm>
      <div v-for="allowed in status.config.origins" :key="allowed" class="row">
        <span class="item-url">{{ allowed }}</span
        ><InkButton
          text="停用"
          size="sm"
          :disabled="busy"
          @click="
            action(() =>
              updateSettings({
                ...status!.config,
                origins: status!.config.origins.filter((origin) => origin !== allowed),
              })
            )
          "
        />
      </div>
      <details @toggle="editExclusions">
        <summary>排除页面或站点</summary>
        <InkForm layout="col" @submit="action(saveExclusions, '排除规则已生效。')"
          ><p class="muted">每行一个页面或站点地址。</p>
          <InkTextarea v-model:value="exclusions" label="排除规则" :rows="4" /><InkButton
            native-type="submit"
            text="保存排除规则"
            :disabled="busy"
        /></InkForm>
      </details>
    </section>
    <section class="section" aria-labelledby="import-heading">
      <h2 id="import-heading">导入已有资料</h2>
      <p class="muted">
        先保存原来的记录，再取得今天的正文。需要登录或获取失败的页面保留记录，可在原页打开后补采。
      </p>
      <InkForm layout="col" @submit="action(preview, '预览已生成；确认范围后开始导入。')">
        <div class="two-column">
          <InkDropdown
            v-model="importKind"
            label="来源"
            :options="[
              { label: '浏览器书签', value: 'bookmarks' },
              { label: '浏览器历史', value: 'history' },
            ]"
          /><InkInput v-model="site" label="限定站点（可选）" placeholder="example.com" />
        </div>
        <InkDropdown
          v-if="importKind === 'bookmarks'"
          v-model="folder"
          label="书签目录"
          :options="folders"
        />
        <div v-else class="two-column">
          <InkInput v-model="since" label="开始日期" native-type="date" /><InkInput
            v-model="until"
            label="结束日期"
            native-type="date"
          /><InkInput v-model="visits" label="至少访问次数" native-type="number" />
        </div>
        <div class="row">
          <span>同时取得当前内容</span
          ><InkSwitch v-model="fetchContent" size="xs" aria-label="同时取得当前内容" />
        </div>
        <InkButton native-type="submit" text="读取来源并预览" :is-loading="busy" />
      </InkForm>
      <article v-for="run in status?.imports" :key="run.id" class="item">
        <div class="row">
          <h3>{{ run.kind === 'bookmarks' ? '书签' : '历史' }} · {{ run.counts.total }} 条</h3>
          <span>{{
            { preview: '待确认', running: '进行中', paused: '已停止', completed: '本批已处理' }[
              run.state
            ]
          }}</span>
        </div>
        <p class="muted">
          记录已保存 {{ run.counts.records }} · 内容已取得 {{ run.counts.content }} · 内容已存在
          {{ run.counts.existing }} · 待处理 {{ run.remainingCount }} · 需补采
          {{ run.failuresCount }}
        </p>
        <p v-if="run.error" role="alert" class="feedback error">
          {{ run.error }} 修复后可继续，已取得的材料不会重新抓取。
        </p>
        <p v-if="run.state === 'preview'" class="muted">
          {{
            run.fetchContent
              ? `将访问 ${run.origins.length} 个站点取得当前内容。`
              : '只保存来源记录，不访问原网页。'
          }}
          保存到 {{ status?.connections.find((target) => target.id === run.connectionId)?.name }}。
        </p>
        <div v-if="run.state === 'preview'" class="preview-list">
          <div v-for="item in run.sample" :key="item.key" class="item">
            <span>{{ item.title }}</span
            ><span class="item-url muted">{{ item.url }}</span>
          </div>
          <p v-if="run.remainingCount > run.sample.length" class="muted">
            先展示前 {{ run.sample.length }} 条；筛选条件应用于整批 {{ run.remainingCount }} 条。
          </p>
        </div>
        <div class="actions">
          <InkButton
            v-if="run.state === 'preview'"
            theme="primary"
            text="确认导入"
            :disabled="busy"
            @click="action(() => controlImport(run.id, 'start'))"
          /><InkButton
            v-if="run.state === 'running'"
            text="停止剩余工作"
            :disabled="busy"
            @click="action(() => controlImport(run.id, 'pause'))"
          /><InkButton
            v-if="run.state === 'paused'"
            text="继续"
            :disabled="busy"
            @click="action(() => controlImport(run.id, 'resume'))"
          /><InkButton
            v-if="run.failuresCount"
            text="只重试需补采的条目"
            :disabled="busy || run.state === 'running'"
            @click="action(() => controlImport(run.id, 'retry'))"
          />
        </div>
        <details v-if="run.failures.length">
          <summary>查看需要处理的条目</summary>
          <div v-for="failure in run.failures" :key="failure.item.key" class="item">
            <a :href="failure.item.url" target="_blank" rel="noopener noreferrer">{{
              failure.item.title || failure.item.url
            }}</a>
            <p class="muted">{{ failure.error }}</p>
          </div>
        </details>
      </article>
    </section>
    <section class="section" aria-labelledby="delivery-heading">
      <h2 id="delivery-heading">最近保存与待发送</h2>
      <p v-if="!status?.items.length" class="muted">
        从扩展按钮保存当前页或选区，结果会显示在这里。
      </p>
      <article v-for="item in status?.items" :key="item.id" class="item">
        <div class="row">
          <span>{{ deliveryLabels[item.state] }}</span
          ><span class="muted">{{
            item.automatic ? '自动采集' : item.importId ? '导入' : '主动保存'
          }}</span>
        </div>
        <span class="item-url">{{ item.url }}</span>
        <p v-if="item.error" class="muted">{{ item.error }}</p>
        <div class="actions">
          <InkButton
            v-if="item.receipt"
            text="读取已保存材料"
            size="sm"
            @click="action(() => read(item.connectionId, item.receipt!.root_id))"
          /><InkButton
            v-if="item.state === 'blocked'"
            text="重试"
            size="sm"
            @click="action(() => collectionMessage({ type: 'collection-retry', id: item.id }))"
          />
        </div>
      </article>
    </section>
    <details class="section">
      <summary>本机数据迁移</summary>
      <p class="muted">
        文件包含明文密钥和待发送材料，请私下保管。迁移时先关闭其他扩展页面并等待正在发送的工作结束，导出后停用旧实例，不要卸载；只迁入空实例。
      </p>
      <div class="actions">
        <InkButton text="导出本机数据" @click="action(downloadLocalData)" />
        <InkButton text="迁入本机数据" @click="transferFile?.click()" />
        <input
          ref="transferFile"
          type="file"
          accept="application/json,.json"
          hidden
          aria-label="本机数据文件"
          @change="restoreLocalData"
        />
      </div>
    </details>
    <MaterialReader v-if="reader" :material="reader" />
    <section v-if="status?.legacyTasks.length || status?.legacyWarning" class="section">
      <h2>待迁入的旧摘录</h2>
      <p v-if="status?.legacyWarning" class="feedback">{{ status.legacyWarning }}</p>
      <article v-for="task in status?.legacyTasks" :key="task.id" class="item">
        <p>{{ task.text }}</p>
        <span class="muted">原状态：{{ task.state }}。保存结果可能不明，请核对后再迁入。</span
        ><InkButton text="核对并迁入这条摘录" @click="recover(task)" />
      </article>
    </section>
  </main>
</template>
