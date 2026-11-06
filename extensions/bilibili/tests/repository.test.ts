import assert from 'node:assert/strict'
import test from 'node:test'
import { Block, Relation, Source } from '@inkcre/core'
import { BilibiliRepository } from '../src/repository.ts'
import { favoriteGraph } from '../src/graph.ts'
import { advanceProgress, startProgress } from '../src/progress.ts'
import { resolverTypes, SourceConfigSchema, sourceType } from '../src/schema.ts'
import type { FavoritePage } from '../src/normalize.ts'

type Table = 'blocks' | 'relations' | 'sources'
type Row = { id: number; [key: string]: unknown }
type Values = Record<string, unknown>
class Query {
  table: Table
  database: Database
  action: 'read' | 'insert' | 'update' = 'read'
  values: Values = {}
  filters: ((row: Row) => boolean)[] = []
  start = 0
  end = Infinity
  one = false
  counted = false
  constructor(database: Database, table: Table) {
    this.database = database
    this.table = table
  }
  select(_fields = '*', options?: { count: string }) {
    this.counted = options?.count === 'exact'
    return this
  }
  eq(key: string, value: unknown) {
    this.filters.push((row) => row[key] === value)
    return this
  }
  is(key: string, value: unknown) {
    return this.eq(key, value)
  }
  in(key: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[key]))
    return this
  }
  order() {
    return this
  }
  range(start: number, end: number) {
    this.start = start
    this.end = end
    return this
  }
  limit(limit: number) {
    this.end = this.start + limit - 1
    return this
  }
  single() {
    this.one = true
    return this
  }
  async throwOnError() {
    return this.database.execute(this)
  }
}
class Database {
  rows: Record<Table, Row[]> = { blocks: [], relations: [], sources: [] }
  events: { table: Table; action: string; values: Values }[] = []
  failBefore: ((query: Query) => boolean) | null = null
  failAfter: ((query: Query) => boolean) | null = null
  pageLimit = 500
  client(table: Table) {
    return {
      from: () => new Query(this, table),
      insert: (values: Values) => {
        const query = new Query(this, table)
        query.action = 'insert'
        query.values = values
        return query
      },
      update: (values: Values) => {
        const query = new Query(this, table)
        query.action = 'update'
        query.values = values
        return query
      },
    }
  }
  execute(query: Query) {
    this.events.push({
      table: query.table,
      action: query.action,
      values: structuredClone(query.values),
    })
    if (this.failBefore?.(query)) throw new Error('write failed')
    const table = this.rows[query.table]
    let result = table
      .filter((row) => query.filters.every((filter) => filter(row)))
      .sort((a, b) => a.id - b.id)
    const count = result.length
    if (query.action === 'insert') {
      const row = {
        id: Math.max(0, ...table.map((value) => value.id)) + 1,
        ...structuredClone(query.values),
      }
      table.push(row)
      result = [row]
    } else if (query.action === 'update') {
      for (const row of result) Object.assign(row, structuredClone(query.values))
    }
    if (this.failAfter?.(query)) throw new Error('create outcome unknown')
    if (query.action === 'read')
      result = result.slice(query.start, Math.min(query.end + 1, query.start + this.pageLimit))
    if (query.one && result.length !== 1) throw new Error('Expected one result')
    return {
      data: structuredClone(query.one ? result[0] : result),
      count: query.counted ? count : null,
    }
  }
}
const account = { mid: '1001', name: '当前名称' }
const config = SourceConfigSchema.parse({
  provider: 'd089e2c4-e3ec-42a6-953b-42530a726ac2',
  account_mid: account.mid,
  folder_ids: ['900123'],
})
function page(): FavoritePage {
  return {
    folder: { id: '900123', title: '技术收藏', reported_count: 1 },
    owner: account,
    items: [
      {
        video: { aid: '11' },
        uploader: { mid: '2002', name: 'UP 主' },
        membership: { availability: 'unavailable', observed_at: '2026-11-07T00:00:00.000Z' },
      },
    ],
    hasMore: false,
    unsupported: 0,
    unresolved: 0,
    totalItems: 1,
    ids: ['2:11'],
  }
}
function source() {
  return {
    id: 1,
    type: sourceType,
    nickname: 'B 站',
    config,
    state: { kept: true },
    block: null,
  } as unknown as Source
}
function next(source: Source) {
  return advanceProgress(startProgress(source.state, config), '900123', page(), 1, 1)
}
function block(id: number, resolver: string, content: Values): Row {
  return { id, resolver, storage: null, content: JSON.stringify(content, null, 2) }
}
function attach(context: { after: (action: () => void) => void }, database: Database) {
  const originals = [Block.dbApi, Relation.dbApi, Source.dbApi]
  Block.dbApi = database.client('blocks') as unknown as typeof Block.dbApi
  Relation.dbApi = database.client('relations') as unknown as typeof Relation.dbApi
  Source.dbApi = database.client('sources') as unknown as typeof Source.dbApi
  context.after(() => {
    ;[Block.dbApi, Relation.dbApi, Source.dbApi] = originals as typeof originals
  })
}
function savedGraph(database: Database, value: Source) {
  const folder = database.rows.blocks.find((row) => row.resolver === resolverTypes.folder)!
  const video = database.rows.blocks.find(
    (row) => row.resolver === resolverTypes.video && JSON.parse(String(row.content)).aid === '11'
  )!
  const memberLink = database.rows.relations.find(
    (row) => row.from_ === folder.id && row.content === 'contains'
  )!
  const item = database.rows.relations.find(
    (row) => row.from_ === memberLink.to_ && row.content === 'item'
  )!
  assert.equal(item.to_, video.id)
  const anchor = database.rows.blocks.find((row) => row.id === value.block)!
  assert.equal(anchor.resolver, 'core.source.v1')
  assert.equal(JSON.parse(String(anchor.content)).id, value.id)
}

