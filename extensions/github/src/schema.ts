import { z } from 'zod'

export const AccountSchema = z.strictObject({
  node_id: z.string(),
  database_id: z.number().int().nullable().default(null),
  kind: z.enum(['user', 'organization']),
  login: z.string(),
  name: z.string().nullable().default(null),
  url: z.string(),
  avatar_url: z.string().nullable().default(null),
})
export const RepositorySchema = z.strictObject({
  node_id: z.string(),
  database_id: z.number().int().nullable().default(null),
  name_with_owner: z.string(),
  description: z.string().nullable().default(null),
  url: z.string(),
  homepage_url: z.string().nullable().default(null),
  primary_language: z.string().nullable().default(null),
  topics: z.array(z.string()).default([]),
  is_private: z.boolean(),
  is_archived: z.boolean(),
})
export const ListSchema = z.strictObject({
  node_id: z.string(),
  name: z.string(),
  description: z.string().nullable().default(null),
  slug: z.string(),
  is_private: z.boolean(),
})
export type Account = z.infer<typeof AccountSchema>
export type Repository = z.infer<typeof RepositorySchema>
export type GitHubList = z.infer<typeof ListSchema>
export type RelatedRecord =
  | { type: 'account'; content: Account }
  | { type: 'repository'; content: Repository }
  | { type: 'list'; content: GitHubList }
export type RelatedBlock = RelatedRecord & { blockId: number }
export interface RelatedGroup {
  title: string
  blocks: RelatedBlock[]
}
export interface SolvedGitHub<Content> {
  record: Content
  groups: RelatedGroup[]
}

/** External record URLs are displayed only as HTTP(S) links without embedded credentials. */
export function safeWebUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}
export function relatedTitle(block: RelatedBlock): string {
  if (block.type === 'account') return block.content.name || `@${block.content.login}`
  if (block.type === 'repository') return block.content.name_with_owner
  return block.content.name
}
