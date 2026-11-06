import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseAccount,
  parseFavoritePage,
  parseFolders,
  type FavoritePage,
} from '../src/normalize.ts'
import { favoriteGraph } from '../src/graph.ts'
import { SourceConfigSchema, nativeId } from '../src/schema.ts'
import { startProgress, type Progress } from '../src/progress.ts'
import { collectFavorites, type FavoriteSessionPort } from '../src/collect.ts'

// Invented identities and text; only response field shapes come from observed browser responses.
const account = { mid: '1001', name: '测试账号' }
const info = {
  id: 900123,
  fid: 9001,
  mid: 1001,
  upper: account,
  title: '技术收藏',
  attr: 1,
  media_count: 41,
}
const config = SourceConfigSchema.parse({
  provider: 'd089e2c4-e3ec-42a6-953b-42530a726ac2',
  account_mid: account.mid,
  folder_ids: ['900123'],
})
const media = (id: number, extra: object = {}) => ({
  id,
  type: 2,
  bvid: 'BV1234567890',
  title: `视频 ${id}`,
  intro: '已知简介',
  attr: 0,
  upper: { mid: 2002, name: '测试 UP 主' },
  fav_time: 1700000000,
  ...extra,
})
function page(ids: number[], more: boolean, number = 1, extra: object = {}): FavoritePage {
  return parseFavoritePage(
    { code: 0, data: { info, medias: ids.map((id) => media(id)), has_more: more, ...extra } },
    account.mid,
    '900123',
    number,
    '2026-11-06T00:00:00.000Z'
  )
}

void test('full media_id is kept distinct from raw fid, visibility is a bit, and login is required', () => {
  const folders = parseFolders(
    { code: 0, data: { list: [info, { ...info, id: 900124, attr: 23 }] } },
    account.mid
  )
  assert.equal(folders[0]!.id, '900123')
  assert.equal(folders[0]!.is_private, true)
  assert.equal(folders[1]!.is_private, true)
  assert.throws(() => parseAccount({ code: 0, data: { isLogin: false, mid: 1001 } }), /登录/)
  assert.throws(
    () => parseFolders({ code: 0, data: { list: [{ ...info, mid: 777 }] } }, account.mid),
    /不属于/
  )
  assert.throws(() => nativeId(Number.MAX_SAFE_INTEGER + 1), /安全整数/)
})

void test('short pages follow has_more, unavailable placeholders preserve unknown fields, and types are reported', () => {
  const value = parseFavoritePage(
    {
      code: 0,
      data: {
        info,
        has_more: true,
        medias: [
          media(11),
          media(12, { title: '已失效视频', attr: 9 }),
          media(13, { type: 12 }),
          { id: 'bad', type: 2 },
        ],
      },
    },
    account.mid,
    '900123',
    2,
    '2026-11-06T00:00:00.000Z'
  )
  assert.equal(value.hasMore, true)
  assert.equal(value.items.length, 2)
  assert.equal(value.unsupported, 1)
  assert.equal(value.unresolved, 1)
  assert.equal(value.items[1]!.video.title, undefined)
  assert.equal(value.items[1]!.video.description, undefined)
  assert.equal(value.items[1]!.membership.availability, 'unavailable')
  assert.equal(value.items[1]!.membership.page_number, 2)
  assert.equal(value.items[1]!.membership.position_in_page, 1)
  const record = favoriteGraph(account, value).records.find((entry) => entry.key === 'video:12')!
  assert.equal(Object.hasOwn(record.content, 'title'), false)
  assert.throws(() => page([], true), /分页为空/)
  assert.throws(
    () => parseFavoritePage({ code: -101, message: '账号未登录' }, account.mid, '900123', 1),
    /未登录/
  )
  assert.throws(
    () => parseFavoritePage({ code: 0, data: { info, medias: [] } }, account.mid, '900123', 1),
    /结束标记/
  )
})

