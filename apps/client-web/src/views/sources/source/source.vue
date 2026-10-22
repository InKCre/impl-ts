<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'
import {
  RouterLink,
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  useRoute,
  useRouter,
} from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  InkLoading,
  InkSkeleton,
  InkButton,
  InkDialog,
  InkPopup,
  InkDropdown,
  InkInput,
  InkForm,
  InkTabs,
  type JsonEditorValidation,
} from '@inkcre/ui-web'
import SourceForm from '@/components/source/sourceForm/sourceForm.vue'
import SchemaConfigEditor from '@/components/schemaConfigEditor/schemaConfigEditor.vue'
import JobCard from '@/components/job/JobCard/JobCard.vue'
import { humanizeCron } from '@/utils/cron'
import { Cron, CronForm, Job, JobManager, JobStatus, Source } from '@inkcre/core'
import { usePageObjectTitle } from '@/composables/use-page-object-title'

type TabId = 'overview' | 'config' | 'schedules' | 'jobs'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const sourceId = computed(() => Number(route.params.id))
const source = ref<Source | null>(null)
usePageObjectTitle(
  computed(() =>
    source.value?.id === sourceId.value ? source.value.nickname || undefined : undefined
  )
)
const draft = ref<Source | null>(null)
const editor = useTemplateRef('editor')
const sourceLoading = ref(false)
const sourceLoadError = ref(false)
const sourceSaving = ref(false)
const sourceError = ref('')
const sourceSaved = ref(false)
const deleteOpen = ref(false)
const sourceDeleting = ref(false)
const deleteError = ref('')
const jobs = ref<Job[]>([])
const jobsLoading = ref(false)
const jobsError = ref(false)
const crons = ref<Cron[]>([])
const cronsLoading = ref(false)
const cronsError = ref(false)
let sourceRequest = 0
let jobsRequest = 0
let cronsRequest = 0

// Tabs state
const activeTab = ref<TabId>('overview')
const tabs = computed(() => [
  { value: 'overview' as TabId, label: t('source.tab.overview') },
  { value: 'config' as TabId, label: t('source.tab.config') },
  { value: 'schedules' as TabId, label: t('source.tab.schedules') },
  { value: 'jobs' as TabId, label: t('source.tab.jobs') },
])

// Generate unique IDs for ARIA associations
const baseId = `source-tabs-${Math.random().toString(36).substr(2, 9)}`
function getTabId(value: string): string {
  return `${baseId}-tab-${value}`
}

function setTab(tab: string) {
  activeTab.value = tab as TabId
}

// Each region loads independently; late responses must not replace another source's context.
async function loadSource() {
  const request = ++sourceRequest
  sourceLoading.value = true
  sourceLoadError.value = false
  try {
    const loaded = await Source.get(sourceId.value)
    if (request !== sourceRequest) return
    source.value = loaded
    draft.value = Source.parse(loaded)
  } catch {
    if (request === sourceRequest) sourceLoadError.value = true
  } finally {
    if (request === sourceRequest) sourceLoading.value = false
  }
}
async function loadJobs() {
  const request = ++jobsRequest
  jobsLoading.value = true
  jobsError.value = false
  try {
    const loaded = await Job.getBySource(sourceId.value)
    if (request === jobsRequest) jobs.value = loaded
  } catch {
    if (request === jobsRequest) jobsError.value = true
  } finally {
    if (request === jobsRequest) jobsLoading.value = false
  }
}
async function loadCrons() {
  const request = ++cronsRequest
  cronsLoading.value = true
  cronsError.value = false
  try {
    const loaded = await Cron.getBySource(sourceId.value)
    if (request === cronsRequest) crons.value = loaded
  } catch {
    if (request === cronsRequest) cronsError.value = true
  } finally {
    if (request === cronsRequest) cronsLoading.value = false
  }
}

watch(
  sourceId,
  () => {
    void loadSource()
    void loadJobs()
    void loadCrons()
  },
  { immediate: true }
)

const busy = computed(
  () =>
    sourceLoading.value ||
    sourceSaving.value ||
    sourceDeleting.value ||
    jobsLoading.value ||
    cronsLoading.value ||
    jobSaving.value ||
    cronSaving.value ||
    Boolean(jobAction.value) ||
    Boolean(cronAction.value)
)

