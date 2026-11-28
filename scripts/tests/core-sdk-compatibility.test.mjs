import assert from 'node:assert/strict'
import { test } from 'node:test'
import { jwtVerify } from 'jose'
import {
  authStore,
  Block,
  configStore,
  databaseRuntimeContract,
  peerJwtContract,
  presentLexicalMatches,
  Resolver,
  ResolverCache,
  MarkdownResolver,
  TextResolver,
  DBAPIClient,
  PostgreSQLBinaryStorage,
  rawPostgrestFetch,
} from '../../packages/core/dist/index.js'

void test('SDK 0.4 signs 24-hour tokens and serves valid credentials after the cached token expires', async (t) => {
  assert.equal(peerJwtContract.maximum_lifetime_seconds, 86_400)
  assert.equal(databaseRuntimeContract.jwt.maximum_lifetime_seconds, 86_400)
  const priorSecret = configStore.metaConfig.INKCRE_JWT_SECRET
  const secret = 'sdk-compatibility-test-secret-at-least-32-bytes'
  const key = new TextEncoder().encode(secret)
  const peer = { algorithms: ['HS256'], issuer: 'inkcre-peer', audience: 'inkcre-api' }
  let now = Date.parse('2026-11-01T12:00:00Z')
  t.mock.method(Date, 'now', () => now)
  configStore.metaConfig.INKCRE_JWT_SECRET = secret
  try {
    const first = await authStore.newToken()
    const { payload } = await jwtVerify(first, key, { ...peer, currentDate: new Date(now) })
    assert.equal(payload.role, 'authenticated')
    assert.equal(payload.exp - payload.iat, 86_400)
    now = payload.exp * 1000
    const second = await authStore.getToken()
    await jwtVerify(second, key, { ...peer, currentDate: new Date(now) })
  } finally {
    configStore.metaConfig.INKCRE_JWT_SECRET = priorSecret
  }
})

void test('binary storage keeps its explicit connection for create, read, update and delete', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  const id = '00000000-0000-4000-8000-000000000009'
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({
      url: new URL(url),
      headers: new Headers(init.headers),
      method: init.method,
      body: init.body,
    })
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
    assert.equal(await storage.updateRawContent(pointer, new Uint8Array([0, 1, 127, 255])), true)
    assert.equal(await storage.deleteRawContent(pointer), true)
    assert.equal(calls.length, 4)
    for (const call of calls) {
      assert.equal(call.url.href.startsWith(baseUrl + '/'), true)
      assert.equal(call.headers.get('Authorization'), 'Bearer explicit-connection-test-token')
      assert.equal(call.headers.get('Content-Profile'), 'inkcre')
    }
    assert.deepEqual(
      calls.map(({ method, url }) => [method, url.pathname]),
      [
        ['POST', '/database/rpc/create_storage_blob'],
        ['POST', '/database/rpc/read_storage_blob'],
        ['PATCH', '/database/storage_blobs'],
        ['DELETE', '/database/storage_blobs'],
      ]
    )
    assert.equal(calls[0].headers.get('Content-Type'), 'application/octet-stream')
    assert.deepEqual([...new Uint8Array(calls[0].body)], [37, 80, 68, 70])
    assert.equal(calls[1].headers.get('Accept'), 'application/octet-stream')
    assert.deepEqual(JSON.parse(calls[1].body), { blob_id: id })
    assert.deepEqual(JSON.parse(calls[2].body), { data: '\\x00017fff' })
    assert.equal(calls[2].url.searchParams.get('id'), `eq.${id}`)
    assert.equal(calls[3].url.searchParams.get('id'), `eq.${id}`)
  } finally {
    globalThis.fetch = originalFetch
  }
})

void test('optional recall APIs preserve an ordinary resolver and its original match', async (t) => {
  class Article extends TextResolver {
    static type = 'test.article.v1'
    static previewRenderer = { render: () => null }
    static solvedContentRenderer = { render: () => null }
  }
  Resolver.register(Article.type, Article)
  const block = Block.parse({
    id: 1,
    resolver: Article.type,
    content: 'article',
    storage: null,
    updated_at: '2026-10-21T00:00:00Z',
  })
  t.after(() => {
    Resolver.unregister(Article.type, Article)
    ResolverCache.invalidate(block.id)
  })
  const match = { block, label: 'Article', excerpt: 'article', evidence: 'text_substring', rank: 1 }
  assert.equal(await new Article(block).getRecallTarget(match), null)
  const [group] = await presentLexicalMatches([match])
  assert.deepEqual(group.block, block)
  assert.equal(group.readable, false)
  assert.deepEqual(group.matches, [match])
})

void test('Markdown text projection preserves authored markup, spacing and the final newline', async () => {
  const markdown = '# Title\n\n```html\n<node>& value\n  indent\n```\n[link](https://example.org)\n'
  const block = Block.parse({
    id: 2,
    resolver: 'core.markdown.v1',
    storage: null,
    content: markdown,
  })
  assert.equal(await new MarkdownResolver(block).getText(), markdown)
})

void test('a replaced Resolver serves its new projection even when the old module later unloads', async (t) => {
  class Original extends TextResolver {
    static type = 'test.replaceable.v1'
    static previewRenderer = { render: () => null }
    static solvedContentRenderer = { render: () => null }
  }
  class Replacement extends Original {
    async getText() {
      return 'new projection'
    }
  }
  const block = Block.parse({
    id: 3,
    resolver: Original.type,
    storage: null,
    content: 'old projection',
    updated_at: '2026-10-21T00:00:00Z',
  })
  t.after(() => {
    Resolver.unregister(Original.type, Original)
    Resolver.unregister(Original.type, Replacement)
    ResolverCache.invalidate(block.id)
  })
  Resolver.register(Original.type, Original)
  assert.equal(await (await ResolverCache.getResolver(block)).getText(), 'old projection')
  Resolver.unregister(Original.type, Original)
  Resolver.register(Original.type, Replacement)
  assert.equal(Resolver.unregister(Original.type, Original), false)
  assert.equal(await (await ResolverCache.getResolver(block)).getText(), 'new projection')
})
