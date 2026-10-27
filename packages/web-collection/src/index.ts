import { z } from 'zod'

export const WEB_RECORD_RESOLVER = 'extensions.web-collection.record.v1'
export const WEB_MATERIAL_RESOLVER = 'extensions.web-collection.material.v1'
export const MATERIAL_BYTE_LIMIT = 32 * 1024 * 1024
export const MATERIAL_WIRE_LIMIT = 48 * 1024 * 1024

export const SourceRecordSchema = z
  .object({
    scope: z.string().min(1).max(512),
    key: z.string().min(1).max(2048),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict()
export const CONTENT_RESOLVERS = {
  text: 'core.text.v1',
  html: 'core.html.v1',
  markdown: 'core.markdown.v1',
  pdf: 'core.pdf.v1',
} as const
export type MaterialFormat = keyof typeof CONTENT_RESOLVERS
export const PART_RELATION = 'extensions.web-collection.part.'
const encodedContent = z.string().min(1)
const ContentPartSchema = z.strictObject({
  role: z.enum(['original', 'body']),
  format: z.enum(['text', 'html', 'markdown', 'pdf']),
  base64: encodedContent,
})
// Frozen outbox payloads retain their original bytes and role names.
const LegacyPartSchema = z.strictObject({
  role: z.enum(['html', 'text', 'pdf']),
  base64: encodedContent,
})
export const MaterialPartSchema = z.union([ContentPartSchema, LegacyPartSchema])

export function partRole(part: { role: string }): 'original' | 'body' {
  return part.role === 'original' || part.role === 'html' ? 'original' : 'body'
}
export function partFormat(part: MaterialPart): MaterialFormat {
  return 'format' in part ? part.format : part.role
}

/** The graph reader and updater reject the same ambiguous body shapes. */
export function selectMaterialParts<T extends { content: string; to_: number | null }>(
  relations: readonly T[]
): Partial<Record<'original' | 'body', T>> {
  const selected: Partial<Record<'original' | 'body', T>> = {}
  for (const relation of relations) {
    if (!relation.content.startsWith(PART_RELATION)) continue
    const role = relation.content.slice(PART_RELATION.length)
    if (!['original', 'body', 'html', 'text', 'pdf'].includes(role)) continue
    const use = partRole({ role })
    if (selected[use] || relation.to_ === null)
      throw new Error('材料关联有歧义，请保留待办并检查图。')
    selected[use] = relation
  }
  return selected
}
export const MaterialMetadataSchema = z
  .object({
    captured_at: z.iso.datetime(),
    url: z.url().refine((value) => /^https?:\/\//.test(value), '只支持 HTTP(S) 网页'),
    method: z.string().min(1).max(128),
    title: z.string(),
    coverage: z.array(z.string()),
  })
  .catchall(z.unknown())
export const SubmitMaterialSchema = z
  .object({
    request_id: z.uuid(),
    mode: z.enum(['record', 'fixed', 'current']),
    source: SourceRecordSchema,
    storage_id: z.number().int().optional(),
    material: MaterialMetadataSchema.optional(),
    parts: z.array(MaterialPartSchema).min(1).max(3).optional(),
    note: z.string().optional(),
  })
  .strict()
  .superRefine((command, ctx) => {
    if (command.mode === 'record') {
      if (command.material || command.parts)
        ctx.addIssue({ code: 'custom', message: '来源记录不能携带正文' })
    } else if (!command.material || !command.parts) {
      ctx.addIssue({ code: 'custom', message: '材料需要出处和正文' })
    }
    if (command.parts && !command.parts.some((part) => partRole(part) === 'body'))
      ctx.addIssue({ code: 'custom', message: '材料需要唯一可用正文' })
    if (command.mode === 'current' && command.note)
      ctx.addIssue({ code: 'custom', message: '附注请另存为主动材料' })
    if (new Set(command.parts?.map(partRole)).size !== (command.parts?.length ?? 0))
      ctx.addIssue({ code: 'custom', message: '正文类型不能重复' })
  })
export type SubmitMaterial = z.infer<typeof SubmitMaterialSchema>
export type SourceRecord = z.infer<typeof SourceRecordSchema>
export type MaterialMetadata = z.infer<typeof MaterialMetadataSchema>
export type MaterialPart = z.infer<typeof MaterialPartSchema>

export const MaterialReceiptSchema = z.object({
  request_id: z.uuid(),
  root_id: z.number().int(),
  source_id: z.number().int().optional(),
  mode: z.enum(['record', 'fixed', 'current']),
  part_ids: z.record(z.string(), z.number().int()),
  committed_at: z.string(),
})
export type MaterialReceipt = z.infer<typeof MaterialReceiptSchema>

export const MaterialReadSchema = z.object({
  root_id: z.number().int(),
  requested_id: z.number().int(),
  mode: z.enum(['record', 'fixed', 'current']),
  source: SourceRecordSchema,
  material: MaterialMetadataSchema.optional(),
  part_ids: z.record(z.string(), z.number().int()),
  parts: z.array(
    z.union([
      ContentPartSchema.extend({ id: z.number().int() }),
      LegacyPartSchema.extend({ id: z.number().int() }),
    ])
  ),
  notes: z.array(z.object({ id: z.number().int(), text: z.string() })),
})
export type MaterialRead = z.infer<typeof MaterialReadSchema>

export function encodeBytes(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(binary)
}
export function decodeBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
}
export function textPart(role: 'html' | 'text', text: string): MaterialPart {
  return { role, base64: encodeBytes(new TextEncoder().encode(text)) }
}
export function contentPart(
  role: 'original' | 'body',
  format: Exclude<MaterialFormat, 'pdf'>,
  content: string
): MaterialPart {
  return { role, format, base64: encodeBytes(new TextEncoder().encode(content)) }
}

export function validateSubmission(value: unknown): SubmitMaterial {
  const command = SubmitMaterialSchema.parse(value)
  const total =
    command.parts?.reduce((sum, part) => sum + decodeBytes(part.base64).byteLength, 0) ?? 0
  if (
    total > MATERIAL_BYTE_LIMIT ||
    new TextEncoder().encode(JSON.stringify(command)).byteLength > MATERIAL_WIRE_LIMIT
  )
    throw new Error('材料超过 32 MiB 正文 / 48 MiB 请求上限，请仅保存链接或缩小选区。')
  return command
}
