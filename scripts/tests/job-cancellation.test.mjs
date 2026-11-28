import assert from 'node:assert/strict'
import test from 'node:test'
import {
  configStore,
  shutdownTelemetry,
  JobManager,
  MetaConfigSchema,
} from '../../packages/core/dist/index.js'

for (const scenario of [
  {
    name: 'an already cancelled pending Job closes without asking business eligibility',
    cancelled: true,
    eligible: false,
    handled: true,
    updates: ['running', 'aborted'],
  },
  {
    name: 'a cancellation arriving during claim prevents the handler from starting',
    onClaim: { abort_requested: true },
    eligible: true,
    handled: true,
    updates: ['running', 'aborted'],
  },
  {
    name: 'ordinary ineligible work remains pending',
    eligible: false,
    handled: false,
    updates: [],
  },
  {
    name: 'work claimed by another Peer never starts or closes locally',
    onClaim: { status: 'running' },
    eligible: true,
    handled: false,
    updates: ['running'],
  },
  {
    name: 'a terminal write that matches no row does not report success',
    cancelled: true,
    eligible: false,
    onClose: { status: 'timed_out' },
    closeConflict: true,
    updates: ['running', 'aborted'],
  },
]) {
  void test(scenario.name, async (t) => {
    const prior = { ...configStore.metaConfig }
    const job = {
      id: 81,
      type: 'test.cancellation',
      parameters: {},
      state: {},
      abort_requested: scenario.cancelled ?? false,
      timeout_seconds: 30,
      status: 'pending',
      created_at: '2026-10-01T00:00:00Z',
      started_at: null,
      closed_at: null,
    }
    const updates = []
    t.mock.method(globalThis, 'fetch', async (input, init) => {
      const url = new URL(input)
      if (url.pathname === '/configs') return Response.json(null)
      if (url.pathname === '/logs') return new Response(null, { status: 201 })
      assert.equal(url.pathname, '/jobs')
      if (init.method === 'GET') return Response.json([job])
      const fields = JSON.parse(init.body)
      if (fields.status === 'running') Object.assign(job, scenario.onClaim)
      else Object.assign(job, scenario.onClose)
      const id = url.searchParams.get('id')
      const status = url.searchParams.get('status')
      updates.push({ method: init.method, id, status, next: fields.status })
      if (status && status !== 'eq.' + job.status) return Response.json([])
      Object.assign(job, fields)
      return Response.json([job])
    })
    Object.assign(configStore.metaConfig, {
      INKCRE_PGREST_URL: 'https://jobs.example',
      INKCRE_JWT_SECRET: 'job-cancellation-fixture',
      telemetry_enabled: false,
    })
    const canHandle = t.mock.fn(() => scenario.eligible)
    const handle = t.mock.fn(async () => {})
    JobManager.registerHandler(job.type, { parameters: MetaConfigSchema, canHandle, handle })
    try {
      if (scenario.closeConflict) {
        await assert.rejects(JobManager.run(job.id), /Job 81 no longer matches a running row/)
        assert.equal(job.status, 'timed_out')
      } else {
        assert.equal(await JobManager.run(job.id), scenario.handled)
      }
      assert.equal(canHandle.mock.callCount(), scenario.cancelled ? 0 : 1)
      assert.equal(handle.mock.callCount(), 0)
      assert.deepEqual(
        updates,
        scenario.updates.map((next) => ({
          method: 'PATCH',
          id: 'eq.81',
          status: next === 'running' ? 'eq.pending' : 'eq.running',
          next,
        }))
      )
    } finally {
      JobManager.unregisterHandler(job.type)
      await shutdownTelemetry()
      Object.assign(configStore.metaConfig, prior)
    }
  })
}
