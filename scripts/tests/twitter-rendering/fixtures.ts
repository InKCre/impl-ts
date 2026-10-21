import { Block, Resolver } from '@inkcre/core'
import {
  ArchiveMediaResolver,
  ArchivePostResolver,
  TweetResolver,
  type ArchivePostContentModel,
} from '../../../extensions/twitter/src/resolver'
import type { Media, Post, Tweet, User } from '../../../extensions/twitter/src/schema'

const author: User = {
  id: '123456789',
  name: '南山',
  handle: 'nanshan_notes',
  avatarUrl: 'https://example.invalid/avatar.jpg',
  verified: { blue: true },
}
const basePost: Post = {
  id: '1848392839000000001',
  authorId: author.id,
  createdAt: '2026-10-20T10:32:00Z',
  text: {
    text: '🌿 周末散步时遇见的光。\n\n把值得记住的小事留下来，等需要的时候，再慢慢展开。\n#日常 https://example.com/notes',
    entities: [
      { type: 'hashtag', range: [40, 43] },
      { type: 'url', range: [44, 69], expanded: 'https://example.com/notes' },
    ],
  },
  counts: { replies: 12, reposts: 38, quotes: 4, likes: 1284, bookmarks: 26, views: 28400 },
}
const image = (number: number, portrait = false): Media => ({
  id: String(9000 + number),
  type: 'photo',
  url: new URL(`/media.png?image=${number}`, location.origin).href,
  width: portrait ? 900 : 1600,
  height: portrait ? 1600 : 1000,
  alt: `山间光影，图片 ${number}`,
})

export const specimens = [
  { id: 100, name: '单图推文', post: basePost, media: [image(1, true)] },
  {
    id: 101,
    name: '两张图片',
    post: { ...basePost, id: '1848392839000000002' },
    media: [image(1), image(2)],
  },
  {
    id: 102,
    name: '三张图片',
    post: { ...basePost, id: '1848392839000000003' },
    media: [image(1), image(2), image(3)],
  },
  {
    id: 103,
    name: '四张图片',
    post: { ...basePost, id: '1848392839000000004' },
    media: [image(1), image(2), image(3), image(4)],
  },
  {
    id: 104,
    name: '引用与回复',
    post: {
      ...basePost,
      id: '1848392839000000005',
      replyTo: { postId: '1848392839000000020', handle: 'river_notes' },
      quote: { postId: '1848392839000000021' },
    },
    media: [],
  },
  {
    id: 105,
    name: '长文与富文本',
    post: {
      ...basePost,
      id: '1848392839000000006',
      article: {
        id: '987654321',
        title: '让信息回到阅读之中',
        preview: '关于保存、发现和再次阅读的一些笔记。',
        blocks: [
          { type: 'header-two', text: '保留上下文' },
          ...Array.from({ length: 8 }, () => ({
            type: 'unstyled',
            text: '信息的价值常常存在于细节与联系之中。阅读时需要完整的段落、清楚的来源，以及可以随时展开的上下文。保留这些联系，才能在另一次阅读中发现新的意义。',
          })),
          { type: 'unstyled', text: '全文结束标记：所有已保存的正文都应可读。' },
        ],
      },
    },
    media: [],
  },
  {
    id: 106,
    name: '内容缺失',
    post: {
      ...basePost,
      id: '1848392839000000007',
      quote: { postId: '1848392839000000022', tombstone: 'This post is no longer available.' },
    },
    media: [],
  },
  {
    id: 107,
    name: '媒体失败',
    post: { ...basePost, id: '1848392839000000008' },
    media: [{ ...image(1), url: new URL('/missing-media.jpg', location.origin).href }],
  },
  { id: 108, name: '旧格式推文', post: null, media: [] },
  { id: 109, name: '身份占位', post: null, media: [] },
  {
    id: 110,
    name: '视频',
    post: { ...basePost, id: '1848392839000000010' },
    media: [
      {
        id: '9100',
        type: 'video',
        width: 640,
        height: 360,
        url: '',
        video: {
          durationMs: 2000,
          variants: [
            {
              url: new URL('/video.mp4', location.origin).href,
              type: 'video/mp4',
              bitrate: 100000,
            },
          ],
        },
      } satisfies Media,
    ],
  },
  {
    id: 111,
    name: '链接与零计数',
    post: {
      ...basePost,
      id: '1848392839000000011',
      counts: { likes: 0 },
      card: {
        type: 'summary',
        url: 'https://example.com/notes',
        domain: 'example.com',
        title: '给未来的自己留一份阅读笔记',
        description: '保留上下文，按需打开信息。',
      },
      communityNote: { text: { text: '这是一条保存在归档中的补充说明。' } },
    },
    media: [],
  },
  { id: 112, name: '独立媒体 Block', post: null, media: [] },
]

