<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
  type Component,
} from 'vue'
import { useI18n } from 'vue-i18n'
import {
  InkButton,
  InkDialog,
  InkDropdown,
  InkLoading,
  type JsonEditorValidation,
} from '@inkcre/ui-web'
import {
  configStore,
  ExtensionRegistryOriginResolver,
  ExtensionModel,
  ExtensionParticipationModel,
  PeerOutcomeUnknown,
  type ExtensionRuntimeStatus,
  type NativeDistribution,
  type MetaConfig,
  type Peer,
} from '@inkcre/core'
import {
  manageExtensionOnPeer,
  sortPublishedReleases,
  preferredPublishedRelease,
  RegistryReleaseError,
  getExtensionDocumentation,
  type ExtensionDocumentationLink,
} from '@inkcre/extension-runtime-client-web'
import {
  extensionHostRestoreState,
  extensionHostConnectionReady,
  getExtensionHost,
  getExtensionRegistry,
  getExtensionSetupContribution,
  startExtensionHost,
  webPeerConnectionState,
} from '@/core'
import { extensionCardProps, extensionCardEmits } from './extensionCard'
import {
  extensionPeerControlMode,
  observeExtensionPeer,
  selectExtensionPeerVersion,
  setExtensionPeerEnabled,
} from '@/extension-peer-control'
import SchemaConfigEditor from '@/components/schemaConfigEditor/schemaConfigEditor.vue'

const props = defineProps(extensionCardProps)
const emit = defineEmits(extensionCardEmits)
const { t } = useI18n()
const statuses = ref<Record<string, ExtensionRuntimeStatus | null>>({})
const formats = ref<Record<string, NativeDistribution[]>>({})
const errors = ref<Record<string, string>>({})
const busyPeer = ref('')
const refreshing = ref(false)
const selectedPeer = shallowRef<Peer | null>(null)
const versionOpen = ref(false)
const versionLoading = ref(false)
const versionModel = ref('')
const distributionModel = ref<NativeDistribution>('module_federation')
const versionOptions = ref<{ label: string; value: string }[]>([])
const versionError = ref('')
const publishedFormats = ref<Partial<Record<NativeDistribution, boolean>>>({})
const knownPublishedFormats = computed(() =>
  (['python', 'module_federation'] as const).filter((format) => publishedFormats.value[format])
)
let versionRequest = 0
let documentationRequest = 0
let active = true
onUnmounted(() => {
  active = false
  versionRequest += 1
  documentationRequest += 1
})
function ownsConnection(meta: MetaConfig): boolean {
  const current = configStore.metaConfig
  return (
    active &&
    meta.INKCRE_PGREST_URL === current.INKCRE_PGREST_URL &&
    meta.INKCRE_PEER_ID === current.INKCRE_PEER_ID &&
    meta.INKCRE_JWT_SECRET === current.INKCRE_JWT_SECRET
  )
}
const documentation = ref<ExtensionDocumentationLink[]>([])
const docsOpen = ref(false)
const docsLoading = ref(false)
const docsError = ref('')
const docsPeerName = ref('')
const configOpen = ref(false)
const configSaving = ref(false)
const configModel = ref('')
const schemaPeerId = ref('')
const configValidation = ref<JsonEditorValidation>()
const configError = ref('')
const setupOpen = ref(false)
const setupComponent = shallowRef<Component | null>(null)
const setupContribution = shallowRef(getExtensionSetupContribution(props.extension.name))
const rows = computed(() =>
  props.peers.map((peer) => ({
    peer,
    pin: props.participations.find((row) => row.peer_id === peer.id),
    status: statuses.value[peer.id],
  }))
)
const schemaOptions = computed(() =>
  props.participations
    .filter((row) => row.config_schema && row.distribution)
    .map((row) => ({
      label: `${props.peers.find((peer) => peer.id === row.peer_id)?.name ?? row.peer_id} · ${distributionLabel(row.distribution)} ${row.version}`,
      value: row.peer_id,
    }))
)
const configSchema = computed(
  () =>
    props.participations.find((row) => row.peer_id === schemaPeerId.value)?.config_schema ??
    undefined
)
const canSaveConfig = computed(
  () =>
    configValidation.value?.status === 'valid' && configValidation.value.text === configModel.value
)
const distributionOptions = computed(() =>
  selectedPeer.value
    ? supportedFormats(selectedPeer.value).map((format) => ({
        label: format === 'python' ? 'Python' : 'Module Federation',
        value: format,
      }))
    : []
)