void test('a shared video has one identity and separate stable membership records in each folder', () => {
  const sharedUploader = favoriteGraph(account, page([11, 12], false))
  assert.equal(sharedUploader.records.length, 7)
  assert.equal(
    new Set(sharedUploader.records.map((entry) => entry.key)).size,
    sharedUploader.records.length
  )
  const first = favoriteGraph(account, page([11], false))
  const secondPage = { ...page([11], false), folder: { ...page([11], false).folder, id: '900124' } }
  const second = favoriteGraph(account, secondPage)
  assert.equal(
    first.records.find((entry) => entry.resolver.endsWith('.video.v1'))!.key,
    second.records.find((entry) => entry.resolver.endsWith('.video.v1'))!.key
  )
  assert.notEqual(
    first.records.find((entry) => entry.resolver.endsWith('.membership.v1'))!.key,
    second.records.find((entry) => entry.resolver.endsWith('.membership.v1'))!.key
  )
  assert.deepEqual(
    first.relations.map((entry) => entry.content),
    ['owns', 'contains', 'item', 'author']
  )
})

void test('optional malformed uploader and time do not discard an identified video', () => {
  const value = parseFavoritePage(
    {
      code: 0,
      data: {
        info,
        has_more: false,
        medias: [media(11, { upper: { mid: 0 }, pubtime: Number.MAX_SAFE_INTEGER })],
      },
    },
    account.mid,
    '900123',
    1
  )
  assert.equal(value.items[0]!.video.aid, '11')
  assert.equal(value.items[0]!.video.published_at, undefined)
  assert.equal(value.items[0]!.uploader, null)
  assert.equal(value.unresolved, 0)
})

function session(pages: FavoritePage[], requested: number[]): FavoriteSessionPort {
  return {
    open: async () => {},
    account: async () => account,
    read: async (_folder, number) => {
      requested.push(number)
      return pages[number - 1]!
    },
  }
}

void test('budgeted runs continue beyond initial pages only after checking head and committed boundary', async () => {
  const pages = [page([11, 12], true), page([13], true, 2), page([14], false, 3)]
  const requested: number[] = []
  let persisted: Record<string, unknown> = {}
  const commit = async (_account: unknown, _page: unknown, progress: Progress) => {
    persisted = { bilibili: progress }
  }
  await collectFavorites(
    config,
    startProgress(persisted, config),
    { max_pages: 2 },
    new AbortController().signal,
    session(pages, requested),
    commit
  )
  assert.equal((persisted.bilibili as Progress).last_run.status, 'partial')
  assert.equal((persisted.bilibili as Progress).folders['900123']!.next_page, 3)
  requested.length = 0
  await collectFavorites(
    config,
    startProgress(persisted, config),
    { max_pages: 2 },
    new AbortController().signal,
    session(pages, requested),
    commit
  )
  assert.deepEqual(requested, [1, 2, 3, 1])
  assert.equal((persisted.bilibili as Progress).last_run.status, 'complete')
})

void test('a changed head restarts scanning and failed persistence never advances acknowledged progress', async () => {
  const pages = [page([11], true), page([12], false, 2)]
  let persisted: Record<string, unknown> = {}
  await collectFavorites(
    config,
    startProgress(persisted, config),
    { max_pages: 1 },
    new AbortController().signal,
    session(pages, []),
    async (_account, _page, progress) => {
      persisted = { bilibili: progress }
    }
  )
  const before = structuredClone(persisted)
  const requested: number[] = []
  const changed = [page([99], true), page([11], false, 2)]
  await assert.rejects(
    collectFavorites(
      config,
      startProgress(persisted, config),
      { max_pages: 1 },
      new AbortController().signal,
      session(changed, requested),
      async () => {
        throw new Error('transaction rejected')
      }
    ),
    /transaction rejected/
  )
  assert.deepEqual(requested, [1])
  assert.deepEqual(persisted, before)
  const imported: string[] = []
  await collectFavorites(
    config,
    startProgress(persisted, config),
    { max_pages: 1 },
    new AbortController().signal,
    session(changed, []),
    async (_account, current, progress) => {
      imported.push(...current.ids)
      persisted = { bilibili: progress }
    }
  )
  assert.deepEqual(imported, ['2:99'])
})

