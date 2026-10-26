import { z } from 'zod'
import type { Block, Resolver } from '@inkcre/core'

export const captureMetadata = z.object({
  submission_id: z.uuid(),
  payload_digest: z.string().regex(/^[0-9a-f]{64}$/),
  captured_at: z.iso.datetime({ offset: true }),
  entry: z.enum(['selection', 'paste', 'screenshot', 'manual']),
  origin: z
    .object({
      application_id: z.string().nullable().optional(),
      title: z.string().nullable().optional(),
      url: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
})
export const attachmentMetadata = z.object({
  mime_type: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  filename: z.string().nullable().optional(),
})

export interface SolvedMaterial {
  block: Block
  resolver: Resolver
  solvedContent: unknown
}
export interface SolvedCapture {
  metadata: z.infer<typeof captureMetadata>
  materials: SolvedMaterial[]
  annotation: SolvedMaterial | null
}
export interface SolvedAttachment {
  metadata: z.infer<typeof attachmentMetadata>
  content: SolvedMaterial
}

export function safeSourceURL(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}
