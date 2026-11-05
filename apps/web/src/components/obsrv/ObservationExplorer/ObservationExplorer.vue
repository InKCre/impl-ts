<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { InkButton, InkDropdown, InkForm, InkInput, InkLoading } from '@inkcre/ui-web'
import {
  configStore,
  createObservabilityClient,
  OBSERVATION_MAX_WINDOW_MS,
  type ObservationPage,
  type ObservationQuery,
  type ObservationRecord,
  type ObservabilityStatus,
} from '@inkcre/core'
import { defaultObservationWindow, type ObservationExplorerProps } from './ObservationExplorer'

const props = withDefaults(defineProps<ObservationExplorerProps>(), {
  embedded: false,
  enablePolling: false,
  pollingInterval: 5000,
})
const { t, locale } = useI18n()
const hours = ref<string | number>(1)
const severity = ref<string | number>(0)
const kind = ref<string | number>('')
const text = ref('')
const job = ref('')
const peer = ref('')
const trace = ref('')
const operation = ref('')
const chronological = ref(false)
const customSince = ref('')
const customUntil = ref('')
const page = ref<ObservationPage | null>(null)
const windowLimited = ref(false)
const status = ref<ObservabilityStatus | null>(null)
const loading = ref(false)
const error = ref(false)
const statusError = ref(false)
const validationError = ref('')
const expanded = ref<string | null>(null)
const hasLoaded = ref(false)
let generation = 0
let client: ReturnType<typeof createObservabilityClient> | null = null
let applied: Omit<ObservationQuery, 'since' | 'until'> = { limit: 200 }
let appliedHours = 1
let appliedSince: string | null = null
let appliedUntil: string | null = null

const records = computed(() => {
  const entries = page.value?.records ?? []
  return chronological.value ? [...entries].reverse() : entries
})
const errorCount = computed(
  () => records.value.filter((record) => record.severity_number >= 17).length
)
const durations = computed(() =>
  records.value.flatMap((record) => {
    if (record.kind !== 'span') return []
    const duration = record.attributes.duration_ms
    return typeof duration === 'number' && Number.isFinite(duration) && duration >= 0
      ? [duration]
      : []
  })
)
const meanDuration = computed(() =>
  durations.value.length
    ? Math.round(durations.value.reduce((sum, value) => sum + value, 0) / durations.value.length)
    : null
)
const history = computed(() => status.value?.history)
const partialJobWindow = computed(() => {
  if (!page.value || !props.jobCreatedAt) return false
  const created = Date.parse(props.jobCreatedAt)
  const end = props.jobClosedAt ? Date.parse(props.jobClosedAt) : Date.now()
  return (
    Math.min(created, end) < Date.parse(page.value.since) ||
    Math.max(created, end) >= Date.parse(page.value.until)
  )
})
const windowOptions = computed(() => [
  { value: 1, label: t('observability.lastHour') },
  { value: 24, label: t('observability.lastDay') },
  { value: 168, label: t('observability.lastWeek') },
])
const severityOptions = computed(() => [
  { value: 0, label: t('observability.allLevels') },
  { value: 9, label: t('observability.infoAbove') },
  { value: 13, label: t('observability.warnAbove') },
  { value: 17, label: t('observability.errorAbove') },
])
const kindOptions = computed(() => [
  { value: '', label: t('observability.allKinds') },
  { value: 'log', label: t('observability.log') },
  { value: 'event', label: t('observability.event') },
  { value: 'span', label: t('observability.span') },
])

function dateLabel(value: string): string {
  return new Date(value).toLocaleString(locale.value, { hour12: false })
}

function relatedJob(record: ObservationRecord): number | null {
  const value = record.attributes['inkcre.job.id']
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  const legacy = record.trace_id?.match(/^job\.(\d+)$/)
  return legacy ? Number(legacy[1]) : null
}

