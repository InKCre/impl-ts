import { z } from 'zod'

export const extensionName = 'inkcre/bilibili'
export const sourceType = 'extensions.bilibili.favorites.v1'
export const resolverTypes = {
  user: 'extensions.bilibili.user.v1',
  folder: 'extensions.bilibili.folder.v1',
  video: 'extensions.bilibili.video.v1',
  membership: 'extensions.bilibili.membership.v1',
} as const

export const NativeIdSchema = z.string().regex(/^[1-9]\d*$/)
const instant = z.iso.datetime()
export const UserSchema = z.strictObject({
  mid: NativeIdSchema,
  name: z.string().optional(),
  avatar_url: z.url().optional(),
})
export const FolderSchema = z.strictObject({
  id: NativeIdSchema,
  title: z.string().optional(),
  description: z.string().optional(),
  is_private: z.boolean().optional(),
  reported_count: z.number().int().nonnegative().optional(),
})
export const VideoSchema = z.strictObject({
  aid: NativeIdSchema,
  bvid: z
    .string()
    .regex(/^BV[0-9A-Za-z]{10}$/)
    .optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  duration_seconds: z.number().int().nonnegative().optional(),
  published_at: instant.optional(),
  cover_url: z.url().optional(),
})
// Availability and bookmark time describe this account's list item, not the global video.
export const MembershipSchema = z.strictObject({
  availability: z.enum(['available', 'unavailable', 'unknown']),
  page_number: z.number().int().positive().optional(),
  position_in_page: z.number().int().nonnegative().optional(),
  favored_at: instant.optional(),
  observed_at: instant,
})
export const SourceConfigSchema = z.strictObject({
  provider: z.uuid(),
  account_mid: NativeIdSchema,
  folder_ids: z
    .array(NativeIdSchema)
    .min(1)
    .max(128)
    .refine((ids) => new Set(ids).size === ids.length),
})
export const CollectConfigSchema = z.strictObject({
  max_pages: z.number().int().min(1).max(100).default(10),
})
export type User = z.infer<typeof UserSchema>
export type Folder = z.infer<typeof FolderSchema>
export type Video = z.infer<typeof VideoSchema>
export type Membership = z.infer<typeof MembershipSchema>
export type BilibiliSourceConfig = z.infer<typeof SourceConfigSchema>
export type CollectConfig = z.infer<typeof CollectConfigSchema>

export function nativeId(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('来源身份不是安全整数。')
    return String(value)
  }
  return NativeIdSchema.parse(value)
}

export function videoUrl(video: Video): string {
  return `https://www.bilibili.com/video/${video.bvid ?? `av${video.aid}`}`
}

export function safeWebUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null
  } catch {
    return null
  }
}

export type BilibiliRecord =
  | { kind: 'user'; record: User }
  | { kind: 'folder'; record: Folder }
  | { kind: 'video'; record: Video }
  | { kind: 'membership'; record: Membership }

export function recordTitle(value: BilibiliRecord): string {
  switch (value.kind) {
    case 'user':
      return value.record.name || `UID ${value.record.mid}`
    case 'folder':
      return value.record.title || `收藏夹 ${value.record.id}`
    case 'video':
      return value.record.title || value.record.bvid || `av${value.record.aid}`
    case 'membership':
      return value.record.availability === 'unavailable' ? '已失效的收藏条目' : '收藏条目'
  }
}

export function parseRecord(resolver: string, content: unknown): BilibiliRecord | null {
  switch (resolver) {
    case resolverTypes.user:
      return { kind: 'user', record: UserSchema.parse(content) }
    case resolverTypes.folder:
      return { kind: 'folder', record: FolderSchema.parse(content) }
    case resolverTypes.video:
      return { kind: 'video', record: VideoSchema.parse(content) }
    case resolverTypes.membership:
      return { kind: 'membership', record: MembershipSchema.parse(content) }
    default:
      return null
  }
}
