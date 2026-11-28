import {
  Block,
  Relation,
  Resolver,
  ResolverCache,
  TextResolver,
  type ProjectionOptions,
} from '@inkcre/core'
import { markRaw } from 'vue'
import MailExtension from '../src'
import { MailMimePartResolver } from '../src/resolver'
import BodyRenderer from '../src/components/contentNewsletterBody.vue'
import BodyPreview from '../src/components/contentNewsletterPreview.vue'

TextResolver.previewRenderer = markRaw(BodyPreview)
TextResolver.solvedContentRenderer = markRaw(BodyRenderer)
Resolver.register(TextResolver.type, TextResolver)

const mode = new URLSearchParams(location.search).get('case')
const blocks = new Map<number, Block>()
function block(id: number, resolver: string, content: string): Block {
  const value = Block.parse({
    id,
    resolver,
    content,
    storage: null,
    updated_at: '2026-10-20T00:00:00Z',
  })
  blocks.set(id, value)
  return value
}
const mime = block(1, MailMimePartResolver.type, JSON.stringify({ media_type: 'text/plain' }))
block(2, 'core.text.v1', 'Persisted MIME payload')
const rows: Relation[] = []
function relate(from_: number, to_: number): void {
  rows.push(Relation.parse({ id: rows.length + 1, from_, to_, content: 'content' }))
}

// Only graph persistence is replaced.
Block.find = async (id) => blocks.get(id) ?? null
let reads = 0
let release!: () => void
let fail!: (error: Error) => void
const gate = new Promise<void>((resolve, reject) => {
  release = resolve
  fail = reject
})
let entered!: () => void
const started = new Promise<void>((resolve) => {
  entered = resolve
})
Relation.getByBlock = async (id) => {
  reads++
  if (reads === 1 && ['parallel', 'options', 'failure'].includes(mode ?? '')) {
    entered()
    await gate
  }
  return rows.filter((row) => row.from_ === id || row.to_ === id)
}
class CustomResolver extends Resolver<string, string> {
  static readonly type = 'test.mail.custom.v1'
  static readonly previewRenderer = { render: () => null }
  static readonly solvedContentRenderer = { render: () => null }
  protected override async _getSolvedContent(options: ProjectionOptions): Promise<string> {
    if (mode !== 'custom-cycle') return 'Custom content remains supported'
    const parent = await ResolverCache.getResolver(mime)
    await parent.getSolvedContent(options)
    return 'unreachable'
  }
  override getText(options: ProjectionOptions = {}): Promise<string> {
    return this.getSolvedContent(options)
  }
}
Resolver.register(CustomResolver.type, CustomResolver)

async function run(): Promise<unknown> {
  await MailExtension.initialize()
  if (mode === 'self') relate(mime.id, mime.id)
  else if (mode === 'custom' || mode === 'custom-cycle') {
    relate(mime.id, block(4, CustomResolver.type, '').id)
  } else relate(mime.id, 2)

  const resolver = await ResolverCache.getResolver<MailMimePartResolver>(mime)
  const first = resolver.getSolvedContent({ materializeMissing: false })
  if (['parallel', 'options', 'failure'].includes(mode ?? '')) await started
  if (mode === 'parallel') {
    const second = resolver.getSolvedContent({ context: 'default', materializeMissing: false })
    release()
    const [left, right] = await Promise.all([first, second])
    return {
      reads,
      content: [left.content?.solvedContent, right.content?.solvedContent],
    }
  }
  if (mode === 'options') {
    const distinct = await Promise.allSettled([
      resolver.getSolvedContent({ refresh: true, materializeMissing: false }),
      resolver.getSolvedContent({ materializeMissing: true }),
      resolver.getSolvedContent({ context: 'lexical', materializeMissing: false }),
    ])
    release()
    await first
    return distinct.map((item) =>
      item.status === 'rejected' ? String(item.reason) : 'unexpected success'
    )
  }
  if (mode === 'failure') {
    const expected = new Error('MIME relation read failed')
    const second = resolver.getSolvedContent({ materializeMissing: false })
    const settled = Promise.allSettled([first, second])
    fail(expected)
    const failures = await settled
    const retry = await resolver.getSolvedContent({ materializeMissing: false })
    return {
      failures: failures.map((item) => item.status === 'rejected' && item.reason === expected),
      reads,
      retry: retry.content?.solvedContent,
    }
  }
  return { content: (await first).content?.solvedContent }
}

void run().then(
  (value) => {
    document.getElementById('result')!.textContent = JSON.stringify(value)
  },
  (error: unknown) => {
    document.getElementById('result')!.textContent = JSON.stringify({ error: String(error) })
  }
)
