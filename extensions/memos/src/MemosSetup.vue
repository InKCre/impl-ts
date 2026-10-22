<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { InkButton, InkDropdown, InkForm, InkInput, INK_I18N_KEY } from '@inkcre/ui-web'
import {
  ExtensionModel,
  ExtensionParticipationModel,
  configStore,
  type ExtensionParticipation,
  PeerOutcomeUnknown,
  type InstalledExtension,
  type Peer,
} from '@inkcre/core'
import { manageExtensionOnPeer } from '@inkcre/extension-runtime-client-web'
import {
  extensionName,
  ensureMemosParticipation,
  generateToken,
  MemosConnectionError,
  personalAccessToken,
  readHelpUrl,
  readSetup,
  readServerUrl,
} from './setup'

const emit = defineEmits<{ close: [] }>()
const i18n = inject(INK_I18N_KEY, undefined)
const zh = computed(() => i18n?.locale.value.startsWith('zh') ?? false)
const tr = (en: string, cn: string) => (zh.value ? cn : en)
const extension = shallowRef<InstalledExtension | null>(null)
const peers = shallowRef<Peer[]>([])
const selected = ref('')
const draft = ref('')
const address = ref('')
const busy = ref(false)
const loaded = ref(false)
const requiresRefresh = ref(false)
const reveal = ref(false)
const error = ref('')
const notice = ref('')
const helpUrl = ref<string | null>(null)
const helpStatus = ref<'loading' | 'available' | 'missing' | 'unavailable'>('loading')
let mounted = true
onUnmounted(() => {
  mounted = false
})

const peer = computed(() => peers.value.find((candidate) => candidate.id === selected.value))
const savedToken = computed(() => (extension.value ? personalAccessToken(extension.value) : null))
const participations = ref<ExtensionParticipation[]>([])
const enabled = computed(() =>
  participations.value.some((row) => row.peer_id === selected.value && row.enabled)
)
const localVersion = computed(
  () =>
    participations.value.find((row) => row.peer_id === configStore.metaConfig.INKCRE_PEER_ID)
      ?.version
)
const ready = computed(() => loaded.value && address.value && savedToken.value && enabled.value)
const options = computed(() =>
  peers.value.map((candidate) => ({
    label: `${candidate.name} · ${candidate.application_version ? `v${candidate.application_version}` : tr('version unknown', '版本未知')}`,
    value: candidate.id,
  }))
)

async function loadHelp(version: string) {
  helpUrl.value = null
  helpStatus.value = 'loading'
  try {
    const url = await readHelpUrl(version)
    if (!mounted || localVersion.value !== version) return
    helpUrl.value = url
    helpStatus.value = url ? 'available' : 'missing'
  } catch {
    if (mounted && localVersion.value === version) helpStatus.value = 'unavailable'
  }
}

async function loadAddress() {
  address.value = ''
  if (!peer.value || !savedToken.value || !enabled.value) return
  try {
    address.value = await readServerUrl(peer.value.id)
  } catch (cause) {
    error.value =
      cause instanceof MemosConnectionError && cause.status === 409
        ? tr(
            'PAT saved and Memos enabled. Set this Core’s Public HTTP Base URL in Peers → Edit Config, then refresh.',
            'PAT 已保存，Memos 已启用。请在 Peer → 编辑配置中设置此 Core 的公共 HTTP 基址，再刷新。'
          )
        : tr(
            'PAT saved and Memos enabled, but its address is unavailable. Check Core and refresh.',
            'PAT 已保存，Memos 已启用，但暂时无法读取服务地址。请检查 Core 后刷新。'
          )
  }
}

async function refresh() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  address.value = ''
  reveal.value = false
  try {
    const current = await readSetup()
    if (!mounted) return
    extension.value = current.extension
    participations.value = (await ExtensionParticipationModel.list()).filter(
      (row) => row.name === extensionName
    )
    if (localVersion.value) void loadHelp(localVersion.value)
    else helpStatus.value = 'missing'
    peers.value = current.peers
    if (!selected.value && current.peers.length === 1) selected.value = current.peers[0]!.id
    loaded.value = true
    requiresRefresh.value = false
    await loadAddress()
  } catch {
    loaded.value = false
    error.value = tr(
      'Unable to read the current setup. Check your instance connection and refresh.',
      '无法读取当前配置。请检查实例连接并刷新。'
    )
  } finally {
    busy.value = false
  }
}

async function selectPeer() {
  reveal.value = false
  error.value = ''
  notice.value = ''
  busy.value = true
  try {
    await loadAddress()
  } finally {
    busy.value = false
  }
}

