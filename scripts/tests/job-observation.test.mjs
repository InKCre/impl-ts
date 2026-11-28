import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { configStore, flushTelemetry } from '../../packages/core/dist/index.js'
import { defaultObservationWindow } from '../../apps/web/src/components/obsrv/ObservationExplorer/ObservationExplorer.ts'
import { useJobCreator } from '../../apps/web/src/views/sources/source/use-job-creator.ts'

const appRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url))
const { computed, createSSRApp, ref } = await import(pathToFileURL(appRequire.resolve('vue')))
const { createI18n } = await import(pathToFileURL(appRequire.resolve('vue-i18n')))
const { renderToString } = await import(pathToFileURL(appRequire.resolve('vue/server-renderer')))
const messages = JSON.parse(
  await readFile(new URL('../../apps/web/src/locales/messages/en.json', import.meta.url), 'utf8')
)
const now = Date.parse('2026-11-05T12:00:00Z')

void test('the default historical Job window includes early submission and late closure records', () => {
  const window = defaultObservationWindow(
    now,
    1,
    '2025-10-01T10:00:00.082Z',
    '2025-10-01T10:00:02Z'
  )
  const since = Date.parse(window.since)
  const until = Date.parse(window.until)
  assert.ok(since <= Date.parse('2025-10-01T10:00:00Z'))
  assert.ok(until > Date.parse('2025-10-01T10:00:02.052Z'))
  assert.ok(until - since <= 31 * 86400 * 1000)
  assert.ok(until < now - 31 * 86400 * 1000)
  assert.equal(window.limited, false)
})

void test('a long Job opens on its latest 31 days of records', () => {
  for (const [end, latestEvent] of [
    ['2025-12-01T10:00:02Z', '2025-12-01T10:00:02.052Z'],
    [undefined, '2026-11-05T11:30:00Z'],
  ]) {
    const window = defaultObservationWindow(now, 1, '2025-10-01T10:00:00.082Z', end)
    const since = Date.parse(window.since)
    const until = Date.parse(window.until)
    assert.equal(window.limited, true)
    assert.equal(until - since, 31 * 86400 * 1000)
    assert.ok(since <= Date.parse(latestEvent) && Date.parse(latestEvent) < until)
  }
})

void test('successful Job submission clears the draft despite diagnostic failure, while rejected submission keeps it', async (context) => {
  const priorMeta = { ...configStore.metaConfig }
  const priorWindow = globalThis.window
  let rejectSubmission = false
  let writes = 0
  let diagnosticWrites = 0
  let confirmations = 0
  let discard = false
  let navigatedJob = null
  const jobs = ref([])
  const transport = async (input, init) => {
    const url = new URL(input)
    if (url.pathname === '/configs') return Response.json(null)
    if (url.pathname === '/logs') {
      if (init.method === 'POST') {
        diagnosticWrites++
        throw new Error('Submitting Peer exited before diagnostics reached storage')
      }
      return Response.json([])
    }
    if (url.pathname === '/job_types')
      return Response.json({
        id: 'core.source.backfill.v1',
        description: 'Fixture',
        parameters_schema: {},
        default_timeout_seconds: 30,
      })
    assert.equal(url.pathname, '/jobs')
    assert.equal(init.method, 'POST')
    if (rejectSubmission) return Response.json({ message: 'Unavailable' }, { status: 503 })
    writes++
    return Response.json({
      ...JSON.parse(init.body),
      id: 13,
      status: 'pending',
      abort_requested: false,
      created_at: '2026-11-05T12:00:00.082Z',
      started_at: null,
      closed_at: null,
    })
  }
  context.mock.method(globalThis, 'fetch', transport)
  context.mock.method(console, 'warn', () => {})
  globalThis.window = {
    confirm: () => {
      confirmations++
      return discard
    },
  }
  Object.assign(configStore.metaConfig, {
    INKCRE_PGREST_URL: 'https://submission.example',
    INKCRE_JWT_SECRET: 'fixture-only-secret',
    telemetry_enabled: false,
  })
  let form
  const app = createSSRApp({
    setup() {
      form = useJobCreator({
        sourceId: computed(() => 4),
        jobs,
        isBusy: () => false,
        onCreated: (job) => {
          navigatedJob = job.id
        },
      })
      return () => null
    },
  })
  app.use(createI18n({ legacy: false, locale: 'en', messages: { en: messages } }))
  try {
    await renderToString(app)
    form.onNewJob()
    form.jobKind.value = 'backfill'
    form.jobConfig.value = '{"limit":20}'
    await form.onCreateJob()
    form.onCloseJob() // The native dialog close event can arrive after saving finishes.
    assert.equal(form.newJobOpen.value, false)
    assert.equal(form.jobConfig.value, '{}')
    assert.equal(form.jobError.value, '')
    assert.equal(confirmations, 0)
    assert.equal(navigatedJob, 13)
    assert.equal(jobs.value[0].id, 13)
    assert.deepEqual(jobs.value[0].parameters, { source: 4, config: { limit: 20 } })
    assert.equal(jobs.value[0].created_at.toISOString(), '2026-11-05T12:00:00.082Z')
    assert.equal(writes, 1)
    await flushTelemetry()
    assert.ok(diagnosticWrites > 0)

    form.onNewJob()
    form.jobConfig.value = '{"limit":40}'
    rejectSubmission = true
    await form.onCreateJob()
    assert.equal(form.newJobOpen.value, true)
    assert.equal(form.jobConfig.value, '{"limit":40}')
    assert.equal(form.jobError.value, messages.source.runFailed)
    assert.equal(form.jobSaving.value, false)
    form.onCloseJob()
    assert.equal(form.newJobOpen.value, true)
    assert.equal(form.jobConfig.value, '{"limit":40}')
    assert.equal(confirmations, 1)
    discard = true
    form.onCloseJob()
    form.onCloseJob()
    assert.equal(form.newJobOpen.value, false)
    assert.equal(confirmations, 2)
    assert.equal(writes, 1)
  } finally {
    await flushTelemetry()
    Object.assign(configStore.metaConfig, priorMeta)
    if (priorWindow === undefined) delete globalThis.window
    else globalThis.window = priorWindow
  }
})