async function refresh(): Promise<void> {
  if (loading.value) return
  if (client === null) {
    try {
      client = createObservabilityClient()
    } catch {
      error.value = true
      statusError.value = true
      hasLoaded.value = true
      return
    }
  }
  const current = generation
  const defaultWindow = defaultObservationWindow(
    Date.now(),
    appliedHours,
    props.jobCreatedAt,
    props.jobClosedAt
  )
  const since = appliedSince ?? defaultWindow.since
  const until = appliedUntil ?? defaultWindow.until
  loading.value = true
  error.value = false
  statusError.value = false
  const [queryResult, statusResult] = await Promise.allSettled([
    client.query({ ...applied, since, until }),
    client.status(),
  ])
  // A completed request always belongs to the connection and filters that started it.
  if (current !== generation) return
  loading.value = false
  hasLoaded.value = true
  if (queryResult.status === 'fulfilled') {
    page.value = queryResult.value
    windowLimited.value = appliedSince === null && defaultWindow.limited
  } else error.value = true
  if (statusResult.status === 'fulfilled') status.value = statusResult.value
  else statusError.value = true
}

function apply(): void {
  const jobValue = props.jobId ?? (job.value.trim() ? Number(job.value) : undefined)
  if (jobValue !== undefined && (!Number.isSafeInteger(jobValue) || jobValue < 1)) {
    validationError.value = t('observability.invalidJob')
    return
  }
  const start = Date.parse(customSince.value)
  const end = Date.parse(customUntil.value)
  if (
    (customSince.value || customUntil.value) &&
    (!Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start >= end ||
      end - start > OBSERVATION_MAX_WINDOW_MS)
  ) {
    validationError.value = t('observability.invalidWindow')
    return
  }
  appliedSince = customSince.value ? new Date(start).toISOString() : null
  appliedUntil = customUntil.value ? new Date(end).toISOString() : null
  appliedHours = Number(hours.value)
  validationError.value = ''
  applied = {
    limit: 200,
    ...(jobValue === undefined ? {} : { job_id: jobValue }),
    ...(props.traceId || trace.value.trim()
      ? { trace_id: props.traceId || trace.value.trim() }
      : {}),
    ...(peer.value.trim() ? { peer_id: peer.value.trim() } : {}),
    ...(operation.value.trim() ? { operation: operation.value.trim() } : {}),
    ...(text.value.trim() ? { text: text.value.trim() } : {}),
    ...(Number(severity.value) ? { severity_min: Number(severity.value) } : {}),
    ...(kind.value ? { kind: kind.value as ObservationQuery['kind'] } : {}),
  }
  generation++
  loading.value = false
  hasLoaded.value = false
  page.value = null
  expanded.value = null
  void refresh()
}

function correlate(record: ObservationRecord, field: 'trace' | 'peer' | 'operation'): void {
  if (field === 'trace') trace.value = record.trace_id ?? ''
  if (field === 'peer') peer.value = String(record.attributes['inkcre.peer.id'] ?? '')
  if (field === 'operation') operation.value = String(record.attributes['inkcre.operation'] ?? '')
  apply()
}

const { pause, resume } = useIntervalFn(
  () => {
    if (!error.value && !validationError.value) void refresh()
  },
  () => props.pollingInterval,
  { immediate: false }
)
watch(
  () => props.jobClosedAt,
  () => {
    generation++
    loading.value = false
    void refresh()
  }
)
watch(
  () => props.enablePolling,
  (enabled) => (enabled ? resume() : pause()),
  { immediate: true }
)
watch(
  () => [
    configStore.metaConfig.INKCRE_PGREST_URL,
    configStore.metaConfig.INKCRE_JWT_SECRET,
    configStore.metaConfig.INKCRE_PEER_ID,
    props.jobId,
    props.traceId,
    props.jobCreatedAt,
  ],
  () => {
    generation++
    page.value = null
    expanded.value = null
    loading.value = false
    hasLoaded.value = false
    customSince.value = ''
    customUntil.value = ''
    status.value = null
    client = null
    apply()
  },
  { immediate: true }
)
onUnmounted(() => {
  generation++
  pause()
})
</script>

