<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { InkButton, InkDialog, InkInput, type JsonEditorValidation } from '@inkcre/ui-web'
import { toast } from '@/components/toast/toast'
import SchemaConfigEditor from '@/components/schemaConfigEditor/schemaConfigEditor.vue'
import { configStore, ExtensionModel, Peer, PeerConfigSchema, PeerManager } from '@inkcre/core'
import { peerCardEmits, peerCardProps } from './peerCard'
import { currentWebPeer } from '@/core'

const props = defineProps(peerCardProps)
const emit = defineEmits(peerCardEmits)
const { t } = useI18n()

const configPopupOpen = ref(false)
const configModel = ref('{}')
const configValidation = ref<JsonEditorValidation>()
const savingConfig = ref(false)
const configError = ref('')
const deleteOpen = ref(false)
const deleting = ref(false)
const deleteError = ref('')
const diagnostics = computed(() =>
  props.readiness && props.readiness.status !== 'unavailable' ? props.readiness.diagnostics : null
)
const databaseComponents = computed(() =>
  diagnostics.value
    ? Object.entries(diagnostics.value.database).filter(
        (entry): entry is [string, { status: string; problems?: string[] }] =>
          typeof entry[1] === 'object' &&
          ((entry[1].status !== 'ok' && entry[1].status !== 'not_required') ||
            !!entry[1].problems?.length)
      )
    : []
)
function openDelete() {
  deleteError.value = ''
  deleteOpen.value = true
}
const canSaveConfig = computed(
  () =>
    configValidation.value?.status === 'valid' && configValidation.value.text === configModel.value
)
function openConfig() {
  configModel.value = JSON.stringify(props.peer.config, null, 2)
  configValidation.value = undefined
  configError.value = ''
  configPopupOpen.value = true
}

const saveError = ref('')

const savePeer = async () => {
  saveError.value = ''
  try {
    await props.peer.save()
    if (props.current) currentWebPeer.value = { id: props.peer.id, name: props.peer.name }
    emit('updated')
    toast.success(t('peer.saveSuccess'))
  } catch (error) {
    console.error('Failed to update Peer:', error)
    saveError.value = error instanceof Error ? error.message : t('common.saveFailed')
    toast.error(t('common.saveFailed'))
  }
}

const onConfirmConfig = async () => {
  if (savingConfig.value || !canSaveConfig.value) return
  savingConfig.value = true
  configError.value = ''
  try {
    const updated = Peer.parse({ ...props.peer, config: JSON.parse(configModel.value) })
    await updated.saveConfig()
    props.peer.config = updated.config
    if (props.current) configStore.peerConfig = PeerConfigSchema.parse(updated.config)
    emit('updated')
    configPopupOpen.value = false
  } catch (error) {
    configError.value = error instanceof Error ? error.message : t('common.saveFailed')
  } finally {
    savingConfig.value = false
  }
}

const onConfirmDelete = async () => {
  if (deleting.value || props.current) return
  deleting.value = true
  deleteError.value = ''
  try {
    const live = await PeerManager.listLive()
    if (live.some((peer) => peer.id === props.peer.id)) {
      deleteError.value = t('peer.deleteOnline')
      emit('updated')
      return
    }
    const extensions = await ExtensionModel.list()
    for (const extension of extensions) {
      if (extension.enabled.includes(props.peer.id)) await extension.disablePeer(props.peer.id)
    }
    await props.peer.delete()
    deleteOpen.value = false
    emit('updated')
    toast.success(t('peer.deleteSuccess'))
  } catch (error) {
    deleteError.value = error instanceof Error ? error.message : t('peer.deleteFailed')
  } finally {
    deleting.value = false
  }
}

const getStatusText = (status: 'online' | 'offline' | 'unknown') => {
  const statusMap = {
    online: t('peer.statusOnline'),
    offline: t('peer.statusOffline'),
    unknown: t('peer.statusUnknown'),
  }
  return statusMap[status]
}
</script>