function distributionLabel(distribution: NativeDistribution | null): string {
  return distribution === 'python'
    ? 'Python'
    : distribution === 'module_federation'
      ? 'Module Federation'
      : distribution === 'swift_bundled'
        ? 'Swift (bundled)'
        : t('extension.distributionUnknown')
}

function supportedFormats(peer: Peer): NativeDistribution[] {
  if (peer.id === props.currentPeerId) return ['module_federation']
  const observed = formats.value[peer.id]
  if (observed?.length) return observed
  const previous = props.participations.find((row) => row.peer_id === peer.id)
  return previous?.distribution ? [previous.distribution] : []
}
function statusText(peerId: string): string {
  const pin = props.participations.find((row) => row.peer_id === peerId)
  const status = statuses.value[peerId]
  if (status?.restart_required)
    return [
      status.loaded_version
        ? t('extension.runningVersion', { version: status.loaded_version })
        : null,
      t('extension.restartRequired'),
    ]
      .filter(Boolean)
      .join(' · ')
  if (status?.running && status.loaded_version)
    return t('extension.runningVersion', { version: status.loaded_version })
  if (pin?.distribution === null) return t('extension.needsVersionSelection')
  if (!status) return t('extension.runtimeUnknown')
  if (status?.error) return t('extension.startFailed')
  return t('extension.notRunning')
}
function noPublishedDistributionForPeer(peer: Peer): boolean {
  const supported = supportedFormats(peer)
  return (
    supported.length > 0 && supported.every((format) => publishedFormats.value[format] === false)
  )
}
async function refreshCard(): Promise<void> {
  // Catalog facts are populated only by an explicit version choice, never by initial card mounting.
  publishedFormats.value = {}
  await refreshRuntime()
}
let runtimeRequest = 0
async function refreshRuntime(): Promise<void> {
  const request = ++runtimeRequest
  refreshing.value = true
  const meta = { ...configStore.metaConfig }
  const host = getExtensionHost()
  const ownsRefresh = () =>
    request === runtimeRequest && ownsConnection(meta) && getExtensionHost() === host
  try {
    if (extensionHostConnectionReady.value && extensionHostRestoreState.value !== 'failed') {
      // Restore attempts every enabled module; a failure still leaves per-module status to inspect.
      await startExtensionHost().catch(() => {})
    }
    if (!ownsRefresh()) return
    await Promise.all(
      props.peers.map(async (peer) => {
        try {
          const result = await observeExtensionPeer({
            name: props.extension.name,
            peer,
            currentPeerId: props.currentPeerId,
            livePeerIds: props.livePeerIds,
            manager: host,
          })
          if (!ownsRefresh()) return
          formats.value[peer.id] = result.supported_distributions
          statuses.value[peer.id] = result.status
          delete errors.value[peer.id]
        } catch (error) {
          if (!ownsRefresh()) return
          statuses.value[peer.id] = null
          errors.value[peer.id] = error instanceof Error ? error.message : String(error)
        }
      })
    )
    if (ownsRefresh()) setupContribution.value = getExtensionSetupContribution(props.extension.name)
  } finally {
    if (request === runtimeRequest) refreshing.value = false
  }
}
function currentHostRestoring(peer: Peer): boolean {
  return peer.id === props.currentPeerId && extensionHostRestoreState.value === 'restoring'
}
async function perform(peer: Peer, operation: () => Promise<unknown>): Promise<Error | null> {
  if (busyPeer.value) return null
  busyPeer.value = peer.id
  // A pre-command sample must not replace the status observed after its completion.
  runtimeRequest += 1
  delete errors.value[peer.id]
  let operationError: Error | null = null
  const meta = { ...configStore.metaConfig }
  const host = getExtensionHost()
  const ownsOperation = () => ownsConnection(meta) && getExtensionHost() === host
  try {
    if (currentHostRestoring(peer)) await startExtensionHost().catch(() => {})
    if (!ownsOperation()) return null
    await operation()
  } catch (error) {
    operationError = error instanceof Error ? error : new Error(String(error))
  } finally {
    // A failed command may still have persisted its desired intent.
    if (ownsOperation()) emit('participationChanged')
    try {
      if (ownsOperation()) await refreshRuntime()
    } finally {
      if (operationError && ownsOperation()) errors.value[peer.id] = operationError.message
      busyPeer.value = ''
    }
  }
  return operationError
}

