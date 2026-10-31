import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import test from 'node:test'
import {
  AudioResolver,
  Block,
  configStore,
  EpubResolver,
  FileResolver,
  ImageResolver,
  PdfResolver,
  Resolver,
  ResolverCache,
  TextResolver,
  VideoResolver,
  ZipResolver,
} from '../../packages/core/dist/index.js'

function block(resolver, content = 'shared content', storage = null) {
  return Block.parse({ id: 701, resolver, content, storage })
}

void test('two readers of one cached resolver share the first load', async (t) => {
  TextResolver.previewRenderer = { render: () => null }
  TextResolver.solvedContentRenderer = { render: () => null }
  Resolver.register(TextResolver.type, TextResolver)
  t.after(() => {
    ResolverCache.clear()
    Resolver.unregister(TextResolver.type, TextResolver)
  })
  const source = block(TextResolver.type)
  const first = await ResolverCache.getResolver(source)
  const second = await ResolverCache.getResolver(source)
  assert.equal(first, second)
  assert.deepEqual(await Promise.all([first.getSolvedContent(), second.getText()]), [
    'shared content',
    'shared content',
  ])
  assert.equal(first.solvedContentState.value.status, 'success')
})

// An extension supplies the transformation; the SDK owns request coordination.
class ProjectionResolver extends Resolver {
  constructor(source, read) {
    super(source)
    this.read = read
  }

  _getSolvedContent(options) {
    return this.read(options)
  }

  getText(options) {
    return this.getSolvedContent(options)
  }
}

void test('an explicit derivation waits for a read without changing either request', async () => {
  const reading = Promise.withResolvers()
  const deriving = Promise.withResolvers()
  const derivationStarted = Promise.withResolvers()
  const received = []
  const resolver = new ProjectionResolver(block('test.projection.v1'), (options) => {
    received.push(options)
    if (received.length === 1) return reading.promise
    derivationStarted.resolve()
    return deriving.promise
  })
  const first = resolver.getSolvedContent()
  const options = { refresh: true, materializeMissing: true, context: 'lexical' }
  const second = resolver.getSolvedContent(options)
  const shared = resolver.getSolvedContent(options)
  options.materializeMissing = false
  reading.resolve(null)
  assert.equal(await first, null)
  await derivationStarted.promise
  assert.deepEqual(received, [
    { refresh: false, materializeMissing: false, context: 'default' },
    { refresh: true, materializeMissing: true, context: 'lexical' },
  ])
  deriving.resolve('derived content')
  assert.deepEqual(await Promise.all([second, shared]), ['derived content', 'derived content'])
  assert.equal(await resolver.getSolvedContent(), 'derived content')
})

void test('a failed read does not cancel a queued refresh or poison later retries', async () => {
  const reading = Promise.withResolvers()
  const resolver = new ProjectionResolver(block('test.projection.v1'), (options) =>
    options.refresh ? Promise.resolve('recovered') : reading.promise
  )
  const rejected = assert.rejects(resolver.getSolvedContent(), /unavailable/)
  const refresh = resolver.getSolvedContent({ refresh: true })
  reading.reject(new Error('unavailable'))
  await rejected
  assert.equal(await refresh, 'recovered')
  assert.equal(await resolver.getSolvedContent(), 'recovered')
  assert.equal(resolver.solvedContentState.value.status, 'success')
})

void test('disposal prevents a queued derivation from starting', async () => {
  const reading = Promise.withResolvers()
  let materialized = false
  const resolver = new ProjectionResolver(block('test.projection.v1'), (options) => {
    materialized ||= options.materializeMissing
    return reading.promise
  })
  const first = assert.rejects(resolver.getSolvedContent(), /disposed/)
  const second = assert.rejects(
    resolver.getSolvedContent({ refresh: true, materializeMissing: true }),
    /disposed/
  )
  await resolver.dispose()
  reading.resolve('late content')
  await Promise.all([first, second])
  assert.equal(materialized, false)
  assert.equal(resolver.solvedContentState.value.status, 'idle')
})

