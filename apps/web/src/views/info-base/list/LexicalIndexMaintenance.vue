<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIntervalFn } from '@vueuse/core'
import { InkButton, InkDoubleCheck } from '@inkcre/ui-web'
import {
  configStore,
  Job,
  JobManager,
  JobStatus,
  JobType,
  LEXICAL_INDEX_JOB_TYPES,
  LexicalIndexReportSchema,
} from '@inkcre/core'

const { t, d } = useI18n()
const operations = ['maintain', 'rebuild'] as const
type Operation = (typeof operations)[number]
type JobSummary = { latest: Job | undefined; active: Job | undefined }

const open = ref(false)
const loading = ref(false)
const submitting = ref<Operation | null>(null)
const readError = ref(false)
const submitError = ref<Operation | null>(null)
const registered = shallowRef<ReadonlySet<string>>()
const summaries = shallowRef<Partial<Record<Operation, JobSummary>>>({})
let connectionGeneration = 0

const meta = computed(() => configStore.metaConfig)
const activeStatuses = [JobStatus.PENDING, JobStatus.RUNNING]

async function refresh(checkTypes = false) {
  if (!open.value || loading.value || submitting.value) return
  loading.value = true
  readError.value = false
  const generation = connectionGeneration
  try {
    const [types, ...entries] = await Promise.all([
      checkTypes || !registered.value ? JobType.getAll() : undefined,
      ...operations.map(async (operation) => {
        const type = LEXICAL_INDEX_JOB_TYPES[operation]
        const [[latest], [active]] = await Promise.all([
          Job.getAll({ type, limit: 1 }),
          Job.getAll({ type, status: activeStatuses, limit: 1 }),
        ])
        return [operation, { latest, active }] as const
      }),
    ])
    if (generation !== connectionGeneration) return
    if (types) registered.value = new Set(types.map(({ id }) => id))
    summaries.value = Object.fromEntries(entries)
    if (checkTypes) submitError.value = null
  } catch {
    if (generation === connectionGeneration) readError.value = true
  } finally {
    if (generation === connectionGeneration) loading.value = false
  }
}

function setOpen(event: Event) {
  open.value = (event.currentTarget as HTMLDetailsElement).open
  if (open.value) void refresh(true)
}

const rows = computed(() =>
  operations.map((operation) => {
    const summary = summaries.value[operation]
    const job = summary?.latest
    const active = summary?.active ?? (job && !job.isTerminal ? job : undefined)
    const parsed = LexicalIndexReportSchema.safeParse(job?.state)
    const report = job?.status === JobStatus.FINISHED && parsed.success ? parsed.data : null
    const canContinue =
      !!report?.next_after_block && (operation === 'maintain' || !!report.rebuild_cutoff)
    const actionsDisabled =
      loading.value ||
      readError.value ||
      !!active ||
      submitting.value !== null ||
      submitError.value === operation
    return { operation, job, active, report, canContinue, actionsDisabled }
  })
)

async function submit(operation: Operation, resume: boolean) {
  const type = LEXICAL_INDEX_JOB_TYPES[operation]
  const row = rows.value.find((entry) => entry.operation === operation)
  if (!row || row.actionsDisabled || !registered.value?.has(type)) return
  const report = row?.report
  if (resume && !row.canContinue) return
  const parameters =
    resume && report
      ? { options: { after_block: report.next_after_block, rebuild_cutoff: report.rebuild_cutoff } }
      : {}
  const generation = connectionGeneration
  submitting.value = operation
  submitError.value = null
  try {
    const job = await JobManager.create(type, parameters)
    if (generation !== connectionGeneration) return
    summaries.value = { ...summaries.value, [operation]: { latest: job, active: job } }
  } catch {
    if (generation === connectionGeneration) submitError.value = operation
  } finally {
    if (generation === connectionGeneration) submitting.value = null
  }
}

watch(
  () => [meta.value.INKCRE_PGREST_URL, meta.value.INKCRE_JWT_SECRET, meta.value.INKCRE_PEER_ID],
  () => {
    connectionGeneration++
    summaries.value = {}
    registered.value = undefined
    loading.value = false
    submitting.value = null
    submitError.value = null
    void refresh()
  },
  { flush: 'sync' }
)
onBeforeUnmount(() => connectionGeneration++)