void test('cancellation and repeated pagination fail without a false completed checkpoint', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    collectFavorites(
      config,
      startProgress({}, config),
      { max_pages: 2 },
      controller.signal,
      session([], []),
      async () => assert.fail('must not write')
    )
  )
  let persisted: Record<string, unknown> = {}
  await assert.rejects(
    collectFavorites(
      config,
      startProgress(persisted, config),
      { max_pages: 2 },
      new AbortController().signal,
      session([page([11], true), page([11], true, 2)], []),
      async (_account, _page, progress) => {
        persisted = { bilibili: progress }
      }
    ),
    /分页没有前进/
  )
  assert.equal((persisted.bilibili as Progress).folders['900123']!.next_page, 2)
  assert.notEqual((persisted.bilibili as Progress).last_run.status, 'complete')
})

void test('a changed committed boundary restarts even when the first page has not changed', async () => {
  const pages = [page([11], true), page([12], true, 2), page([13], false, 3)]
  let persisted: Record<string, unknown> = {}
  await collectFavorites(
    config,
    startProgress(persisted, config),
    { max_pages: 2 },
    new AbortController().signal,
    session(pages, []),
    async (_account, _page, progress) => {
      persisted = { bilibili: progress }
    }
  )
  const requested: number[] = []
  const changed = [pages[0]!, page([99], true, 2), pages[2]!]
  const imported: string[] = []
  await collectFavorites(
    config,
    startProgress(persisted, config),
    { max_pages: 1 },
    new AbortController().signal,
    session(changed, requested),
    async (_account, current, progress) => {
      imported.push(...current.ids)
      persisted = { bilibili: progress }
    }
  )
  assert.deepEqual(requested, [1, 2])
  assert.deepEqual(imported, ['2:11'])
  assert.equal((persisted.bilibili as Progress).folders['900123']!.next_page, 2)
})

void test('an abort during page reading prevents dispatching an uncommitted batch', async () => {
  const controller = new AbortController()
  const target = session([page([11], false)], [])
  target.read = async () => {
    controller.abort()
    return page([11], false)
  }
  await assert.rejects(
    collectFavorites(
      config,
      startProgress({}, config),
      { max_pages: 1 },
      controller.signal,
      target,
      async () => assert.fail('must not write an aborted batch')
    )
  )
})

void test('a head reorder during the same run prevents a false completed scan', async () => {
  let persisted: Record<string, unknown> = {}
  let headReads = 0
  const target: FavoriteSessionPort = {
    open: async () => {},
    account: async () => account,
    read: async (_folder, number) =>
      number === 1 ? page([++headReads === 1 ? 11 : 99], true) : page([12], false, 2),
  }
  await assert.rejects(
    collectFavorites(
      config,
      startProgress({}, config),
      { max_pages: 2 },
      new AbortController().signal,
      target,
      async (_account, _page, next) => {
        persisted = { bilibili: next }
      }
    ),
    /采集期间发生变化/
  )
  const cursor = (persisted.bilibili as Progress).folders['900123']!
  assert.equal(cursor.next_page, 2)
  assert.equal(cursor.complete, false)
  assert.equal(cursor.rows, 1)
})

void test('reported count differences from hidden items do not turn a fully traversed scan into an endless restart', async () => {
  const target = session([page([11], true), page([12], false, 2)], [])
  let result: Progress | undefined
  await collectFavorites(
    config,
    startProgress({}, config),
    { max_pages: 2 },
    new AbortController().signal,
    target,
    async (_account, _page, next) => {
      result = next
    }
  )
  assert.equal(result!.last_run.status, 'complete')
  assert.equal(result!.folders['900123']!.reported_count, 41)
  assert.equal(result!.folders['900123']!.rows, 2)
})
