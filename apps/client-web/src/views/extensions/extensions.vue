<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { InkButton, InkSkeleton, InkPlaceholder } from '@inkcre/ui-web'
import { toast } from '@/components/toast/toast'
import { usePageObjectTitle } from '@/composables/use-page-object-title'
import { configStore, Peer, PeerManager, type InstalledExtension } from '@inkcre/core'
import type { ReleaseRecord } from '@inkcre/extension-runtime-client-web'
import extensionCard from '@/components/extension/extensionCard/extensionCard.vue'
import {
  getExtensionHost,
  getExtensionRegistry,
  getExtensionRegistryOrigin,
  WEB_PEER_IDENTITY,
} from '@/core'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const currentPeerId = configStore.metaConfig.INKCRE_PEER_ID
const peers = ref<Peer[]>([])
const livePeerIds = ref<ReadonlySet<string>>(new Set())
const extensions = ref<InstalledExtension[]>([])
const peersLoading = ref(false)
const extensionsLoading = ref(false)
const extensionError = ref<string | null>(null)
const peerError = ref<string | null>(null)
const browseUrl = ref<string | null>(null)
const browseError = ref<string | null>(null)
const installRequested = computed(
  () => route.query.install !== undefined || route.query.version !== undefined
)
const installRelease = ref<ReleaseRecord | null>(null)
usePageObjectTitle(
  computed(() =>
    installRequested.value && installRelease.value
      ? `${installRelease.value.nickname || installRelease.value.name} v${installRelease.value.version}`
      : undefined
  )
)
const installLoading = ref(false)
const installError = ref<string | null>(null)
const installing = ref(false)
const installedMatch = computed(() =>
  extensions.value.find(({ name }) => name === installRelease.value?.name)
)
const connected = computed(
  () => !!configStore.metaConfig.INKCRE_PGREST_URL && !!configStore.metaConfig.INKCRE_JWT_SECRET
)
let releaseRequest = 0
const currentPeerFallback = Peer.parse({
  id: currentPeerId,
  name: t('extension.currentBrowser'),
  application_version: WEB_PEER_IDENTITY.applicationVersion,
  labels: [],
  config: {},
  config_schema: {},
  capabilities: [],
  lease_expires_at: new Date(Date.now() + 60_000),
  created_at: new Date(),
  updated_at: new Date(),
})
const availablePeers = computed(() =>
  peers.value.some((peer) => peer.id === currentPeerId)
    ? peers.value
    : [currentPeerFallback, ...peers.value]
)

async function refreshPeers(): Promise<void> {
  if (peersLoading.value) return
  peersLoading.value = true
  peerError.value = null
  try {
    const [allPeers, livePeers] = await Promise.all([Peer.list(), PeerManager.listLive()])
    peers.value = allPeers
    livePeerIds.value = new Set(livePeers.map((peer) => peer.id))
  } catch (error) {
    peerError.value = error instanceof Error ? error.message : String(error)
  } finally {
    peersLoading.value = false
  }
}

async function refreshExtensions(): Promise<void> {
  if (extensionsLoading.value) return
  extensionsLoading.value = true
  extensionError.value = null
  
  const maxRetries = 3
  let lastError: Error | null = null
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      extensions.value = await getExtensionHost().list()
      lastError = null
      break // Success
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      
      // If it's a prepared statement conflict, wait and retry
      if (lastError.message.includes('prepared statement') && attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)))
        continue
      }
      
      // For other errors, fail immediately
      break
    }
  }
  
  if (lastError) {
    extensionError.value = lastError.message
  }
  
  extensionsLoading.value = false
}

function refreshAll(): void {
  void refreshExtensions()
  void refreshPeers()
}

async function loadBrowseUrl(): Promise<void> {
  browseError.value = null
  try {
    const url = new URL(await getExtensionRegistryOrigin())
    url.searchParams.set('client_origin', window.location.origin)
    browseUrl.value = url.href
  } catch (error) {
    browseUrl.value = null
    browseError.value = error instanceof Error ? error.message : String(error)
  }
}

