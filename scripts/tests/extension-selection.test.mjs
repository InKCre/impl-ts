import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Peer, PeerManager, PeerOutcomeUnknown } from '../../packages/core/dist/index.js'
import {
  ensureExtensionSelection,
  configuredRegistry,
  RegistryConfigurationError,
} from '../../packages/ext-dev-utils/src/selection.ts'

const target = '00000000-0000-4000-8000-000000000001'
const name = 'inkcre/example'
const peer = Peer.parse({
  id: target,
  created_at: new Date(),
  updated_at: new Date(),
  name: 'target',
  config: { extension_registry_url: 'https://target.example' },
  application_version: '1.0.0',
  config_schema: {},
  capabilities: [],
})
const row = {
  name,
  peer_id: target,
  distribution: 'python',
  version: '1.0.0',
  enabled: false,
  config_schema: null,
  supported_distributions: ['python'],
  loaded_version: null,
  running: false,
  restart_required: false,
  operation: null,
  error: null,
}
const envelope = (rows) => ({
  status: 200,
  headers: {},
  body: { peer_id: target, supported_distributions: ['python'], extensions: rows },
})

void test('setup keeps an exact existing pin and never consults Registry or enables it', async (t) => {
  const calls = []
  t.mock.method(PeerManager, 'delegate', async (_capability, payload, selected) => {
    calls.push([payload.body.action, selected])
    return envelope([row])
  })
  t.mock.method(globalThis, 'fetch', async () =>
    assert.fail('existing selection must not query Registry')
  )
  assert.deepEqual(await ensureExtensionSelection(peer, name, 'python'), row)
  assert.deepEqual(calls, [['status', target]])
})

void test('first selection uses the target Registry and returns restart without a second write', async (t) => {
  const calls = []
  const restart = { ...row, restart_required: true, operation: 'restarting' }
  t.mock.method(PeerManager, 'delegate', async (_capability, payload, selected) => {
    calls.push([payload.body, selected])
    return envelope(payload.body.action === 'status' ? [] : [restart])
  })
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(new URL(url).origin, 'https://target.example')
    return Response.json({
      name,
      nickname: 'Example',
      releases: [
        {
          name,
          nickname: 'Example',
          version: '1.0.0',
          state: 'published',
          distribution: 'python',
          python: {
            project: 'example',
            simple_url: 'https://target.example/simple',
            host_sdk: 'core-py',
            host_sdk_version: '>=0.4',
            entry_point: {
              group: 'inkcre.extensions',
              name: 'example',
              object: 'example:Extension',
            },
          },
        },
      ],
    })
  })
  assert.deepEqual(await ensureExtensionSelection(peer, name, 'python'), restart)
  assert.deepEqual(
    calls.map(([command]) => command.action),
    ['status', 'select']
  )
  assert.equal(calls[1][0].version, '1.0.0')
  assert.equal(calls[1][1], target)
})

void test('unknown writes are not retried; failed or pending targets do not advance', async (t) => {
  const failure = new PeerOutcomeUnknown('lost response')
  const delegate = t.mock.method(PeerManager, 'delegate', async () => {
    throw failure
  })
  await assert.rejects(ensureExtensionSelection(peer, name, 'python'), (error) => error === failure)
  assert.equal(delegate.mock.callCount(), 1)
  for (const current of [
    { ...row, error: 'failed' },
    { ...row, version: null, operation: 'downloading' },
  ]) {
    delegate.mock.mockImplementation(async () => envelope([current]))
    assert.deepEqual(await ensureExtensionSelection(peer, name, 'python'), current)
  }
})

void test('a remote process default is never substituted by the browser Registry', () => {
  assert.equal(
    configuredRegistry(null, {
      schema: 'extension.registry.config.v1',
      value: { extension_registry_url: 'https://deployment.example' },
    }),
    'https://deployment.example'
  )
  assert.throws(() => configuredRegistry(null, null), RegistryConfigurationError)
})
