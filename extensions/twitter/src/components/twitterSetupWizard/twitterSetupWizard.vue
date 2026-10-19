<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  InkButton,
  InkDropdown,
  InkField,
  InkForm,
  InkInput,
  InkLoading,
  InkPicker,
  type DropdownOption,
} from '@inkcre/ui-web'
import { authStore, type Cron, type Source } from '@inkcre/core'
import {
  discoverCoreCandidates,
  readTwitterOAuthAppConfig,
  TwitterBookmarkSetup,
  TwitterSetupAPI,
  type CorePeerCandidate,
  type OAuthTransaction,
  type TwitterOAuthAppConfig,
  type TwitterSetupStatus,
} from '../../setup-api'
import { TWITTER_SETUP_STEPS, twitterSetupWizardEmits } from './twitterSetupWizard'

const emit = defineEmits(twitterSetupWizardEmits)
const candidates = ref<CorePeerCandidate[]>([])
const selectedPeerId = ref<string | number | null>(null)
const status = ref<TwitterSetupStatus | null>(null)
const currentStep = ref(0)
const loading = ref(true)
const pending = ref<string | null>(null)
const error = ref<string | null>(null)
const clientId = ref('')
const clientSecret = ref('')
const savedOAuthApp = ref<TwitterOAuthAppConfig | null>(null)
const transaction = ref<OAuthTransaction | null>(null)
const sources = ref<Source[]>([])
const selectedSourceId = ref<string | number | null>(null)
const selectedSource = ref<Source | null>(null)
const selectedCron = ref<Cron | null>(null)
const creatingSource = ref(false)
const sourceNickname = ref('Twitter Bookmarks')
const scheduleTime = ref(new Date(2000, 0, 1, 0, 0))
let polling: AbortController | null = null
const lifecycle = new AbortController()

