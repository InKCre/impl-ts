import { z } from 'zod'

export function peerFileLocation(value: string): { peer: string; path: string } {
  const url = new URL(value)
  if (
    url.protocol !== 'inkcre-peer-file:' ||
    url.username ||
    url.password ||
    url.port ||
    value.includes('?') ||
    value.includes('#')
  )
    throw new Error('原件位置格式无效。')
  const peer = z.uuid().parse(url.hostname)
  const path = decodeURIComponent(url.pathname)
  if (!path.startsWith('/') || path.includes('\0')) throw new Error('原件位置需要绝对路径。')
  return { peer, path }
}

export const fileMetadata = z.strictObject({
  location: z.string().refine((value) => {
    try {
      peerFileLocation(value)
      return true
    } catch {
      return false
    }
  }),
  format: z.enum(['pdf', 'docx', 'markdown', 'org', 'html', 'text']),
  identity: z
    .strictObject({
      volume: z.string(),
      number: z.number().int().nonnegative(),
      created: z.iso.datetime(),
    })
    .optional(),
  available: z.boolean(),
  observed_at: z.iso.datetime(),
  revision: z
    .strictObject({
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      extractor: z.string(),
      extracted_at: z.iso.datetime(),
      scope: z.enum(['text', 'text_layer', 'main_document']),
    })
    .optional(),
  issue: z.string().optional(),
})

export type SolvedFile = {
  metadata: z.infer<typeof fileMetadata>
  text: string | null
  bodyID: number | null
  content: string | null
  format: 'text' | 'html' | 'markdown' | null
}
