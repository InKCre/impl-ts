import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ObservabilityClient,
  ObservabilityUnavailableError,
} from '../../packages/core/dist/sdk/sdk.js'

const range = { since: '2026-11-04T00:00:00Z', until: '2026-11-04T23:59:59Z' }
const record = {
  id: 'observation-1',
  timestamp: '2026-11-04T10:00:00Z',
  kind: 'event',
  event_name: 'job.closed',
  severity_number: 9,
  severity_text: 'INFO',
  body: 'job.closed',
  trace_id: 'job.8',
  span_id: null,
  attributes: { 'inkcre.job.id': 8 },
}
const selector = { schema: 'inkcre.observability.backend.v1', value: { backend: 'loki' } }
const peer = {
  id: '00000000-0000-4000-8000-000000000001',
  capabilities: [
    {
      id: 'core.observability.v1',
      inbound: {
        protocol: 'core.peer.protocol.http.v1',
        parameters: { method: 'POST', url: 'https://peer.example/observability' },
      },
    },
  ],
}

void test('default database query is bounded, preserves legacy records and captures connection', async () => {
  const calls = []
  const connection = {
    baseUrl: 'https://a.example',
    tokenProvider: async () => 'token-a',
    fetch: async (input, init) => {
      const url = new URL(input)
      calls.push({ url, headers: new Headers(init.headers) })
      if (url.pathname === '/configs') return Response.json(null)
      return Response.json([
        {
          ...record,
          id: 7,
          kind: undefined,
          event_name: undefined,
          body: 'x'.repeat(8193),
          attributes: { job_id: '8', legacy: { nested: ['metadata'] } },
        },
        { ...record, id: 8 },
      ])
    },
  }
  const client = new ObservabilityClient(connection)
  connection.baseUrl = 'https://b.example'
  connection.tokenProvider = async () => 'token-b'
  const result = await client.query({
    ...range,
    limit: 1,
    job_id: 8,
    kind: 'log',
    text: 'literal.*(x)',
    severity_min: 9,
  })
  assert.equal(result.backend, 'postgresql')
  assert.equal(result.records[0].id, 'pg.7')
  assert.equal(result.records[0].kind, 'log')
  assert.equal(result.records[0].body.length, 8193)
  assert.deepEqual(result.records[0].attributes.legacy, { nested: ['metadata'] })
  assert.equal(result.truncated, true)
  const logCall = calls[1]
  assert.equal(logCall.url.origin, 'https://a.example')
  assert.equal(logCall.headers.get('Authorization'), 'Bearer token-a')
  assert.equal(logCall.url.searchParams.get('limit'), '2')
  assert.equal(logCall.url.searchParams.get('body'), 'imatch.literal\\.\\*\\(x\\)')
  assert.equal(logCall.url.searchParams.get('severity_number'), 'gte.9')
  assert.deepEqual(logCall.url.searchParams.getAll('timestamp'), [
    `gte.${range.since}`,
    `lt.${range.until}`,
  ])
  assert.ok(
    logCall.url.searchParams
      .getAll('or')
      .some((value) => value.includes('attributes->>"inkcre.record.kind"'))
  )
  assert.ok(
    logCall.url.searchParams
      .getAll('or')
      .includes('(trace_id.eq.job.8,attributes->>"inkcre.job.id".eq.8,attributes->>job_id.eq.8)')
  )
})

void test('selected external backend delegates query and writes using Peer authority, never database logs', async () => {
  const calls = []
  const client = new ObservabilityClient({
    baseUrl: 'https://db.example',
    tokenProvider: async () => 'peer-token',
    fetch: async (input, init) => {
      const url = new URL(input)
      calls.push(url)
      if (url.pathname === '/configs') return Response.json(selector)
      if (url.pathname === '/peers') return Response.json([peer])
      assert.equal(url.href, 'https://peer.example/observability')
      assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer peer-token')
      assert.equal(init.redirect, 'error')
      const body = JSON.parse(init.body)
      if (body.action === 'ingest') {
        assert.deepEqual(body.records, [record])
        return Response.json({ accepted: 1, dropped: 0 })
      }
      if (body.action === 'status')
        return Response.json({
          backend: 'loki',
          configured: true,
          recording: true,
          queryable: true,
          scope: 'selected_backend',
          history: 'Previous backend data remains there.',
          dropped: null,
          error: null,
        })
      return Response.json({ ...range, records: [record], truncated: false, backend: 'loki' })
    },
  })
  assert.deepEqual((await client.query(range)).records, [record])
  assert.equal((await client.status()).dropped, null)
  await client.emit(record)
  assert.ok(calls.every((url) => url.pathname !== '/logs'))
})