void test('ordinary pretty-printed JSON from another Peer is reused and repeat collection preserves IDs and user relations', async (context) => {
  const database = new Database()
  attach(context, database)
  const value = source()
  value.block = 15
  database.rows.sources.push(structuredClone(value) as unknown as Row)
  database.rows.blocks.push(
    block(10, resolverTypes.user, {
      mid: '1001',
      name: '原名称',
      avatar_url: 'https://example.com/avatar.png',
    }),
    block(11, resolverTypes.folder, { id: '900123', title: '旧夹名' }),
    block(12, resolverTypes.video, { aid: '11', title: '已知标题', description: '已知简介' }),
    block(13, resolverTypes.user, { mid: '2002', name: 'UP 主' }),
    block(14, resolverTypes.membership, {
      availability: 'available',
      favored_at: '2025-01-01T00:00:00.000Z',
      observed_at: '2025-01-01T00:00:00.000Z',
    }),
    block(15, 'core.source.v1', { id: 1, type: sourceType, nickname: 'B 站' }),
    { id: 16, resolver: 'core.text.v1', storage: null, content: '用户笔记' },
    block(17, resolverTypes.user, { mid: '11001', name: '提到 1001 的另一个人' }),
    block(18, resolverTypes.video, { aid: '111', title: '提到 11 的另一个视频' })
  )
  database.rows.relations.push(
    { id: 1, from_: 10, to_: 11, content: 'owns' },
    { id: 2, from_: 11, to_: 14, content: 'contains' },
    { id: 3, from_: 14, to_: 12, content: 'item' },
    { id: 4, from_: 12, to_: 13, content: 'author' },
    { id: 5, from_: 15, to_: 10, content: 'collects' },
    { id: 6, from_: 12, to_: 16, content: 'user:note' }
  )
  const ids = database.rows.blocks.map((row) => row.id)
  const userEdge = structuredClone(database.rows.relations[5])
  await new BilibiliRepository().reconcilePage(value, favoriteGraph(account, page()), next(value))
  await new BilibiliRepository().reconcilePage(value, favoriteGraph(account, page()), next(value))
  assert.deepEqual(
    database.rows.blocks.map((row) => row.id),
    ids
  )
  assert.deepEqual(
    database.rows.relations.find((row) => row.id === 6),
    userEdge
  )
  assert.equal(database.rows.relations.length, 6)
  assert.equal(
    JSON.parse(String(database.rows.blocks.find((row) => row.id === 10)!.content)).avatar_url,
    'https://example.com/avatar.png'
  )
  assert.equal(
    JSON.parse(String(database.rows.blocks.find((row) => row.id === 12)!.content)).title,
    '已知标题'
  )
  assert.equal(
    JSON.parse(String(database.rows.blocks.find((row) => row.id === 14)!.content)).favored_at,
    '2025-01-01T00:00:00.000Z'
  )
  assert.equal(value.block, 15)
  savedGraph(database, value)
})

void test('an existing membership for another video is never reused', async (context) => {
  const database = new Database()
  attach(context, database)
  const value = source()
  database.rows.sources.push(structuredClone(value) as unknown as Row)
  database.rows.blocks.push(
    block(10, resolverTypes.folder, { id: '900123' }),
    block(11, resolverTypes.video, { aid: '99' }),
    block(12, resolverTypes.membership, {
      availability: 'available',
      observed_at: '2025-01-01T00:00:00.000Z',
    })
  )
  database.rows.relations.push(
    { id: 1, from_: 10, to_: 12, content: 'contains' },
    { id: 2, from_: 12, to_: 11, content: 'item' }
  )
  await new BilibiliRepository().reconcilePage(value, favoriteGraph(account, page()), next(value))
  const currentVideo = database.rows.blocks.find(
    (row) => row.resolver === resolverTypes.video && JSON.parse(String(row.content)).aid === '11'
  )!
  const currentItem = database.rows.relations.find(
    (row) => row.content === 'item' && row.to_ === currentVideo.id
  )!
  assert.notEqual(currentItem.from_, 12)
  assert.equal(database.rows.relations.find((row) => row.id === 2)!.to_, 11)
})