async function prepare() {
  if (busy.value || !loaded.value || !peer.value || requiresRefresh.value) return
  const target = peer.value.id
  busy.value = true
  error.value = ''
  notice.value = ''
  address.value = ''
  let phase: 'read' | 'save' | 'enable' = 'read'
  try {
    const current = await ExtensionModel.get(extensionName)
    if (!current) throw new Error('Memos is no longer installed.')
    extension.value = current
    await ensureMemosParticipation(target)
    if (!personalAccessToken(current)) {
      phase = 'save'
      draft.value ||= generateToken()
      await manageExtensionOnPeer(target, {
        action: 'patch_config',
        extension: extensionName,
        patch: { personal_access_token: draft.value },
      })
    }
    phase = 'enable'
    if (!enabled.value) {
      await manageExtensionOnPeer(target, {
        action: 'enable',
        extension: extensionName,
      })
    }
    extension.value = await ExtensionModel.get(extensionName)
    participations.value = (await ExtensionParticipationModel.list()).filter(
      (row) => row.name === extensionName
    )
    draft.value = ''
    await loadAddress()
  } catch (cause) {
    if (cause instanceof PeerOutcomeUnknown) {
      requiresRefresh.value = true
      error.value =
        phase === 'enable'
          ? tr(
              'PAT saved. Enablement outcome is unknown; refresh before continuing.',
              'PAT 已保存，启用结果未知；请先刷新再继续。'
            )
          : tr(
              'Save outcome is unknown; refresh before continuing.',
              '保存结果未知；请先刷新再继续。'
            )
    } else {
      error.value =
        phase === 'enable'
          ? tr(
              'PAT saved, but Memos could not be enabled. Check Core, then try again.',
              'PAT 已保存，但 Memos 未能启用。请检查 Core 后重试。'
            )
          : tr(
              'Connection preparation failed. Check Core and try again.',
              '连接准备失败，请检查 Core 后重试。'
            )
    }
  } finally {
    busy.value = false
  }
}

async function copy(value: string, kind: 'url' | 'pat') {
  notice.value = ''
  try {
    await navigator.clipboard.writeText(value)
    notice.value =
      kind === 'url'
        ? tr('Server URL copied.', '服务地址已复制。')
        : tr('PAT copied. Keep it private.', 'PAT 已复制，请妥善保管。')
  } catch {
    notice.value = tr(
      'Clipboard unavailable. Select the value and copy manually; reveal the PAT if needed.',
      '剪贴板不可用，请选中文字手动复制；需要时先显示 PAT。'
    )
  }
}

onMounted(refresh)
</script>

<template>
  <section class="memos-setup" :aria-busy="busy">
    <p>
      {{
        tr('Connect a Memos-compatible app to this instance.', '将兼容 Memos 的 App 连接到此实例。')
      }}
    </p>
    <p v-if="error" role="alert" class="memos-setup__error">{{ error }}</p>
    <template v-if="loaded">
      <p v-if="!peers.length" role="status">
        {{
          tr(
            'No online Core can manage Memos. Start Core, then refresh.',
            '没有可管理 Memos 的在线 Core。请启动 Core 后刷新。'
          )
        }}
      </p>
      <InkForm v-else layout="col" @submit="prepare">
        <InkDropdown
          v-if="peers.length > 1 || !peer"
          v-model="selected"
          :options="options"
          :label="tr('Core providing Memos', '提供 Memos 服务的 Core')"
          :disabled="busy || requiresRefresh"
          required
          @change="selectPeer"
        />
        <p v-else>
          Core: {{ peer.name }} ·
          {{
            peer.application_version
              ? `v${peer.application_version}`
              : tr('version unknown', '版本未知')
          }}
        </p>
        <InkButton
          v-if="!ready"
          native-type="submit"
          theme="primary"
          :text="tr('Prepare connection', '准备连接')"
          :disabled="!peer || requiresRefresh"
          :is-loading="busy"
        />
        <template v-else>
          <h3>{{ tr('Connection details are ready', '连接信息已准备好') }}</h3>
          <InkInput :model-value="address" label="Server URL" readonly />
          <InkButton :text="tr('Copy server URL', '复制服务地址')" @click="copy(address, 'url')" />
          <InkInput
            :model-value="savedToken"
            label="Personal Access Token"
            :native-type="reveal ? 'text' : 'password'"
            readonly
            autocomplete="off"
          />
          <div class="memos-setup__actions">
            <InkButton
              :text="reveal ? tr('Hide PAT', '隐藏 PAT') : tr('Show PAT', '显示 PAT')"
              :aria-pressed="reveal"
              @click="reveal = !reveal"
            />
            <InkButton :text="tr('Copy PAT', '复制 PAT')" @click="copy(savedToken!, 'pat')" />
          </div>
          <p>
            {{
              tr(
                'Paste both values into your app. Keep the PAT private.',
                '将两项信息填入 App，并妥善保管 PAT。'
              )
            }}
          </p>
        </template>
      </InkForm>
    </template>
    <p v-if="notice" role="status">{{ notice }}</p>
    <a v-if="helpUrl" :href="helpUrl" target="_blank" rel="noopener noreferrer">{{
      tr('Memos connection help', 'Memos 连接帮助')
    }}</a>
    <p v-else-if="helpStatus === 'missing'">
      {{ tr('No connection guide for this version.', '此版本尚无连接指南。') }}
    </p>
    <p v-else-if="helpStatus === 'unavailable'">
      {{ tr('Connection help is temporarily unavailable.', '连接帮助暂时不可用。') }}
    </p>
    <div class="memos-setup__actions">
      <InkButton :text="tr('Refresh status', '刷新状态')" :is-loading="busy" @click="refresh" />
      <InkButton :text="tr('Close', '关闭')" :disabled="busy" @click="emit('close')" />
    </div>
  </section>
</template>

<style scoped>
.memos-setup {
  display: grid;
  gap: var(--sys-space-md, 1rem);
  min-width: 0;
}
.memos-setup p {
  margin: 0;
}
.memos-setup h3 {
  margin: 0;
  font-size: var(--sys-font-title-sm-font-size);
}
.memos-setup__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sys-space-sm, 0.5rem);
}
.memos-setup__error {
  color: var(--sys-color-feedback-error);
}
</style>
