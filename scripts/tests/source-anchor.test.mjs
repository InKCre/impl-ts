import assert from 'node:assert/strict'
import test from 'node:test'
import { Block, SourceResolver, ResolverContentError } from '../../packages/core/dist/index.js'

const anchor = (content) =>
  Block.parse({
    id: 41,
    resolver: 'core.source.v1',
    storage: null,
    content: JSON.stringify(content),
  })

void test('Source anchors read canonical identity without needing the collector or its config', async () => {
  const resolver = new SourceResolver(
    anchor({ id: 9, type: 'extensions.bilibili.favorites.v1', nickname: '我的收藏' })
  )
  assert.equal(
    await resolver.getText(),
    'Source 9 named 我的收藏 uses extensions.bilibili.favorites.v1.'
  )
  assert.equal(await resolver.getSolvedContent(), await resolver.getText())
  assert.equal(
    await new SourceResolver(anchor({ id: 10, type: 'source.example' })).getText(),
    'Source 10 uses source.example.'
  )
})

void test('Source anchor decoding rejects a parallel config or malformed identity', async () => {
  for (const content of [
    { id: '9', type: 'source.example' },
    { id: 9, type: 'source.example', config: { cookie: 'must-not-be-an-anchor' } },
    { id: 9 },
  ]) {
    await assert.rejects(new SourceResolver(anchor(content)).getText(), ResolverContentError)
  }
})