<template>
  <section
    class="observation-explorer"
    :class="{ 'observation-explorer--embedded': embedded }"
    :aria-label="t('observability.title')"
  >
    <header v-if="!embedded" class="observation-explorer__header">
      <h1>{{ t('observability.title') }}</h1>
      <p>{{ t('observability.intro') }}</p>
    </header>

    <details class="observation-explorer__backend" :open="!embedded">
      <summary>
        {{ t('observability.backendStatus')
        }}<template v-if="status"> · {{ status.backend }}</template>
      </summary>
      <template v-if="status">
        <dl class="observation-explorer__status">
          <div>
            <dt>{{ t('observability.configuration') }}</dt>
            <dd>
              {{ t(status.configured ? 'observability.available' : 'observability.unavailable') }}
            </dd>
          </div>
          <div>
            <dt>{{ t('observability.recording') }}</dt>
            <dd>{{ t(status.recording ? 'observability.enabled' : 'observability.disabled') }}</dd>
          </div>
          <div>
            <dt>{{ t('observability.query') }}</dt>
            <dd>
              {{ t(status.queryable ? 'observability.available' : 'observability.unavailable') }}
            </dd>
          </div>
          <div>
            <dt>{{ t('observability.dropped') }}</dt>
            <dd>{{ status.dropped ?? t('observability.notObserved') }}</dd>
          </div>
        </dl>
        <p v-if="history">{{ history }}</p>
        <p v-if="status.error" class="observation-explorer__warning">{{ status.error }}</p>
      </template>
      <p v-if="statusError" role="status">{{ t('observability.statusFailed') }}</p>
      <p>{{ t('observability.scopeNote') }}</p>
    </details>

    <InkForm layout="col" @submit="apply">
      <div class="observation-explorer__filters">
        <InkDropdown
          v-if="!jobCreatedAt"
          v-model="hours"
          :label="t('observability.window')"
          :options="windowOptions"
        />
        <InkDropdown
          v-model="severity"
          :label="t('observability.severity')"
          :options="severityOptions"
        />
        <InkDropdown v-model="kind" :label="t('observability.kind')" :options="kindOptions" />
        <InkInput v-model="text" :label="t('observability.search')" />
      </div>
      <details class="observation-explorer__correlation">
        <summary>{{ t(embedded ? 'observability.timeRange' : 'observability.correlate') }}</summary>
        <div v-if="!embedded" class="observation-explorer__filters">
          <InkInput
            v-model="job"
            :label="t('observability.jobId')"
            native-type="number"
            :error="validationError"
          />
          <InkInput v-model="peer" :label="t('observability.peerId')" />
          <InkInput v-model="trace" :label="t('observability.traceId')" />
          <InkInput v-model="operation" :label="t('observability.operation')" />
        </div>
        <p class="observation-explorer__hint">{{ t('observability.absoluteWindow') }}</p>
        <p v-if="jobCreatedAt" class="observation-explorer__hint">
          {{ t('observability.jobWindow') }}
        </p>
        <div class="observation-explorer__filters">
          <InkInput
            v-model="customSince"
            native-type="datetime-local"
            :label="t('observability.since')"
          />
          <InkInput
            v-model="customUntil"
            native-type="datetime-local"
            :label="t('observability.until')"
          />
        </div>
      </details>
      <p v-if="validationError" class="observation-explorer__warning" role="alert">
        {{ validationError }}
      </p>
      <div class="observation-explorer__actions">
        <InkButton native-type="submit" theme="primary" :text="t('observability.apply')" />
        <InkButton :text="t('common.refresh')" :is-loading="loading" @click="refresh" />
        <InkButton
          :text="t(chronological ? 'observability.newestFirst' : 'observability.timeline')"
          :aria-pressed="chronological"
          @click="chronological = !chronological"
        />
      </div>
    </InkForm>

    <div v-if="page" class="observation-explorer__summary">
      <p>
        {{
          t('observability.windowShown', {
            since: dateLabel(page.since),
            until: dateLabel(page.until),
          })
        }}
        · {{ page.backend }}
      </p>
      <dl class="observation-explorer__status">
        <div>
          <dt>{{ t('observability.returned') }}</dt>
          <dd>{{ records.length }}</dd>
        </div>
        <div>
          <dt>{{ t('observability.errors') }}</dt>
          <dd>{{ errorCount }}</dd>
        </div>
        <div>
          <dt>{{ t('observability.meanDuration') }}</dt>
          <dd>
            {{ meanDuration === null ? t('observability.notObserved') : `${meanDuration} ms` }}
          </dd>
        </div>
      </dl>
      <p>{{ t('observability.sampleNote') }}</p>
      <p v-if="windowLimited" class="observation-explorer__warning" role="status">
        {{ t('observability.windowLimited') }}
      </p>
      <p v-else-if="partialJobWindow" class="observation-explorer__warning" role="status">
        {{ t('observability.partialJobWindow') }}
      </p>
      <p v-if="page.truncated" class="observation-explorer__warning" role="status">
        {{ t('observability.truncated') }}
      </p>
    </div>

    <div v-if="error" class="observation-explorer__error" role="alert">
      <p>{{ t('observability.loadFailed') }}</p>
      <p v-if="page">{{ t('observability.keptResults') }}</p>
      <InkButton :text="t('common.retry')" @click="refresh" />
    </div>
    <InkLoading v-if="loading" variant="spinner" size="sm" :label="t('logs.loading')" />
    <p v-else-if="enablePolling && !error" class="observation-explorer__hint">
      {{ t('logs.autoUpdating') }}
    </p>
    <div
      v-if="hasLoaded && !loading && !error && records.length === 0"
      class="observation-explorer__empty"
      role="status"
    >
      <p>{{ t('observability.empty') }}</p>
      <p>{{ t('observability.emptyExplanation') }}</p>
    </div>

    <ol
      class="observation-explorer__records"
      :aria-label="t(chronological ? 'observability.timeline' : 'observability.records')"
    >
      <li
        v-for="record in records"
        :key="record.id"
        class="observation-explorer__record"
        :class="{ 'observation-explorer__record--error': record.severity_number >= 17 }"
      >
        <button
          class="observation-explorer__record-heading"
          type="button"
          :aria-expanded="expanded === record.id"
          @click="expanded = expanded === record.id ? null : record.id"
        >
          <time :datetime="record.timestamp">{{ dateLabel(record.timestamp) }}</time>
          <span class="observation-explorer__level">{{ record.severity_text }}</span>
          <span
            >{{ record.event_name || record.body
            }}<small v-if="typeof record.attributes.duration_ms === 'number'">
              · {{ record.attributes.duration_ms }} ms</small
            ></span
          >
          <span class="observation-explorer__hint">{{ t(`observability.${record.kind}`) }}</span>
        </button>
        <div v-if="expanded === record.id" class="observation-explorer__detail">
          <p class="observation-explorer__body">{{ record.body }}</p>
          <dl>
            <dt>{{ t('observability.traceId') }}</dt>
            <dd>{{ record.trace_id || t('observability.notObserved') }}</dd>
            <dt>{{ t('observability.spanId') }}</dt>
            <dd>{{ record.span_id || t('observability.notObserved') }}</dd>
          </dl>
          <div class="observation-explorer__actions">
            <router-link
              v-if="relatedJob(record) !== null"
              :to="{ name: 'Job', params: { id: relatedJob(record)! } }"
              >{{ t('observability.openJob', { id: relatedJob(record) }) }}</router-link
            >
            <template v-if="!embedded">
              <InkButton
                v-if="record.trace_id"
                size="sm"
                :text="t('observability.sameTrace')"
                @click="correlate(record, 'trace')"
              />
              <InkButton
                v-if="record.attributes['inkcre.peer.id']"
                size="sm"
                :text="t('observability.samePeer')"
                @click="correlate(record, 'peer')"
              />
              <InkButton
                v-if="record.attributes['inkcre.operation']"
                size="sm"
                :text="t('observability.sameOperation')"
                @click="correlate(record, 'operation')"
              />
            </template>
          </div>
          <details>
            <summary>{{ t('observability.attributes') }}</summary>
            <pre>{{ JSON.stringify(record.attributes, null, 2) }}</pre>
          </details>
        </div>
      </li>
    </ol>
  </section>
</template>

<style lang="scss" scoped src="./ObservationExplorer.scss" />
