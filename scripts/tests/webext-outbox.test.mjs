import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(
  new URL('../../apps/webext/logic/collection/outbox.ts', import.meta.url),
  'utf8'
)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})

class DatabaseFailure extends Error {
  constructor(status) {
    super(`HTTP ${status}`)
    this.status = status
  }
}

// Run the real dispatcher with isolated persistence and submission boundaries.
function fixture(failure) {
  const command = {
    request_id: 'captured-request',
    mode: 'fixed',
    source: { scope: 'saved-page', key: 'https://source.test/page', metadata: {} },
    parts: [{ slot: 'body', content: 'captured material' }],
  }
  const target = { id: 'original-target', url: 'https://database.test' }
  let item = {
    id: command.request_id,
    connectionId: target.id,
    createdAt: 1,
    state: 'pending',
    automatic: false,
    url: command.source.key,
    command,
  }
  const submitted = []
  const receipt = { request_id: command.request_id }
  const modules = {
    '@inkcre/web-collection': {},
    'wxt/browser': {},
    './permissions': {},
    './store': {
      outbox: async () => [structuredClone(item)],
      outboxItem: async (id) => (id === item.id ? structuredClone(item) : undefined),
      updateOutbox: async (value) => {
        item = structuredClone(value)
      },
      connection: async (id) => {
        assert.equal(id, target.id)
        return target
      },
    },
    './database': {
      DatabaseFailure,
      materialClient: (connection) => {
        assert.equal(connection, target)
        return {
          submit: async (value) => {
            submitted.push(structuredClone(value))
            if (submitted.length === 1) throw failure
            return receipt
          },
        }
      },
    },
  }
  const exports = {}
  new Function('require', 'exports', outputText)((name) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`)
    return modules[name]
  }, exports)
  return { ...exports, current: () => item, command, target, submitted, receipt }
}

for (const failure of [
  new DatabaseFailure(408),
  new DatabaseFailure(429),
  new DatabaseFailure(503),
  new Error('offline'),
]) {
  test(`${failure.message} retries on the next wake with the original request and material`, async () => {
    const run = fixture(failure)
    const attempted = new Set()
    assert.equal(await run.deliverBatch(attempted), 1)
    assert.equal(run.current().state, 'sending')
    assert.equal(run.current().id, run.command.request_id)
    assert.equal(run.current().connectionId, run.target.id)
    assert.deepEqual(run.current().command, run.command)
    assert.equal(run.current().error, failure.message)
    assert.equal(await run.deliverBatch(attempted), 0)
    assert.equal(run.submitted.length, 1)

    assert.equal(await run.deliverBatch(new Set()), 1)
    assert.deepEqual(run.submitted, [run.command, run.command])
    assert.equal(run.current().id, run.command.request_id)
    assert.equal(run.current().connectionId, run.target.id)
    assert.equal(run.current().state, 'confirmed')
    assert.deepEqual(run.current().receipt, run.receipt)
    assert.equal(run.current().command, undefined)
    assert.equal(run.current().error, undefined)
  })
}

for (const status of [400, 401, 403, 404, 409, 422]) {
  test(`HTTP ${status} keeps the original material blocked for manual recovery`, async () => {
    const run = fixture(new DatabaseFailure(status))
    assert.equal(await run.deliverBatch(new Set()), 1)
    assert.equal(run.current().state, 'blocked')
    assert.equal(run.current().id, run.command.request_id)
    assert.equal(run.current().connectionId, run.target.id)
    assert.deepEqual(run.current().command, run.command)
    assert.equal(await run.deliverBatch(new Set()), 0)
    assert.deepEqual(run.submitted, [run.command])
  })
}