// Delay real HTTP bytes at the Storage boundary, so disposal and refresh races
// are deterministic without replacing Resolver, Block, Storage or browser handles.
async function contentServer(t) {
  const waiting = []
  let arrived = Promise.withResolvers()
  const server = createServer((request, response) => {
    if (request.url.startsWith('/storages?')) {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ id: 701, type: 'http', nickname: null, config: {} }))
      return
    }
    waiting.push(response)
    arrived.resolve()
    arrived = Promise.withResolvers()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  const previous = { ...configStore.metaConfig }
  configStore.metaConfig.INKCRE_PGREST_URL = origin
  configStore.metaConfig.INKCRE_JWT_SECRET = 'resolver-lifecycle-test-only'
  t.after(async () => {
    Object.assign(configStore.metaConfig, previous)
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  return {
    url: `${origin}/content`,
    async nextRequest() {
      while (waiting.length === 0) await arrived.promise
      return waiting.shift()
    },
  }
}

void test('byte resolver handles survive concurrent readers and end with their owner', async (t) => {
  const server = await contentServer(t)
  for (const ResolverType of [
    ImageResolver,
    AudioResolver,
    VideoResolver,
    PdfResolver,
    EpubResolver,
    ZipResolver,
    FileResolver,
  ]) {
    await t.test(ResolverType.type, async () => {
      const resolver = new ResolverType(block(ResolverType.type, server.url, 701))
      const first = resolver.getSolvedContent()
      const response = await server.nextRequest()
      const second = resolver.getSolvedContent()
      response.end(new Uint8Array([1, 2, 3]))
      const [initial, shared] = await Promise.all([first, second])
      assert.equal(initial, shared)
      assert.deepEqual(
        new Uint8Array(await (await fetch(initial.objectUrl)).arrayBuffer()),
        new Uint8Array([1, 2, 3])
      )

      const refresh = resolver.getSolvedContent({ refresh: true })
      const refreshResponse = await server.nextRequest()
      refreshResponse.end(new Uint8Array([4, 5]))
      const replacement = await refresh
      await assert.rejects(fetch(initial.objectUrl))
      assert.deepEqual(replacement.content, new Uint8Array([4, 5]))

      const late = resolver.getSolvedContent({ refresh: true })
      const lateResponse = await server.nextRequest()
      const rejected = assert.rejects(late, /disposed/)
      await resolver.dispose()
      await assert.rejects(fetch(replacement.objectUrl))
      lateResponse.end(new Uint8Array([6]))
      await rejected
      await assert.rejects(resolver.getSolvedContent(), /disposed/)
      await resolver.dispose()
    })
  }
})

void test('an extension declares lazy bytes without its own queue, URL or dispose override', async () => {
  const arrivals = []
  class MediaResolver extends Resolver {
    media = this.createByteContent(async () => {
      const arrival = Promise.withResolvers()
      arrivals.push(arrival)
      return arrival.promise
    })
    _getSolvedContent() {
      return Promise.resolve({ title: 'metadata only' })
    }
    getText() {
      return Promise.resolve('metadata only')
    }
    loadContent(options) {
      return this.media.load(undefined, options)
    }
  }
  const resolver = new MediaResolver(block('test.media.v1'))
  await resolver.getSolvedContent()
  assert.equal(arrivals.length, 0, 'metadata previews never fetch bytes')
  const first = resolver.loadContent()
  const second = resolver.loadContent()
  await Promise.resolve()
  assert.equal(arrivals.length, 1)
  arrivals[0].resolve({ content: new Uint8Array([1]), mediaType: 'video/mp4' })
  const initial = await first
  assert.equal(await second, initial)
  const refresh = resolver.loadContent({ refresh: true })
  await Promise.resolve()
  arrivals[1].resolve({ content: new Uint8Array([2]) })
  const updated = await refresh
  await assert.rejects(fetch(initial.objectUrl))
  const late = assert.rejects(resolver.loadContent({ refresh: true }), /disposed/)
  await Promise.resolve()
  await resolver.dispose()
  arrivals[2].resolve({ content: new Uint8Array([3]) })
  await late
  await assert.rejects(fetch(updated.objectUrl))
})

void test('borrow loads complete relations while historical constructors preserve supplied snapshots', async (t) => {
  const { Relation } = await import('../../packages/core/dist/index.js')
  const complete = [Relation.parse({ id: 1, from_: 701, to_: 702, content: 'member' })]
  const query = t.mock.method(Relation, 'getByBlock', async () => complete)
  TextResolver.previewRenderer = { render: () => null }
  TextResolver.solvedContentRenderer = { render: () => null }
  Resolver.register(TextResolver.type, TextResolver)
  t.after(() => {
    ResolverCache.clear()
    Resolver.unregister(TextResolver.type, TextResolver)
  })
  const borrowed = await ResolverCache.borrow(block(TextResolver.type))
  assert.deepEqual(await borrowed.getRelations(), complete)
  assert.equal(query.mock.callCount(), 1)
  const legacy = new TextResolver(block(TextResolver.type), [])
  assert.deepEqual(await legacy.getRelations(), [])
  const knownComplete = Resolver.createOwned(block(TextResolver.type), {
    complete: true,
    relations: [],
  })
  assert.deepEqual(await knownComplete.getRelations(), [])
  assert.equal(query.mock.callCount(), 1)
})

void test('a media snapshot is both the byte-cache identity and the exact loader input', async () => {
  const reads = []
  class MediaResolver extends Resolver {
    media = this.createByteContent(async (source) => {
      reads.push(source)
      return { content: new Uint8Array([source.revision]) }
    })
    getText() {
      return Promise.resolve(null)
    }
    loadContent(source) {
      return this.media.load(source)
    }
  }
  const resolver = new MediaResolver(block('test.media.v1'))
  const firstSource = { revision: 1 }
  const first = await resolver.loadContent(firstSource)
  assert.equal(await resolver.loadContent(firstSource), first)
  const secondSource = { revision: 2 }
  const second = await resolver.loadContent(secondSource)
  assert.deepEqual(reads, [firstSource, secondSource])
  assert.equal(reads[1], secondSource)
  assert.deepEqual([...second.content], [2])
  await assert.rejects(fetch(first.objectUrl))
  await resolver.dispose()
})
