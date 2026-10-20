<script setup lang="ts">
import { ref, computed, nextTick, shallowRef, watch, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  InkButton,
  InkDialog,
  InkDropdown,
  InkLoading,
  type JsonEditorValidation,
} from '@inkcre/ui-web'
import { toast } from '@/components/toast/toast'
import { getExtensionHost, getExtensionRegistry, getExtensionSetupContribution } from '@/core'
import { configStore, ExtensionRegistryOriginResolver, type Peer } from '@inkcre/core'
import {
  getExtensionDocumentation,
  sortPublishedReleases,
  type ExtensionDocumentationLink,
} from '@inkcre/extension-runtime-client-web'
import { extensionCardProps, extensionCardEmits } from './extensionCard'
import { extensionPeerControlMode, setExtensionPeerEnabled } from '@/extension-peer-control'
import SchemaConfigEditor from '@/components/schemaConfigEditor/schemaConfigEditor.vue'

const props = defineProps(extensionCardProps)
const emit = defineEmits(extensionCardEmits)
const { t } = useI18n()

// --- data ---
const configPopupOpen = ref(false)
const configSaving = ref(false)
const configValidation = ref<JsonEditorValidation>()
const versionPopupOpen = ref<boolean | Promise<boolean>>(false)
const managementOpen = ref(false)
function openManagement(): void {
  operationError.value = null
  managementOpen.value = true
}
const setupPopupOpen = ref(false)
const setupComponent = shallowRef<Component | null>(null)
const setupContribution = shallowRef(getExtensionSetupContribution(props.extension.name))
const peerDialogOpen = ref(false)
const peerAction = ref<'enable' | 'disable'>('enable')
const selectedPeerIds = ref<string[]>([])
const peerActionErrors = ref<string[]>([])
const updatingPeers = ref(false)
const isUninstalling = ref(false)
const operationError = ref<string | null>(null)
const configModel = ref(JSON.stringify(props.extension.config, null, 2))
const versionModel = ref(props.extension.version)
const versionOptions = ref<{ label: string; value: string; description?: string }[]>([])
const versionLoading = ref(false)
const versionError = ref<string | null>(null)
const documentation = shallowRef<ExtensionDocumentationLink[]>([])
const documentationRetry = ref(0)
const documentationStatus = ref<'loading' | 'available' | 'missing' | 'unavailable'>('loading')
const canSaveConfig = computed(
  () =>
    configValidation.value?.status === 'valid' && configValidation.value.text === configModel.value
)

// --- computed ---
watch(
  () => [props.extension.name, props.extension.version, documentationRetry.value] as const,
  async ([name, version], _previous, onCleanup) => {
    let current = true
    onCleanup(() => {
      current = false
    })
    documentation.value = []
    documentationStatus.value = 'loading'
    try {
      const origin = await new ExtensionRegistryOriginResolver(
        () => configStore.peerConfig.extension_registry_url
      ).resolve()
      const links = await getExtensionDocumentation(origin, name, version)
      if (!current) return
      documentation.value = links ?? []
      documentationStatus.value = links?.length ? 'available' : 'missing'
    } catch {
      if (current) documentationStatus.value = 'unavailable'
    }
  },
  { immediate: true }
)

watch(
  () => props.extension.config,
  (config) => {
    if (!configPopupOpen.value) configModel.value = JSON.stringify(config, null, 2)
  },
  { deep: true }
)

const canUninstall = computed(() => props.extension.enabled.length === 0 && !isUninstalling.value)
const eligiblePeers = computed(() =>
  props.peers.filter((peer) => {
    const alreadyEnabled = props.extension.enabled.includes(peer.id)
    return peerAction.value === 'disable' ? alreadyEnabled : !alreadyEnabled
  })
)
const hasDeferredSelection = computed(() =>
  eligiblePeers.value.some(
    (peer) =>
      selectedPeerIds.value.includes(peer.id) &&
      extensionPeerControlMode(peer, props.currentPeerId, props.livePeerIds) === 'desired-state'
  )
)
const peerLabel = (peer: Peer) =>
  `${peer.name} · ${peer.application_version ? `v${peer.application_version}` : t('peer.versionUnknown')}`