void test('unknown selection, missing capability, external failure and backend disagreement never fall back', async () => {
  for (const failure of ['selection', 'capability', 'request', 'mismatch']) {
    let queriedDatabase = false
    const client = new ObservabilityClient({
      baseUrl: 'https://db.example',
      tokenProvider: async () => 'token',
      fetch: async (input) => {
        const url = new URL(input)
        if (url.pathname === '/configs')
          return Response.json(
            failure === 'selection' ? { schema: 'future.v2', value: {} } : selector
          )
        if (url.pathname === '/peers') return Response.json(failure === 'capability' ? [] : [peer])
        if (url.pathname === '/logs') {
          queriedDatabase = true
          return Response.json([])
        }
        return failure === 'request'
          ? new Response('unavailable', { status: 503 })
          : Response.json({ ...range, records: [], truncated: false, backend: 'postgresql' })
      },
    })
    await assert.rejects(client.query(range), ObservabilityUnavailableError)
    assert.equal(queriedDatabase, false)
  }
})

void test('database ingestion preserves portable identity, kind and event metadata', async () => {
  let stored
  const client = new ObservabilityClient({
    baseUrl: 'https://db.example',
    tokenProvider: async () => 'token',
    fetch: async (input, init) => {
      if (new URL(input).pathname === '/configs') return Response.json(null)
      stored = JSON.parse(init.body)
      return new Response(null, { status: 201 })
    },
  })
  await client.emit(record)
  assert.equal(stored.attributes['inkcre.record.id'], record.id)
  assert.equal(stored.attributes['inkcre.record.kind'], 'event')
  assert.equal(stored.attributes['inkcre.event.name'], 'job.closed')
  assert.equal(stored.id, undefined)
  await assert.rejects(client.emit({ ...record, body: 'x'.repeat(8193) }))
  for (const [key, length] of [
    ['event_name', 128],
    ['severity_text', 32],
    ['trace_id', 128],
    ['span_id', 128],
  ])
    await assert.rejects(client.emit({ ...record, [key]: 'x'.repeat(length + 1) }))
  await assert.rejects(client.emit({ ...record, attributes: { nested: { value: 1 } } }))
  await assert.rejects(client.emit({ ...record, attributes: { large: 'x'.repeat(1025) } }))
  await assert.rejects(client.emit({ ...record, attributes: { large: Array(33).fill(1) } }))
  assert.equal(stored.body, record.body)
  await assert.rejects(client.query({ ...range, until: range.since }))
  await assert.rejects(client.query({ ...range, limit: 501 }))
})

void test('an initialized instance keeps its selected backend until a new instance is created', async () => {
  let selected = null
  let reads = 0
  const connection = {
    baseUrl: 'https://db.example',
    tokenProvider: async () => 'token',
    fetch: async (input) => {
      const url = new URL(input)
      if (url.pathname === '/configs') {
        reads++
        return Response.json(selected)
      }
      if (url.pathname === '/logs') return Response.json([])
      if (url.pathname === '/peers') return Response.json([])
      throw new Error('Unexpected call')
    },
  }
  const old = new ObservabilityClient(connection)
  await old.prepare()
  selected = selector
  assert.equal((await old.query(range)).backend, 'postgresql')
  assert.equal(reads, 1)
  await assert.rejects(
    new ObservabilityClient(connection).query(range),
    ObservabilityUnavailableError
  )
  await assert.rejects(old.query({ since: '2026-01-01T00:00:00Z', until: '2026-11-01T00:00:00Z' }))
})

void test('a not-ready Peer is skipped before dispatch and writes carry atomic backend expectation', async () => {
  const stale = {
    ...peer,
    id: '00000000-0000-4000-8000-000000000000',
    capabilities: [
      {
        ...peer.capabilities[0],
        inbound: {
          ...peer.capabilities[0].inbound,
          parameters: { method: 'POST', url: 'https://stale.example/observability' },
        },
      },
    ],
  }
  let stored = false
  const client = new ObservabilityClient({
    baseUrl: 'https://db.example',
    tokenProvider: async () => 'token',
    fetch: async (input, init) => {
      const url = new URL(input)
      if (url.pathname === '/configs') return Response.json(selector)
      if (url.pathname === '/peers') return Response.json([stale, peer])
      const body = JSON.parse(init.body)
      if (body.action === 'status')
        return Response.json({
          backend: 'loki',
          configured: url.hostname !== 'stale.example',
          recording: url.hostname !== 'stale.example',
          queryable: url.hostname !== 'stale.example',
          scope: 'selected_backend',
          history: '',
          dropped: null,
          error: null,
        })
      assert.equal(url.hostname, 'peer.example')
      assert.equal(body.expected_backend, 'loki')
      stored = true
      return Response.json({ accepted: 1, dropped: 0 })
    },
  })
  await client.emit(record)
  assert.equal(stored, true)
})