// Create/edit state
const jobKind = ref<'ordinary' | 'backfill'>('ordinary')
const jobConfig = ref('{}')
const jobValidation = ref<JsonEditorValidation>()
const jobError = ref('')
const jobSaving = ref(false)
const jobAction = ref<{ id: number; kind: 'run' | 'delete' } | null>(null)
const newJobOpen = ref(false)
const canCreateJob = computed(
  () => jobConfig.value.trim() !== '' && (!jobValidation.value || jobValidation.value.valid)
)
const cronSchedule = ref('0 * * * *')
const cronCreateError = ref('')
const cronSaving = ref(false)
const cronAction = ref<{ id: number; kind: 'run' | 'delete' } | null>(null)
const newCronOpen = ref(false)
const cronToDelete = ref<Cron | null>(null)
const cronError = ref('')

// Derived values for display
const sourceTypeFull = computed(() => source.value?.type || '')

// Overview tab data
const lastJob = computed(() => {
  if (!jobs.value.length) return null
  return jobs.value[0]
})

const lastJobStatus = computed(() => {
  if (!lastJob.value) return null
  return lastJob.value.status
})

const lastJobTime = computed(() => {
  if (!lastJob.value) return null
  return lastJob.value.created_at
})

const runningJob = computed(() =>
  jobs.value.find((job) => job.status === JobStatus.PENDING || job.status === JobStatus.RUNNING)
)

const cronCount = computed(() => crons.value.length)
const enabledCronCount = computed(() => crons.value.filter((c) => c.enabled).length)
const jobCount = computed(() => jobs.value.length)

function canLeave(): boolean {
  const dirty =
    Boolean(draft.value && editor.value?.isDirty) ||
    (newJobOpen.value && jobConfig.value !== '{}') ||
    (newCronOpen.value && cronSchedule.value !== '0 * * * *')
  return !busy.value && (!dirty || window.confirm(t('source.discardChanges')))
}
onBeforeRouteLeave(canLeave)
onBeforeRouteUpdate((to) => to.params.id === route.params.id || canLeave())

async function onSaveSource() {
  if (busy.value || !draft.value || !editor.value) return
  if (!editor.value.canSave) return
  sourceSaving.value = true
  sourceError.value = ''
  sourceSaved.value = false
  try {
    const saved = await draft.value.save()
    if (source.value) source.value = Source.parse(saved)
    draft.value = Source.parse(saved)
    sourceSaved.value = true
  } catch {
    sourceError.value = t('source.saveFailed')
  } finally {
    sourceSaving.value = false
  }
}
function onRequestDeleteSource() {
  if (busy.value) return
  deleteError.value = ''
  deleteOpen.value = true
}
async function onDeleteSource() {
  if (busy.value || !source.value) return
  sourceDeleting.value = true
  deleteError.value = ''
  try {
    await source.value.delete()
  } catch {
    deleteError.value = t('source.deleteFailed')
    return
  } finally {
    sourceDeleting.value = false
  }
  deleteOpen.value = false
  draft.value = null
  await router.push('/sources')
}
function onNewJob() {
  jobKind.value = 'ordinary'
  jobConfig.value = '{}'
  jobValidation.value = undefined
  jobError.value = ''
  newJobOpen.value = true
}
function onCloseJob() {
  if (jobSaving.value) return
  if (jobConfig.value !== '{}' && !window.confirm(t('source.discardChanges'))) return
  newJobOpen.value = false
}
async function onCreateJob() {
  if (busy.value || !canCreateJob.value) return
  jobSaving.value = true
  jobError.value = ''
  let created: Job
  try {
    created = await JobManager.create(
      jobKind.value === 'ordinary' ? 'core.source.collect.v1' : 'core.source.backfill.v1',
      { source: sourceId.value, config: JSON.parse(jobConfig.value) }
    )
    jobs.value = [created, ...jobs.value]
    newJobOpen.value = false
  } catch {
    jobError.value = t('source.runFailed')
    return
  } finally {
    jobSaving.value = false
  }
  await router.push(`/jobs/${created.id}`)
}
function onNewCron() {
  cronSchedule.value = '0 * * * *'
  cronCreateError.value = ''
  newCronOpen.value = true
}
function onCloseCron() {
  if (cronSaving.value) return
  if (cronSchedule.value !== '0 * * * *' && !window.confirm(t('source.discardChanges'))) return
  newCronOpen.value = false
}
async function onCreateCron() {
  if (busy.value) return
  cronSaving.value = true
  cronCreateError.value = ''
  try {
    const created = await new CronForm({
      schedule: cronSchedule.value,
      enabled: true,
      job_type: 'core.source.collect.v1',
      job_parameters: { source: sourceId.value },
      job_timeout_seconds: null,
    }).create()
    crons.value = [...crons.value, created]
    newCronOpen.value = false
  } catch {
    cronCreateError.value = t('source.scheduleFailed')
  } finally {
    cronSaving.value = false
  }
}
async function onRunCron(cron: Cron) {
  if (busy.value) return
  cronAction.value = { id: cron.id, kind: 'run' }
  cronError.value = ''
  try {
    await cron.runNow()
  } catch {
    cronError.value = t('source.runFailed')
  } finally {
    cronAction.value = null
  }
}
function onRequestDeleteCron(cron: Cron) {
  if (busy.value) return
  cronError.value = ''
  cronToDelete.value = cron
}
async function onDeleteCron() {
  if (busy.value || !cronToDelete.value) return
  const cron = cronToDelete.value
  cronAction.value = { id: cron.id, kind: 'delete' }
  try {
    await cron.delete()
    crons.value = crons.value.filter((item) => item.id !== cron.id)
    cronToDelete.value = null
  } catch {
    cronError.value = t('source.deleteFailed')
  } finally {
    cronAction.value = null
  }
}
</script>