async function loadInstallRelease(): Promise<void> {
  const request = ++releaseRequest
  installRelease.value = null
  installError.value = null
  installLoading.value = false
  if (!installRequested.value) return
  const name = route.query.install
  const version = route.query.version
  if (typeof name !== 'string' || typeof version !== 'string') {
    installError.value = t('extension.invalidInstallLink')
    return
  }
  installLoading.value = true
  try {
    const release = await getExtensionRegistry().getRelease(name, version, true)
    if (request === releaseRequest) installRelease.value = release
  } catch (error) {
    if (request === releaseRequest) {
      installError.value = error instanceof Error ? error.message : String(error)
    }
  } finally {
    if (request === releaseRequest) installLoading.value = false
  }
}

async function installReleaseInDeployment(): Promise<void> {
  const release = installRelease.value
  if (!release || installing.value || installedMatch.value || !connected.value) return
  installing.value = true
  installError.value = null
  try {
    updateExtension(
      await getExtensionHost().install({ name: release.name, version: release.version })
    )
    toast.success(t('extension.installSuccess'))
    await router.replace('/extensions')
  } catch (error) {
    installError.value = error instanceof Error ? error.message : String(error)
  } finally {
    installing.value = false
  }
}

function updateExtension(updated: InstalledExtension): void {
  const existing = extensions.value.find(({ name }) => name === updated.name)
  extensions.value = existing
    ? extensions.value.map((extension) => (extension.name === updated.name ? updated : extension))
    : [...extensions.value, updated].sort((left, right) => left.name.localeCompare(right.name))
}

watch(() => [route.query.install, route.query.version], loadInstallRelease, { immediate: true })

// Watch for connection state changes and reload when connected
watch(connected, (isConnected) => {
  if (isConnected) {
    refreshAll()
  }
}, { immediate: true })

onMounted(() => {
  void loadBrowseUrl()
})
</script>

