import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  authStore,
  Block,
  configStore,
  databaseRuntimeContract,
  peerJwtContract,
  presentLexicalMatches,
  Resolver,
  TextResolver,
  DBAPIClient,
  PostgreSQLBinaryStorage,
  rawPostgrestFetch,
} from '../../packages/core/dist/index.js'

void test('SDK 0.4 preserves the legacy JWT default without changing database admission truth', async () => {
  const generated = JSON.parse(
    await readFile(
      new URL('../../packages/core/src/database/runtime-contract.generated.json', import.meta.url),
      'utf8'
    )
  )
  assert.equal(Object.hasOwn(generated.jwt, 'maximum_lifetime_seconds'), false)
  assert.equal(peerJwtContract.maximum_lifetime_seconds, 86_400)
  assert.equal(databaseRuntimeContract.jwt, peerJwtContract)
  configStore.metaConfig.INKCRE_JWT_SECRET = 'sdk-compatibility-test-only'
  try {
    const token = await authStore.newToken()
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    assert.equal(claims.exp - claims.iat, peerJwtContract.maximum_lifetime_seconds)
  } finally {
    configStore.metaConfig.INKCRE_JWT_SECRET = ''
  }
})

void test('binary storage keeps its explicit connection for create, read, update and delete', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  const id = '00000000-0000-4000-8000-000000000009'
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({ url, token: new Headers(init.headers).get('Authorization') })
    if (url.includes('create_storage_blob')) return Response.json(id)
    if (url.includes('read_storage_blob')) return new Response(new Uint8Array([37, 80, 68, 70]))
    return Response.json([{ id }])
  }
  try {
    const token = async () => 'explicit-connection-test-token'
    const baseUrl = 'https://connection.test/database'
    const storage = new PostgreSQLBinaryStorage(
      { id: -4, type: 'postgresql_binary' },
      (path, options) => rawPostgrestFetch(path, { ...options, baseUrl, tokenProvider: token }),
      new DBAPIClient('storage_blobs', undefined, 'inkcre', baseUrl, token)
    )
    const pointer = await storage.createRawContent(new Uint8Array([37, 80, 68, 70]))
    assert.deepEqual(JSON.parse(pointer), { blob_id: id })
    assert.deepEqual(
      await storage.getRawContent({ id: 1, storage: -4, content: pointer }),
      new Uint8Array([37, 80, 68, 70])
    )
    assert.equal(await storage.updateRawContent(pointer, new Uint8Array([1])), true)
    assert.equal(await storage.deleteRawContent(pointer), true)
    assert.equal(calls.length, 4)
    for (const call of calls) {
      assert.equal(call.url.startsWith(baseUrl + '/'), true)
      assert.equal(call.token, 'Bearer explicit-connection-test-token')
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

void test('optional recall APIs preserve an ordinary resolver and its original match', async () => {
  TextResolver.previewRenderer = { render: () => null }
  TextResolver.solvedContentRenderer = { render: () => null }
  Resolver.register(TextResolver.type, TextResolver)
  const block = Block.parse({
    id: 1,
    resolver: TextResolver.type,
    content: 'article',
    storage: null,
    updated_at: '2026-10-21T00:00:00Z',
  })
  const match = { block, label: 'Article', excerpt: 'article', evidence: 'text_substring', rank: 1 }
  const resolver = new TextResolver(block)
  assert.equal(await resolver.getRecallTarget(match), null)
  const [group] = await presentLexicalMatches([match])
  assert.equal(group.block, block)
  assert.equal(group.readable, false)
  assert.equal(group.matches[0], match)
})