const selectedCandidate = computed(
  () => candidates.value.find((item) => item.peer.id === selectedPeerId.value) ?? null
)
const api = computed(() =>
  selectedCandidate.value ? new TwitterSetupAPI(selectedCandidate.value.peer) : null
)
const selectedCoreEnabled = computed(() => selectedCandidate.value?.enabled ?? false)
const busy = computed(() => pending.value !== null)
const oauthAppConfigured = computed(() =>
  Boolean(savedOAuthApp.value?.client_id && savedOAuthApp.value?.client_secret)
)
const oauthAppChanged = computed(
  () =>
    clientId.value !== savedOAuthApp.value?.client_id ||
    clientSecret.value !== savedOAuthApp.value?.client_secret
)
const authorizationPending = computed(() =>
  Boolean(transaction.value && ['pending', 'exchanging'].includes(transaction.value.status))
)
const collectionTime = computed(() =>
  scheduleTime.value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
)
const setupReady = computed(() =>
  Boolean(status.value?.connected && selectedSource.value && selectedCron.value?.enabled)
)
const peerOptions = computed<DropdownOption[]>(() =>
  candidates.value.map((item) => ({
    value: item.peer.id,
    label: `${item.peer.name} · ${item.peer.application_version ? `v${item.peer.application_version}` : 'version unknown'}${item.enabled ? ' — enabled' : ''}`,
  }))
)
const sourceOptions = computed<DropdownOption[]>(() => [
  ...sources.value.map((source) => ({
    value: source.id,
    label: source.nickname || `Bookmark Source #${source.id}`,
  })),
  { value: 'create', label: 'Create a new Source' },
])

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
function scheduleFromCron(cron: Cron | null): Date {
  const [minute = '0', hour = '0'] = cron?.schedule.split(' ') ?? []
  return new Date(2000, 0, 1, Number(hour), Number(minute))
}
async function run(operation: string, task: () => Promise<void>): Promise<void> {
  if (busy.value) return
  pending.value = operation
  error.value = null
  try {
    await task()
  } catch (cause) {
    error.value = message(cause)
  } finally {
    pending.value = null
  }
}
async function loadCollection(preferredSourceId?: number | null): Promise<void> {
  const collection = await TwitterBookmarkSetup.read(preferredSourceId)
  sources.value = collection.sources
  selectedSource.value = collection.source
  selectedSourceId.value = collection.source?.id ?? null
  selectedCron.value = collection.cron
  scheduleTime.value = scheduleFromCron(collection.cron)
  creatingSource.value = collection.sources.length === 0
}
function applyOAuthAppConfig(config: TwitterOAuthAppConfig): void {
  savedOAuthApp.value = config
  clientId.value = config.client_id
  clientSecret.value = config.client_secret
}
async function applyStatus(next: TwitterSetupStatus): Promise<void> {
  status.value = next
  if (next.connected) await loadCollection(selectedSource.value?.id)
  currentStep.value = !oauthAppConfigured.value || !next.connected ? 1 : setupReady.value ? 3 : 2
}
async function reloadStatus(): Promise<void> {
  if (!api.value || !selectedCoreEnabled.value) return
  const [next, config] = await Promise.all([
    api.value.status(lifecycle.signal),
    readTwitterOAuthAppConfig(),
  ])
  applyOAuthAppConfig(config)
  await applyStatus(next)
}
async function initialize(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    candidates.value = await discoverCoreCandidates(lifecycle.signal)
    const selected =
      candidates.value.find((item) => item.enabled && item.setupAvailable) ??
      candidates.value.find((item) => item.enabled) ??
      candidates.value[0]
    selectedPeerId.value = selected?.peer.id ?? null
    if (selected?.enabled) await reloadStatus()
  } catch (cause) {
    error.value = message(cause)
  } finally {
    loading.value = false
  }
}
watch(selectedPeerId, async (next, previous) => {
  if (next === previous || loading.value) return
  stopPolling()
  status.value = null
  transaction.value = null
  currentStep.value = 0
  error.value = null
  if (selectedCoreEnabled.value) await run('status', reloadStatus)
})
watch(selectedSourceId, async (value) => {
  if (value === 'create') {
    creatingSource.value = true
    selectedSource.value = null
    selectedCron.value = null
    return
  }
  if (typeof value !== 'number' || value === selectedSource.value?.id) return
  creatingSource.value = false
  await run('source', async () => {
    try {
      const collection = await TwitterBookmarkSetup.read(value)
      selectedSource.value = collection.source
      selectedCron.value = collection.cron
      scheduleTime.value = scheduleFromCron(collection.cron)
    } catch (cause) {
      selectedSourceId.value = selectedSource.value?.id ?? null
      throw cause
    }
  })
})
async function enableSelectedCore(): Promise<void> {
  if (!api.value || !selectedCandidate.value) return
  await run('enable-core', async () => {
    const extension = await api.value!.enableCore(lifecycle.signal)
    selectedCandidate.value!.enabled = extension.enabled
    await reloadStatus()
  })
}
async function saveOAuthApp(): Promise<void> {
  if (!api.value) return
  await run('save-oauth-app', async () => {
    try {
      const next = await api.value!.saveOAuthApp(
        clientId.value,
        clientSecret.value,
        false,
        lifecycle.signal
      )
      applyOAuthAppConfig(await readTwitterOAuthAppConfig())
      await applyStatus(next)
    } catch (cause) {
      const text = message(cause)
      if (!text.includes('requires confirmation')) throw cause
      if (!window.confirm(`${text}\n\nDisconnect the current account and continue?`)) return
      const next = await api.value!.saveOAuthApp(
        clientId.value,
        clientSecret.value,
        true,
        lifecycle.signal
      )
      applyOAuthAppConfig(await readTwitterOAuthAppConfig())
      await applyStatus(next)
    }
  })
}
function stopPolling(): void {
  polling?.abort()
  polling = null
}
function close(): void {
  if (busy.value) return
  stopPolling()
  emit('close')
}
async function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Polling cancelled', 'AbortError'))
    const onAbort = () => {
      window.clearTimeout(timer)
      reject(new DOMException('Polling cancelled', 'AbortError'))
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
async function pollTransaction(id: string): Promise<void> {
  if (!api.value) return
  stopPolling()
  const controller = new AbortController()
  polling = controller
  try {
    while (!controller.signal.aborted) {
      await wait(2000, controller.signal)
      const next = await api.value.oauthTransaction(id, controller.signal)
      transaction.value = next
      if (!['pending', 'exchanging'].includes(next.status)) {
        if (next.status === 'succeeded') await reloadStatus()
        else error.value = next.error ?? 'Twitter authorization did not complete.'
        return
      }
    }
  } catch (cause) {
    if (!controller.signal.aborted) error.value = message(cause)
  } finally {
    if (polling === controller) polling = null
  }
}
async function beginOAuth(): Promise<void> {
  if (!api.value) return
  await run('begin-oauth', async () => {
    transaction.value = await api.value!.beginOAuth(lifecycle.signal)
    void pollTransaction(transaction.value.id)
  })
}
async function connectXMonkey(): Promise<void> {
  const base = status.value?.x_monkey_base_url
  if (!base) return
  await run('connect-x-monkey', async () => {
    // Explicit user action mints a fresh Peer JWT, then sends it only in a
    // top-level form POST so Core can set its own HttpOnly session cookie.
    const token = await authStore.refreshToken()
    const target = new URL(base)
    const basePath = target.pathname.replace(/\/+$/, '')
    target.pathname = `${basePath}/session`
    target.search = ''
    target.hash = ''
    const form = document.createElement('form')
    form.method = 'post'
    form.enctype = 'application/x-www-form-urlencoded'
    form.action = target.toString()
    const tokenField = document.createElement('input')
    tokenField.type = 'hidden'
    tokenField.name = 'token'
    tokenField.value = token
    form.append(tokenField)
    document.body.append(form)
    form.submit()
    form.remove()
  })
}
async function disconnect(): Promise<void> {
  if (!api.value) return
  await run('disconnect', async () => {
    stopPolling()
    transaction.value = null
    await applyStatus(await api.value!.disconnect(lifecycle.signal))
  })
}
async function createSource(): Promise<void> {
  await run('create-source', async () => {
    const source = await TwitterBookmarkSetup.createSource(sourceNickname.value)
    creatingSource.value = false
    await loadCollection(source.id)
  })
}
async function saveSchedule(): Promise<void> {
  if (!selectedSource.value) return
  await run('save-schedule', async () => {
    selectedCron.value = await TwitterBookmarkSetup.saveSchedule(
      selectedSource.value!,
      scheduleTime.value.getHours(),
      scheduleTime.value.getMinutes()
    )
    currentStep.value = 3
  })
}
async function finish(): Promise<void> {
  if (!selectedSource.value || !selectedCron.value) return
  await run('finish', async () => {
    selectedCron.value = await TwitterBookmarkSetup.finish(
      selectedSource.value!,
      selectedCron.value!
    )
  })
}
onMounted(() => void initialize())
onBeforeUnmount(() => {
  lifecycle.abort()
  stopPolling()
})
</script>

<template>
  <section class="twitter-setup" :aria-busy="loading || busy">
    <ol class="twitter-setup__steps" aria-label="Twitter setup progress">
      <li
        v-for="(step, index) in TWITTER_SETUP_STEPS"
        :key="step"
        :class="{ 'is-current': currentStep === index }"
        :aria-current="currentStep === index ? 'step' : undefined"
      >
        <button
          v-if="index < currentStep"
          type="button"
          :disabled="busy"
          @click="currentStep = index"
        >
          <span>{{ index + 1 }}</span
          >{{ step }}
        </button>
        <span v-else class="twitter-setup__step"
          ><span>{{ index + 1 }}</span
          >{{ step }}</span
        >
      </li>
    </ol>
    <div v-if="loading" class="twitter-setup__loading" role="status">
      <InkLoading />
      <p>Loading Twitter settings…</p>
    </div>
    <template v-else>
      <p v-if="error" class="twitter-setup__error" role="alert">{{ error }}</p>
      <div v-if="currentStep === 0" class="twitter-setup__panel">
        <h3>Choose an authorization Peer</h3>
        <InkForm v-if="candidates.length" layout="col">
          <InkDropdown
            v-model="selectedPeerId"
            :options="peerOptions"
            label="Authorization Peer"
            :editable="!busy"
          />
        </InkForm>
        <p v-else>No authorization Peer is available.</p>
        <div class="twitter-setup__actions">
          <InkButton
            v-if="selectedCandidate && !selectedCoreEnabled"
            text="Enable Twitter"
            theme="primary"
            :is-loading="pending === 'enable-core'"
            :disabled="busy"
            @click="enableSelectedCore"
          />
          <InkButton
            v-else-if="selectedCoreEnabled"
            text="Continue"
            theme="primary"
            :is-loading="busy"
            @click="run('status', reloadStatus)"
          />
          <InkButton v-else text="Retry" theme="subtle" @click="initialize" />
        </div>
        <section v-if="status?.x_monkey_base_url" class="twitter-setup__x-monkey">
          <h3>Connect x-monkey storage</h3>
          <p class="twitter-setup__hint">
            This connects the selected Core to x-monkey with a fresh InKCre Peer credential. It is
            separate from X bookmark authorization.
          </p>
          <InkButton
            text="Connect x-monkey"
            theme="subtle"
            :is-loading="pending === 'connect-x-monkey'"
            :disabled="busy"
            @click="connectXMonkey"
          />
        </section>
      </div>
      <div v-else-if="currentStep === 1" class="twitter-setup__panel">
        <h3>Connect an X account</h3>
        <p v-if="status?.connected">Connected as @{{ status.handle }}.</p>
        <p v-else class="twitter-setup__hint">
          Use your own X OAuth application to authorize access to bookmarks.
        </p>
        <details class="twitter-setup__app" :open="!oauthAppConfigured">
          <summary>
            {{ oauthAppConfigured ? 'Application settings' : 'Configure your X application' }}
          </summary>
          <p class="twitter-setup__hint">Register this callback URL in your X application.</p>
          <code>{{ status?.callback_url }}</code>
          <InkForm layout="col" @submit="saveOAuthApp">
            <InkInput
              v-model="clientId"
              label="Client ID"
              required
              :editable="!busy && !authorizationPending"
            />
            <InkField label="Client Secret" for="twitter-client-secret" required>
              <input
                id="twitter-client-secret"
                v-model="clientSecret"
                class="twitter-setup__secret"
                type="password"
                autocomplete="off"
                required
                :disabled="busy || authorizationPending"
              />
            </InkField>
            <InkButton
              text="Save application"
              native-type="submit"
              :theme="oauthAppConfigured ? 'subtle' : 'primary'"
              :is-loading="pending === 'save-oauth-app'"
              :disabled="
                busy || authorizationPending || !clientId || !clientSecret || !oauthAppChanged
              "
            />
          </InkForm>
        </details>
        <p v-if="oauthAppConfigured && oauthAppChanged" class="twitter-setup__hint">
          Save the application changes before authorizing.
        </p>
        <div v-if="authorizationPending" class="twitter-setup__authorization" role="status">
          <a
            v-if="transaction?.authorize_url"
            :href="transaction.authorize_url"
            target="_blank"
            rel="noopener noreferrer"
            >Open X authorization</a
          >
          <p>Complete authorization in the new tab. This page will update when it finishes.</p>
        </div>
        <div class="twitter-setup__actions">
          <InkButton
            v-if="status?.connected"
            text="Continue"
            theme="primary"
            :disabled="busy || oauthAppChanged"
            @click="applyStatus(status)"
          />
          <InkButton
            v-else-if="oauthAppConfigured && !authorizationPending"
            text="Create authorization link"
            theme="primary"
            :is-loading="pending === 'begin-oauth'"
            :disabled="busy || oauthAppChanged"
            @click="beginOAuth"
          />
          <InkButton
            v-if="status?.connected"
            text="Disconnect"
            theme="danger"
            :is-loading="pending === 'disconnect'"
            :disabled="busy"
            @click="disconnect"
          />
        </div>
      </div>
      <div v-else-if="currentStep === 2" class="twitter-setup__panel">
        <h3>Set up bookmark collection</h3>
        <InkForm v-if="sources.length" layout="col">
          <InkDropdown
            v-model="selectedSourceId"
            :options="sourceOptions"
            label="Bookmark Source"
            :editable="!busy"
          />
        </InkForm>
        <InkForm v-if="creatingSource" layout="col" @submit="createSource">
          <InkInput v-model="sourceNickname" label="Source nickname" :editable="!busy" required />
          <InkButton
            text="Create Bookmark Source"
            theme="primary"
            native-type="submit"
            :is-loading="pending === 'create-source'"
            :disabled="busy || !sourceNickname.trim()"
          />
        </InkForm>
        <InkForm v-if="selectedSource" layout="col" @submit="saveSchedule">
          <InkPicker
            v-model="scheduleTime"
            type="time"
            label="Collect bookmarks daily at"
            :editable="!busy"
            :formatter="
              (value: Date) => value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            "
          />
          <InkButton
            text="Continue"
            theme="primary"
            native-type="submit"
            :is-loading="pending === 'save-schedule'"
            :disabled="busy"
          />
        </InkForm>
      </div>
      <div v-else class="twitter-setup__panel">
        <h3>{{ setupReady ? 'Twitter is ready' : 'Review and start' }}</h3>
        <dl>
          <dt>Account</dt>
          <dd>@{{ status?.handle }}</dd>
          <dt>Bookmark Source</dt>
          <dd>{{ selectedSource?.nickname || `#${selectedSource?.id}` }}</dd>
          <dt>Collection</dt>
          <dd>Daily at {{ collectionTime }}</dd>
        </dl>
        <p v-if="setupReady" role="status">Bookmarks will be collected on this schedule.</p>
        <p v-else class="twitter-setup__hint">
          Start collection now and keep collecting on this schedule.
        </p>
        <div class="twitter-setup__actions">
          <InkButton
            :text="setupReady ? 'Edit collection' : 'Back'"
            theme="subtle"
            :disabled="busy"
            @click="currentStep = 2"
          />
          <InkButton
            v-if="!setupReady"
            text="Start collecting bookmarks"
            theme="primary"
            :is-loading="pending === 'finish'"
            :disabled="busy || !selectedCron"
            @click="finish"
          />
        </div>
      </div>
    </template>
    <div class="twitter-setup__toolbar">
      <InkButton text="Close" theme="subtle" :disabled="busy" @click="close" />
    </div>
  </section>
</template>

<style lang="scss" scoped src="./twitterSetupWizard.scss" />