const closeSetup = async () => {
  setupPopupOpen.value = false
  setupComponent.value = null
  await nextTick()
}

const openPeerDialog = (action: 'enable' | 'disable') => {
  peerAction.value = action
  selectedPeerIds.value = []
  peerActionErrors.value = []
  operationError.value = null
  peerDialogOpen.value = true
}

const applyPeerAction = async () => {
  if (updatingPeers.value || selectedPeerIds.value.length === 0) return
  const selectedPeers = eligiblePeers.value.filter((peer) =>
    selectedPeerIds.value.includes(peer.id)
  )
  if (selectedPeers.length === 0) return
  const enabled = peerAction.value === 'enable'
  updatingPeers.value = true
  peerActionErrors.value = []
  try {
    if (!enabled && selectedPeerIds.value.includes(props.currentPeerId)) await closeSetup()
    for (const peer of selectedPeers) {
      try {
        const updated = await setExtensionPeerEnabled({
          name: props.extension.name,
          peer,
          currentPeerId: props.currentPeerId,
          livePeerIds: props.livePeerIds,
          enabled,
          manager: getExtensionHost(),
        })
        emit('updated', updated)
      } catch (error) {
        peerActionErrors.value.push(
          `${peerLabel(peer)}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
    if (peerActionErrors.value.length) {
      try {
        const latest = await getExtensionHost().get(props.extension.name)
        if (latest) emit('updated', latest)
      } catch (error) {
        peerActionErrors.value.push(error instanceof Error ? error.message : String(error))
      }
      selectedPeerIds.value = []
    } else {
      peerDialogOpen.value = false
    }
  } finally {
    setupContribution.value = getExtensionSetupContribution(props.extension.name)
    updatingPeers.value = false
  }
}

const onEditConfigClick = () => {
  configModel.value = JSON.stringify(props.extension.config, null, 2)
  configValidation.value = undefined
  operationError.value = null
  configPopupOpen.value = true
}

const onSetupClick = () => {
  const contribution = setupContribution.value
  if (!contribution) return
  setupComponent.value = contribution.component
  setupPopupOpen.value = true
}

const onChangeVersionClick = async () => {
  managementOpen.value = false
  versionModel.value = props.extension.version
  versionOptions.value = []
  versionError.value = null
  versionPopupOpen.value = true
  versionLoading.value = true
  try {
    const record = await getExtensionRegistry().getExtension(props.extension.name)
    versionOptions.value = sortPublishedReleases(record.releases ?? []).map((release) => ({
      label: release.version,
      value: release.version,
      description: [
        release.python ? t('extension.hostCore') : null,
        release.module_federation ? t('extension.hostWeb') : null,
      ]
        .filter(Boolean)
        .join(' · '),
    }))
  } catch (error) {
    versionError.value = error instanceof Error ? error.message : String(error)
  } finally {
    versionLoading.value = false
  }
}

const onConfirmVersion = () => {
  if (versionLoading.value || versionError.value || !versionModel.value) return
  versionPopupOpen.value = (async () => {
    try {
      operationError.value = null
      const updatedExtension = await getExtensionHost().changeVersion(
        props.extension.name,
        versionModel.value
      )
      emit('updated', updatedExtension)
      return false
    } catch (error) {
      operationError.value = error instanceof Error ? error.message : String(error)
      return true
    }
  })()
}

const onConfirmConfig = async () => {
  if (configSaving.value || !canSaveConfig.value) return
  configSaving.value = true
  operationError.value = null
  try {
    const config: unknown = JSON.parse(configModel.value)
    if (!config || typeof config !== 'object' || Array.isArray(config))
      throw new Error(t('common.invalidConfig'))
    const updatedExtension = await getExtensionHost().updateConfig(
      props.extension.name,
      config as Record<string, unknown>
    )
    emit('updated', updatedExtension)
    configPopupOpen.value = false
  } catch (error) {
    operationError.value = error instanceof Error ? error.message : t('common.saveFailed')
  } finally {
    configSaving.value = false
  }
}

const onUninstall = async () => {
  operationError.value = null
  isUninstalling.value = true
  try {
    await getExtensionHost().uninstall(props.extension.name)
    managementOpen.value = false
    emit('uninstalled')
    toast.success(t('extension.uninstallSuccess'))
  } catch (error) {
    operationError.value = error instanceof Error ? error.message : String(error)
  } finally {
    isUninstalling.value = false
  }
}
</script>

<template>
  <article class="entity-card extension-card">
    <header class="entity-card__header">
      <div class="entity-card__title-group">
        <h3 class="entity-card__title extension-card__title">
          {{ extension.nickname ?? extension.name }}
        </h3>
      </div>
    </header>
    <div class="entity-card__meta">
      <code>{{ extension.name }}</code>
      <span>v{{ extension.version }}</span>
      <span>{{ t('extension.enabledPeerCount', { count: extension.enabled.length }) }}</span>
    </div>

    <div class="entity-card__actions extension-card__actions--primary">
      <InkButton
        :text="t('extension.enableOnPeers')"
        size="sm"
        :disabled="
          peerSelectionDisabled || !peers.some((peer) => !extension.enabled.includes(peer.id))
        "
        @click="openPeerDialog('enable')"
      />
      <InkButton
        :text="t('extension.disableOnPeers')"
        size="sm"
        :disabled="
          peerSelectionDisabled || !peers.some((peer) => extension.enabled.includes(peer.id))
        "
        @click="openPeerDialog('disable')"
      />
    </div>
    <div class="entity-card__actions extension-card__actions--secondary">
      <InkButton
        v-if="setupContribution"
        :text="t('extension.setup')"
        size="sm"
        theme="subtle"
        @click="onSetupClick"
      />
      <InkButton
        @click="onEditConfigClick"
        :text="t('extension.editConfig')"
        size="sm"
        theme="subtle"
      />
      <InkButton
        :text="t('extension.versionAndRemoval')"
        size="sm"
        theme="subtle"
        @click="openManagement"
      />
    </div>
    <InkDialog
      v-model="managementOpen"
      :title="t('extension.versionAndRemoval')"
      :subtitle="`${extension.nickname ?? extension.name} · v${extension.version}`"
      :show-confirm="false"
      :cancel-text="t('common.close')"
      :is-loading="isUninstalling"
    >
      <div class="extension-card__actions">
        <InkButton
          @click="onChangeVersionClick"
          :text="t('extension.changeVersion')"
          size="sm"
          :disabled="extension.enabled.length > 0"
        />
        <InkButton
          @click="onUninstall"
          :text="t('extension.uninstall')"
          theme="danger"
          size="sm"
          :disabled="!canUninstall"
          :is-loading="isUninstalling"
        />
      </div>

      <p v-if="extension.enabled.length > 0" class="extension-card__hint">
        {{ t('extension.uninstallDisabled') }}
      </p>
      <p v-else class="extension-card__hint">{{ t('extension.uninstallConfirm') }}</p>
      <p v-if="operationError" role="alert" class="extension-card__error">{{ operationError }}</p>
    </InkDialog>
    <div class="extension-card__documentation">
      <InkLoading
        v-if="documentationStatus === 'loading'"
        variant="spinner"
        size="xs"
        :label="t('common.loading')"
      />
      <nav
        v-else-if="documentation.length"
        class="extension-card__actions"
        :aria-label="t('extension.documentation')"
      >
        <a
          v-for="link in documentation"
          :key="link.scope"
          :href="link.entry_url"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ t(`extension.documentationScope.${link.scope}`) }}
          <span aria-hidden="true"> ↗</span>
        </a>
      </nav>
      <p v-else-if="documentationStatus === 'unavailable'" class="extension-card__hint">
        {{ t('extension.documentationUnavailable') }}
      </p>
      <p v-else-if="documentationStatus === 'missing'" class="extension-card__hint">
        {{ t('extension.documentationMissing') }}
      </p>
      <InkButton
        v-if="documentationStatus === 'unavailable'"
        :text="t('common.retry')"
        size="sm"
        @click="documentationRetry++"
      />
    </div>

    <InkDialog
      v-model="peerDialogOpen"
      :title="
        t(peerAction === 'enable' ? 'extension.enablePeerTitle' : 'extension.disablePeerTitle', {
          name: extension.nickname ?? extension.name,
        })
      "
      :show-cancel="false"
      :show-confirm="false"
      :is-loading="updatingPeers"
    >
      <div class="extension-card__peer-options">
        <label v-for="peer in eligiblePeers" :key="peer.id" class="extension-card__peer-option">
          <input
            v-model="selectedPeerIds"
            type="checkbox"
            :value="peer.id"
            :disabled="updatingPeers"
          />
          <span>
            <span>{{ peerLabel(peer) }}</span>
            <span v-if="peer.id === currentPeerId" class="extension-card__peer-note">
              {{ t('extension.currentBrowser') }}
            </span>
            <span
              v-else-if="
                extensionPeerControlMode(peer, currentPeerId, livePeerIds) === 'desired-state'
              "
              class="extension-card__peer-note"
            >
              {{ t('extension.desiredStateBrief') }}
            </span>
          </span>
        </label>
      </div>
      <p v-if="hasDeferredSelection" class="extension-card__hint">
        {{ t('extension.desiredStateExplanation') }}
      </p>
      <p v-for="error in peerActionErrors" :key="error" role="alert" class="extension-card__error">
        {{ error }}
      </p>
      <template #footer>
        <InkButton
          :text="t('common.cancel')"
          :disabled="updatingPeers"
          @click="peerDialogOpen = false"
        />
        <InkButton
          :text="
            t(peerAction === 'enable' ? 'extension.enableSelected' : 'extension.disableSelected')
          "
          theme="primary"
          :disabled="selectedPeerIds.length === 0"
          :is-loading="updatingPeers"
          @click="applyPeerAction"
        />
      </template>
    </InkDialog>

    <InkDialog
      v-model="setupPopupOpen"
      :title="t('extension.setupTitle', { name: extension.nickname ?? extension.name })"
      :show-cancel="false"
      :show-confirm="false"
      :close-on-scrim="false"
      @update:model-value="(open) => !open && closeSetup()"
    >
      <component :is="setupComponent" v-if="setupComponent" @close="closeSetup" />
    </InkDialog>

    <InkDialog
      v-model="configPopupOpen"
      :title="t('extension.editConfigTitle')"
      :is-loading="configSaving"
      style="width: min(48rem, calc(100vw - 2 * var(--sys-space-md)))"
    >
      <SchemaConfigEditor
        v-model="configModel"
        :schema="extension.config_schema ?? undefined"
        :label="t('extension.editConfigTitle')"
        :disabled="configSaving"
        @validation="configValidation = $event"
      />
      <p v-if="operationError" role="alert" class="extension-card__error">{{ operationError }}</p>
      <template #footer>
        <InkButton :text="t('common.cancel')" @click="configPopupOpen = false" />
        <InkButton
          :text="t('common.save')"
          theme="primary"
          :disabled="!canSaveConfig"
          :is-loading="configSaving"
          @click="onConfirmConfig"
        />
      </template>
    </InkDialog>

    <InkDialog
      v-model="versionPopupOpen"
      :title="t('extension.changeVersionTitle')"
      :show-confirm="!versionLoading && !versionError && versionOptions.length > 0"
      @confirm="onConfirmVersion"
    >
      <div v-if="versionLoading" class="extension-card__loading">
        <InkLoading variant="spinner" size="xs" :label="t('extension.versionsLoading')" />
      </div>
      <InkDropdown
        v-else
        v-model="versionModel"
        :label="t('extension.version')"
        :options="versionOptions"
        :error="versionError ?? ''"
        :disabled="!!versionError"
        required
      />
      <InkButton
        v-if="versionError"
        :text="t('common.retry')"
        size="sm"
        @click="onChangeVersionClick"
      />
      <p v-if="operationError" role="alert" class="extension-card__error">{{ operationError }}</p>
    </InkDialog>
  </article>
</template>

<style lang="scss" scoped src="./extensionCard.scss" />