<template>
  <main class="extensions-view" :aria-label="t('extension.title')">
    <h1 class="sr-only">{{ t('extension.title') }}</h1>
    <div class="extensions-view__actions">
      <a v-if="browseUrl" :href="browseUrl" class="extensions-view__browse-link">
        {{ t('extension.browseRegistry') }} ↗
      </a>
      <InkButton
        v-if="connected && !installRequested"
        :text="t('common.refresh')"
        size="sm"
        :is-loading="extensionsLoading || peersLoading"
        :disabled="extensionsLoading || peersLoading"
        @click="refreshAll"
      />
    </div>
    <p v-if="browseError" role="alert" class="extensions-view__error">
      {{ t('extension.registryUnavailable') }}: {{ browseError }}
    </p>

    <section v-if="installRequested" class="extensions-view__install">
      <div
        v-if="installLoading"
        class="extensions-view__skeleton"
        role="status"
        :aria-label="t('common.loading')"
      >
        <InkSkeleton style="width: 55%; height: 1.5rem" /><InkSkeleton
          style="width: 75%"
        /><InkSkeleton style="width: 30%" />
      </div>
      <InkPlaceholder
        v-else-if="installError && !installRelease"
        state="error"
        :title="t('extension.releaseUnavailable')"
        :description="installError"
      >
        <template #actions>
          <InkButton :text="t('common.retry')" @click="loadInstallRelease" />
        </template>
      </InkPlaceholder>
      <template v-else-if="installRelease">
        <h2>{{ installRelease.nickname }}</h2>
        <p class="extensions-view__install-coordinate">
          {{ installRelease.name }} · v{{ installRelease.version }}
        </p>
        <p class="extensions-view__install-hosts">
          {{
            [
              installRelease.python ? t('extension.hostCore') : null,
              installRelease.module_federation ? t('extension.hostWeb') : null,
            ]
              .filter(Boolean)
              .join(' · ')
          }}
        </p>
        <p v-if="installedMatch" class="extensions-view__notice">
          {{ t('extension.installedVersion', { version: installedMatch.version }) }}
        </p>
        <p v-else-if="!connected" class="extensions-view__notice">
          {{ t('extension.connectBeforeInstall') }}
          <RouterLink to="/settings">{{ t('common.settings') }}</RouterLink>
        </p>
        <p v-else-if="extensionError" role="alert" class="extensions-view__error">
          {{ t('extension.installedUnavailable') }}: {{ extensionError }}
        </p>
        <p v-else class="extensions-view__notice">{{ t('extension.installScope') }}</p>
        <p v-if="installError" role="alert" class="extensions-view__error">{{ installError }}</p>
        <div class="extensions-view__install-actions">
          <InkButton
            v-if="!installedMatch"
            theme="primary"
            :text="t('extension.install')"
            :disabled="!connected || extensionsLoading || !!extensionError"
            :is-loading="installing"
            @click="installReleaseInDeployment"
          />
          <span v-if="installing" aria-disabled="true">{{ t('common.cancel') }}</span>
          <RouterLink v-else to="/extensions">{{
            installedMatch ? t('extension.manage') : t('common.cancel')
          }}</RouterLink>
        </div>
      </template>
    </section>

    <InkPlaceholder
      v-else-if="!connected"
      :title="t('extension.connectDeployment')"
      :description="t('extension.connectDeploymentDescription')"
    >
      <template #actions>
        <RouterLink to="/settings">{{ t('common.settings') }}</RouterLink>
      </template>
    </InkPlaceholder>

    <template v-else>
      <section v-if="peerError" class="extensions-view__peer-status">
        <p role="alert" class="extensions-view__error">
          {{ t('extension.peerListUnavailable', { error: peerError }) }}
        </p>
        <InkButton v-if="peerError" :text="t('common.retry')" size="sm" @click="refreshPeers" />
      </section>

      <section class="extensions-view__list">
        <div
          v-if="extensionsLoading && !extensions.length"
          role="status"
          :aria-label="t('common.loading')"
        >
          <div v-for="index in 3" :key="index" class="extensions-view__skeleton" aria-hidden="true">
            <InkSkeleton style="width: 40%" /><InkSkeleton style="width: 65%" />
          </div>
        </div>
        <InkPlaceholder
          v-else-if="extensionError && !extensions.length"
          state="error"
          :title="t('extension.installedUnavailable')"
          :description="t('extension.errorDescription')"
        >
          <template #actions>
            <InkButton :text="t('common.retry')" @click="refreshExtensions" />
            <details class="extensions-view__error-details">
              <summary>{{ t('common.errorDetails') }}</summary>
              <code>{{ extensionError }}</code>
            </details>
          </template>
        </InkPlaceholder>
        <InkPlaceholder
          v-else-if="extensions.length === 0 && !extensionsLoading"
          :title="t('extension.noneInstalled')"
          :description="t('extension.noneInstalledDescription')"
        >
          <template #actions>
            <a v-if="browseUrl" :href="browseUrl">{{ t('extension.browseRegistry') }} ↗</a>
          </template>
        </InkPlaceholder>
        <extensionCard
          v-for="extension in extensions"
          :key="extension.name"
          :extension="extension"
          :peers="availablePeers"
          :live-peer-ids="livePeerIds"
          :current-peer-id="currentPeerId"
          :peer-selection-disabled="peersLoading || !!peerError"
          @updated="updateExtension"
          @uninstalled="refreshExtensions"
        />
        <div v-if="extensionError && extensions.length" class="extensions-view__error">
          <p role="alert">{{ t('extension.installedUnavailable') }}</p>
          <details>
            <summary>{{ t('common.errorDetails') }}</summary>
            {{ extensionError }}
          </details>
          <InkButton :text="t('common.retry')" size="sm" @click="refreshExtensions" />
        </div>
      </section>
    </template>
  </main>
</template>

<style lang="scss" scoped src="./extensions.scss" />