async function togglePeer(peer: Peer, enabled: boolean): Promise<void> {
  if (!enabled && peer.id === props.currentPeerId) await closeSetup()
  await perform(peer, () =>
    setExtensionPeerEnabled({
      name: props.extension.name,
      peer,
      currentPeerId: props.currentPeerId,
      livePeerIds: props.livePeerIds,
      enabled,
      manager: getExtensionHost(),
    })
  )
}
async function removePeer(peer: Peer): Promise<void> {
  await perform(peer, async () => {
    if (peer.id === props.currentPeerId)
      return getExtensionHost().uninstall(props.extension.name, peer.id)
    if (extensionPeerControlMode(peer, props.currentPeerId, props.livePeerIds) === 'remote-host') {
      await manageExtensionOnPeer(peer.id, { action: 'unselect', extension: props.extension.name })
      return
    }
    const pin = await ExtensionParticipationModel.get(peer.id, props.extension.name)
    if (pin) await pin.remove()
  })
}
async function openVersion(peer: Peer): Promise<void> {
  selectedPeer.value = peer
  versionError.value = ''
  versionModel.value = ''
  distributionModel.value =
    props.participations.find((row) => row.peer_id === peer.id)?.distribution ??
    supportedFormats(peer)[0] ??
    'module_federation'
  versionOpen.value = true
  await loadVersions()
}
async function loadVersions(): Promise<void> {
  const request = ++versionRequest
  const distribution = distributionModel.value
  const peerId = selectedPeer.value?.id
  versionLoading.value = true
  versionOptions.value = []
  versionError.value = ''
  if (distribution === 'swift_bundled') {
    versionError.value = t('extension.bundledManagedByApp')
    versionLoading.value = false
    return
  }
  const readPublished = async (format: 'python' | 'module_federation') => {
    try {
      const catalog = await getExtensionRegistry().getExtension(props.extension.name, format)
      const releases = sortPublishedReleases(catalog.releases ?? [])
      if (request === versionRequest) publishedFormats.value[format] = releases.length > 0
      return releases
    } catch (error) {
      if (error instanceof RegistryReleaseError && error.status === 404) {
        if (request === versionRequest) publishedFormats.value[format] = false
        return []
      }
      if (request === versionRequest) delete publishedFormats.value[format]
      throw error
    }
  }
  try {
    const releases = await readPublished(distribution)
    if (request !== versionRequest) return
    versionOptions.value = releases.map((release) => ({
      label: release.version,
      value: release.version,
    }))
    const previous = props.participations.find(
      (row) => row.peer_id === peerId && row.distribution === distribution
    )
    versionModel.value = versionOptions.value.some((option) => option.value === previous?.version)
      ? previous!.version
      : (preferredPublishedRelease(releases)?.version ?? '')
    if (!releases.length) {
      // On explicit install, show another published native format without implying this Peer supports it.
      const other = distribution === 'python' ? 'module_federation' : 'python'
      if (publishedFormats.value[other] === undefined) await readPublished(other)
    }
  } catch (error) {
    if (request === versionRequest)
      versionError.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (request === versionRequest) versionLoading.value = false
  }
}