export const models = new Map<number, ArchivePostContentModel>()
export const blocks = new Map<number, Block>()
const legacy: Tweet = {
  id: 12345,
  user_id: '123456789',
  text: '旧格式保存的正文仍然完整可读。\n\n' + '保持自然的段落与阅读节奏。'.repeat(30),
  attachments: [new URL('/media.png?legacy', location.origin).href],
}
for (const item of specimens) {
  const references: ArchivePostContentModel['references'] = item.media.map((record, index) => {
    const blockId = item.id * 10 + index
    blocks.set(
      blockId,
      Block.parse({
        id: blockId,
        storage: null,
        resolver: ArchiveMediaResolver.type,
        content: JSON.stringify(record),
      })
    )
    return {
      blockId,
      record,
      reference: { schema: 'extensions.twitter.reference.v1', type: 'media', position: index },
    }
  })
  if (item.id === 104) {
    references.push({
      blockId: 120,
      reference: { schema: 'extensions.twitter.reference.v1', type: 'quote' },
      record: {
        ...basePost,
        id: '1848392839000000021',
        text: { text: '好的阅读体验，应当让内容自己说话。' },
      },
    })
    references.push({
      blockId: 121,
      reference: { schema: 'extensions.twitter.reference.v1', type: 'reply' },
      record: { id: '1848392839000000020' },
    })
  }
  const model: ArchivePostContentModel = {
    post: item.post ?? { id: '1848392839000000009' },
    author: item.id === 109 ? null : author,
    references,
  }
  models.set(item.id, model)
  blocks.set(
    item.id,
    Block.parse({
      id: item.id,
      storage: null,
      resolver: item.id === 108 ? TweetResolver.type : ArchivePostResolver.type,
      content: JSON.stringify(item.id === 108 ? legacy : model.post),
    })
  )
}
models.set(120, {
  post: {
    ...basePost,
    id: '1848392839000000021',
    text: { text: '好的阅读体验，应当让内容自己说话。' },
  },
  author,
  references: [],
})
blocks.set(
  120,
  Block.parse({
    id: 120,
    storage: null,
    resolver: ArchivePostResolver.type,
    content: JSON.stringify(models.get(120)!.post),
  })
)
blocks.set(
  121,
  Block.parse({
    id: 121,
    storage: null,
    resolver: ArchivePostResolver.type,
    content: '{"id":"1848392839000000020"}',
  })
)
models.set(121, { post: { id: '1848392839000000020' }, author: null, references: [] })

// Replace only stored-record access; real renderers, media loading and host components run.
class SpecimenPostResolver extends ArchivePostResolver {
  protected async _getSolvedContent(): Promise<ArchivePostContentModel> {
    return models.get(this.block.id)!
  }
}
class SpecimenLegacyResolver extends TweetResolver {
  protected async _getSolvedContent(): Promise<Tweet> {
    return legacy
  }
}
Resolver.register(ArchivePostResolver.type, SpecimenPostResolver)
Resolver.register(TweetResolver.type, SpecimenLegacyResolver)
Resolver.register(ArchiveMediaResolver.type, ArchiveMediaResolver)
Block.find = async (id) => blocks.get(id) ?? null

blocks.set(
  112,
  Block.parse({
    id: 112,
    storage: null,
    resolver: ArchiveMediaResolver.type,
    content: JSON.stringify(image(1, true)),
  })
)

export function resolverFor(id: number): Resolver {
  const block = blocks.get(id)!
  return new (Resolver.getClass(block.resolver))(block)
}
export const solvedFor = (id: number) =>
  id === 108 ? legacy : id === 112 ? image(1, true) : models.get(id)!
