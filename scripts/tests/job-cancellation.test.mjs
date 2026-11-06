import assert from 'node:assert/strict'
import test from 'node:test'
import { Job, JobManager, JobStatus, MetaConfigSchema } from '../../packages/core/dist/index.js'

function pending(id, type, abortRequested) {
  return Job.parse({
    id,
    type,
    parameters: {},
    state: {},
    abort_requested: abortRequested,
    timeout_seconds: 30,
    status: JobStatus.PENDING,
    created_at: new Date(),
    started_at: null,
    closed_at: null,
  })
}

function database(t, job, abortWhenClaimed) {
  const updates = []
  t.mock.method(Job, 'get', async () => job)
  t.mock.method(Job.dbApi, 'update', (fields) => ({
    eq() {
      return this
    },
    select() {
      if (fields.status === JobStatus.RUNNING)
        return {
          maybeSingle: async () => ({
            data: { ...job, status: JobStatus.RUNNING, abort_requested: abortWhenClaimed },
          }),
        }
      updates.push(fields.status)
      return Promise.resolve({ data: [{ id: job.id }] })
    },
  }))
  return updates
}

void test('an already cancelled pending Job closes without asking business eligibility or running', async (t) => {
  const type = `test.cancel.${crypto.randomUUID()}`
  const job = pending(1, type, true)
  const updates = database(t, job, true)
  const canHandle = t.mock.fn(() => false)
  const handle = t.mock.fn(async () => undefined)
  JobManager.registerHandler(type, { parameters: MetaConfigSchema, canHandle, handle })
  try {
    assert.equal(await JobManager.run(job.id), true)
    assert.equal(canHandle.mock.callCount(), 0)
    assert.equal(handle.mock.callCount(), 0)
    assert.deepEqual(updates, [JobStatus.ABORTED])
  } finally {
    JobManager.unregisterHandler(type)
  }
})

void test('a cancellation arriving during atomic claim prevents the handler from starting', async (t) => {
  const type = `test.cancel.${crypto.randomUUID()}`
  const job = pending(2, type, false)
  const updates = database(t, job, true)
  const handle = t.mock.fn(async () => undefined)
  JobManager.registerHandler(type, { parameters: MetaConfigSchema, canHandle: () => true, handle })
  try {
    assert.equal(await JobManager.run(job.id), true)
    assert.equal(handle.mock.callCount(), 0)
    assert.deepEqual(updates, [JobStatus.ABORTED])
  } finally {
    JobManager.unregisterHandler(type)
  }
})

void test('ordinary ineligible work remains pending', async (t) => {
  const type = `test.cancel.${crypto.randomUUID()}`
  const job = pending(3, type, false)
  const updates = database(t, job, false)
  const handle = t.mock.fn(async () => undefined)
  JobManager.registerHandler(type, { parameters: MetaConfigSchema, canHandle: () => false, handle })
  try {
    assert.equal(await JobManager.run(job.id), false)
    assert.equal(handle.mock.callCount(), 0)
    assert.deepEqual(updates, [])
  } finally {
    JobManager.unregisterHandler(type)
  }
})
