import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  EXTENSION_MANAGEMENT_CAPABILITY,
  ExtensionManagementError,
  ExtensionPeerStatusSchema,
  PeerManager,
  PeerOutcomeUnknown,
  listAdvertisedExtensionManagementPeers,
  manageExtensionOnPeer,
  readExtensionPeerStatus,
} from '../../packages/core/dist/index.js'

const target = '00000000-0000-4000-8000-000000000001'
const row = {
  name: 'inkcre/example',
  peer_id: target,
  distribution: 'kotlin_apk',
  version: '1.0.0',
  enabled: true,
  config_schema: null,
  supported_distributions: ['kotlin_apk'],
  loaded_version: '1.0.0',
  running: true,
  restart_required: false,
  operation: null,
  error: null,
}
const status = { peer_id: target, supported_distributions: ['kotlin_apk'], extensions: [row] }
const envelope = (body, code = 200) => ({ status: code, headers: {}, body })

void test('Core owns exact Peer management and accepts formats unknown to this Host', async (t) => {
  const calls = []
  t.mock.method(PeerManager, 'delegate', async (...args) => {
    calls.push(args)
    return envelope(status)
  })
  assert.deepEqual(await readExtensionPeerStatus(target, row.name), status)
  assert.deepEqual(calls[0], [
    EXTENSION_MANAGEMENT_CAPABILITY,
    { body: { action: 'status', extension: row.name } },
    target,
  ])
  const command = {
    action: 'select',
    extension: row.name,
    distribution: 'kotlin_apk',
    version: '1.0.0',
  }
  assert.deepEqual(await manageExtensionOnPeer(target, command), row)
  assert.deepEqual(calls[1], [EXTENSION_MANAGEMENT_CAPABILITY, { body: command }, target])
  assert.equal(
    ExtensionPeerStatusSchema.safeParse({ ...status, supported_distributions: [''] }).success,
    false
  )
})

void test('invalid management responses do not expose remote configuration or retry', async (t) => {
  const secret = 'credential-that-must-not-appear'
  let response
  let calls = 0
  t.mock.method(PeerManager, 'delegate', async () => {
    calls += 1
    return response
  })
  for (response of [
    { invalid: secret },
    envelope({ detail: secret }, 422),
    envelope({ ...status, peer_id: secret }),
    envelope({ ...status, extensions: [{ ...row, peer_id: secret }] }),
    envelope({ ...status, extensions: [] }),
  ]) {
    const previous = calls
    await assert.rejects(
      manageExtensionOnPeer(target, { action: 'enable', extension: row.name }),
      (error) => error instanceof ExtensionManagementError && !String(error).includes(secret)
    )
    assert.equal(calls, previous + 1)
  }
  await assert.rejects(readExtensionPeerStatus(''), TypeError)
  assert.equal(calls, 5)
})

void test('ambiguous dispatch keeps the original transport error and one exact attempt', async (t) => {
  const failure = new PeerOutcomeUnknown('connection lost after dispatch')
  const delegate = t.mock.method(PeerManager, 'delegate', async () => {
    throw failure
  })
  await assert.rejects(readExtensionPeerStatus(target), (error) => error === failure)
  assert.equal(delegate.mock.callCount(), 1)
})

void test('discovery ignores malformed advertisements without claiming route readiness', async (t) => {
  const advertised = { capabilitySnapshot: () => [{ id: EXTENSION_MANAGEMENT_CAPABILITY }] }
  t.mock.method(PeerManager, 'listLive', async () => [
    advertised,
    { capabilitySnapshot: () => [] },
    {
      capabilitySnapshot: () => {
        throw new Error('bad advertisement')
      },
    },
  ])
  assert.deepEqual(await listAdvertisedExtensionManagementPeers(), [advertised])
})
