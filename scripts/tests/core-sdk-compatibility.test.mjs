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
  HtmlResolver,
  TextResolver,
  DBAPIClient,
  PostgreSQLBinaryStorage,
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

void test('binary storage targets the selected blob for bytea updates and deletion', async (t) => {
  const calls = []
  const id = '00000000-0000-4000-8000-000000000009'
  const pointer = JSON.stringify({ blob_id: id })
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input)
    calls.push(init.method)
    assert.equal(url.origin + url.pathname, 'https://connection.test/database/storage_blobs')
    assert.equal(url.searchParams.get('id'), `eq.${id}`)
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer explicit-connection')
    assert.equal(new Headers(init.headers).get('Content-Profile'), 'inkcre')
    if (init.method === 'PATCH') assert.deepEqual(JSON.parse(init.body), { data: '\\x00017fff' })
    return Response.json([{ id }])
  })
  const storage = new PostgreSQLBinaryStorage(
    { id: -4, type: 'postgresql_binary' },
    undefined,
    new DBAPIClient(
      'storage_blobs',
      undefined,
      'inkcre',
      'https://connection.test/database',
      async () => 'explicit-connection'
    )
  )
  assert.equal(await storage.updateRawContent(pointer, new Uint8Array([0, 1, 127, 255])), true)
  assert.equal(await storage.deleteRawContent(pointer), true)
  assert.deepEqual(calls, ['PATCH', 'DELETE'])
})

void test('optional recall APIs preserve an ordinary resolver and its original matches', async (t) => {
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
  const later = { ...match, excerpt: 'another passage', rank: 2 }
  const [group] = await presentLexicalMatches([match, later])
  assert.deepEqual(group.block, block)
  assert.equal(group.readable, false)
  assert.equal(group.matches.length, 2)
  assert.equal(group.matches[0], match)
  assert.equal(group.matches[1], later)
})

void test('text projections retain authored Markdown and expose HTML columns and media references', async () => {
  const markdown = '# Title\n\n```html\n<node>& value\n  indent\n```\n[link](https://example.org)\n'
  const block = Block.parse({
    id: 2,
    resolver: 'core.markdown.v1',
    storage: null,
    content: markdown,
  })
  assert.equal(await new MarkdownResolver(block).getText(), markdown)
  const html = Block.parse({
    id: 4,
    resolver: 'core.html.v1',
    storage: null,
    content:
      '<table><tr><th>Name</th><td>Score</td><td>12</td></tr></table><video><track src="https://example.org/captions.vtt"></video>',
  })
  const text = await new HtmlResolver(html).getText()
  assert.match(text, /Name\s+Score\s+12/)
  assert.ok(text.includes('https://example.org/captions.vtt'))
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
