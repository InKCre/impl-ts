/**
 * Twitter Resolver
 *
 * Handles Tweet content with inline media display.
 * Aligned with core-py's TweetResolver (rso_type="tweet")
 *
 * Features:
 * - Parses raw JSON to Tweet object
 * - Fetches attachment images/videos from relations
 * - Uses resolver cache to avoid redundant content loading
 * - Gracefully handles missing/invalid attachments
 */

import { markRaw } from 'vue'
import {
  Block,
  Resolver,
  ResolverCache,
  HttpStorage,
  type ImageSolvedContent,
  type ProjectionOptions,
  type VideoSolvedContent,
} from '@inkcre/core'
import {
  TweetSchema,
  type Tweet,
  MediaRecordSchema,
  PostRecordSchema,
  PostReferenceSchema,
  UserRecordSchema,
  type MediaRecord,
  type Post,
  type PostRecord,
  type PostReference,
  type User,
  type Media,
  type UserRecord,
  RELATION_ATTACHMENT_PHOTO,
  RELATION_ATTACHMENT_VIDEO,
} from './schema'
import ContentTweet from './components/contentTweet/contentTweet.vue'
import ContentTweetPreview from './components/contentTweet/contentTweetPreview.vue'
import ArchivePostContent from './components/contentTweet/archivePostContent.vue'
import ArchivePostPreview from './components/contentTweet/archivePostPreview.vue'
import ArchiveUserContent from './components/contentTweet/archiveUserContent.vue'
import ArchiveUserPreview from './components/contentTweet/archiveUserPreview.vue'
import ArchiveMediaContent from './components/contentTweet/archiveMediaContent.vue'
import ArchiveMediaPreview from './components/contentTweet/archiveMediaPreview.vue'

type ArchiveReference = {
  blockId: number
  reference: PostReference
  record: UserRecord | PostRecord | MediaRecord | null
}

export type ArchivePostContentModel = {
  post: PostRecord
  references: ArchiveReference[]
  author: UserRecord | null
}

export type ArchiveMediaContentModel = {
  media: MediaRecord
  content: ImageSolvedContent | VideoSolvedContent | null
}

function parseJson(value: string): unknown {
  return JSON.parse(value)
}

function recordForReference(
  reference: PostReference,
  block: Block
): UserRecord | PostRecord | MediaRecord | null {
  const value = parseJson(block.content)
  if (reference.type === 'author') return UserRecordSchema.parse(value)
  if (reference.type === 'media') return MediaRecordSchema.parse(value)
  return PostRecordSchema.parse(value)
}

function postIndexText(post: Post): string {
  const text = post.text?.text ?? ''
  const article = post.article
  const articleText = article
    ? [article.title, article.preview, ...(article.blocks ?? []).map((block) => block.text)]
        .filter(Boolean)
        .join('\n')
    : ''
  const cardText = [post.card?.title, post.card?.description].filter(Boolean).join('\n')
  const contextText = [
    post.replyTo?.postId,
    post.replyTo?.handle,
    post.replyTo?.userId,
    post.replyTo?.tombstone,
    post.quote?.postId,
    post.quote?.url,
    post.quote?.tombstone,
    post.repostOf,
  ]
    .filter(Boolean)
    .join('\n')
  return [text, articleText, cardText, contextText].filter(Boolean).join('\n')
}

function isPost(record: PostRecord): record is Post {
  return 'authorId' in record
}

function isUser(record: UserRecord): record is User {
  return 'handle' in record && typeof record.handle === 'string'
}

function isMedia(record: MediaRecord): record is Media {
  return 'type' in record && typeof record.type === 'string'
}

export class TweetResolver extends Resolver<string, Tweet> {
  static readonly type = 'extensions.twitter.tweet.v1'
  static readonly previewRenderer = markRaw(ContentTweetPreview)
  static readonly solvedContentRenderer = markRaw(ContentTweet)

  protected async _getSolvedContent(options: ProjectionOptions): Promise<Tweet> {
    const rawContent = await this.getRawContent(options)
    const tweet = TweetSchema.parse(JSON.parse(rawContent))

    // If attachments are already populated, return as-is
    if (tweet.attachments && tweet.attachments.length > 0) {
      return tweet
    }

    // Fetch attachment relations (outgoing only: from_ = this block)
    const attachmentRelations = await this.getRelations({
      includeOut: true,
      includeIn: false,
      refresh: options.refresh,
    })

    const attachmentPatterns = [RELATION_ATTACHMENT_PHOTO, RELATION_ATTACHMENT_VIDEO]
    const filteredRelations = attachmentRelations.filter((rel) =>
      attachmentPatterns.some((pattern) => rel.content.startsWith(pattern))
    )

    if (filteredRelations.length === 0) {
      return tweet
    }

    // Resolve attachment content
    try {
      const attachments: string[] = []

      for (const relation of filteredRelations) {
        try {
          // Get the attachment block from relation
          const { Block } = await import('@inkcre/core')
          const attachmentBlock = await Block.get(relation.to_)

          // Use ResolverCache to get resolver for attachment block
          const attachmentResolver = await ResolverCache.getResolver(attachmentBlock)
          const attachmentContent = await attachmentResolver.getSolvedContent(options)

          if (
            typeof attachmentContent === 'object' &&
            attachmentContent !== null &&
            'objectUrl' in attachmentContent &&
            typeof attachmentContent.objectUrl === 'string'
          ) {
            attachments.push(attachmentContent.objectUrl)
          }
        } catch (error) {
          // Log error but continue with other attachments
          console.warn(
            `[TweetResolver] Failed to resolve attachment relation ${relation.id}:`,
            error
          )
        }
      }

      // Populate attachments array
      if (attachments.length > 0) {
        tweet.attachments = attachments
      }
    } catch (error) {
      // Log error but return tweet without attachments
      console.warn('[TweetResolver] Failed to fetch attachments:', error)
    }

    return tweet
  }