void test('Job lifecycle and terminal severities are recorded without optional OTEL or raw content', async () => {
  const { JobManager, configStore, flushTelemetry } =
    await import('../../packages/core/dist/index.js')
  const originalFetch = globalThis.fetch
  const priorMeta = { ...configStore.metaConfig }
  const dbJob = {
    id: 8,
    type: 'test.observation',
    parameters: { private_input: 'must-not-be-recorded' },
    state: {},
    abort_requested: false,
    timeout_seconds: 30,
    status: 'pending',
    created_at: range.since,
    started_at: null,
    closed_at: null,
  }
  const records = []
  let configReads = 0
  let outcome = 'finished'
  globalThis.fetch = async (input, init) => {
    const url = new URL(input)
    if (url.pathname === '/configs') {
      configReads++
      return Response.json(null)
    }
    if (url.pathname === '/logs') {
      records.push(JSON.parse(init.body))
      return new Response(null, { status: 201 })
    }
    if (url.pathname === '/jobs') {
      if (init.method === 'PATCH') Object.assign(dbJob, JSON.parse(init.body))
      const singleton = new Headers(init.headers).get('Accept')?.includes('object+json')
      return Response.json(singleton ? dbJob : [dbJob])
    }
    throw new Error(`Unexpected mocked request ${url.pathname}`)
  }
  Object.assign(configStore.metaConfig, {
    INKCRE_PGREST_URL: 'https://test.example',
    INKCRE_JWT_SECRET: 'test-only-observation-secret',
    telemetry_enabled: false,
  })
  await new Promise((resolve) => queueMicrotask(resolve))
  JobManager.registerHandler('test.observation', {
    parameters: { parse: (value) => value },
    canHandle: () => true,
    handle: async (job, _parameters, signal) => {
      job.state = { count: 11 }
      if (outcome === 'timed_out')
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
      if (outcome === 'aborted') {
        dbJob.abort_requested = true
        await new Promise((resolve) => setImmediate(resolve))
        await JobManager.checkAbortRequests()
      }
    },
  })
  try {
    assert.equal(await JobManager.run(8), true)
    await flushTelemetry()
    assert.equal(dbJob.status, 'finished')
    const events = records.filter((item) =>
      item.attributes?.['inkcre.event.name']?.startsWith('job.')
    )
    assert.deepEqual(
      events.map((item) => item.attributes['inkcre.event.name']).sort((a, b) => a.localeCompare(b)),
      ['job.closed', 'job.started']
    )
    assert.ok(
      events.every((item) => item.severity_number === 9 && item.attributes['inkcre.job.id'] === 8)
    )
    assert.equal(JSON.stringify(records).includes('must-not-be-recorded'), false)
    for (const [terminalStatus, severity, expectedOutcome] of [
      ['timed_out', 17, 'timeout'],
      ['aborted', 9, 'cancelled'],
    ]) {
      outcome = terminalStatus
      records.length = 0
      Object.assign(dbJob, { status: 'pending', abort_requested: false, timeout_seconds: 1 })
      assert.equal(await JobManager.run(8), true)
      await flushTelemetry()
      assert.equal(dbJob.status, terminalStatus)
      const closed = records.find((item) => item.attributes['inkcre.event.name'] === 'job.closed')
      const execution = records.find(
        (item) => item.attributes['inkcre.operation'] === 'job.execute'
      )
      assert.equal(closed.severity_number, severity)
      assert.equal(execution.severity_number, severity)
      assert.equal(execution.attributes.outcome, expectedOutcome)
    }
    assert.equal(configReads, 1, 'all operations share one captured backend selection')
  } finally {
    JobManager.unregisterHandler('test.observation')
    Object.assign(configStore.metaConfig, priorMeta)
    globalThis.fetch = originalFetch
  }
})