void test('partial graph failure leaves progress unchanged and the next execution repairs the ordinary graph', async (context) => {
  const database = new Database()
  attach(context, database)
  const value = source()
  database.rows.sources.push(structuredClone(value) as unknown as Row)
  database.failBefore = (query) =>
    query.table === 'relations' && query.action === 'insert' && query.values.content === 'contains'
  await assert.rejects(
    new BilibiliRepository().reconcilePage(value, favoriteGraph(account, page()), next(value)),
    /write failed/
  )
  assert.deepEqual(value.state, { kept: true })
  assert.deepEqual(database.rows.sources[0]!.state, { kept: true })
  const originalVideo = database.rows.blocks.find((row) => row.resolver === resolverTypes.video)!.id
  const incompleteMember = database.rows.blocks.find(
    (row) => row.resolver === resolverTypes.membership
  )!.id
  assert.ok(
    database.rows.relations.some((row) => row.from_ === incompleteMember && row.content === 'item')
  )
  database.failBefore = null
  await new BilibiliRepository().reconcilePage(value, favoriteGraph(account, page()), next(value))
  assert.equal(
    database.rows.blocks.find((row) => row.resolver === resolverTypes.video)!.id,
    originalVideo
  )
  assert.ok(database.rows.blocks.some((row) => row.id === incompleteMember))
  assert.ok(Object.hasOwn(value.state, 'bilibili'))
  savedGraph(database, value)
})

void test('a lost create response is not replayed and a later execution reuses the visible native object', async (context) => {
  const database = new Database()
  attach(context, database)
  const value = source()
  database.rows.sources.push(structuredClone(value) as unknown as Row)
  database.failAfter = (query) =>
    query.table === 'blocks' &&
    query.action === 'insert' &&
    query.values.resolver === resolverTypes.video
  await assert.rejects(
    new BilibiliRepository().reconcilePage(value, favoriteGraph(account, page()), next(value)),
    /create outcome unknown/
  )
  const created = database.rows.blocks.find((row) => row.resolver === resolverTypes.video)!.id
  assert.deepEqual(value.state, { kept: true })
  const creates = () =>
    database.events.filter(
      (event) => event.action === 'insert' && event.values.resolver === resolverTypes.video
    ).length
  assert.equal(creates(), 1)
  database.failAfter = null
  await new BilibiliRepository().reconcilePage(value, favoriteGraph(account, page()), next(value))
  assert.equal(creates(), 1)
  assert.equal(
    database.rows.blocks.find((row) => row.resolver === resolverTypes.video)!.id,
    created
  )
  savedGraph(database, value)
})

void test('failure of the final Source update reuses the already saved graph and unbound Source anchor on the next execution', async (context) => {
  const database = new Database()
  attach(context, database)
  const value = source()
  database.rows.sources.push(structuredClone(value) as unknown as Row)
  database.failBefore = (query) => query.table === 'sources' && query.action === 'update'
  await assert.rejects(
    new BilibiliRepository().reconcilePage(value, favoriteGraph(account, page()), next(value)),
    /write failed/
  )
  assert.deepEqual(value.state, { kept: true })
  assert.equal(value.block, null)
  const ids = database.rows.blocks.map((row) => row.id)
  const relations = structuredClone(database.rows.relations)
  database.failBefore = null
  await new BilibiliRepository().reconcilePage(value, favoriteGraph(account, page()), next(value))
  assert.deepEqual(
    database.rows.blocks.map((row) => row.id),
    ids
  )
  assert.deepEqual(database.rows.relations, relations)
  savedGraph(database, value)
})

void test('normal paginated graph reads find existing objects beyond the service row cap', async (context) => {
  const database = new Database()
  attach(context, database)
  const value = source()
  database.rows.sources.push(structuredClone(value) as unknown as Row)
  for (let id = 1; id <= 1100; id++)
    database.rows.blocks.push(block(id, resolverTypes.user, { mid: String(1000000 + id) }))
  database.rows.blocks.push(block(1101, resolverTypes.user, account))
  await new BilibiliRepository().reconcilePage(value, favoriteGraph(account, page()), next(value))
  const users = database.rows.blocks.filter(
    (row) =>
      row.resolver === resolverTypes.user && JSON.parse(String(row.content)).mid === account.mid
  )
  assert.deepEqual(
    users.map((row) => row.id),
    [1101]
  )
})