async function saveVersion(): Promise<void> {
  const peer = selectedPeer.value
  if (!peer || !versionModel.value || versionLoading.value || busyPeer.value) return
  const distribution = distributionModel.value
  const version = versionModel.value
  const name = props.extension.name
  const meta = { ...configStore.metaConfig }
  const host = getExtensionHost()
  const pickerRequest = versionRequest
  const ownsSelection = () =>
    ownsConnection(meta) &&
    getExtensionHost() === host &&
    versionOpen.value &&
    versionRequest === pickerRequest &&
    selectedPeer.value?.id === peer.id &&
    distributionModel.value === distribution &&
    versionModel.value === version
  const commandError = await perform(peer, () =>
    selectExtensionPeerVersion({
      name: props.extension.name,
      nickname: props.extension.nickname ?? props.extension.name,
      releases: getExtensionRegistry(),
      version,
      distribution,
      peer,
      currentPeerId: props.currentPeerId,
      livePeerIds: props.livePeerIds,
      manager: getExtensionHost(),
    })
  )
  if (!ownsSelection()) return
  if (!commandError) {
    versionOpen.value = false
  } else if (commandError instanceof PeerOutcomeUnknown) {
    // This independent read can verify selection through a target Peer restart; never resend select.
    try {
      const observed = await ExtensionParticipationModel.readForConnection(meta, peer.id, name)
      if (
        ownsSelection() &&
        observed?.distribution === distribution &&
        observed.version === version
      ) {
        versionOpen.value = false
      }
    } catch {
      // Keep the original unknown outcome until the exact selection can be observed.
    }
  }
}
async function openDocumentation(peer: Peer): Promise<void> {
  const pin = props.participations.find((row) => row.peer_id === peer.id)
  if (!pin?.distribution) return
  const request = ++documentationRequest
  docsPeerName.value = `${peer.name} · ${distributionLabel(pin.distribution)} ${pin.version}`
  docsOpen.value = true
  docsLoading.value = true
  documentation.value = []
  docsError.value = ''
  if (pin.distribution === 'swift_bundled') {
    docsError.value = t('extension.bundledManagedByApp')
    docsLoading.value = false
    return
  }
  try {
    const origin = await new ExtensionRegistryOriginResolver(
      () => configStore.peerConfig.extension_registry_url
    ).resolve()
    const links =
      (await getExtensionDocumentation(
        origin,
        props.extension.name,
        pin.version,
        pin.distribution
      )) ?? []
    if (request === documentationRequest) documentation.value = links
  } catch (error) {
    if (request === documentationRequest)
      docsError.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (request === documentationRequest) docsLoading.value = false
  }
}
function openConfig(): void {
  configModel.value = JSON.stringify(props.extension.config, null, 2)
  schemaPeerId.value = schemaOptions.value.some((option) => option.value === props.currentPeerId)
    ? props.currentPeerId
    : ''
  configValidation.value = undefined
  configError.value = ''
  configOpen.value = true
}
async function saveConfig(): Promise<void> {
  if (configSaving.value || !canSaveConfig.value) return
  configSaving.value = true
  try {
    const config: unknown = JSON.parse(configModel.value)
    if (!config || typeof config !== 'object' || Array.isArray(config))
      throw new Error(t('common.invalidConfig'))
    const shared = await ExtensionModel.get(props.extension.name)
    if (!shared) throw new Error('Extension no longer exists.')
    emit('updated', await shared.updateConfig(config as Record<string, unknown>))
    configOpen.value = false
  } catch (error) {
    configError.value = error instanceof Error ? error.message : String(error)
  } finally {
    configSaving.value = false
  }
}
function openSetup(): void {
  setupComponent.value = setupContribution.value?.component ?? null
  setupOpen.value = !!setupComponent.value
}
async function closeSetup(): Promise<void> {
  setupOpen.value = false
  setupComponent.value = null
  await nextTick()
}
watch(() => props.livePeerIds, refreshRuntime)
watch(extensionHostRestoreState, (state) => {
  if (state === 'restored' || state === 'failed') void refreshRuntime()
})
onMounted(refreshRuntime)
</script>