  async getText(options: ProjectionOptions = {}): Promise<string> {
    return (await this.getSolvedContent(options)).text
  }
}

export class ArchivePostResolver extends Resolver<string, ArchivePostContentModel> {
  static readonly type = 'extensions.twitter.tweet.v2'
  static readonly previewRenderer = markRaw(ArchivePostPreview)
  static readonly solvedContentRenderer = markRaw(ArchivePostContent)

  protected async _getSolvedContent(options: ProjectionOptions): Promise<ArchivePostContentModel> {
    const post = PostRecordSchema.parse(parseJson(await this.getRawContent(options)))
    const relations = await this.getRelations({
      includeOut: true,
      includeIn: false,
      refresh: options.refresh,
    })
    const references = relations.flatMap((relation) => {
      try {
        return [{ relation, reference: PostReferenceSchema.parse(parseJson(relation.content)) }]
      } catch {
        return []
      }
    })
    const blocks = await Block.getMany(references.map(({ relation }) => relation.to_))
    const blocksById = new Map(blocks.map((block) => [block.id, block]))
    const resolvedReferences = references.map(({ relation, reference }) => {
      const block = blocksById.get(relation.to_)
      let record: ArchiveReference['record'] = null
      if (block) {
        try {
          record = recordForReference(reference, block)
        } catch {
          record = null
        }
      }
      return { blockId: relation.to_, reference, record }
    })
    return {
      post,
      references: resolvedReferences,
      author:
        (resolvedReferences.find(({ reference }) => reference.type === 'author')
          ?.record as UserRecord | null) ?? null,
    }
  }

  async getText(options: ProjectionOptions = {}): Promise<string | null> {
    const content = await this.getSolvedContent(options)
    if (!isPost(content.post)) return null
    const author =
      content.author && isUser(content.author)
        ? `${content.author.name} @${content.author.handle}`
        : ''
    return [author, postIndexText(content.post)].filter(Boolean).join('\n') || null
  }
}

export class ArchiveUserResolver extends Resolver<string, UserRecord> {
  static readonly type = 'extensions.twitter.user.v1'
  static readonly previewRenderer = markRaw(ArchiveUserPreview)
  static readonly solvedContentRenderer = markRaw(ArchiveUserContent)

  protected async _getSolvedContent(options: ProjectionOptions): Promise<UserRecord> {
    return UserRecordSchema.parse(parseJson(await this.getRawContent(options)))
  }

  async getText(options: ProjectionOptions = {}): Promise<string | null> {
    const user = await this.getSolvedContent(options)
    if (!isUser(user)) return null
    return [user.name, user.handle, user.bio?.text, user.location, user.website]
      .filter(Boolean)
      .join('\n')
  }
}

export class ArchiveMediaResolver extends Resolver<string, MediaRecord> {
  static readonly type = 'extensions.twitter.media.v1'
  static readonly previewRenderer = markRaw(ArchiveMediaPreview)
  static readonly solvedContentRenderer = markRaw(ArchiveMediaContent)
  private objectUrl: string | null = null

  protected async _getSolvedContent(options: ProjectionOptions): Promise<MediaRecord> {
    return MediaRecordSchema.parse(parseJson(await this.getRawContent(options)))
  }

  async getText(options: ProjectionOptions = {}): Promise<string | null> {
    const media = await this.getSolvedContent(options)
    if (!isMedia(media)) return null
    return [media.alt, media.title, media.description, media.link, media.type]
      .filter(Boolean)
      .join('\n')
  }

  async loadContent(_options: ProjectionOptions = {}): Promise<ArchiveMediaContentModel> {
    const media = await this.getSolvedContent(_options)
    if (!isMedia(media)) return { media, content: null }
    const source = media.type === 'photo' ? media.url : bestVideoUrl(media)
    if (!source) return { media, content: null }

    const bytes = await new HttpStorage({ type: 'http', config: {} }).getRawContent({
      id: this.block.id,
      storage: null,
      content: source,
    })
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
    const mediaType = media.type === 'photo' ? imageMediaType(new URL(source)) : 'video/mp4'
    this.objectUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mediaType }))
    const byteContent = {
      content: bytes,
      byte_size: bytes.byteLength,
      detected_media_type: null,
      objectUrl: this.objectUrl,
    }
    return media.type === 'photo'
      ? {
          media,
          content: {
            ...byteContent,
            format: null,
            width: media.width ?? null,
            height: media.height ?? null,
            frame_count: null,
          } satisfies ImageSolvedContent,
        }
      : {
          media,
          content: {
            ...byteContent,
            container: 'mp4',
            video_codec: null,
            duration_ms: media.video?.durationMs ?? null,
            width: media.width ?? null,
            height: media.height ?? null,
            frame_rate: null,
          } satisfies VideoSolvedContent,
        }
  }

  async dispose(): Promise<void> {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
    this.objectUrl = null
  }
}

function bestVideoUrl(media: Media): string | null {
  const variants = [...(media.video?.variants ?? [])]
    .filter((variant) => variant.type === 'video/mp4' && variant.url.trim().length > 0)
    .sort((left, right) => (right.bitrate ?? -1) - (left.bitrate ?? -1))
  return variants[0]?.url ?? null
}

function imageMediaType(url: URL): string {
  const format = (
    url.searchParams.get('format') ??
    url.pathname.split('.').at(-1) ??
    ''
  ).toLowerCase()
  if (format === 'png') return 'image/png'
  if (format === 'webp') return 'image/webp'
  if (format === 'gif') return 'image/gif'
  return 'image/jpeg'
}