const { pause, resume } = useIntervalFn(() => void refresh(), 5000, { immediate: false })
watch(
  () => open.value && !readError.value && rows.value.some(({ active }) => active),
  (poll) => (poll ? resume() : pause())
)
</script>

<template>
  <details class="lexical-index" @toggle="setOpen">
    <summary>{{ t('infoBase.lexicalIndex.title') }}</summary>
    <p>{{ t('infoBase.lexicalIndex.description') }}</p>
    <div class="lexical-index__toolbar">
      <InkButton
        size="sm"
        :text="t('common.refresh')"
        :is-loading="loading"
        :disabled="submitting !== null"
        @click="refresh(true)"
      />
      <span v-if="readError" role="alert">{{ t('infoBase.lexicalIndex.readError') }}</span>
    </div>
    <div class="lexical-index__jobs" aria-live="polite" :aria-busy="loading && !registered">
      <section
        v-for="{ operation, job, active, report, canContinue, actionsDisabled } in rows"
        :key="operation"
      >
        <h2>{{ t(`infoBase.lexicalIndex.${operation}`) }}</h2>
        <p v-if="job">
          <RouterLink :to="{ name: 'Job', params: { id: job.id } }">
            {{ t('infoBase.lexicalIndex.job', { id: job.id }) }}
          </RouterLink>
          · {{ t(`infoBase.lexicalIndex.status.${job.status}`) }} ·
          {{ d(job.closed_at ?? job.created_at, { dateStyle: 'short', timeStyle: 'short' }) }}
        </p>
        <p v-else-if="registered && !readError">{{ t('infoBase.lexicalIndex.noJobs') }}</p>
        <p v-if="active && active.id !== job?.id">
          <RouterLink :to="{ name: 'Job', params: { id: active.id } }">
            {{ t('infoBase.lexicalIndex.job', { id: active.id }) }}
          </RouterLink>
          · {{ t(`infoBase.lexicalIndex.status.${active.status}`) }}
        </p>
        <p v-if="active?.status === JobStatus.PENDING">{{ t('infoBase.lexicalIndex.waiting') }}</p>
        <p v-if="report">
          {{ t('infoBase.lexicalIndex.counts', report) }}
          {{ canContinue ? t('infoBase.lexicalIndex.more') : '' }}
        </p>
        <p v-if="registered && !registered.has(LEXICAL_INDEX_JOB_TYPES[operation])">
          {{ t('infoBase.lexicalIndex.unavailable') }}
        </p>
        <p v-if="submitError === operation" role="alert">
          {{ t('infoBase.lexicalIndex.submitError') }}
        </p>
        <div
          v-if="registered?.has(LEXICAL_INDEX_JOB_TYPES[operation])"
          class="lexical-index__toolbar"
        >
          <InkButton
            v-if="canContinue"
            size="sm"
            :text="t('infoBase.lexicalIndex.continue')"
            :disabled="actionsDisabled"
            @click="submit(operation, true)"
          />
          <InkDoubleCheck
            v-if="operation === 'rebuild'"
            :title="t('infoBase.lexicalIndex.rebuild')"
            :message="t('infoBase.lexicalIndex.rebuildConfirm')"
            :confirm-text="t('infoBase.lexicalIndex.queue')"
            :cancel-text="t('common.cancel')"
            @confirm="submit(operation, false)"
          >
            <InkButton
              size="sm"
              :text="t('infoBase.lexicalIndex.queue')"
              :is-loading="submitting === operation"
              :disabled="actionsDisabled"
            />
          </InkDoubleCheck>
          <InkButton
            v-else
            size="sm"
            :text="t('infoBase.lexicalIndex.queue')"
            :is-loading="submitting === operation"
            :disabled="actionsDisabled"
            @click="submit(operation, false)"
          />
        </div>
      </section>
    </div>
  </details>
</template>

<style lang="scss" scoped>
.lexical-index {
  @include apply-font(body-sm);
  margin-top: sys-var(space, lg);

  summary {
    cursor: pointer;
    width: fit-content;
  }

  p {
    margin: sys-var(space, sm) 0;
  }

  h2 {
    @include apply-font(title-sm);
    margin: 0;
  }

  &__toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: sys-var(space, sm);
  }

  &__jobs {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(15rem, 100%), 1fr));
    gap: sys-var(space, lg);
    margin-top: sys-var(space, md);
  }
}
</style>