<template>
  <article class="extension-card" :aria-label="extension.nickname ?? extension.name">
    <header class="extension-card__header">
      <div>
        <span class="extension-card__id">{{ extension.nickname ?? extension.name }}</span>
        <p class="extension-card__hint">{{ extension.name }}</p>
      </div>
      <div class="extension-card__actions">
        <InkButton
          v-if="setupContribution"
          :text="t('extension.setup')"
          size="sm"
          theme="primary"
          @click="openSetup"
        />
        <InkButton :text="t('extension.editConfig')" size="sm" @click="openConfig" />
        <InkButton
          :text="t('common.refresh')"
          size="sm"
          :is-loading="refreshing"
          @click="refreshCard"
        />
      </div>
    </header>
    <h3 class="extension-card__hint">{{ t('extension.usedOnPeers') }}</h3>
    <section
      v-for="{ peer, pin, status } in rows"
      :key="peer.id"
      class="extension-card__peer-row"
      :aria-label="peer.name"
    >
      <div>
        <strong>{{ peer.name }}</strong
        ><span v-if="peer.id === currentPeerId"> · {{ t('extension.currentBrowser') }}</span>
        <p class="extension-card__hint">
          {{
            pin
              ? `${distributionLabel(pin.distribution)} · ${pin.version}`
              : t('extension.notInstalled')
          }}
        </p>
        <p v-if="pin" class="extension-card__hint">{{ statusText(peer.id) }}</p>
        <p v-else-if="noPublishedDistributionForPeer(peer)" class="extension-card__hint">
          {{ t('extension.unavailableOnPeer') }}
        </p>
        <p v-if="errors[peer.id] || status?.error" role="alert" class="extension-card__error">
          {{ errors[peer.id] || status?.error }}
        </p>
      </div>
      <div class="extension-card__actions">
        <InkButton
          v-if="supportedFormats(peer).length"
          :text="
            t(
              pin
                ? 'extension.changeVersion'
                : noPublishedDistributionForPeer(peer)
                  ? 'extension.unavailableOnPeer'
                  : 'extension.install'
            )
          "
          size="sm"
          :disabled="
            !!busyPeer ||
            peerSelectionDisabled ||
            currentHostRestoring(peer) ||
            (!pin && noPublishedDistributionForPeer(peer))
          "
          @click="openVersion(peer)"
        />
        <InkButton
          v-if="pin?.distribution"
          :text="
            t(
              pin.enabled || status?.running
                ? 'extension.disableSelected'
                : 'extension.enableSelected'
            )
          "
          size="sm"
          :is-loading="busyPeer === peer.id || (currentHostRestoring(peer) && pin.enabled)"
          :disabled="!!busyPeer || peerSelectionDisabled || currentHostRestoring(peer)"
          @click="togglePeer(peer, !(pin.enabled || status?.running))"
        />
        <InkButton
          v-if="pin?.distribution"
          :text="t('extension.documentation')"
          size="sm"
          theme="subtle"
          @click="openDocumentation(peer)"
        />
        <InkButton
          v-if="pin && !pin.enabled && !status?.running"
          :text="t('extension.removeFromPeer')"
          size="sm"
          theme="subtle"
          :disabled="!!busyPeer || currentHostRestoring(peer)"
          @click="removePeer(peer)"
        />
      </div>
    </section>
    <InkDialog
      v-model="docsOpen"
      :title="t('extension.documentation')"
      :subtitle="docsPeerName"
      :show-confirm="false"
      :cancel-text="t('common.close')"
    >
      <InkLoading v-if="docsLoading" size="xs" variant="spinner" :label="t('common.loading')" />
      <p v-else-if="docsError" role="alert" class="extension-card__error">{{ docsError }}</p>
      <nav v-else-if="documentation.length" class="extension-card__actions">
        <a
          v-for="link in documentation"
          :key="link.scope"
          :href="link.entry_url"
          target="_blank"
          rel="noopener noreferrer"
          >{{ t(`extension.documentationScope.${link.scope}`) }} ↗</a
        >
      </nav>
      <p v-else class="extension-card__hint">{{ t('extension.documentationMissing') }}</p>
    </InkDialog>
    <InkDialog
      v-model="versionOpen"
      :title="
        t(
          participations.some((row) => row.peer_id === selectedPeer?.id)
            ? 'extension.changeVersionTitle'
            : selectedPeer && noPublishedDistributionForPeer(selectedPeer)
              ? 'extension.unavailableOnPeer'
              : 'extension.install'
        )
      "
      :subtitle="selectedPeer?.name"
      :show-confirm="false"
      :show-cancel="false"
    >
      <InkDropdown
        v-if="distributionOptions.length > 1"
        v-model="distributionModel"
        :label="t('extension.distribution')"
        :options="distributionOptions"
        :disabled="versionLoading || !!busyPeer"
        @change="loadVersions"
      />
      <p v-else class="extension-card__hint">
        {{ t('extension.distribution') }}: {{ distributionLabel(distributionModel) }}
      </p>
      <InkLoading
        v-if="versionLoading"
        size="xs"
        variant="spinner"
        :label="t('extension.versionsLoading')"
      />
      <InkDropdown
        v-else-if="versionOptions.length"
        v-model="versionModel"
        :label="t('extension.version')"
        :options="versionOptions"
        :error="versionError"
        :disabled="!!busyPeer"
        required
      />
      <p
        v-if="!versionLoading && publishedFormats[distributionModel] === false"
        class="extension-card__hint"
      >
        {{
          t('extension.noPublishedDistribution', {
            distribution: distributionLabel(distributionModel),
          })
        }}
      </p>
      <p
        v-if="!versionLoading && !versionOptions.length && knownPublishedFormats.length"
        class="extension-card__hint"
      >
        {{ t('extension.publishedDistributions') }}:
        {{ knownPublishedFormats.map(distributionLabel).join(', ') }}
      </p>
      <p v-if="versionError" role="alert" class="extension-card__error">{{ versionError }}</p>
      <p v-if="selectedPeer && errors[selectedPeer.id]" role="alert" class="extension-card__error">
        {{ errors[selectedPeer.id] }}
      </p>
      <template #footer
        ><InkButton
          :text="t('common.cancel')"
          :disabled="!!busyPeer"
          @click="versionOpen = false" /><InkButton
          :text="t('common.save')"
          theme="primary"
          :is-loading="!!busyPeer"
          :disabled="!versionModel || versionLoading || !!versionError"
          @click="saveVersion"
      /></template>
    </InkDialog>
    <InkDialog
      v-model="configOpen"
      :title="t('extension.editConfigTitle')"
      :show-confirm="false"
      :show-cancel="false"
    >
      <InkDropdown
        v-if="schemaOptions.length"
        v-model="schemaPeerId"
        :label="t('extension.configSchemaSource')"
        :options="[{ label: t('extension.jsonConfig'), value: '' }, ...schemaOptions]"
      />
      <SchemaConfigEditor
        v-model="configModel"
        :schema="configSchema"
        :label="t('extension.editConfigTitle')"
        :disabled="configSaving"
        @validation="configValidation = $event"
      />
      <p v-if="configError" role="alert" class="extension-card__error">{{ configError }}</p>
      <template #footer
        ><InkButton
          :text="t('common.cancel')"
          :disabled="configSaving"
          @click="configOpen = false" /><InkButton
          :text="t('common.save')"
          theme="primary"
          :is-loading="configSaving"
          :disabled="!canSaveConfig"
          @click="saveConfig"
      /></template>
    </InkDialog>
    <InkDialog
      v-model="setupOpen"
      :title="t('extension.setupTitle', { name: extension.nickname ?? extension.name })"
      :show-confirm="false"
      :show-cancel="false"
      :close-on-scrim="false"
      @update:model-value="(open) => !open && closeSetup()"
      ><component :is="setupComponent" v-if="setupComponent" @close="closeSetup"
    /></InkDialog>
  </article>
</template>
<style lang="scss" scoped src="./extensionCard.scss" />