<template>
  <main class="source-view">
    <nav :aria-label="t('common.back')">
      <RouterLink :to="{ path: '/sources', hash: `#source-${sourceId}` }" class="source-view__back">
        <span aria-hidden="true">←</span> {{ t('source.backToSources') }}
      </RouterLink>
    </nav>
    <div
      v-if="sourceLoading"
      class="source-view__skeleton"
      role="status"
      :aria-label="t('common.loading')"
    >
      <InkSkeleton style="width: 40%; height: 1.5rem" /><InkSkeleton style="width: 65%" />
    </div>
    <div v-else-if="sourceLoadError" class="source-view__feedback">
      <p role="alert" class="text-feedback-error">{{ t('source.detailFailed') }}</p>
      <InkButton :text="t('source.retry')" theme="subtle" @click="loadSource" />
    </div>
    <template v-else-if="source && draft">
      <header class="source-view__header">
        <h1>{{ source.nickname || t('source.unnamed') }}</h1>
        <div class="source-view__metadata">
          <code class="source-view__type">{{ sourceTypeFull }}</code>
          <span class="source-view__id">#{{ source.id }}</span>
        </div>
      </header>

      <!-- Tabs Navigation -->
      <InkTabs
        ref="tabsRef"
        v-model="activeTab"
        :tabs="tabs"
        :label="t('source.tab.overview')"
        class="source-view__tabs"
        @update:model-value="setTab"
      />

      <!-- Tab Content -->
      <div class="source-view__tab-content">
        <!-- Overview Tab -->
        <section
          v-if="activeTab === 'overview'"
          class="source-view__tab-panel"
          role="tabpanel"
          :aria-labelledby="getTabId('overview')"
        >
          <div class="source-view__overview-grid">
            <div class="source-view__overview-card">
              <h3>{{ t('source.info') }}</h3>
              <dl class="source-view__overview-list">
                <div>
                  <dt>{{ t('source.nickname') }}</dt>
                  <dd>{{ source.nickname || t('source.unnamed') }}</dd>
                </div>
                <div>
                  <dt>{{ t('source.type') }}</dt>
                  <dd>
                    <code>{{ sourceTypeFull }}</code>
                  </dd>
                </div>
                <div>
                  <dt>{{ t('source.id') }}</dt>
                  <dd>#{{ source.id }}</dd>
                </div>
                <div>
                  <dt>{{ t('source.created') }}</dt>
                  <dd>{{ source.created_at?.toLocaleString() }}</dd>
                </div>
                <div>
                  <dt>{{ t('source.updated') }}</dt>
                  <dd>{{ source.updated_at?.toLocaleString() }}</dd>
                </div>
              </dl>
            </div>

            <div class="source-view__overview-card">
              <h3>{{ t('source.lastRun') }}</h3>
              <div v-if="lastJob" class="source-view__last-job">
                <div class="source-view__last-job-status">
                  <span
                    class="source-view__status-dot"
                    :class="`source-view__status-dot--${lastJobStatus?.toLowerCase()}`"
                  />
                  <span>{{ lastJobStatus }}</span>
                </div>
                <div class="source-view__last-job-time">{{ lastJobTime?.toLocaleString() }}</div>
                <RouterLink :to="`/jobs/${lastJob.id}`" class="source-view__last-job-link">
                  {{ t('source.view') }} →
                </RouterLink>
              </div>
              <p v-else class="source-view__no-data">{{ t('source.noJobs') }}</p>
            </div>

            <div class="source-view__overview-card">
              <h3>{{ t('source.tab.schedules') }}</h3>
              <div class="source-view__stat-row">
                <span class="source-view__stat-value">{{ cronCount }}</span>
                <span class="source-view__stat-label">{{ t('source.schedules') }}</span>
              </div>
              <div class="source-view__stat-row">
                <span class="source-view__stat-value">{{ enabledCronCount }}</span>
                <span class="source-view__stat-label">{{ t('source.enabled') }}</span>
              </div>
              <div v-if="crons.length" class="source-view__cron-preview">
                <code>{{ crons[0].schedule }}</code>
                <span>({{ t(`source.cronHuman.${humanizeCron(crons[0].schedule)}`) }})</span>
              </div>
            </div>

            <div class="source-view__overview-card">
              <h3>{{ t('source.tab.jobs') }}</h3>
              <div class="source-view__stat-row">
                <span class="source-view__stat-value">{{ jobCount }}</span>
                <span class="source-view__stat-label">{{ t('source.jobs') }}</span>
              </div>
              <div v-if="runningJob" class="source-view__running-job">
                <span class="source-view__status-dot source-view__status-dot--running" />
                <span>{{ t('source.checkOpenJob') }}</span>
                <RouterLink :to="`/jobs/${runningJob.id}`">{{ t('source.view') }}</RouterLink>
              </div>
            </div>
          </div>
        </section>

        <!-- Config Tab -->
        <section v-if="activeTab === 'config'" class="source-view__tab-panel" role="tabpanel" :aria-labelledby="getTabId('config')">
          <div class="source-view__config-section">
            <h2>{{ t('source.editConfig') }}</h2>
            <SourceForm ref="editor" :model-value="draft" :disabled="busy" @submit="onSaveSource">
              <p v-if="sourceError" role="alert" class="text-feedback-error">{{ sourceError }}</p>
              <p v-else-if="sourceSaved && !editor?.isDirty" role="status">{{ t('source.saved') }}</p>
              <div class="source-view__actions">
                <InkButton
                  :text="t('source.delete')"
                  theme="danger"
                  size="sm"
                  :disabled="busy"
                  @click="onRequestDeleteSource"
                />
                <InkButton
                  :text="t('common.save')"
                  theme="primary"
                  native-type="submit"
                  :is-loading="sourceSaving"
                  :disabled="!editor?.canSave || !editor?.isDirty || (busy && !sourceSaving)"
                />
              </div>
            </SourceForm>
          </div>
        </section>

        <!-- Schedules Tab -->
        <section v-if="activeTab === 'schedules'" class="source-view__tab-panel" role="tabpanel" :aria-labelledby="getTabId('schedules')">
          <div class="source-view__schedules-section">
            <div class="source-view__section-header">
              <h2>{{ t('source.schedules') }}</h2>
              <InkButton
                :text="t('source.addSchedule')"
                theme="subtle"
                size="sm"
                :disabled="busy"
                @click="onNewCron"
              />
            </div>
            <InkLoading
              v-if="cronsLoading"
              variant="spinner"
              size="xs"
              :label="t('common.loading')"
            />
            <div v-else-if="cronsError" class="source-view__feedback">
              <p role="alert" class="text-feedback-error">{{ t('source.schedulesFailed') }}</p>
              <InkButton :text="t('source.retry')" theme="subtle" size="sm" @click="loadCrons" />
            </div>
            <p v-else-if="!crons.length">{{ t('source.noSchedules') }}</p>
            <div v-else class="source-view__cron-list">
              <div v-for="cron in crons" :key="cron.id" class="source-view__cron-item">
                <div class="source-view__cron-info">
                  <code>{{ cron.schedule }}</code>
                  <span class="source-view__cron-human">{{
                    t(`source.cronHuman.${humanizeCron(cron.schedule)}`)
                  }}</span>
                </div>
                <span
                  class="source-view__cron-status"
                  :class="{ 'source-view__cron-status--enabled': cron.enabled }"
                >
                  {{ t(cron.enabled ? 'source.enabled' : 'source.disabled') }}
                </span>
                <div class="source-view__cron-actions">
                  <InkButton
                    :text="t('source.runNow')"
                    theme="subtle"
                    size="sm"
                    :is-loading="cronAction?.id === cron.id && cronAction.kind === 'run'"
                    :disabled="busy && cronAction?.id !== cron.id"
                    @click="onRunCron(cron)"
                  />
                  <InkButton
                    :text="t('source.delete')"
                    theme="subtle"
                    size="sm"
                    :disabled="busy"
                    @click="onRequestDeleteCron(cron)"
                  />
                </div>
              </div>
            </div>
            <p v-if="cronError && !cronToDelete" role="alert" class="text-feedback-error">
              {{ cronError }}
            </p>
          </div>
        </section>

        <!-- Jobs Tab -->
        <section v-if="activeTab === 'jobs'" class="source-view__tab-panel" role="tabpanel" :aria-labelledby="getTabId('jobs')">
          <div class="source-view__jobs-section">
            <div class="source-view__section-header">
              <h2>{{ t('source.jobs') }}</h2>
              <InkButton
                :text="t('source.newJob')"
                theme="subtle"
                size="sm"
                :disabled="busy || !sourceTypeFull"
                @click="onNewJob"
              />
            </div>
            <InkLoading
              v-if="jobsLoading"
              variant="spinner"
              size="xs"
              :label="t('source.jobsLoading')"
            />
            <div v-else-if="jobsError" class="source-view__feedback">
              <p role="alert" class="text-feedback-error">{{ t('source.jobsFailed') }}</p>
              <InkButton :text="t('source.retry')" theme="subtle" size="sm" @click="loadJobs" />
            </div>
            <p v-else-if="!jobs.length">{{ t('source.noJobs') }}</p>
            <div v-else class="source-view__job-list">
              <RouterLink
                v-for="job in jobs"
                :key="job.id"
                :to="`/jobs/${job.id}`"
                class="source-view__job-link"
                ><JobCard :job="job"
              /></RouterLink>
            </div>
          </div>
        </section>
      </div>
    </template>

    <!-- Dialogs and Popups -->
    <InkDialog
      v-model="deleteOpen"
      :title="t('source.deleteConfirmTitle')"
      :confirm-text="t('source.delete')"
      :cancel-text="t('common.cancel')"
      :is-loading="sourceDeleting"
      @confirm="onDeleteSource"
    >
      <p>{{ t('source.deleteConfirmMessage') }}</p>
      <p v-if="deleteError" role="alert" class="text-feedback-error">{{ deleteError }}</p>
    </InkDialog>

    <InkPopup v-model:open="newJobOpen" :title="t('source.newJobTitle')" @close="onCloseJob">
      <InkForm @submit="onCreateJob">
        <p class="source-view__popup-description">{{ t('source.newJobDescription') }}</p>
        <InkDropdown
          v-model="jobKind"
          :label="t('source.collectionIntent')"
          :options="[
            { value: 'ordinary', label: t('source.ordinary') },
            { value: 'backfill', label: t('source.backfill') },
          ]"
        />
        <SchemaConfigEditor
          v-model="jobConfig"
          :label="t('source.config')"
          @validation="jobValidation = $event"
        />
        <p v-if="jobError" role="alert" class="text-feedback-error">{{ jobError }}</p>
        <div class="source-view__popup-actions">
          <InkButton :text="t('common.cancel')" theme="subtle" @click="onCloseJob" />
          <InkButton
            :text="t('source.createJob')"
            theme="primary"
            native-type="submit"
            :is-loading="jobSaving"
            :disabled="!canCreateJob || busy"
          />
        </div>
      </InkForm>
    </InkPopup>

    <InkPopup v-model:open="newCronOpen" :title="t('source.addSchedule')" @close="onCloseCron">
      <InkForm @submit="onCreateCron">
        <InkInput
          v-model="cronSchedule"
          :label="t('source.cronSchedule')"
          placeholder="0 * * * *"
        />
        <p v-if="cronCreateError" role="alert" class="text-feedback-error">{{ cronCreateError }}</p>
        <div class="source-view__popup-actions">
          <InkButton :text="t('common.cancel')" theme="subtle" @click="onCloseCron" />
          <InkButton
            :text="t('source.addSchedule')"
            theme="primary"
            native-type="submit"
            :is-loading="cronSaving"
            :disabled="busy"
          />
        </div>
      </InkForm>
    </InkPopup>

    <InkDialog
      :model-value="cronToDelete !== null"
      :title="t('source.deleteSchedule')"
      :confirm-text="t('source.delete')"
      :cancel-text="t('common.cancel')"
      @confirm="onDeleteCron"
      @update:model-value="cronToDelete = null"
    >
      <p>{{ t('source.deleteScheduleMessage') }}</p>
      <p v-if="cronError" role="alert" class="text-feedback-error">{{ cronError }}</p>
    </InkDialog>
  </main>
</template>

<style lang="scss" scoped src="./source.scss" />