<template>
  <article class="entity-card peer-card">
    <header class="entity-card__header">
      <div class="entity-card__title-group">
        <h3 class="entity-card__title peer-card__title">
          <InkInput v-model="peer.name" type="inline" @confirm="savePeer" />
        </h3>
        <span :class="['entity-card__status', `peer-card__status--${status}`]">
          {{ getStatusText(status) }}
        </span>
        <span v-if="current" class="entity-card__status peer-card__status--current">{{
          t('peer.current')
        }}</span>
      </div>
      <div class="entity-card__actions peer-card__actions">
        <InkButton :text="t('peer.editConfig')" size="sm" @click="openConfig" />
        <InkButton
          v-if="!current"
          :text="t('peer.delete')"
          size="sm"
          theme="danger"
          :disabled="status === 'online'"
          @click="openDelete"
        />
      </div>
    </header>
    <div class="entity-card__meta">
      <span>{{ peer.application_version ? `v${peer.application_version}` : t('peer.versionUnknown') }}</span>
    </div>
    <p v-if="saveError" role="alert" class="peer-card__save-error text-feedback-error">
      {{ saveError }}
    </p>
    <div class="peer-card__item-info">
      <section v-if="diagnostics" class="peer-card__readiness" :aria-label="t('peer.readiness')">
        <p>
          <strong>{{ t(`peer.readinessStatus.${diagnostics.status}`) }}</strong> ·
          {{ t('peer.phase') }}: <code>{{ diagnostics.runtime.phase }}</code> ·
          {{ t('peer.reason') }}: <code>{{ diagnostics.runtime.reason }}</code>
        </p>
        <p v-if="diagnostics.runtime.step">
          {{ t('peer.step') }}: <code>{{ diagnostics.runtime.step }}</code>
        </p>
        <p>{{ t('peer.database') }}: {{ diagnostics.database.status }}</p>
        <ul v-if="databaseComponents.length">
          <li v-for="[name, component] in databaseComponents" :key="name">
            <span>{{ name }}: {{ component.status }}</span>
            <ul v-if="component.problems?.length">
              <li v-for="problem in component.problems" :key="problem">{{ problem }}</li>
            </ul>
          </li>
        </ul>
      </section>
      <p v-else-if="readiness?.status === 'unavailable'" class="peer-card__readiness">
        {{ t(`peer.readinessUnavailable.${readiness.reason}`) }}
      </p>
      <details class="peer-card__details">
        <summary>{{ t('common.details') }}</summary>
        <code class="peer-card__item-id">{{ peer.id }}</code>
        <p>{{ t('peer.capabilities', { count: peer.capabilities.length }) }}</p>
        <pre v-if="peer.capabilities.length">{{ JSON.stringify(peer.capabilities, null, 2) }}</pre>
        <p v-if="!current && status === 'online'">{{ t('peer.deleteOnline') }}</p>
      </details>
    </div>
    <InkDialog v-model="configPopupOpen" :title="t('peer.editConfig')" :is-loading="savingConfig">
      <SchemaConfigEditor
        v-model="configModel"
        :schema="peer.config_schema"
        :label="t('peer.editConfig')"
        :disabled="savingConfig"
        @validation="configValidation = $event"
      />
      <p v-if="configError" role="alert" class="text-feedback-error">{{ configError }}</p>
      <template #footer>
        <InkButton :text="t('common.cancel')" @click="configPopupOpen = false" />
        <InkButton
          :text="t('common.save')"
          theme="primary"
          :is-loading="savingConfig"
          :disabled="!canSaveConfig"
          @click="onConfirmConfig"
        />
      </template>
    </InkDialog>

    <InkDialog
      v-model="deleteOpen"
      :title="t('peer.delete')"
      :confirm-text="t('peer.delete')"
      :cancel-text="t('common.cancel')"
      :is-loading="deleting"
      @confirm="onConfirmDelete"
    >
      <p>{{ peer.name }} · {{ peer.id }}</p>
      <p>{{ t('peer.deleteConfirm') }}</p>
      <p v-if="deleteError" role="alert" class="text-feedback-error">{{ deleteError }}</p>
    </InkDialog>
  </article>
</template>

<style lang="scss" scoped src="./peerCard.scss" />
