import { z } from 'zod'
import {
  FolderSchema,
  MembershipSchema,
  UserSchema,
  VideoSchema,
  nativeId,
  type Folder,
  type Membership,
  type User,
  type Video,
} from './schema.ts'

const object = z.record(z.string(), z.unknown())
export interface FavoriteItem {
  video: Video
  uploader: User | null
  membership: Membership
}
export interface FavoritePage {
  folder: Folder
  owner: User
  items: FavoriteItem[]
  hasMore: boolean
  unsupported: number
  unresolved: number
  totalItems: number
  ids: string[]
}

export function responseData(response: unknown): Record<string, unknown> {
  const envelope = object.parse(response)
  if (envelope.code !== 0) {
    const message = typeof envelope.message === 'string' ? envelope.message : 'B 站未返回成功结果。'
    throw new Error(`B 站请求失败（${String(envelope.code)}）：${message}`)
  }
  return object.parse(envelope.data)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
function seconds(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}
function instant(value: unknown): string | undefined {
  const timestamp = seconds(value)
  if (!timestamp) return undefined
  const date = new Date(timestamp * 1000)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}
function webUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}

export function parseUser(value: unknown): User {
  const user = object.parse(value)
  return UserSchema.parse({
    mid: nativeId(user.mid),
    name: text(user.name ?? user.uname),
    avatar_url: webUrl(user.face),
  })
}

export function parseAccount(response: unknown): User {
  const data = responseData(response)
  if (data.isLogin !== true) throw new Error('请先在所选浏览器登录 B 站，再读取收藏夹。')
  return parseUser(data)
}

export function parseFolder(
  value: unknown,
  expectedOwner: string
): { folder: Folder; owner: User } {
  const info = object.parse(value)
  const owner = parseUser(info.upper ?? { mid: info.mid })
  if (owner.mid !== expectedOwner || (info.mid != null && nativeId(info.mid) !== expectedOwner))
    throw new Error('收藏夹不属于已确认的 B 站账号。')
  return {
    owner,
    folder: FolderSchema.parse({
      // info.fid is the original folder number; info.id is the full media_id used by the site.
      id: nativeId(info.id),
      title: text(info.title),
      description: text(info.intro),
      is_private: typeof info.attr === 'number' ? (info.attr & 1) === 1 : undefined,
      reported_count: seconds(info.media_count),
    }),
  }
}

export function parseFolders(response: unknown, owner: string): Folder[] {
  const data = responseData(response)
  if (!Array.isArray(data.list)) throw new Error('B 站未返回可识别的自建收藏夹列表。')
  return data.list.map((value) => {
    const row = object.parse(value)
    return parseFolder({ ...row, upper: row.upper ?? { mid: row.mid ?? owner } }, owner).folder
  })
}

export function parseFavoritePage(
  response: unknown,
  expectedOwner: string,
  expectedFolder: string,
  page: number,
  observedAt = new Date().toISOString(),
  pageSize = 20
): FavoritePage {
  const data = responseData(response)
  const { folder, owner } = parseFolder(data.info, expectedOwner)
  if (folder.id !== expectedFolder) throw new Error('B 站返回了另一个收藏夹的数据。')
  if (typeof data.has_more !== 'boolean')
    throw new Error('B 站分页结束标记缺失，无法确认采集范围。')
  const medias = data.medias === null && !data.has_more ? [] : data.medias
  if (!Array.isArray(medias)) throw new Error('B 站未返回可识别的收藏条目。')
  if (medias.length > pageSize)
    throw new Error('B 站返回了超出分页范围的条目，需重新核实分页协议。')
  if (medias.length === 0 && data.has_more)
    throw new Error('收藏分页为空但仍声明有后续，已停止采集。')
  const items: FavoriteItem[] = []
  let unsupported = 0
  let unresolved = 0
  for (let index = 0; index < medias.length; index++) {
    const raw = object.safeParse(medias[index])
    if (!raw.success) {
      unresolved++
      continue
    }
    const value = raw.data
    if (value.type !== 2) {
      unsupported++
      continue
    }
    try {
      const aid = nativeId(value.id)
      const unavailable =
        value.title === '已失效视频' || (typeof value.attr === 'number' && (value.attr & 1) === 1)
      const bvid = z
        .string()
        .regex(/^BV[0-9A-Za-z]{10}$/)
        .safeParse(value.bvid ?? value.bv_id)
      let uploader: User | null = null
      if (value.upper != null) {
        try {
          uploader = parseUser(value.upper)
        } catch {
          /* A missing uploader must not discard an identified video. */
        }
      }
      items.push({
        video: VideoSchema.parse({
          aid,
          bvid: bvid.success ? bvid.data : undefined,
          title: unavailable ? undefined : text(value.title),
          description: unavailable ? undefined : text(value.intro),
          duration_seconds: unavailable ? undefined : seconds(value.duration),
          published_at: unavailable ? undefined : instant(value.pubtime),
          cover_url: unavailable ? undefined : webUrl(value.cover),
        }),
        uploader,
        membership: MembershipSchema.parse({
          availability: unavailable ? 'unavailable' : 'available',
          page_number: page,
          position_in_page: index,
          favored_at: instant(value.fav_time),
          observed_at: observedAt,
        }),
      })
    } catch {
      unresolved++
    }
  }
  const ids = medias.map((value, index) => {
    const row = object.safeParse(value)
    if (!row.success) return `unresolved:${index}`
    try {
      return `${String(row.data.type)}:${nativeId(row.data.id)}`
    } catch {
      return `unresolved:${index}`
    }
  })
  return {
    folder,
    owner,
    items,
    hasMore: data.has_more,
    unsupported,
    unresolved,
    totalItems: medias.length,
    ids,
  }
}
